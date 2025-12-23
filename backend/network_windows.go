//go:build windows
// +build windows

package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"os/exec"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"
	"unsafe"

	"github.com/go-ole/go-ole"
	"github.com/go-ole/go-ole/oleutil"
	"golang.org/x/sys/windows"
)

var (
	iphlpapi                = windows.NewLazySystemDLL("iphlpapi.dll")
	procGetTcpTable2        = iphlpapi.NewProc("GetTcpTable2")
	procGetExtendedTcpTable = iphlpapi.NewProc("GetExtendedTcpTable")
	procGetIfTable          = iphlpapi.NewProc("GetIfTable")
	procGetIpNetTable       = iphlpapi.NewProc("GetIpNetTable")
	procGetIpForwardTable   = iphlpapi.NewProc("GetIpForwardTable")

	kernel32                  = windows.NewLazySystemDLL("kernel32.dll")
	procOpenProcess           = kernel32.NewProc("OpenProcess")
	procCloseHandle           = kernel32.NewProc("CloseHandle")
	procGetProcessIoCounters  = kernel32.NewProc("GetProcessIoCounters")
	procTerminateProcess      = kernel32.NewProc("TerminateProcess")

	psapi                          = windows.NewLazySystemDLL("psapi.dll")
	procGetModuleFileNameExW       = psapi.NewProc("GetModuleFileNameExW")
	procQueryFullProcessImageNameW = kernel32.NewProc("QueryFullProcessImageNameW")

	wlanapi                    = windows.NewLazySystemDLL("wlanapi.dll")
	procWlanOpenHandle         = wlanapi.NewProc("WlanOpenHandle")
	procWlanCloseHandle        = wlanapi.NewProc("WlanCloseHandle")
	procWlanEnumInterfaces     = wlanapi.NewProc("WlanEnumInterfaces")
	procWlanGetNetworkBssList  = wlanapi.NewProc("WlanGetNetworkBssList")
	procWlanFreeMemory         = wlanapi.NewProc("WlanFreeMemory")

	wtsapi32                      = windows.NewLazySystemDLL("wtsapi32.dll")
	procWTSEnumerateSessionsW     = wtsapi32.NewProc("WTSEnumerateSessionsW")
	procWTSFreeMemory             = wtsapi32.NewProc("WTSFreeMemory")
	procWTSQuerySessionInformationW = wtsapi32.NewProc("WTSQuerySessionInformationW")

	// Per-process IO tracking
	processIOCache     = make(map[uint32]IO_COUNTERS)
	processIOCacheMux  sync.RWMutex

	// Process name cache (to remember names of short-lived processes)
	processNameCache     = make(map[uint32]processNameEntry)
	processNameCacheMux  sync.RWMutex

	// GeoIP cache
	geoIPCache         = make(map[string]*GeoIPInfo)
	geoIPCacheMux      sync.RWMutex
	geoIPCacheTime     = make(map[string]time.Time)
	geoIPCacheTTL      = 24 * time.Hour

	// HTTP client for GeoIP requests
	geoIPClient        = &http.Client{Timeout: 5 * time.Second}
)

type IO_COUNTERS struct {
	ReadOperationCount  uint64
	WriteOperationCount uint64
	OtherOperationCount uint64
	ReadTransferCount   uint64
	WriteTransferCount  uint64
	OtherTransferCount  uint64
}

type processNameEntry struct {
	name     string
	path     string
	lastSeen time.Time
}

// GeoIPInfo holds geolocation data from ip-api.com
type GeoIPInfo struct {
	Status      string  `json:"status"`
	Country     string  `json:"country"`
	CountryCode string  `json:"countryCode"`
	Region      string  `json:"region"`
	RegionName  string  `json:"regionName"`
	City        string  `json:"city"`
	Lat         float64 `json:"lat"`
	Lon         float64 `json:"lon"`
	ISP         string  `json:"isp"`
	Org         string  `json:"org"`
}

const (
	MIB_TCP_STATE_CLOSED     = 1
	MIB_TCP_STATE_LISTEN     = 2
	MIB_TCP_STATE_SYN_SENT   = 3
	MIB_TCP_STATE_SYN_RCVD   = 4
	MIB_TCP_STATE_ESTAB      = 5
	MIB_TCP_STATE_FIN_WAIT1  = 6
	MIB_TCP_STATE_FIN_WAIT2  = 7
	MIB_TCP_STATE_CLOSE_WAIT = 8
	MIB_TCP_STATE_CLOSING    = 9
	MIB_TCP_STATE_LAST_ACK   = 10
	MIB_TCP_STATE_TIME_WAIT  = 11
	MIB_TCP_STATE_DELETE_TCB = 12

	TCP_TABLE_OWNER_PID_ALL = 5
	AF_INET                 = 2

	PROCESS_QUERY_INFORMATION = 0x0400
	PROCESS_VM_READ           = 0x0010
	PROCESS_TERMINATE         = 0x0001

	// WLAN constants
	WLAN_API_VERSION_2_0      = 2
	DOT11_BSS_TYPE_ANY        = 3

	// ARP entry types
	MIB_IPNET_TYPE_OTHER      = 1
	MIB_IPNET_TYPE_INVALID    = 2
	MIB_IPNET_TYPE_DYNAMIC    = 3
	MIB_IPNET_TYPE_STATIC     = 4
)

type MIB_TCPROW_OWNER_PID struct {
	State      uint32
	LocalAddr  uint32
	LocalPort  uint32
	RemoteAddr uint32
	RemotePort uint32
	OwningPid  uint32
}

type MIB_TCPTABLE_OWNER_PID struct {
	NumEntries uint32
	Table      [1]MIB_TCPROW_OWNER_PID
}

type MIB_IFROW struct {
	Name            [256]uint16
	Index           uint32
	Type            uint32
	Mtu             uint32
	Speed           uint32
	PhysAddrLen     uint32
	PhysAddr        [8]byte
	AdminStatus     uint32
	OperStatus      uint32
	LastChange      uint32
	InOctets        uint32
	InUcastPkts     uint32
	InNUcastPkts    uint32
	InDiscards      uint32
	InErrors        uint32
	InUnknownProtos uint32
	OutOctets       uint32
	OutUcastPkts    uint32
	OutNUcastPkts   uint32
	OutDiscards     uint32
	OutErrors       uint32
	OutQLen         uint32
	DescrLen        uint32
	Descr           [256]byte
}

type MIB_IFTABLE struct {
	NumEntries uint32
	Table      [1]MIB_IFROW
}

type MIB_IPNETROW struct {
	Index       uint32
	PhysAddrLen uint32
	PhysAddr    [8]byte
	Addr        uint32
	Type        uint32
}

type MIB_IPNETTABLE struct {
	NumEntries uint32
	Table      [1]MIB_IPNETROW
}

// IP Forward (routing) table structures
type MIB_IPFORWARDROW struct {
	ForwardDest      uint32
	ForwardMask      uint32
	ForwardPolicy    uint32
	ForwardNextHop   uint32
	ForwardIfIndex   uint32
	ForwardType      uint32
	ForwardProto     uint32
	ForwardAge       uint32
	ForwardNextHopAS uint32
	ForwardMetric1   uint32
	ForwardMetric2   uint32
	ForwardMetric3   uint32
	ForwardMetric4   uint32
	ForwardMetric5   uint32
}

type MIB_IPFORWARDTABLE struct {
	NumEntries uint32
	Table      [1]MIB_IPFORWARDROW
}

// WLAN API structures
type WLAN_INTERFACE_INFO struct {
	InterfaceGuid           [16]byte
	InterfaceDescription    [256]uint16
	State                   uint32
}

type WLAN_INTERFACE_INFO_LIST struct {
	NumberOfItems uint32
	Index         uint32
	InterfaceInfo [1]WLAN_INTERFACE_INFO
}

type DOT11_SSID struct {
	SSIDLength uint32
	SSID       [32]byte
}

type WLAN_BSS_ENTRY struct {
	Dot11Ssid              DOT11_SSID
	PhyId                  uint32
	Dot11Bssid             [6]byte
	Dot11BssType           uint32
	Dot11BssPhyType        uint32
	Rssi                   int32
	LinkQuality            uint32
	InRegDomain            uint32
	BeaconPeriod           uint16
	Timestamp              uint64
	HostTimestamp          uint64
	CapabilityInformation  uint16
	ChCenterFrequency      uint32
	RateSet                [126]byte
}

type WLAN_BSS_LIST struct {
	TotalSize       uint32
	NumberOfItems   uint32
	BssEntries      [1]WLAN_BSS_ENTRY
}

// WTS (Windows Terminal Services) structures
type WTS_SESSION_INFO struct {
	SessionId      uint32
	WinStationName *uint16
	State          uint32
}

const (
	WTS_CURRENT_SERVER_HANDLE = 0
	WTSUserName               = 5
	WTSClientProtocolType     = 16

	// Session states
	WTSActive       = 0
	WTSConnected    = 1
	WTSConnectQuery = 2
	WTSShadow       = 3
	WTSDisconnected = 4
	WTSIdle         = 5
	WTSListen       = 6
	WTSReset        = 7
	WTSDown         = 8
	WTSInit         = 9
)

