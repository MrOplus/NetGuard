/*
 * NetGuard WFP Callout Driver
 *
 * This driver intercepts outbound network connections using Windows Filtering Platform
 * and blocks unknown applications until the user approves them.
 *
 * Build Requirements:
 * - Windows Driver Kit (WDK) 10
 * - Visual Studio 2019/2022 with WDK integration
 *
 * To build: Use Visual Studio with WDK or run from Developer Command Prompt:
 *   msbuild netguard_wfp.vcxproj /p:Configuration=Release /p:Platform=x64
 */

#include <ntddk.h>
#include <wdf.h>
#include <fwpsk.h>
#include <fwpmk.h>
#include <mstcpip.h>

#define NETGUARD_DEVICE_NAME L"\\Device\\NetGuardWFP"
#define NETGUARD_SYMBOLIC_NAME L"\\DosDevices\\NetGuardWFP"

// IOCTL codes for user-mode communication
#define IOCTL_NETGUARD_GET_PENDING    CTL_CODE(FILE_DEVICE_UNKNOWN, 0x800, METHOD_BUFFERED, FILE_READ_DATA)
#define IOCTL_NETGUARD_RESPOND        CTL_CODE(FILE_DEVICE_UNKNOWN, 0x801, METHOD_BUFFERED, FILE_WRITE_DATA)
#define IOCTL_NETGUARD_ADD_ALLOWED    CTL_CODE(FILE_DEVICE_UNKNOWN, 0x802, METHOD_BUFFERED, FILE_WRITE_DATA)
#define IOCTL_NETGUARD_REMOVE_ALLOWED CTL_CODE(FILE_DEVICE_UNKNOWN, 0x803, METHOD_BUFFERED, FILE_WRITE_DATA)
#define IOCTL_NETGUARD_ENABLE         CTL_CODE(FILE_DEVICE_UNKNOWN, 0x804, METHOD_BUFFERED, FILE_WRITE_DATA)
#define IOCTL_NETGUARD_DISABLE        CTL_CODE(FILE_DEVICE_UNKNOWN, 0x805, METHOD_BUFFERED, FILE_WRITE_DATA)

// Maximum pending connections
#define MAX_PENDING_CONNECTIONS 256
#define MAX_ALLOWED_APPS 1024
#define MAX_PATH_LENGTH 512

// Pending connection structure
typedef struct _PENDING_CONNECTION {
    UINT64 connectionId;
    UINT32 processId;
    WCHAR processPath[MAX_PATH_LENGTH];
    UINT32 remoteIp;
    UINT16 remotePort;
    LARGE_INTEGER timestamp;
    BOOLEAN responded;
    BOOLEAN allowed;
} PENDING_CONNECTION, *PPENDING_CONNECTION;

// Allowed application structure
typedef struct _ALLOWED_APP {
    WCHAR processPath[MAX_PATH_LENGTH];
    BOOLEAN blocked; // TRUE = blocked, FALSE = allowed
} ALLOWED_APP, *PALLOWED_APP;

// Global state
typedef struct _NETGUARD_CONTEXT {
    PDEVICE_OBJECT DeviceObject;
    HANDLE EngineHandle;
    UINT32 CalloutId;
    UINT32 FilterId;
    BOOLEAN Enabled;

    // Pending connections
    PENDING_CONNECTION PendingConnections[MAX_PENDING_CONNECTIONS];
    UINT32 PendingCount;
    KSPIN_LOCK PendingLock;
    KEVENT PendingEvent;

    // Allowed/blocked apps
    ALLOWED_APP AllowedApps[MAX_ALLOWED_APPS];
    UINT32 AllowedCount;
    KSPIN_LOCK AllowedLock;

    // Statistics
    UINT64 TotalConnections;
    UINT64 BlockedConnections;
    UINT64 AllowedConnections;
} NETGUARD_CONTEXT, *PNETGUARD_CONTEXT;

NETGUARD_CONTEXT g_Context = {0};

// Forward declarations
DRIVER_INITIALIZE DriverEntry;
DRIVER_UNLOAD DriverUnload;

NTSTATUS NetGuardCreate(PDEVICE_OBJECT DeviceObject, PIRP Irp);
NTSTATUS NetGuardClose(PDEVICE_OBJECT DeviceObject, PIRP Irp);
NTSTATUS NetGuardDeviceControl(PDEVICE_OBJECT DeviceObject, PIRP Irp);

NTSTATUS RegisterWfpCallout(void);
NTSTATUS UnregisterWfpCallout(void);

