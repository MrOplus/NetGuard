# NetGuard WFP Kernel Driver

This is a Windows Filtering Platform (WFP) kernel-mode driver that enables the "Ask to Connect" feature by intercepting outbound network connections at the kernel level.

## Features

- Intercepts all outbound TCP/UDP connections using WFP callout at ALE_AUTH_CONNECT layer
- Blocks unknown applications until user approval
- Maintains allow/block lists in kernel memory
- Communicates with user-mode service via IOCTLs
- Supports dynamic enable/disable

## Build Requirements

1. **Windows Driver Kit (WDK) 10**
   - Download from: https://docs.microsoft.com/en-us/windows-hardware/drivers/download-the-wdk
   - Install matching version for your Windows SDK

2. **Visual Studio 2019/2022**
   - Install "Desktop development with C++"
   - Install "Windows Driver Kit" extension

3. **Code Signing Certificate** (for release)
   - Required for loading drivers on 64-bit Windows
   - For development, enable Test Signing Mode

## Build Instructions

### Using Visual Studio

1. Create a new "Kernel Mode Driver (KMDF)" project
2. Add `netguard_wfp.c` to the project
3. Add WFP libraries to linker:
   - `fwpkclnt.lib`
   - `fwpuclnt.lib`
4. Build for x64 Release

### Using Command Line

```cmd
# Open Developer Command Prompt for VS
cd F:\Workspace\GlassWire\driver

# Build (requires WDK installed)
msbuild netguard_wfp.vcxproj /p:Configuration=Release /p:Platform=x64
```

## Installation

### Enable Test Signing (Development Only)

```cmd
# Run as Administrator
bcdedit /set testsigning on
# Reboot required
```

### Install Driver

```cmd
# Create service
sc create NetGuardWFP type=kernel start=demand binPath="C:\path\to\netguard_wfp.sys"

# Start driver
sc start NetGuardWFP
```

### Uninstall Driver

```cmd
sc stop NetGuardWFP
sc delete NetGuardWFP
```

## IOCTL Interface

The driver exposes the following IOCTLs through `\\.\NetGuardWFP`:

| IOCTL | Code | Description |
|-------|------|-------------|
| `IOCTL_NETGUARD_ENABLE` | 0x804 | Enable connection filtering |
| `IOCTL_NETGUARD_DISABLE` | 0x805 | Disable connection filtering |
| `IOCTL_NETGUARD_GET_PENDING` | 0x800 | Get pending connections awaiting approval |
| `IOCTL_NETGUARD_RESPOND` | 0x801 | Respond to a pending connection (allow/block) |
| `IOCTL_NETGUARD_ADD_ALLOWED` | 0x802 | Add app to allow/block list |
| `IOCTL_NETGUARD_REMOVE_ALLOWED` | 0x803 | Remove app from list |

## Integration with NetGuard Backend

The Go backend should:

1. Open handle to `\\.\NetGuardWFP`
2. Send `IOCTL_NETGUARD_ENABLE` when "Ask to Connect" is enabled
3. Poll for pending connections using `IOCTL_NETGUARD_GET_PENDING`
4. Send user response via `IOCTL_NETGUARD_RESPOND`
5. Persist allow/block decisions using `IOCTL_NETGUARD_ADD_ALLOWED`

## Security Considerations

- The driver runs in kernel mode with full system privileges
- Ensure proper validation of all IOCTL inputs
- Use signed driver for production deployment
- Consider HVCI (Hypervisor-Protected Code Integrity) compatibility

## Alternative: User-Mode Approach

If building a kernel driver is too complex, consider using the Windows Firewall API:

1. Set default outbound action to BLOCK
2. Dynamically add ALLOW rules for approved apps
3. This doesn't require a kernel driver but may be less responsive

The current backend already has `blockApplicationWFP()` and `unblockApplicationWFP()` functions that use this approach.