func tcpStateToString(state uint32) string {
	switch state {
	case MIB_TCP_STATE_CLOSED:
		return "Closed"
	case MIB_TCP_STATE_LISTEN:
		return "Listen"
	case MIB_TCP_STATE_SYN_SENT:
		return "SynSent"
	case MIB_TCP_STATE_SYN_RCVD:
		return "SynReceived"
	case MIB_TCP_STATE_ESTAB:
		return "Established"
	case MIB_TCP_STATE_FIN_WAIT1:
		return "FinWait1"
	case MIB_TCP_STATE_FIN_WAIT2:
		return "FinWait2"
	case MIB_TCP_STATE_CLOSE_WAIT:
		return "CloseWait"
	case MIB_TCP_STATE_CLOSING:
		return "Closing"
	case MIB_TCP_STATE_LAST_ACK:
		return "LastAck"
	case MIB_TCP_STATE_TIME_WAIT:
		return "TimeWait"
	case MIB_TCP_STATE_DELETE_TCB:
		return "DeleteTcb"
	default:
		return "Unknown"
	}
}

func ipToString(ip uint32) string {
	return fmt.Sprintf("%d.%d.%d.%d",
		ip&0xFF,
		(ip>>8)&0xFF,
		(ip>>16)&0xFF,
		(ip>>24)&0xFF)
}

func ntohs(port uint32) int {
	return int((port>>8)&0xFF | (port&0xFF)<<8)
}

func getProcessName(pid uint32) (string, string) {
	if pid == 0 {
		return "System Idle", ""
	}
	if pid == 4 {
		return "System", ""
	}

	// Check cache first
	processNameCacheMux.RLock()
	if cached, ok := processNameCache[pid]; ok {
		name, path := cached.name, cached.path
		processNameCacheMux.RUnlock()
		// Update lastSeen time
		processNameCacheMux.Lock()
		if entry, exists := processNameCache[pid]; exists {
			entry.lastSeen = time.Now()
			processNameCache[pid] = entry
		}
		processNameCacheMux.Unlock()
		return name, path
	}
	processNameCacheMux.RUnlock()

	// Try to open the process with limited rights first (more likely to succeed)
	handle, _, _ := procOpenProcess.Call(
		uintptr(PROCESS_QUERY_LIMITED_INFORMATION),
		0,
		uintptr(pid),
	)

	if handle == 0 {
		// Try with full rights as fallback
		handle, _, _ = procOpenProcess.Call(
			uintptr(PROCESS_QUERY_INFORMATION|PROCESS_VM_READ),
			0,
			uintptr(pid),
		)
	}

	if handle == 0 {
		// Can't open process - return PID but don't cache (might be transient)
		return fmt.Sprintf("PID:%d", pid), ""
	}
	defer procCloseHandle.Call(handle)

	var fullPath string

	// Try QueryFullProcessImageNameW first (more reliable, works with more processes)
	var pathBuf [1024]uint16
	pathLen := uint32(len(pathBuf))
	ret, _, _ := procQueryFullProcessImageNameW.Call(
		handle,
		0, // Win32 path format
		uintptr(unsafe.Pointer(&pathBuf[0])),
		uintptr(unsafe.Pointer(&pathLen)),
	)

	if ret != 0 && pathLen > 0 {
		fullPath = syscall.UTF16ToString(pathBuf[:pathLen])
	} else {
		// Fall back to GetModuleFileNameExW
		var path [260]uint16
		ret, _, _ := procGetModuleFileNameExW.Call(
			handle,
			0,
			uintptr(unsafe.Pointer(&path[0])),
			260,
		)
		if ret != 0 {
			fullPath = syscall.UTF16ToString(path[:])
		}
	}

	if fullPath == "" {
		// Last resort - return PID
		return fmt.Sprintf("PID:%d", pid), ""
	}

	// Extract process name from path
	parts := strings.Split(fullPath, "\\")
	name := parts[len(parts)-1]

	// Cache the result
	processNameCacheMux.Lock()
	processNameCache[pid] = processNameEntry{
		name:     name,
		path:     fullPath,
		lastSeen: time.Now(),
	}
	processNameCacheMux.Unlock()

	return name, fullPath
}

// PROCESS_QUERY_LIMITED_INFORMATION allows getting process name without full access
const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000

func getProcessIO(pid uint32) (bytesRead uint64, bytesWritten uint64) {
	handle, _, _ := procOpenProcess.Call(
		PROCESS_QUERY_INFORMATION,
		0,
		uintptr(pid),
	)

	if handle == 0 {
		return 0, 0
	}
	defer procCloseHandle.Call(handle)

	var counters IO_COUNTERS
	ret, _, _ := procGetProcessIoCounters.Call(
		handle,
		uintptr(unsafe.Pointer(&counters)),
	)

	if ret == 0 {
		return 0, 0
	}

	// Get previous values to calculate delta
	processIOCacheMux.RLock()
	prev, exists := processIOCache[pid]
	processIOCacheMux.RUnlock()

	if exists {
		bytesRead = counters.ReadTransferCount - prev.ReadTransferCount
		bytesWritten = counters.WriteTransferCount - prev.WriteTransferCount
	}

	// Update cache
	processIOCacheMux.Lock()
	processIOCache[pid] = counters
	processIOCacheMux.Unlock()

	return bytesRead, bytesWritten
}

// getProcessIOBytes returns network bytes sent/received for a process
// Note: This is an approximation using process IO counters
func getProcessIOBytes(pid uint32) (sent uint64, received uint64) {
	handle, _, _ := procOpenProcess.Call(
		PROCESS_QUERY_INFORMATION,
		0,
		uintptr(pid),
	)

	if handle == 0 {
		return 0, 0
	}
	defer procCloseHandle.Call(handle)

	var counters IO_COUNTERS
	ret, _, _ := procGetProcessIoCounters.Call(
		handle,
		uintptr(unsafe.Pointer(&counters)),
	)

	if ret == 0 {
		return 0, 0
	}

	// Use OtherTransferCount for network bytes (approximation)
	// ReadTransferCount and WriteTransferCount include disk IO
	// For better accuracy, we'd need ETW tracing
	return counters.WriteTransferCount, counters.ReadTransferCount
}

// lookupGeoIP fetches geolocation data for an IP address using ip-api.com
func lookupGeoIP(ip string) *GeoIPInfo {
	// Skip private/local IPs
	if isPrivateIP(ip) || isLocalhost(ip) {
		return nil
	}

	// Check cache first
	geoIPCacheMux.RLock()
	if cached, ok := geoIPCache[ip]; ok {
		if time.Since(geoIPCacheTime[ip]) < geoIPCacheTTL {
			geoIPCacheMux.RUnlock()
			return cached
		}
	}
	geoIPCacheMux.RUnlock()

	// Fetch from ip-api.com (free tier: 45 requests/minute)
	url := fmt.Sprintf("http://ip-api.com/json/%s?fields=status,country,countryCode,region,regionName,city,lat,lon,isp,org", ip)
	resp, err := geoIPClient.Get(url)
	if err != nil {
		return nil
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil
	}

	var geoInfo GeoIPInfo
	if err := json.Unmarshal(body, &geoInfo); err != nil {
		return nil
	}

	if geoInfo.Status != "success" {
		return nil
	}

	// Cache the result
	geoIPCacheMux.Lock()
	geoIPCache[ip] = &geoInfo
	geoIPCacheTime[ip] = time.Now()
	geoIPCacheMux.Unlock()

	return &geoInfo
}

// isPrivateIP checks if an IP is a private/internal address
func isPrivateIP(ip string) bool {
	parsedIP := net.ParseIP(ip)
	if parsedIP == nil {
		return false
	}

	// Check for private IP ranges
	privateBlocks := []string{
		"10.0.0.0/8",
		"172.16.0.0/12",
		"192.168.0.0/16",
		"169.254.0.0/16", // Link-local
		"fc00::/7",       // IPv6 private
		"fe80::/10",      // IPv6 link-local
	}

	for _, block := range privateBlocks {
		_, cidr, _ := net.ParseCIDR(block)
		if cidr != nil && cidr.Contains(parsedIP) {
			return true
		}
	}

	return false
}

// GeoIP batch lookup with rate limiting
var (
	geoIPPendingQueue = make(chan string, 100)
	geoIPRateLimiter  = time.NewTicker(25 * time.Millisecond) // ~40 req/sec (ip-api allows 45/min)
)

func init() {
	// Start GeoIP worker goroutine
	go geoIPWorker()

	// Start process name cache cleanup goroutine
	go processNameCacheCleanup()
}

// processNameCacheCleanup periodically removes stale entries from the process name cache
func processNameCacheCleanup() {
	ticker := time.NewTicker(5 * time.Minute)
	for range ticker.C {
		processNameCacheMux.Lock()
		now := time.Now()
		for pid, entry := range processNameCache {
			// Remove entries older than 10 minutes
			if now.Sub(entry.lastSeen) > 10*time.Minute {
				delete(processNameCache, pid)
			}
		}
		processNameCacheMux.Unlock()
	}
}