// WFP Callout functions
void NTAPI NetGuardClassifyFn(
    const FWPS_INCOMING_VALUES0* inFixedValues,
    const FWPS_INCOMING_METADATA_VALUES0* inMetaValues,
    void* layerData,
    const void* classifyContext,
    const FWPS_FILTER1* filter,
    UINT64 flowContext,
    FWPS_CLASSIFY_OUT0* classifyOut
);

NTSTATUS NTAPI NetGuardNotifyFn(
    FWPS_CALLOUT_NOTIFY_TYPE notifyType,
    const GUID* filterKey,
    FWPS_FILTER1* filter
);

void NTAPI NetGuardFlowDeleteFn(
    UINT16 layerId,
    UINT32 calloutId,
    UINT64 flowContext
);

// GUIDs for WFP registration
DEFINE_GUID(NETGUARD_CALLOUT_GUID,
    0x12345678, 0x1234, 0x1234, 0x12, 0x34, 0x12, 0x34, 0x56, 0x78, 0x9a, 0xbc);

DEFINE_GUID(NETGUARD_SUBLAYER_GUID,
    0x87654321, 0x4321, 0x4321, 0x43, 0x21, 0xab, 0xcd, 0xef, 0x12, 0x34, 0x56);

// Helper: Check if process is in allowed/blocked list
int IsAppInList(PWCHAR processPath, PBOOLEAN isBlocked) {
    KIRQL oldIrql;
    int found = 0;

    KeAcquireSpinLock(&g_Context.AllowedLock, &oldIrql);

    for (UINT32 i = 0; i < g_Context.AllowedCount; i++) {
        if (_wcsicmp(g_Context.AllowedApps[i].processPath, processPath) == 0) {
            *isBlocked = g_Context.AllowedApps[i].blocked;
            found = 1;
            break;
        }
    }

    KeReleaseSpinLock(&g_Context.AllowedLock, oldIrql);
    return found;
}

// Helper: Add pending connection
UINT64 AddPendingConnection(UINT32 processId, PWCHAR processPath, UINT32 remoteIp, UINT16 remotePort) {
    KIRQL oldIrql;
    UINT64 connectionId = 0;

    KeAcquireSpinLock(&g_Context.PendingLock, &oldIrql);

    if (g_Context.PendingCount < MAX_PENDING_CONNECTIONS) {
        PPENDING_CONNECTION conn = &g_Context.PendingConnections[g_Context.PendingCount];

        conn->connectionId = InterlockedIncrement64((PLONG64)&g_Context.TotalConnections);
        conn->processId = processId;
        wcsncpy(conn->processPath, processPath, MAX_PATH_LENGTH - 1);
        conn->remoteIp = remoteIp;
        conn->remotePort = remotePort;
        KeQuerySystemTime(&conn->timestamp);
        conn->responded = FALSE;
        conn->allowed = FALSE;

        connectionId = conn->connectionId;
        g_Context.PendingCount++;

        // Signal user-mode that there's a pending connection
        KeSetEvent(&g_Context.PendingEvent, IO_NO_INCREMENT, FALSE);
    }

    KeReleaseSpinLock(&g_Context.PendingLock, oldIrql);
    return connectionId;
}

// WFP Classify function - called for each connection
void NTAPI NetGuardClassifyFn(
    const FWPS_INCOMING_VALUES0* inFixedValues,
    const FWPS_INCOMING_METADATA_VALUES0* inMetaValues,
    void* layerData,
    const void* classifyContext,
    const FWPS_FILTER1* filter,
    UINT64 flowContext,
    FWPS_CLASSIFY_OUT0* classifyOut
) {
    UNREFERENCED_PARAMETER(layerData);
    UNREFERENCED_PARAMETER(classifyContext);
    UNREFERENCED_PARAMETER(filter);
    UNREFERENCED_PARAMETER(flowContext);

    // Default: permit
    classifyOut->actionType = FWP_ACTION_PERMIT;

    if (!g_Context.Enabled) {
        return;
    }

    // Get process ID
    UINT32 processId = 0;
    if (FWPS_IS_METADATA_FIELD_PRESENT(inMetaValues, FWPS_METADATA_FIELD_PROCESS_ID)) {
        processId = (UINT32)inMetaValues->processId;
    }

    // Get remote IP and port
    UINT32 remoteIp = inFixedValues->incomingValue[FWPS_FIELD_ALE_AUTH_CONNECT_V4_IP_REMOTE_ADDRESS].value.uint32;
    UINT16 remotePort = inFixedValues->incomingValue[FWPS_FIELD_ALE_AUTH_CONNECT_V4_IP_REMOTE_PORT].value.uint16;

    // Get process path
    WCHAR processPath[MAX_PATH_LENGTH] = {0};
    if (FWPS_IS_METADATA_FIELD_PRESENT(inMetaValues, FWPS_METADATA_FIELD_PROCESS_PATH)) {
        if (inMetaValues->processPath && inMetaValues->processPath->size > 0) {
            UINT32 copyLen = min(inMetaValues->processPath->size, (MAX_PATH_LENGTH - 1) * sizeof(WCHAR));
            RtlCopyMemory(processPath, inMetaValues->processPath->data, copyLen);
        }
    }

    // Skip system processes
    if (processId == 0 || processId == 4) {
        return;
    }

    // Check if app is in allowed/blocked list
    BOOLEAN isBlocked = FALSE;
    if (IsAppInList(processPath, &isBlocked)) {
        if (isBlocked) {
            classifyOut->actionType = FWP_ACTION_BLOCK;
            classifyOut->rights &= ~FWPS_RIGHT_ACTION_WRITE;
            InterlockedIncrement64((PLONG64)&g_Context.BlockedConnections);
        } else {
            InterlockedIncrement64((PLONG64)&g_Context.AllowedConnections);
        }
        return;
    }

    // Unknown app - add to pending and block temporarily
    UINT64 connId = AddPendingConnection(processId, processPath, remoteIp, remotePort);
    if (connId > 0) {
        // Block the connection until user responds
        classifyOut->actionType = FWP_ACTION_BLOCK;
        classifyOut->rights &= ~FWPS_RIGHT_ACTION_WRITE;
    }
}