func geoIPWorker() {
	for {
		select {
		case ip := <-geoIPPendingQueue:
			<-geoIPRateLimiter.C // Rate limit
			lookupGeoIP(ip)
		}
	}
}

// queueGeoIPLookup adds an IP to the background lookup queue
func queueGeoIPLookup(ip string) {
	if isPrivateIP(ip) || isLocalhost(ip) {
		return
	}

	// Check if already cached
	geoIPCacheMux.RLock()
	_, exists := geoIPCache[ip]
	geoIPCacheMux.RUnlock()

	if exists {
		return
	}

	// Try to queue for background lookup
	select {
	case geoIPPendingQueue <- ip:
	default:
		// Queue full, skip
	}
}

func getTCPConnections() []NetworkConnection {
	var size uint32
	procGetExtendedTcpTable.Call(0, uintptr(unsafe.Pointer(&size)), 1, AF_INET, TCP_TABLE_OWNER_PID_ALL, 0)

	if size == 0 {
		return []NetworkConnection{}
	}

	buf := make([]byte, size)
	ret, _, _ := procGetExtendedTcpTable.Call(
		uintptr(unsafe.Pointer(&buf[0])),
		uintptr(unsafe.Pointer(&size)),
		1,
		AF_INET,
		TCP_TABLE_OWNER_PID_ALL,
		0,
	)

	if ret != 0 {
		return []NetworkConnection{}
	}

	table := (*MIB_TCPTABLE_OWNER_PID)(unsafe.Pointer(&buf[0]))
	numEntries := table.NumEntries
	rowSize := unsafe.Sizeof(MIB_TCPROW_OWNER_PID{})

	connections := make([]NetworkConnection, 0, numEntries)

	for i := uint32(0); i < numEntries; i++ {
		row := (*MIB_TCPROW_OWNER_PID)(unsafe.Pointer(uintptr(unsafe.Pointer(&table.Table[0])) + uintptr(i)*rowSize))

		localAddr := ipToString(row.LocalAddr)
		remoteAddr := ipToString(row.RemoteAddr)
		localPort := ntohs(row.LocalPort)
		remotePort := ntohs(row.RemotePort)
		state := tcpStateToString(row.State)

		// Skip loopback connections (127.x.x.x)
		if strings.HasPrefix(localAddr, "127.") && strings.HasPrefix(remoteAddr, "127.") {
			continue
		}

		name, path := getProcessName(row.OwningPid)
		bytesRecv, bytesSent := getProcessIO(row.OwningPid)

		conn := NetworkConnection{
			ID:            fmt.Sprintf("%s:%d-%s:%d", localAddr, localPort, remoteAddr, remotePort),
			ProcessName:   name,
			ProcessPath:   path,
			ProcessID:     int(row.OwningPid),
			LocalAddress:  localAddr,
			LocalPort:     localPort,
			RemoteAddress: remoteAddr,
			RemotePort:    remotePort,
			Protocol:      "TCP",
			State:         state,
			BytesSent:     bytesSent,
			BytesReceived: bytesRecv,
		}

		// Add hostname from cache (non-blocking)
		hostnameCacheMux.RLock()
		if hostname, ok := hostnameCache[remoteAddr]; ok && hostname != "" {
			conn.RemoteHost = hostname
		}
		hostnameCacheMux.RUnlock()

		// Queue hostname lookup if not cached
		if conn.RemoteHost == "" && remoteAddr != "0.0.0.0" && !isLocalhost(remoteAddr) {
			queueHostnameLookup(remoteAddr)
		}

		// Add GeoIP data if available (from cache)
		geoIPCacheMux.RLock()
		if geoInfo, ok := geoIPCache[remoteAddr]; ok && geoInfo != nil {
			conn.Country = geoInfo.Country
			conn.City = geoInfo.City
			conn.Lat = geoInfo.Lat
			conn.Lon = geoInfo.Lon
		}
		geoIPCacheMux.RUnlock()

		// Queue for background GeoIP lookup if not cached
		queueGeoIPLookup(remoteAddr)

		connections = append(connections, conn)
	}

	return connections
}

// Debug flag for traffic monitoring
var trafficDebugOnce sync.Once

func getNetworkStats() (received uint64, sent uint64) {
	// Use GetIfTable Windows API to get network statistics
	var size uint32
	procGetIfTable.Call(0, uintptr(unsafe.Pointer(&size)), 0)

	if size == 0 {
		log.Println("getNetworkStats: GetIfTable returned size 0")
		return 0, 0
	}

	buf := make([]byte, size)
	ret, _, err := procGetIfTable.Call(
		uintptr(unsafe.Pointer(&buf[0])),
		uintptr(unsafe.Pointer(&size)),
		0,
	)

	if ret != 0 {
		log.Printf("getNetworkStats: GetIfTable failed with ret=%d, err=%v", ret, err)
		return 0, 0
	}

	table := (*MIB_IFTABLE)(unsafe.Pointer(&buf[0]))
	numEntries := table.NumEntries
	rowSize := unsafe.Sizeof(MIB_IFROW{})

	var includedCount int

	for i := uint32(0); i < numEntries; i++ {
		row := (*MIB_IFROW)(unsafe.Pointer(uintptr(unsafe.Pointer(&table.Table[0])) + uintptr(i)*rowSize))

		// Skip loopback (Type 24) and software loopback (Type 131)
		if row.Type == 24 || row.Type == 131 {
			continue
		}

		// Include interfaces that are up (OperStatus 1) or have traffic
		// Some virtual adapters may report different OperStatus values
		if row.OperStatus != 1 && row.InOctets == 0 && row.OutOctets == 0 {
			continue
		}

		// Sum up bytes for all active interfaces
		received += uint64(row.InOctets)
		sent += uint64(row.OutOctets)
		includedCount++
	}

	// Debug logging (only once at startup)
	trafficDebugOnce.Do(func() {
		log.Printf("getNetworkStats: Found %d interfaces, included %d, received=%d, sent=%d",
			numEntries, includedCount, received, sent)

		// Log interface details
		for i := uint32(0); i < numEntries && i < 10; i++ {
			row := (*MIB_IFROW)(unsafe.Pointer(uintptr(unsafe.Pointer(&table.Table[0])) + uintptr(i)*rowSize))
			descLen := row.DescrLen
			if descLen > 255 {
				descLen = 255
			}
			desc := string(row.Descr[:descLen])
			log.Printf("  Interface %d: Type=%d, OperStatus=%d, In=%d, Out=%d, Desc=%s",
				i, row.Type, row.OperStatus, row.InOctets, row.OutOctets, desc)
		}
	})

	return received, sent
}

func getARPTable() []NetworkDevice {
	// Use GetIpNetTable Windows API to get ARP table
	var size uint32
	procGetIpNetTable.Call(0, uintptr(unsafe.Pointer(&size)), 0)

	if size == 0 {
		return []NetworkDevice{}
	}

	buf := make([]byte, size)
	ret, _, _ := procGetIpNetTable.Call(
		uintptr(unsafe.Pointer(&buf[0])),
		uintptr(unsafe.Pointer(&size)),
		0,
	)

	if ret != 0 {
		return []NetworkDevice{}
	}

	table := (*MIB_IPNETTABLE)(unsafe.Pointer(&buf[0]))
	numEntries := table.NumEntries
	rowSize := unsafe.Sizeof(MIB_IPNETROW{})

	devices := []NetworkDevice{}
	now := time.Now()
	seen := make(map[string]bool)

	for i := uint32(0); i < numEntries; i++ {
		row := (*MIB_IPNETROW)(unsafe.Pointer(uintptr(unsafe.Pointer(&table.Table[0])) + uintptr(i)*rowSize))

		// Only include dynamic entries (learned from network)
		if row.Type != MIB_IPNET_TYPE_DYNAMIC {
			continue
		}

		ip := ipToString(row.Addr)

		// Skip invalid IPs
		if !isValidDeviceIP(ip) {
			continue
		}

		// Format MAC address from bytes
		mac := fmt.Sprintf("%02X:%02X:%02X:%02X:%02X:%02X",
			row.PhysAddr[0], row.PhysAddr[1], row.PhysAddr[2],
			row.PhysAddr[3], row.PhysAddr[4], row.PhysAddr[5])

		// Skip invalid MACs
		if mac == "00:00:00:00:00:00" || mac == "FF:FF:FF:FF:FF:FF" {
			continue
		}

		// Skip multicast MACs (01:xx:xx)
		if strings.HasPrefix(mac, "01:") || strings.HasPrefix(mac, "33:33:") {
			continue
		}

		// Skip duplicates
		if seen[mac] {
			continue
		}
		seen[mac] = true

		// Get vendor from MAC prefix
		vendor := getMACVendor(mac[:8])

		device := NetworkDevice{
			MACAddress: mac,
			IPAddress:  ip,
			Hostname:   "",
			Vendor:     vendor,
			FirstSeen:  now,
			LastSeen:   now,
			IsOnline:   true,
		}

		devices = append(devices, device)
	}

	// Resolve hostnames in parallel (with timeout)
	resolveHostnamesAsync(devices)

	return devices
}

// Hostname cache
var (
	hostnameCache       = make(map[string]string) // IP -> hostname
	hostnameCacheTime   = make(map[string]time.Time)
	hostnameCacheMux    sync.RWMutex
	hostnameCacheTTL    = 5 * time.Minute  // Cache valid hostnames for 5 minutes
	hostnameEmptyTTL    = 30 * time.Second // Retry empty results after 30 seconds
	hostnamePendingQueue = make(chan string, 100)
	hostnamePending     = make(map[string]bool)
	hostnamePendingMux  sync.RWMutex
)

func init() {
	// Start hostname worker goroutine
	go hostnameWorker()
}

func hostnameWorker() {
	for ip := range hostnamePendingQueue {
		// Check if already cached
		hostnameCacheMux.RLock()
		_, exists := hostnameCache[ip]
		hostnameCacheMux.RUnlock()

		if exists {
			continue
		}

		// Resolve hostname
		hostname := resolveHostname(ip)

		// Cache the result
		hostnameCacheMux.Lock()
		hostnameCache[ip] = hostname
		hostnameCacheTime[ip] = time.Now()
		hostnameCacheMux.Unlock()

		// Remove from pending
		hostnamePendingMux.Lock()
		delete(hostnamePending, ip)
		hostnamePendingMux.Unlock()
	}
}

func queueHostnameLookup(ip string) {
	// Skip invalid IPs
	if ip == "" || ip == "0.0.0.0" {
		return
	}

	// Check if already pending
	hostnamePendingMux.RLock()
	pending := hostnamePending[ip]
	hostnamePendingMux.RUnlock()

	if pending {
		return
	}

	// Check if already cached
	hostnameCacheMux.RLock()
	_, cached := hostnameCache[ip]
	hostnameCacheMux.RUnlock()

	if cached {
		return
	}

	// Mark as pending and queue
	hostnamePendingMux.Lock()
	hostnamePending[ip] = true
	hostnamePendingMux.Unlock()

	select {
	case hostnamePendingQueue <- ip:
	default:
		// Queue full, skip
	}
}

func resolveHostnamesAsync(devices []NetworkDevice) {
	var wg sync.WaitGroup
	// Limit concurrency - higher value for faster resolution
	semaphore := make(chan struct{}, 5)

	for i := range devices {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()

			ip := devices[idx].IPAddress

			// Check cache first
			hostnameCacheMux.RLock()
			if cached, ok := hostnameCache[ip]; ok {
				cacheTime := hostnameCacheTime[ip]
				now := time.Now()

				// Determine TTL based on whether we have a valid hostname
				ttl := hostnameCacheTTL
				if cached == "" {
					ttl = hostnameEmptyTTL
				}

				if now.Sub(cacheTime) < ttl {
					hostnameCacheMux.RUnlock()
					devices[idx].Hostname = cached
					return
				}
			}
			hostnameCacheMux.RUnlock()

			// Acquire semaphore to limit concurrent lookups
			semaphore <- struct{}{}
			defer func() { <-semaphore }()

			// Resolve hostname
			hostname := resolveHostname(ip)

			// Cache the result with timestamp
			hostnameCacheMux.Lock()
			hostnameCache[ip] = hostname
			hostnameCacheTime[ip] = time.Now()
			hostnameCacheMux.Unlock()

			devices[idx].Hostname = hostname
		}(i)
	}

	// Wait max 30 seconds for hostname resolution (PowerShell can be slow)
	done := make(chan struct{})
	go func() {
		wg.Wait()
		close(done)
	}()

	select {
	case <-done:
	case <-time.After(30 * time.Second):
	}
}

func resolveHostname(ip string) string {
	// Try DNS lookup first (fastest and most reliable via router)
	if hostname := dnsLookup(ip); hostname != "" {
		return hostname
	}

	// Try NetBIOS lookup (works for Windows devices)
	if hostname := netbiosLookup(ip); hostname != "" {
		return hostname
	}

	// Try mDNS lookup as fallback
	if hostname := mdnsLookup(ip); hostname != "" {
		return hostname
	}

	return ""
}

func netbiosLookup(ip string) string {
	// Native Go NetBIOS Name Service (NBNS) lookup over UDP port 137
	// This replaces the external nbtstat command

	conn, err := net.DialTimeout("udp", ip+":137", 2*time.Second)
	if err != nil {
		return ""
	}
	defer conn.Close()

	// Set read/write deadline
	conn.SetDeadline(time.Now().Add(3 * time.Second))

	// Build NetBIOS Name Query packet (NBSTAT query for "*")
	query := buildNetBIOSQuery()

	_, err = conn.Write(query)
	if err != nil {
		return ""
	}

	// Read response
	response := make([]byte, 1024)
	n, err := conn.Read(response)
	if err != nil {
		return ""
	}

	if n < 57 {
		return ""
	}

	// Parse NetBIOS response to extract hostname
	return parseNetBIOSResponse(response[:n])
}

func buildNetBIOSQuery() []byte {
	// NetBIOS Node Status Request (NBSTAT) for "*" wildcard
	query := make([]byte, 50)

	// Transaction ID
	query[0] = 0x82
	query[1] = 0x28

	// Flags: 0x0000 (standard query)
	query[2] = 0x00
	query[3] = 0x00

	// Questions: 1
	query[4] = 0x00
	query[5] = 0x01

	// Answer RRs: 0
	query[6] = 0x00
	query[7] = 0x00

	// Authority RRs: 0
	query[8] = 0x00
	query[9] = 0x00

	// Additional RRs: 0
	query[10] = 0x00
	query[11] = 0x00

	// Query Name: "*" encoded as NetBIOS name
	// NetBIOS names use "first-level encoding": each byte becomes two characters
	// "*" padded to 16 bytes with nulls, then encoded
	query[12] = 0x20 // Length: 32 bytes

	// Encode "*" (0x2A) followed by 15 null bytes
	// Each byte B becomes two bytes: 'A' + (B >> 4), 'A' + (B & 0x0F)
	name := [16]byte{'*', 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0}
	for i := 0; i < 16; i++ {
		query[13+i*2] = 'A' + (name[i] >> 4)
		query[14+i*2] = 'A' + (name[i] & 0x0F)
	}

	// Null terminator
	query[45] = 0x00

	// Query Type: NBSTAT (0x0021) - Node Status
	query[46] = 0x00
	query[47] = 0x21

	// Query Class: IN (0x0001)
	query[48] = 0x00
	query[49] = 0x01

	return query
}

func parseNetBIOSResponse(response []byte) string {
	if len(response) < 57 {
		return ""
	}

	// Check if it's a response (bit 15 of flags)
	if response[2]&0x80 == 0 {
		return ""
	}

	// Skip header (12 bytes) and find the answer section
	pos := 12

	// Skip query name (encoded, variable length)
	for pos < len(response) && response[pos] != 0 {
		if response[pos] > 63 {
			break // Safety check for invalid length
		}
		pos += int(response[pos]) + 1
	}
	pos++ // Skip null terminator
	pos += 4 // Skip query type and class

	if pos >= len(response) {
		return ""
	}

	// Answer section: skip name (might be pointer 0xC0 0x0C)
	if response[pos]&0xC0 == 0xC0 {
		pos += 2 // Compressed name pointer
	} else {
		for pos < len(response) && response[pos] != 0 {
			if response[pos] > 63 {
				break
			}
			pos += int(response[pos]) + 1
		}
		pos++
	}

	// Skip: type (2) + class (2) + TTL (4) + data length (2) = 10 bytes
	pos += 10

	if pos >= len(response) {
		return ""
	}

	// Number of names in the node status response
	numNames := int(response[pos])
	pos++

	if numNames <= 0 || numNames > 50 {
		return "" // Sanity check
	}

	// Parse each name entry (18 bytes: 15-byte name + 1 suffix + 2 flags)
	var computerName string
	for i := 0; i < numNames && pos+18 <= len(response); i++ {
		nameBytes := response[pos : pos+15]
		suffix := response[pos+15]
		flags := uint16(response[pos+16])<<8 | uint16(response[pos+17])

		pos += 18

		// Check if it's a unique name (not group) - bit 15 of flags
		isGroup := flags&0x8000 != 0

		// Suffix 0x00 = Workstation/Computer name (unique)
		// Suffix 0x20 = File Server Service
		if !isGroup && (suffix == 0x00 || suffix == 0x20) {
			// Clean the name: remove trailing spaces and non-printable chars
			name := cleanNetBIOSName(nameBytes)
			if name != "" && computerName == "" {
				computerName = name
			}
		}
	}

	return computerName
}