// WFP Notify function
NTSTATUS NTAPI NetGuardNotifyFn(
    FWPS_CALLOUT_NOTIFY_TYPE notifyType,
    const GUID* filterKey,
    FWPS_FILTER1* filter
) {
    UNREFERENCED_PARAMETER(notifyType);
    UNREFERENCED_PARAMETER(filterKey);
    UNREFERENCED_PARAMETER(filter);
    return STATUS_SUCCESS;
}

// WFP Flow Delete function
void NTAPI NetGuardFlowDeleteFn(
    UINT16 layerId,
    UINT32 calloutId,
    UINT64 flowContext
) {
    UNREFERENCED_PARAMETER(layerId);
    UNREFERENCED_PARAMETER(calloutId);
    UNREFERENCED_PARAMETER(flowContext);
}

// Register WFP callout
NTSTATUS RegisterWfpCallout(void) {
    NTSTATUS status;
    FWPM_SESSION0 session = {0};
    FWPM_SUBLAYER0 sublayer = {0};
    FWPS_CALLOUT1 callout = {0};
    FWPM_CALLOUT0 mCallout = {0};
    FWPM_FILTER0 filter = {0};
    FWPM_FILTER_CONDITION0 condition = {0};

    // Open WFP engine
    session.flags = FWPM_SESSION_FLAG_DYNAMIC;
    status = FwpmEngineOpen0(NULL, RPC_C_AUTHN_DEFAULT, NULL, &session, &g_Context.EngineHandle);
    if (!NT_SUCCESS(status)) {
        return status;
    }

    // Add sublayer
    sublayer.subLayerKey = NETGUARD_SUBLAYER_GUID;
    sublayer.displayData.name = L"NetGuard Sublayer";
    sublayer.displayData.description = L"Sublayer for NetGuard connection filtering";
    sublayer.flags = 0;
    sublayer.weight = 0xFFFF;

    status = FwpmSubLayerAdd0(g_Context.EngineHandle, &sublayer, NULL);
    if (!NT_SUCCESS(status) && status != STATUS_FWP_ALREADY_EXISTS) {
        FwpmEngineClose0(g_Context.EngineHandle);
        return status;
    }

    // Register callout with WFP kernel
    callout.calloutKey = NETGUARD_CALLOUT_GUID;
    callout.classifyFn = NetGuardClassifyFn;
    callout.notifyFn = NetGuardNotifyFn;
    callout.flowDeleteFn = NetGuardFlowDeleteFn;

    status = FwpsCalloutRegister1(g_Context.DeviceObject, &callout, &g_Context.CalloutId);
    if (!NT_SUCCESS(status)) {
        FwpmEngineClose0(g_Context.EngineHandle);
        return status;
    }

    // Add callout to management layer
    mCallout.calloutKey = NETGUARD_CALLOUT_GUID;
    mCallout.displayData.name = L"NetGuard Callout";
    mCallout.displayData.description = L"Callout for NetGuard connection filtering";
    mCallout.applicableLayer = FWPM_LAYER_ALE_AUTH_CONNECT_V4;

    status = FwpmCalloutAdd0(g_Context.EngineHandle, &mCallout, NULL, NULL);
    if (!NT_SUCCESS(status) && status != STATUS_FWP_ALREADY_EXISTS) {
        FwpsCalloutUnregisterById0(g_Context.CalloutId);
        FwpmEngineClose0(g_Context.EngineHandle);
        return status;
    }

    // Add filter
    filter.filterKey = {0};
    filter.layerKey = FWPM_LAYER_ALE_AUTH_CONNECT_V4;
    filter.subLayerKey = NETGUARD_SUBLAYER_GUID;
    filter.displayData.name = L"NetGuard Filter";
    filter.displayData.description = L"Filter for NetGuard connection control";
    filter.action.type = FWP_ACTION_CALLOUT_TERMINATING;
    filter.action.calloutKey = NETGUARD_CALLOUT_GUID;
    filter.weight.type = FWP_UINT8;
    filter.weight.uint8 = 0xF;
    filter.numFilterConditions = 0; // Match all connections

    status = FwpmFilterAdd0(g_Context.EngineHandle, &filter, NULL, &g_Context.FilterId);
    if (!NT_SUCCESS(status)) {
        FwpsCalloutUnregisterById0(g_Context.CalloutId);
        FwpmEngineClose0(g_Context.EngineHandle);
        return status;
    }

    return STATUS_SUCCESS;
}