func cleanNetBIOSName(nameBytes []byte) string {
	// NetBIOS names are 15 bytes, space-padded
	name := make([]byte, 0, 15)
	for _, b := range nameBytes {
		// Only include printable ASCII characters
		if b >= 0x20 && b <= 0x7E {
			name = append(name, b)
		} else if b == 0x00 {
			break // Null terminator
		}
	}
	// Trim trailing spaces
	return strings.TrimRight(string(name), " ")
}

func dnsLookup(ip string) string {
	// Use Go's native DNS reverse lookup (uses system resolver)
	names, err := net.LookupAddr(ip)
	if err == nil && len(names) > 0 {
		hostname := cleanHostname(names[0])
		if hostname != "" && hostname != ip {
			return hostname
		}
	}
	return ""
}

func cleanHostname(hostname string) string {
	// Remove common domain suffixes
	suffixes := []string{".local", ".lan", ".home", ".localdomain", ".internal"}
	for _, suffix := range suffixes {
		if idx := strings.Index(strings.ToLower(hostname), suffix); idx > 0 {
			return hostname[:idx]
		}
	}
	return hostname
}

var (
	cachedGateway     string
	gatewayCacheTime  time.Time
	gatewayCacheMux   sync.Mutex
	gatewayCacheTTL   = 5 * time.Minute
)

func init() {
	// Pre-fetch gateway at startup
	go func() {
		getDefaultGateway()
	}()
}

func getDefaultGateway() string {
	gatewayCacheMux.Lock()
	defer gatewayCacheMux.Unlock()

	// Return cached gateway if still valid and not empty
	if cachedGateway != "" && time.Since(gatewayCacheTime) < gatewayCacheTTL {
		return cachedGateway
	}

	// Use GetIpForwardTable to find default gateway
	var size uint32
	procGetIpForwardTable.Call(0, uintptr(unsafe.Pointer(&size)), 0)

	if size == 0 {
		return cachedGateway
	}

	buf := make([]byte, size)
	ret, _, _ := procGetIpForwardTable.Call(
		uintptr(unsafe.Pointer(&buf[0])),
		uintptr(unsafe.Pointer(&size)),
		0,
	)

	if ret != 0 {
		return cachedGateway
	}

	table := (*MIB_IPFORWARDTABLE)(unsafe.Pointer(&buf[0]))
	numEntries := table.NumEntries
	rowSize := unsafe.Sizeof(MIB_IPFORWARDROW{})

	// Find the default route (destination 0.0.0.0, mask 0.0.0.0)
	var bestMetric uint32 = 0xFFFFFFFF
	var gateway string

	for i := uint32(0); i < numEntries; i++ {
		row := (*MIB_IPFORWARDROW)(unsafe.Pointer(uintptr(unsafe.Pointer(&table.Table[0])) + uintptr(i)*rowSize))

		// Check if this is a default route (dest and mask both 0)
		if row.ForwardDest == 0 && row.ForwardMask == 0 {
			// Pick the route with the lowest metric
			if row.ForwardMetric1 < bestMetric {
				bestMetric = row.ForwardMetric1
				gateway = ipToString(row.ForwardNextHop)
			}
		}
	}

	if gateway != "" && gateway != "0.0.0.0" {
		cachedGateway = gateway
		gatewayCacheTime = time.Now()
	}

	return cachedGateway
}

func mdnsLookup(ip string) string {
	// mDNS lookup removed - was using external PowerShell command
	// Go's net.LookupAddr already handles mDNS on systems with mDNS responders
	return ""
}

func isValidDeviceIP(ip string) bool {
	// Skip multicast (224.0.0.0 - 239.255.255.255)
	if strings.HasPrefix(ip, "224.") || strings.HasPrefix(ip, "225.") ||
		strings.HasPrefix(ip, "226.") || strings.HasPrefix(ip, "227.") ||
		strings.HasPrefix(ip, "228.") || strings.HasPrefix(ip, "229.") ||
		strings.HasPrefix(ip, "230.") || strings.HasPrefix(ip, "231.") ||
		strings.HasPrefix(ip, "232.") || strings.HasPrefix(ip, "233.") ||
		strings.HasPrefix(ip, "234.") || strings.HasPrefix(ip, "235.") ||
		strings.HasPrefix(ip, "236.") || strings.HasPrefix(ip, "237.") ||
		strings.HasPrefix(ip, "238.") || strings.HasPrefix(ip, "239.") {
		return false
	}

	// Skip broadcast
	if strings.HasSuffix(ip, ".255") || ip == "255.255.255.255" {
		return false
	}

	// Skip loopback
	if strings.HasPrefix(ip, "127.") {
		return false
	}

	// Skip link-local
	if strings.HasPrefix(ip, "169.254.") {
		return false
	}

	return true
}

// pingSweepSubnet pings all IPs in the local subnet to populate ARP table
func pingSweepSubnet() {
	gateway := getDefaultGateway()
	if gateway == "" {
		return
	}

	// Extract subnet from gateway (assume /24)
	parts := strings.Split(gateway, ".")
	if len(parts) != 4 {
		return
	}
	subnet := parts[0] + "." + parts[1] + "." + parts[2] + "."

	log.Printf("Ping sweep starting for subnet %s0/24", subnet)

	// Ping all IPs concurrently with a limit
	var wg sync.WaitGroup
	semaphore := make(chan struct{}, 50) // Limit to 50 concurrent pings

	for i := 1; i <= 254; i++ {
		ip := fmt.Sprintf("%s%d", subnet, i)
		wg.Add(1)
		go func(target string) {
			defer wg.Done()
			semaphore <- struct{}{}
			defer func() { <-semaphore }()

			// Quick ping with 100ms timeout
			ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
			defer cancel()

			cmd := exec.CommandContext(ctx, "ping", "-n", "1", "-w", "100", target)
			cmd.Run() // We don't care about the result, just populating ARP table
		}(ip)
	}

	// Wait max 3 seconds for ping sweep
	done := make(chan struct{})
	go func() {
		wg.Wait()
		close(done)
	}()

	select {
	case <-done:
		log.Println("Ping sweep completed")
	case <-time.After(3 * time.Second):
		log.Println("Ping sweep timeout after 3 seconds")
	}
}


// getMACVendor looks up the vendor for a MAC address prefix using the OUI database
func getMACVendor(prefix string) string {
	return lookupMACVendor(prefix)
}

func scanWiFiNetworks() []WiFiNetwork {
	// Use WLAN API to scan WiFi networks
	var clientHandle uintptr
	var negotiatedVersion uint32

	ret, _, _ := procWlanOpenHandle.Call(
		WLAN_API_VERSION_2_0,
		0,
		uintptr(unsafe.Pointer(&negotiatedVersion)),
		uintptr(unsafe.Pointer(&clientHandle)),
	)

	if ret != 0 {
		log.Printf("Failed to open WLAN handle: %d", ret)
		return []WiFiNetwork{}
	}
	defer procWlanCloseHandle.Call(clientHandle, 0)

	// Enumerate WLAN interfaces
	var interfaceList *WLAN_INTERFACE_INFO_LIST
	ret, _, _ = procWlanEnumInterfaces.Call(
		clientHandle,
		0,
		uintptr(unsafe.Pointer(&interfaceList)),
	)

	if ret != 0 || interfaceList == nil {
		log.Printf("Failed to enumerate WLAN interfaces: %d", ret)
		return []WiFiNetwork{}
	}
	defer procWlanFreeMemory.Call(uintptr(unsafe.Pointer(interfaceList)))

	networks := []WiFiNetwork{}

	// Iterate through each interface
	for i := uint32(0); i < interfaceList.NumberOfItems; i++ {
		interfaceInfo := (*WLAN_INTERFACE_INFO)(unsafe.Pointer(
			uintptr(unsafe.Pointer(&interfaceList.InterfaceInfo[0])) +
				uintptr(i)*unsafe.Sizeof(WLAN_INTERFACE_INFO{})))

		// Get BSS list for this interface
		var bssList *WLAN_BSS_LIST
		ret, _, _ = procWlanGetNetworkBssList.Call(
			clientHandle,
			uintptr(unsafe.Pointer(&interfaceInfo.InterfaceGuid)),
			0, // pDot11Ssid - NULL for all networks
			DOT11_BSS_TYPE_ANY,
			0, // bSecurityEnabled - FALSE
			0, // pReserved
			uintptr(unsafe.Pointer(&bssList)),
		)

		if ret != 0 || bssList == nil {
			continue
		}

		// Process BSS entries
		for j := uint32(0); j < bssList.NumberOfItems; j++ {
			entry := (*WLAN_BSS_ENTRY)(unsafe.Pointer(
				uintptr(unsafe.Pointer(&bssList.BssEntries[0])) +
					uintptr(j)*unsafe.Sizeof(WLAN_BSS_ENTRY{})))

			// Get SSID
			ssidLen := entry.Dot11Ssid.SSIDLength
			if ssidLen > 32 {
				ssidLen = 32
			}
			ssid := string(entry.Dot11Ssid.SSID[:ssidLen])

			// Get BSSID (MAC address)
			bssid := fmt.Sprintf("%02X:%02X:%02X:%02X:%02X:%02X",
				entry.Dot11Bssid[0], entry.Dot11Bssid[1], entry.Dot11Bssid[2],
				entry.Dot11Bssid[3], entry.Dot11Bssid[4], entry.Dot11Bssid[5])

			// Convert frequency to channel (approximate)
			channel := frequencyToChannel(entry.ChCenterFrequency)

			// Signal strength (RSSI to percentage, roughly)
			signalStrength := int(entry.LinkQuality)

			network := WiFiNetwork{
				SSID:           ssid,
				BSSID:          bssid,
				SignalStrength: signalStrength,
				Channel:        channel,
				Security:       "Unknown", // Would need additional API calls to determine
				IsEvilTwin:     false,
			}
			networks = append(networks, network)
		}

		procWlanFreeMemory.Call(uintptr(unsafe.Pointer(bssList)))
	}

	// Check for evil twins (same SSID, different BSSID)
	ssidCount := make(map[string]int)
	for _, n := range networks {
		ssidCount[n.SSID]++
	}

	for i := range networks {
		if ssidCount[networks[i].SSID] > 1 {
			networks[i].IsEvilTwin = true
		}
	}

	return networks
}

// frequencyToChannel converts WiFi frequency (in kHz) to channel number
func frequencyToChannel(freqKHz uint32) int {
	freqMHz := freqKHz / 1000

	// 2.4 GHz band
	if freqMHz >= 2412 && freqMHz <= 2484 {
		if freqMHz == 2484 {
			return 14
		}
		return int((freqMHz - 2412) / 5) + 1
	}

	// 5 GHz band
	if freqMHz >= 5180 && freqMHz <= 5825 {
		return int((freqMHz - 5180) / 5) + 36
	}

	return 0
}

func getRDPSessions() []RDPSession {
	// Use WTS API to enumerate terminal sessions
	var sessionInfo *WTS_SESSION_INFO
	var count uint32

	ret, _, _ := procWTSEnumerateSessionsW.Call(
		WTS_CURRENT_SERVER_HANDLE,
		0,
		1, // Version must be 1
		uintptr(unsafe.Pointer(&sessionInfo)),
		uintptr(unsafe.Pointer(&count)),
	)

	if ret == 0 || sessionInfo == nil {
		return []RDPSession{}
	}
	defer procWTSFreeMemory.Call(uintptr(unsafe.Pointer(sessionInfo)))

	sessions := []RDPSession{}
	sessionSize := unsafe.Sizeof(WTS_SESSION_INFO{})

	for i := uint32(0); i < count; i++ {
		session := (*WTS_SESSION_INFO)(unsafe.Pointer(
			uintptr(unsafe.Pointer(sessionInfo)) + uintptr(i)*sessionSize))

		// Get station name
		stationName := ""
		if session.WinStationName != nil {
			stationName = windows.UTF16PtrToString(session.WinStationName)
		}

		// Only include RDP sessions (station name starts with RDP)
		if !strings.HasPrefix(strings.ToUpper(stationName), "RDP") {
			continue
		}

		// Get username for this session
		var buffer *uint16
		var bytesReturned uint32
		username := ""

		ret, _, _ := procWTSQuerySessionInformationW.Call(
			WTS_CURRENT_SERVER_HANDLE,
			uintptr(session.SessionId),
			WTSUserName,
			uintptr(unsafe.Pointer(&buffer)),
			uintptr(unsafe.Pointer(&bytesReturned)),
		)

		if ret != 0 && buffer != nil {
			username = windows.UTF16PtrToString(buffer)
			procWTSFreeMemory.Call(uintptr(unsafe.Pointer(buffer)))
		}

		// Convert state to string
		state := "Unknown"
		switch session.State {
		case WTSActive:
			state = "Active"
		case WTSConnected:
			state = "Connected"
		case WTSDisconnected:
			state = "Disconnected"
		case WTSIdle:
			state = "Idle"
		case WTSListen:
			state = "Listen"
		}

		rdpSession := RDPSession{
			SessionID: fmt.Sprintf("%d", session.SessionId),
			Username:  username,
			State:     state,
			StartedAt: time.Now(),
		}
		sessions = append(sessions, rdpSession)
	}

	return sessions
}

// Firewall COM API constants
const (
	NET_FW_IP_PROTOCOL_TCP = 6
	NET_FW_IP_PROTOCOL_UDP = 17
	NET_FW_IP_PROTOCOL_ANY = 256

	NET_FW_RULE_DIR_IN  = 1
	NET_FW_RULE_DIR_OUT = 2

	NET_FW_ACTION_BLOCK = 0
	NET_FW_ACTION_ALLOW = 1

	NET_FW_PROFILE2_DOMAIN  = 1
	NET_FW_PROFILE2_PRIVATE = 2
	NET_FW_PROFILE2_PUBLIC  = 4
	NET_FW_PROFILE2_ALL     = 0x7FFFFFFF
)

// initFirewallPolicy initializes COM and returns the firewall policy object
func initFirewallPolicy() (*ole.IDispatch, error) {
	err := ole.CoInitializeEx(0, ole.COINIT_APARTMENTTHREADED)
	if err != nil {
		// May already be initialized
		oleErr, ok := err.(*ole.OleError)
		if !ok || oleErr.Code() != 0x00000001 { // S_FALSE means already initialized
			return nil, err
		}
	}

	unknown, err := oleutil.CreateObject("HNetCfg.FwPolicy2")
	if err != nil {
		return nil, fmt.Errorf("failed to create firewall policy object: %v", err)
	}

	policy, err := unknown.QueryInterface(ole.IID_IDispatch)
	if err != nil {
		unknown.Release()
		return nil, fmt.Errorf("failed to get IDispatch interface: %v", err)
	}

	return policy, nil
}

func getFirewallRules() []FirewallRule {
	policy, err := initFirewallPolicy()
	if err != nil {
		log.Printf("Failed to initialize firewall policy: %v", err)
		return []FirewallRule{}
	}
	// IMPORTANT: CoUninitialize must be called LAST (defers are LIFO)
	defer ole.CoUninitialize()
	defer policy.Release()

	// Get the Rules collection
	rulesVariant, err := oleutil.GetProperty(policy, "Rules")
	if err != nil {
		log.Printf("Failed to get firewall rules: %v", err)
		return []FirewallRule{}
	}
	rulesDispatch := rulesVariant.ToIDispatch()
	if rulesDispatch == nil {
		log.Printf("Failed to get rules dispatch")
		return []FirewallRule{}
	}
	defer rulesDispatch.Release()

	// Get the enumerator
	enumVariant, err := oleutil.GetProperty(rulesDispatch, "_NewEnum")
	if err != nil {
		log.Printf("Failed to get rules enumerator: %v", err)
		return []FirewallRule{}
	}

	enumUnknown := enumVariant.ToIUnknown()
	if enumUnknown == nil {
		log.Printf("Failed to get IUnknown from enumerator")
		return []FirewallRule{}
	}

	enum, err := enumUnknown.IEnumVARIANT(ole.IID_IEnumVariant)
	if err != nil {
		log.Printf("Failed to get IEnumVARIANT: %v", err)
		return []FirewallRule{}
	}
	if enum == nil {
		log.Printf("IEnumVARIANT is nil")
		return []FirewallRule{}
	}
	defer enum.Release()

	rules := []FirewallRule{}
	count := 0
	maxRules := 100 // Limit to first 100 rules

	for count < maxRules {
		variant, length, err := enum.Next(1)
		if err != nil || length == 0 {
			break
		}

		ruleDispatch := variant.ToIDispatch()
		if ruleDispatch == nil {
			continue
		}

		// Get rule properties
		nameVar, _ := oleutil.GetProperty(ruleDispatch, "Name")
		enabledVar, _ := oleutil.GetProperty(ruleDispatch, "Enabled")
		directionVar, _ := oleutil.GetProperty(ruleDispatch, "Direction")
		actionVar, _ := oleutil.GetProperty(ruleDispatch, "Action")
		profilesVar, _ := oleutil.GetProperty(ruleDispatch, "Profiles")

		name := nameVar.ToString()
		enabled := false
		if enabledVar.Value() != nil {
			enabled, _ = enabledVar.Value().(bool)
		}
		direction := "Inbound"
		if directionVar.Val == NET_FW_RULE_DIR_OUT {
			direction = "Outbound"
		}
		action := "Allow"
		if actionVar.Val == NET_FW_ACTION_BLOCK {
			action = "Block"
		}

		profile := "Any"
		if profilesVar.Val == NET_FW_PROFILE2_DOMAIN {
			profile = "Domain"
		} else if profilesVar.Val == NET_FW_PROFILE2_PRIVATE {
			profile = "Private"
		} else if profilesVar.Val == NET_FW_PROFILE2_PUBLIC {
			profile = "Public"
		}

		rule := FirewallRule{
			Name:        name,
			DisplayName: name,
			Enabled:     enabled,
			Direction:   direction,
			Action:      action,
			Profile:     profile,
		}
		rules = append(rules, rule)

		ruleDispatch.Release()
		count++
	}

	return rules
}