// Unregister WFP callout
NTSTATUS UnregisterWfpCallout(void) {
    if (g_Context.FilterId) {
        FwpmFilterDeleteById0(g_Context.EngineHandle, g_Context.FilterId);
    }
    if (g_Context.CalloutId) {
        FwpsCalloutUnregisterById0(g_Context.CalloutId);
    }
    if (g_Context.EngineHandle) {
        FwpmEngineClose0(g_Context.EngineHandle);
    }
    return STATUS_SUCCESS;
}

// Device Create handler
NTSTATUS NetGuardCreate(PDEVICE_OBJECT DeviceObject, PIRP Irp) {
    UNREFERENCED_PARAMETER(DeviceObject);
    Irp->IoStatus.Status = STATUS_SUCCESS;
    Irp->IoStatus.Information = 0;
    IoCompleteRequest(Irp, IO_NO_INCREMENT);
    return STATUS_SUCCESS;
}

// Device Close handler
NTSTATUS NetGuardClose(PDEVICE_OBJECT DeviceObject, PIRP Irp) {
    UNREFERENCED_PARAMETER(DeviceObject);
    Irp->IoStatus.Status = STATUS_SUCCESS;
    Irp->IoStatus.Information = 0;
    IoCompleteRequest(Irp, IO_NO_INCREMENT);
    return STATUS_SUCCESS;
}