func blockApplication(appPath string) error {
	log.Printf("Blocking application: %s", appPath)

	// Extract just the filename for the display name
	parts := strings.Split(appPath, "\\")
	displayName := parts[len(parts)-1]
	ruleName := fmt.Sprintf("NetGuard Block - %s", displayName)

	return createFirewallRule(ruleName, appPath, "", 0, NET_FW_RULE_DIR_OUT, NET_FW_ACTION_BLOCK)
}

// createFirewallRule creates a Windows Firewall rule using COM API
func createFirewallRule(ruleName, appPath, remoteAddress string, remotePort int, direction, action int) error {
	policy, err := initFirewallPolicy()
	if err != nil {
		return fmt.Errorf("failed to initialize firewall policy: %v", err)
	}
	// IMPORTANT: CoUninitialize must be called LAST (defers are LIFO)
	defer ole.CoUninitialize()
	defer policy.Release()

	// Get the Rules collection
	rulesVariant, err := oleutil.GetProperty(policy, "Rules")
	if err != nil {
		return fmt.Errorf("failed to get firewall rules: %v", err)
	}
	rulesDispatch := rulesVariant.ToIDispatch()
	if rulesDispatch == nil {
		return fmt.Errorf("failed to get rules dispatch")
	}
	defer rulesDispatch.Release()

	// Create a new rule object
	ruleUnknown, err := oleutil.CreateObject("HNetCfg.FWRule")
	if err != nil {
		return fmt.Errorf("failed to create firewall rule object: %v", err)
	}

	ruleDispatch, err := ruleUnknown.QueryInterface(ole.IID_IDispatch)
	if err != nil {
		ruleUnknown.Release()
		return fmt.Errorf("failed to get rule IDispatch: %v", err)
	}
	defer ruleDispatch.Release()

	// Set rule properties
	oleutil.PutProperty(ruleDispatch, "Name", ruleName)
	oleutil.PutProperty(ruleDispatch, "Enabled", true)
	oleutil.PutProperty(ruleDispatch, "Direction", direction)
	oleutil.PutProperty(ruleDispatch, "Action", action)
	oleutil.PutProperty(ruleDispatch, "Profiles", NET_FW_PROFILE2_ALL)

	if appPath != "" {
		oleutil.PutProperty(ruleDispatch, "ApplicationName", appPath)
	}

	if remoteAddress != "" {
		oleutil.PutProperty(ruleDispatch, "RemoteAddresses", remoteAddress)
	}

	if remotePort > 0 {
		oleutil.PutProperty(ruleDispatch, "Protocol", NET_FW_IP_PROTOCOL_TCP)
		oleutil.PutProperty(ruleDispatch, "RemotePorts", fmt.Sprintf("%d", remotePort))
	}

	// Add the rule to the collection
	_, err = oleutil.CallMethod(rulesDispatch, "Add", ruleDispatch)
	if err != nil {
		return fmt.Errorf("failed to add firewall rule: %v (may require admin privileges)", err)
	}

	log.Printf("Successfully created firewall rule: %s", ruleName)
	return nil
}

func allowApplication(appPath string) error {
	log.Printf("Allowing application: %s", appPath)

	// Extract just the filename for the display name
	parts := strings.Split(appPath, "\\")
	displayName := parts[len(parts)-1]
	ruleName := fmt.Sprintf("NetGuard Allow - %s", displayName)

	return createFirewallRule(ruleName, appPath, "", 0, NET_FW_RULE_DIR_OUT, NET_FW_ACTION_ALLOW)
}

func killConnection(connectionID string) error {
	// Parse connection ID format: "localIP:localPort-remoteIP:remotePort"
	log.Printf("Attempting to kill connection: %s", connectionID)

	// Find the last dash that separates local from remote
	lastDash := strings.LastIndex(connectionID, "-")
	if lastDash == -1 {
		return fmt.Errorf("invalid connection ID format: no separator found")
	}

	localPart := connectionID[:lastDash]
	remotePart := connectionID[lastDash+1:]

	// Parse local address:port (find last colon for port)
	lastColonLocal := strings.LastIndex(localPart, ":")
	if lastColonLocal == -1 {
		return fmt.Errorf("invalid local address format")
	}
	localPortStr := localPart[lastColonLocal+1:]
	localPort, _ := strconv.Atoi(localPortStr)

	// Parse remote address:port
	lastColonRemote := strings.LastIndex(remotePart, ":")
	if lastColonRemote == -1 {
		return fmt.Errorf("invalid remote address format")
	}
	remoteIP := remotePart[:lastColonRemote]
	remotePortStr := remotePart[lastColonRemote+1:]
	remotePort, _ := strconv.Atoi(remotePortStr)

	// Remove brackets from IPv6 addresses
	remoteIP = strings.Trim(remoteIP, "[]")

	log.Printf("Killing connection - LocalPort: %d, RemoteIP: %s, RemotePort: %d", localPort, remoteIP, remotePort)

	// Find the process using GetExtendedTcpTable (already implemented in getTCPConnections)
	var pid uint32 = 0

	// Use GetExtendedTcpTable to find the PID
	var size uint32
	procGetExtendedTcpTable.Call(0, uintptr(unsafe.Pointer(&size)), 1, AF_INET, TCP_TABLE_OWNER_PID_ALL, 0)

	if size > 0 {
		buf := make([]byte, size)
		ret, _, _ := procGetExtendedTcpTable.Call(
			uintptr(unsafe.Pointer(&buf[0])),
			uintptr(unsafe.Pointer(&size)),
			1,
			AF_INET,
			TCP_TABLE_OWNER_PID_ALL,
			0,
		)

		if ret == 0 {
			table := (*MIB_TCPTABLE_OWNER_PID)(unsafe.Pointer(&buf[0]))
			numEntries := table.NumEntries
			rowSize := unsafe.Sizeof(MIB_TCPROW_OWNER_PID{})

			for i := uint32(0); i < numEntries; i++ {
				row := (*MIB_TCPROW_OWNER_PID)(unsafe.Pointer(uintptr(unsafe.Pointer(&table.Table[0])) + uintptr(i)*rowSize))

				rowLocalPort := ntohs(row.LocalPort)
				rowRemotePort := ntohs(row.RemotePort)
				rowRemoteIP := ipToString(row.RemoteAddr)

				if rowLocalPort == localPort && rowRemotePort == remotePort && rowRemoteIP == remoteIP {
					pid = row.OwningPid
					break
				}
			}
		}
	}

	if pid == 0 {
		return fmt.Errorf("connection not found")
	}

	log.Printf("Found connection owned by PID %d, killing...", pid)

	// Use TerminateProcess Windows API
	handle, _, err := procOpenProcess.Call(
		PROCESS_TERMINATE,
		0,
		uintptr(pid),
	)

	if handle == 0 {
		log.Printf("Failed to open process %d: %v", pid, err)
		return fmt.Errorf("failed to open process: access denied (may require admin privileges)")
	}
	defer procCloseHandle.Call(handle)

	ret, _, err := procTerminateProcess.Call(handle, 1)
	if ret == 0 {
		log.Printf("Failed to terminate process %d: %v", pid, err)
		return fmt.Errorf("failed to terminate process: %v", err)
	}

	log.Printf("Successfully terminated process %d", pid)
	return nil
}

func blockRemoteAddress(remoteAddress string, remotePort int) error {
	log.Printf("Blocking remote address: %s:%d", remoteAddress, remotePort)

	var ruleName string
	if remotePort > 0 {
		ruleName = fmt.Sprintf("NetGuard Block - %s:%d", remoteAddress, remotePort)
	} else {
		ruleName = fmt.Sprintf("NetGuard Block - %s", remoteAddress)
	}

	return createFirewallRule(ruleName, "", remoteAddress, remotePort, NET_FW_RULE_DIR_OUT, NET_FW_ACTION_BLOCK)
}

// =============================================================================
// PORT SCANNING
// =============================================================================

// Common ports to scan for device identification
var commonPorts = []int{
	21,   // FTP
	22,   // SSH
	23,   // Telnet
	25,   // SMTP
	53,   // DNS
	80,   // HTTP
	110,  // POP3
	143,  // IMAP
	443,  // HTTPS
	445,  // SMB
	548,  // AFP (Apple File Protocol)
	993,  // IMAPS
	995,  // POP3S
	1433, // MSSQL
	3306, // MySQL
	3389, // RDP
	5432, // PostgreSQL
	5900, // VNC
	8080, // HTTP Alt
	8443, // HTTPS Alt
	9100, // Printer
}

// PortScanResult represents an open port on a device
type PortScanResult struct {
	Port    int    `json:"port"`
	Service string `json:"service"`
	Open    bool   `json:"open"`
}

// scanDevicePorts scans common ports on a device
func scanDevicePorts(ip string) []PortScanResult {
	var results []PortScanResult
	var mu sync.Mutex
	var wg sync.WaitGroup

	semaphore := make(chan struct{}, 20) // Limit concurrent connections

	for _, port := range commonPorts {
		wg.Add(1)
		go func(p int) {
			defer wg.Done()
			semaphore <- struct{}{}
			defer func() { <-semaphore }()

			address := fmt.Sprintf("%s:%d", ip, p)
			conn, err := net.DialTimeout("tcp", address, 500*time.Millisecond)
			if err == nil {
				conn.Close()
				mu.Lock()
				results = append(results, PortScanResult{
					Port:    p,
					Service: getServiceName(p),
					Open:    true,
				})
				mu.Unlock()
			}
		}(port)
	}

	wg.Wait()
	return results
}

// getServiceName returns the common service name for a port
func getServiceName(port int) string {
	services := map[int]string{
		21:   "FTP",
		22:   "SSH",
		23:   "Telnet",
		25:   "SMTP",
		53:   "DNS",
		80:   "HTTP",
		110:  "POP3",
		143:  "IMAP",
		443:  "HTTPS",
		445:  "SMB",
		548:  "AFP",
		993:  "IMAPS",
		995:  "POP3S",
		1433: "MSSQL",
		3306: "MySQL",
		3389: "RDP",
		5432: "PostgreSQL",
		5900: "VNC",
		8080: "HTTP-Alt",
		8443: "HTTPS-Alt",
		9100: "Printer",
	}
	if name, ok := services[port]; ok {
		return name
	}
	return fmt.Sprintf("Port %d", port)
}

// =============================================================================
// BACKGROUND DEVICE SCANNING
// =============================================================================

var (
	backgroundScanRunning bool
	backgroundScanMux     sync.Mutex
	deviceOpenPorts       = make(map[string][]PortScanResult) // MAC -> open ports
	deviceOpenPortsMux    sync.RWMutex
)

// startBackgroundDeviceScanning starts continuous device discovery
func startBackgroundDeviceScanning() {
	backgroundScanMux.Lock()
	if backgroundScanRunning {
		backgroundScanMux.Unlock()
		return
	}
	backgroundScanRunning = true
	backgroundScanMux.Unlock()

	log.Println("Starting background device scanning...")

	go func() {
		// Initial ping sweep
		pingSweepSubnet()

		ticker := time.NewTicker(30 * time.Second)
		portScanTicker := time.NewTicker(5 * time.Minute)

		for {
			select {
			case <-ticker.C:
				// Regular ARP table refresh with ping sweep
				pingSweepSubnet()

			case <-portScanTicker.C:
				// Scan ports on all known devices
				scanAllDevicePorts()
			}
		}
	}()
}

// scanAllDevicePorts scans ports on all currently online devices
func scanAllDevicePorts() {
	devicesMux.RLock()
	devicesToScan := make([]NetworkDevice, len(devices))
	copy(devicesToScan, devices)
	devicesMux.RUnlock()

	log.Printf("Scanning ports on %d devices...", len(devicesToScan))

	for _, device := range devicesToScan {
		if !device.IsOnline {
			continue
		}

		ports := scanDevicePorts(device.IPAddress)
		if len(ports) > 0 {
			deviceOpenPortsMux.Lock()
			deviceOpenPorts[device.MACAddress] = ports
			deviceOpenPortsMux.Unlock()
			log.Printf("Device %s (%s) has %d open ports", device.IPAddress, device.MACAddress, len(ports))
		}
	}
}

// getDeviceOpenPorts returns the open ports for a device
func getDeviceOpenPorts(mac string) []PortScanResult {
	deviceOpenPortsMux.RLock()
	defer deviceOpenPortsMux.RUnlock()
	return deviceOpenPorts[mac]
}

// =============================================================================
// WFP (Windows Filtering Platform) INTEGRATION
// =============================================================================

var (
	pendingConnections    = make(map[string]*PendingConnection)
	pendingConnectionsMux sync.RWMutex
	blockedApps           = make(map[string]bool) // processPath -> blocked
	blockedAppsMux        sync.RWMutex
)

// PendingConnection represents a connection waiting for user approval
type PendingConnection struct {
	ID            string    `json:"id"`
	ProcessName   string    `json:"processName"`
	ProcessPath   string    `json:"processPath"`
	RemoteAddress string    `json:"remoteAddress"`
	RemotePort    int       `json:"remotePort"`
	Timestamp     time.Time `json:"timestamp"`
}

// blockApplicationWFP blocks an application using Windows Firewall
func blockApplicationWFP(processPath string) error {
	log.Printf("WFP: Blocking application: %s", processPath)

	// Extract filename for rule name
	parts := strings.Split(processPath, "\\")
	displayName := parts[len(parts)-1]
	ruleName := fmt.Sprintf("NetGuard Block - %s", displayName)

	// Create both inbound and outbound block rules
	errOut := createFirewallRule(ruleName+" (Out)", processPath, "", 0, NET_FW_RULE_DIR_OUT, NET_FW_ACTION_BLOCK)
	errIn := createFirewallRule(ruleName+" (In)", processPath, "", 0, NET_FW_RULE_DIR_IN, NET_FW_ACTION_BLOCK)

	if errOut != nil && errIn != nil {
		return fmt.Errorf("failed to create firewall rules: out=%v, in=%v", errOut, errIn)
	}

	// Track blocked app
	blockedAppsMux.Lock()
	blockedApps[processPath] = true
	blockedAppsMux.Unlock()

	return nil
}

// unblockApplicationWFP removes block rules for an application
func unblockApplicationWFP(processPath string) error {
	log.Printf("WFP: Unblocking application: %s", processPath)

	// Extract filename for rule name
	parts := strings.Split(processPath, "\\")
	displayName := parts[len(parts)-1]
	ruleNameOut := fmt.Sprintf("NetGuard Block - %s (Out)", displayName)
	ruleNameIn := fmt.Sprintf("NetGuard Block - %s (In)", displayName)

	// Remove both rules
	removeFirewallRule(ruleNameOut)
	removeFirewallRule(ruleNameIn)

	// Update tracking
	blockedAppsMux.Lock()
	delete(blockedApps, processPath)
	blockedAppsMux.Unlock()

	return nil
}

// isAppBlocked checks if an application is currently blocked
func isAppBlocked(processPath string) bool {
	blockedAppsMux.RLock()
	defer blockedAppsMux.RUnlock()
	return blockedApps[processPath]
}

// removeFirewallRule removes a firewall rule by name
func removeFirewallRule(ruleName string) error {
	policy, err := initFirewallPolicy()
	if err != nil {
		return err
	}
	defer ole.CoUninitialize()
	defer policy.Release()

	rulesVariant, err := oleutil.GetProperty(policy, "Rules")
	if err != nil {
		return err
	}
	rulesDispatch := rulesVariant.ToIDispatch()
	if rulesDispatch == nil {
		return fmt.Errorf("failed to get rules dispatch")
	}
	defer rulesDispatch.Release()

	_, err = oleutil.CallMethod(rulesDispatch, "Remove", ruleName)
	if err != nil {
		log.Printf("Failed to remove firewall rule %s: %v", ruleName, err)
		return err
	}

	log.Printf("Successfully removed firewall rule: %s", ruleName)
	return nil
}

// addPendingConnection adds a connection to the pending list
func addPendingConnection(conn NetworkConnection) {
	pendingConnectionsMux.Lock()
	defer pendingConnectionsMux.Unlock()

	id := fmt.Sprintf("%s-%s:%d-%d", conn.ProcessPath, conn.RemoteAddress, conn.RemotePort, time.Now().UnixNano())

	pendingConnections[id] = &PendingConnection{
		ID:            id,
		ProcessName:   conn.ProcessName,
		ProcessPath:   conn.ProcessPath,
		RemoteAddress: conn.RemoteAddress,
		RemotePort:    conn.RemotePort,
		Timestamp:     time.Now(),
	}

	log.Printf("Added pending connection: %s -> %s:%d", conn.ProcessName, conn.RemoteAddress, conn.RemotePort)
}

// getPendingConnections returns all pending connections
func getPendingConnections() []*PendingConnection {
	pendingConnectionsMux.RLock()
	defer pendingConnectionsMux.RUnlock()

	result := make([]*PendingConnection, 0, len(pendingConnections))
	for _, conn := range pendingConnections {
		result = append(result, conn)
	}
	return result
}

// respondToPendingConnection handles user response to a pending connection
func respondToPendingConnection(id string, allowed bool, remember bool) error {
	pendingConnectionsMux.Lock()
	conn, exists := pendingConnections[id]
	if exists {
		delete(pendingConnections, id)
	}
	pendingConnectionsMux.Unlock()

	if !exists {
		return fmt.Errorf("pending connection not found: %s", id)
	}

	if remember {
		if allowed {
			// Add to known apps as allowed
			addKnownApp(conn.ProcessPath, conn.ProcessName, true)
		} else {
			// Block the application
			if err := blockApplicationWFP(conn.ProcessPath); err != nil {
				log.Printf("Failed to block application: %v", err)
			}
			// Add to known apps as blocked
			addKnownApp(conn.ProcessPath, conn.ProcessName, false)
		}
	}

	return nil
}