// Device Control handler - handles IOCTLs from user-mode
NTSTATUS NetGuardDeviceControl(PDEVICE_OBJECT DeviceObject, PIRP Irp) {
    UNREFERENCED_PARAMETER(DeviceObject);

    PIO_STACK_LOCATION irpSp = IoGetCurrentIrpStackLocation(Irp);
    NTSTATUS status = STATUS_SUCCESS;
    ULONG bytesReturned = 0;

    PVOID inputBuffer = Irp->AssociatedIrp.SystemBuffer;
    PVOID outputBuffer = Irp->AssociatedIrp.SystemBuffer;
    ULONG inputLength = irpSp->Parameters.DeviceIoControl.InputBufferLength;
    ULONG outputLength = irpSp->Parameters.DeviceIoControl.OutputBufferLength;

    switch (irpSp->Parameters.DeviceIoControl.IoControlCode) {
        case IOCTL_NETGUARD_ENABLE:
            g_Context.Enabled = TRUE;
            break;

        case IOCTL_NETGUARD_DISABLE:
            g_Context.Enabled = FALSE;
            break;

        case IOCTL_NETGUARD_GET_PENDING: {
            // Return pending connections to user-mode
            KIRQL oldIrql;
            KeAcquireSpinLock(&g_Context.PendingLock, &oldIrql);

            ULONG copySize = min(outputLength, g_Context.PendingCount * sizeof(PENDING_CONNECTION));
            if (copySize > 0 && outputBuffer) {
                RtlCopyMemory(outputBuffer, g_Context.PendingConnections, copySize);
                bytesReturned = copySize;
            }

            KeReleaseSpinLock(&g_Context.PendingLock, oldIrql);
            break;
        }

        case IOCTL_NETGUARD_RESPOND: {
            // User responded to a pending connection
            if (inputLength >= sizeof(UINT64) + sizeof(BOOLEAN)) {
                UINT64 connId = *(PUINT64)inputBuffer;
                BOOLEAN allowed = *((PBOOLEAN)((PUCHAR)inputBuffer + sizeof(UINT64)));

                KIRQL oldIrql;
                KeAcquireSpinLock(&g_Context.PendingLock, &oldIrql);

                for (UINT32 i = 0; i < g_Context.PendingCount; i++) {
                    if (g_Context.PendingConnections[i].connectionId == connId) {
                        g_Context.PendingConnections[i].responded = TRUE;
                        g_Context.PendingConnections[i].allowed = allowed;

                        // Remove from pending list
                        if (i < g_Context.PendingCount - 1) {
                            RtlMoveMemory(&g_Context.PendingConnections[i],
                                         &g_Context.PendingConnections[i + 1],
                                         (g_Context.PendingCount - i - 1) * sizeof(PENDING_CONNECTION));
                        }
                        g_Context.PendingCount--;
                        break;
                    }
                }

                KeReleaseSpinLock(&g_Context.PendingLock, oldIrql);
            }
            break;
        }

        case IOCTL_NETGUARD_ADD_ALLOWED: {
            // Add app to allowed/blocked list
            if (inputLength >= sizeof(ALLOWED_APP)) {
                PALLOWED_APP newApp = (PALLOWED_APP)inputBuffer;

                KIRQL oldIrql;
                KeAcquireSpinLock(&g_Context.AllowedLock, &oldIrql);

                if (g_Context.AllowedCount < MAX_ALLOWED_APPS) {
                    RtlCopyMemory(&g_Context.AllowedApps[g_Context.AllowedCount], newApp, sizeof(ALLOWED_APP));
                    g_Context.AllowedCount++;
                }

                KeReleaseSpinLock(&g_Context.AllowedLock, oldIrql);
            }
            break;
        }

        default:
            status = STATUS_INVALID_DEVICE_REQUEST;
            break;
    }

    Irp->IoStatus.Status = status;
    Irp->IoStatus.Information = bytesReturned;
    IoCompleteRequest(Irp, IO_NO_INCREMENT);
    return status;
}

// Driver unload
void DriverUnload(PDRIVER_OBJECT DriverObject) {
    UNICODE_STRING symLink;

    // Disable filtering
    g_Context.Enabled = FALSE;

    // Unregister WFP
    UnregisterWfpCallout();

    // Delete symbolic link and device
    RtlInitUnicodeString(&symLink, NETGUARD_SYMBOLIC_NAME);
    IoDeleteSymbolicLink(&symLink);

    if (g_Context.DeviceObject) {
        IoDeleteDevice(g_Context.DeviceObject);
    }
}

// Driver entry point
NTSTATUS DriverEntry(PDRIVER_OBJECT DriverObject, PUNICODE_STRING RegistryPath) {
    UNREFERENCED_PARAMETER(RegistryPath);

    NTSTATUS status;
    UNICODE_STRING deviceName, symLink;

    // Initialize context
    RtlZeroMemory(&g_Context, sizeof(g_Context));
    KeInitializeSpinLock(&g_Context.PendingLock);
    KeInitializeSpinLock(&g_Context.AllowedLock);
    KeInitializeEvent(&g_Context.PendingEvent, NotificationEvent, FALSE);

    // Create device
    RtlInitUnicodeString(&deviceName, NETGUARD_DEVICE_NAME);
    status = IoCreateDevice(DriverObject, 0, &deviceName, FILE_DEVICE_UNKNOWN,
                           FILE_DEVICE_SECURE_OPEN, FALSE, &g_Context.DeviceObject);
    if (!NT_SUCCESS(status)) {
        return status;
    }

    // Create symbolic link
    RtlInitUnicodeString(&symLink, NETGUARD_SYMBOLIC_NAME);
    status = IoCreateSymbolicLink(&symLink, &deviceName);
    if (!NT_SUCCESS(status)) {
        IoDeleteDevice(g_Context.DeviceObject);
        return status;
    }

    // Set up dispatch routines
    DriverObject->MajorFunction[IRP_MJ_CREATE] = NetGuardCreate;
    DriverObject->MajorFunction[IRP_MJ_CLOSE] = NetGuardClose;
    DriverObject->MajorFunction[IRP_MJ_DEVICE_CONTROL] = NetGuardDeviceControl;
    DriverObject->DriverUnload = DriverUnload;

    // Register WFP callout
    status = RegisterWfpCallout();
    if (!NT_SUCCESS(status)) {
        IoDeleteSymbolicLink(&symLink);
        IoDeleteDevice(g_Context.DeviceObject);
        return status;
    }

    return STATUS_SUCCESS;
}
