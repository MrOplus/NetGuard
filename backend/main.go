package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool {
		return true // Allow all origins for local development
	},
}

// Global state
var (
	connections     []NetworkConnection
	trafficStats    TrafficStats
	devices         []NetworkDevice
	wifiNetworks    []WiFiNetwork
	rdpSessions     []RDPSession
	connectionsMux  sync.RWMutex
	devicesMux      sync.RWMutex
	trafficMux      sync.RWMutex

	// Device tracking for new device detection
	knownDevices   map[string]NetworkDevice // MAC -> Device
	knownDevMux    sync.RWMutex

	// WebSocket clients for broadcasting alerts
	wsClients      map[*websocket.Conn]bool
	wsClientsMux   sync.RWMutex

	// Alert channel
	alertChan      chan Alert
)

type Alert struct {
	Type      string      `json:"type"`
	Title     string      `json:"title"`
	Message   string      `json:"message"`
	Data      interface{} `json:"data,omitempty"`
	Timestamp time.Time   `json:"timestamp"`
}

type NetworkConnection struct {
	ID            string  `json:"id"`
	ProcessName   string  `json:"processName"`
	ProcessPath   string  `json:"processPath"`
	ProcessID     int     `json:"processId"`
	LocalAddress  string  `json:"localAddress"`
	LocalPort     int     `json:"localPort"`
	RemoteAddress string  `json:"remoteAddress"`
	RemotePort    int     `json:"remotePort"`
	RemoteHost    string  `json:"remoteHost,omitempty"`
	Protocol      string  `json:"protocol"`
	State         string  `json:"state"`
	BytesSent     uint64  `json:"bytesSent"`
	BytesReceived uint64  `json:"bytesReceived"`
	Country       string  `json:"country,omitempty"`
	City          string  `json:"city,omitempty"`
	Lat           float64 `json:"lat,omitempty"`
	Lon           float64 `json:"lon,omitempty"`
}

type TrafficStats struct {
	Download      uint64    `json:"download"`
	Upload        uint64    `json:"upload"`
	TotalDownload uint64    `json:"totalDownload"`
	TotalUpload   uint64    `json:"totalUpload"`
	Timestamp     time.Time `json:"timestamp"`
}

type NetworkDevice struct {
	MACAddress string    `json:"macAddress"`
	IPAddress  string    `json:"ipAddress"`
	Hostname   string    `json:"hostname"`
	Vendor     string    `json:"vendor"`
	FirstSeen  time.Time `json:"firstSeen"`
	LastSeen   time.Time `json:"lastSeen"`
	IsOnline   bool      `json:"isOnline"`
}

type WiFiNetwork struct {
	SSID           string `json:"ssid"`
	BSSID          string `json:"bssid"`
	SignalStrength int    `json:"signalStrength"`
	Channel        int    `json:"channel"`
	Security       string `json:"security"`
	IsEvilTwin     bool   `json:"isEvilTwin"`
}

type RDPSession struct {
	SessionID     string    `json:"sessionId"`
	Username      string    `json:"username"`
	ClientName    string    `json:"clientName"`
	ClientAddress string    `json:"clientAddress"`
	State         string    `json:"state"`
	StartedAt     time.Time `json:"startedAt"`
}

type FirewallRule struct {
	Name        string `json:"name"`
	DisplayName string `json:"displayName"`
	Enabled     bool   `json:"enabled"`
	Direction   string `json:"direction"`
	Action      string `json:"action"`
	Program     string `json:"program,omitempty"`
	Profile     string `json:"profile"`
}

type APIResponse struct {
	Success bool        `json:"success"`
	Data    interface{} `json:"data,omitempty"`
	Error   string      `json:"error,omitempty"`
}

func main() {
	// Initialize database
	if err := initDatabase(); err != nil {
		log.Fatalf("Failed to initialize database: %v", err)
	}
	defer closeDatabase()

	// Start background monitors
	go monitorConnections()
	go monitorTraffic()
	go monitorDevices()
	go monitorWiFi()
	go monitorRDP()

	// HTTP API endpoints
	http.HandleFunc("/api/connections", handleConnections)
	http.HandleFunc("/api/traffic", handleTraffic)
	http.HandleFunc("/api/devices", handleDevices)
	http.HandleFunc("/api/devices/scan", handleDeviceScan)
	http.HandleFunc("/api/devices/name", handleDeviceName)
	http.HandleFunc("/api/wifi", handleWiFi)
	http.HandleFunc("/api/rdp", handleRDP)
	http.HandleFunc("/api/firewall/rules", handleFirewallRules)
	http.HandleFunc("/api/firewall/block", handleFirewallBlock)
	http.HandleFunc("/api/firewall/allow", handleFirewallAllow)
	http.HandleFunc("/api/connections/kill", handleConnectionKill)
	http.HandleFunc("/api/connections/block", handleConnectionBlock)
	http.HandleFunc("/ws", handleWebSocket)
	http.HandleFunc("/health", handleHealth)
	http.HandleFunc("/shutdown", handleShutdown)
	http.HandleFunc("/api/debug/devices-db", handleDebugDevicesDB)

	// New database-backed endpoints
	http.HandleFunc("/api/settings", handleSettings)
	http.HandleFunc("/api/alerts", handleAlerts)
	http.HandleFunc("/api/alerts/clear", handleAlertsClear)
	http.HandleFunc("/api/alerts/read", handleAlertsRead)
	http.HandleFunc("/api/alerts/recent", handleRecentAlerts)
	http.HandleFunc("/api/history", handleHistory)
	http.HandleFunc("/api/app-usage", handleAppUsage)
	http.HandleFunc("/api/oui/stats", handleOUIStats)
	http.HandleFunc("/api/oui/refresh", handleOUIRefresh)
	http.HandleFunc("/api/known-apps/clear", handleClearKnownApps)
	http.HandleFunc("/api/debug/db-stats", handleDBStats)

	// Port scanning and device management
	http.HandleFunc("/api/devices/ports", handleDevicePorts)
	http.HandleFunc("/api/devices/scan-ports", handleScanDevicePorts)

	// WFP / Ask to Connect endpoints
	http.HandleFunc("/api/pending-connections", handlePendingConnections)
	http.HandleFunc("/api/pending-connections/respond", handleRespondToPendingConnection)
	http.HandleFunc("/api/app/block", handleBlockApp)
	http.HandleFunc("/api/app/unblock", handleUnblockApp)

	// Start background device scanning
	startBackgroundDeviceScanning()

	log.Println("NetGuard backend starting on :8899")
	log.Fatal(http.ListenAndServe("127.0.0.1:8899", nil))
}

func handleHealth(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(APIResponse{Success: true, Data: "ok"})
}

func handleShutdown(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Access-Control-Allow-Origin", "*")
	json.NewEncoder(w).Encode(APIResponse{Success: true, Data: "shutting down"})
	// Give time for response to be sent, then exit
	go func() {
		time.Sleep(100 * time.Millisecond)
		os.Exit(0)
	}()
}

func handleDebugDevicesDB(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Access-Control-Allow-Origin", "*")
	devices := getDevicesFromDB()
	json.NewEncoder(w).Encode(APIResponse{Success: true, Data: devices})
}

// Store recent alerts for API access
var (
	recentAlerts    []Alert
	recentAlertsMux sync.RWMutex
)

func handleRecentAlerts(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Access-Control-Allow-Origin", "*")

	recentAlertsMux.RLock()
	defer recentAlertsMux.RUnlock()

	json.NewEncoder(w).Encode(APIResponse{Success: true, Data: recentAlerts})
}

func storeAlert(alert Alert) {
	recentAlertsMux.Lock()
	defer recentAlertsMux.Unlock()

	// Keep only last 50 alerts
	recentAlerts = append(recentAlerts, alert)
	if len(recentAlerts) > 50 {
		recentAlerts = recentAlerts[len(recentAlerts)-50:]
	}
}

func handleConnections(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Access-Control-Allow-Origin", "*")

	hideLocal := r.URL.Query().Get("hideLocal") == "true"

	connectionsMux.RLock()
	defer connectionsMux.RUnlock()

	if hideLocal {
		// Filter out localhost connections
		filtered := make([]NetworkConnection, 0)
		for _, conn := range connections {
			// Skip if both local and remote are localhost
			if isLocalhost(conn.LocalAddress) && isLocalhost(conn.RemoteAddress) {
				continue
			}
			filtered = append(filtered, conn)
		}
		json.NewEncoder(w).Encode(APIResponse{Success: true, Data: filtered})
	} else {
		json.NewEncoder(w).Encode(APIResponse{Success: true, Data: connections})
	}
}

func isLocalhost(ip string) bool {
	// Note: 0.0.0.0 is NOT localhost - it means "all interfaces" for listening sockets
	return ip == "127.0.0.1" || ip == "::1" || strings.HasPrefix(ip, "127.")
}

func handleTraffic(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Access-Control-Allow-Origin", "*")

	trafficMux.RLock()
	defer trafficMux.RUnlock()

	json.NewEncoder(w).Encode(APIResponse{Success: true, Data: trafficStats})
}

func handleDevices(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Access-Control-Allow-Origin", "*")

	// Get custom names from database
	storedDevices := getDevicesFromDB()
	customNames := make(map[string]string)
	for _, sd := range storedDevices {
		if sd.CustomName != "" {
			customNames[sd.MACAddress] = sd.CustomName
		}
	}

	devicesMux.RLock()
	deviceList := make([]map[string]interface{}, len(devices))
	for i, d := range devices {
		deviceData := map[string]interface{}{
			"macAddress": d.MACAddress,
			"ipAddress":  d.IPAddress,
			"hostname":   d.Hostname,
			"vendor":     d.Vendor,
			"firstSeen":  d.FirstSeen,
			"lastSeen":   d.LastSeen,
			"isOnline":   d.IsOnline,
		}
		// Add custom name from database if available
		if customName, ok := customNames[d.MACAddress]; ok {
			deviceData["customName"] = customName
		}
		// Add open ports if available
		deviceOpenPortsMux.RLock()
		if ports, ok := deviceOpenPorts[d.MACAddress]; ok {
			deviceData["openPorts"] = ports
		}
		deviceOpenPortsMux.RUnlock()
		deviceList[i] = deviceData
	}
	devicesMux.RUnlock()

	json.NewEncoder(w).Encode(APIResponse{Success: true, Data: deviceList})
}

func handleDeviceScan(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Access-Control-Allow-Origin", "*")

	// Trigger immediate scan
	scanDevices()

	devicesMux.RLock()
	defer devicesMux.RUnlock()

	json.NewEncoder(w).Encode(APIResponse{Success: true, Data: devices})
}

func handleWiFi(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Access-Control-Allow-Origin", "*")

	networks := scanWiFiNetworks()
	json.NewEncoder(w).Encode(APIResponse{Success: true, Data: networks})
}

func handleRDP(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Access-Control-Allow-Origin", "*")

	sessions := getRDPSessions()
	json.NewEncoder(w).Encode(APIResponse{Success: true, Data: sessions})
}

func handleFirewallRules(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Access-Control-Allow-Origin", "*")

	rules := getFirewallRules()
	json.NewEncoder(w).Encode(APIResponse{Success: true, Data: rules})
}

func handleFirewallBlock(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Access-Control-Allow-Origin", "*")

	if r.Method != "POST" {
		json.NewEncoder(w).Encode(APIResponse{Success: false, Error: "Method not allowed"})
		return
	}

	var req struct {
		AppPath string `json:"appPath"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		json.NewEncoder(w).Encode(APIResponse{Success: false, Error: err.Error()})
		return
	}

	err := blockApplication(req.AppPath)
	if err != nil {
		json.NewEncoder(w).Encode(APIResponse{Success: false, Error: err.Error()})
		return
	}

	json.NewEncoder(w).Encode(APIResponse{Success: true})
}

func handleFirewallAllow(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Access-Control-Allow-Origin", "*")

	if r.Method != "POST" {
		json.NewEncoder(w).Encode(APIResponse{Success: false, Error: "Method not allowed"})
		return
	}

	var req struct {
		AppPath string `json:"appPath"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		json.NewEncoder(w).Encode(APIResponse{Success: false, Error: err.Error()})
		return
	}

	err := allowApplication(req.AppPath)
	if err != nil {
		json.NewEncoder(w).Encode(APIResponse{Success: false, Error: err.Error()})
		return
	}

	json.NewEncoder(w).Encode(APIResponse{Success: true})
}

func handleConnectionKill(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Access-Control-Allow-Origin", "*")

	if r.Method != "POST" {
		json.NewEncoder(w).Encode(APIResponse{Success: false, Error: "Method not allowed"})
		return
	}

	var req struct {
		ConnectionID string `json:"connectionId"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		json.NewEncoder(w).Encode(APIResponse{Success: false, Error: err.Error()})
		return
	}

	err := killConnection(req.ConnectionID)
	if err != nil {
		json.NewEncoder(w).Encode(APIResponse{Success: false, Error: err.Error()})
		return
	}

	json.NewEncoder(w).Encode(APIResponse{Success: true})
}

func handleConnectionBlock(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Access-Control-Allow-Origin", "*")

	if r.Method != "POST" {
		json.NewEncoder(w).Encode(APIResponse{Success: false, Error: "Method not allowed"})
		return
	}

	var req struct {
		RemoteAddress string `json:"remoteAddress"`
		RemotePort    int    `json:"remotePort"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		json.NewEncoder(w).Encode(APIResponse{Success: false, Error: err.Error()})
		return
	}

	err := blockRemoteAddress(req.RemoteAddress, req.RemotePort)
	if err != nil {
		json.NewEncoder(w).Encode(APIResponse{Success: false, Error: err.Error()})
		return
	}

	json.NewEncoder(w).Encode(APIResponse{Success: true})
}

// WebSocket handler for real-time updates
func handleWebSocket(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Println("WebSocket upgrade error:", err)
		return
	}

	// Register client
	wsClientsMux.Lock()
	wsClients[conn] = true
	wsClientsMux.Unlock()

	log.Println("WebSocket client connected")

	defer func() {
		// Unregister client
		wsClientsMux.Lock()
		delete(wsClients, conn)
		wsClientsMux.Unlock()
		conn.Close()
		log.Println("WebSocket client disconnected")
	}()

	ticker := time.NewTicker(1 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-ticker.C:
			connectionsMux.RLock()
			trafficMux.RLock()

			update := map[string]interface{}{
				"type":        "update",
				"connections": connections,
				"traffic":     trafficStats,
				"timestamp":   time.Now(),
			}

			trafficMux.RUnlock()
			connectionsMux.RUnlock()

			if err := conn.WriteJSON(update); err != nil {
				log.Println("WebSocket write error:", err)
				return
			}
		}
	}
}

// Track seen connections to avoid duplicate logging
var (
	seenConnections    = make(map[string]bool)
	seenConnectionsMux sync.RWMutex
	seenApps           = make(map[string]bool) // Track apps we've already prompted for
	seenAppsMux        sync.RWMutex
)

// Background monitors
func monitorConnections() {
	ticker := time.NewTicker(1 * time.Second)
	logTicker := time.NewTicker(30 * time.Second) // Log connections every 30 seconds
	cleanupTicker := time.NewTicker(5 * time.Minute) // Cleanup old seen connections

	for {
		select {
		case <-ticker.C:
			conns := getTCPConnections()

			// Check for new apps (Ask to Connect feature)
			settings := getSettings()
			if settings.AskToConnect {
				checkNewApps(conns)
			}

			// Debug: log AskToConnect status periodically (suppress after first few)
			if settings.AskToConnect {
				// Only log once when enabled
				seenAppsMux.RLock()
				count := len(seenApps)
				seenAppsMux.RUnlock()
				if count == 0 {
					log.Println("Ask to Connect is ENABLED - will alert on new apps")
				}
			}

			connectionsMux.Lock()
			connections = conns
			connectionsMux.Unlock()

		case <-logTicker.C:
			// Log unique connections to database with process IO bytes
			connectionsMux.RLock()
			for _, conn := range connections {
				// Only log established external connections
				if conn.State == "Established" && !isLocalhost(conn.RemoteAddress) {
					connKey := fmt.Sprintf("%s-%s:%d", conn.ProcessPath, conn.RemoteAddress, conn.RemotePort)

					seenConnectionsMux.RLock()
					seen := seenConnections[connKey]
					seenConnectionsMux.RUnlock()

					if !seen {
						// Use the bytes already calculated by getTCPConnections (delta based)
						// Note: conn.BytesSent and conn.BytesReceived are already set from getProcessIO
						logConnection(conn)
						seenConnectionsMux.Lock()
						seenConnections[connKey] = true
						seenConnectionsMux.Unlock()

						// Also update app usage stats
						if conn.BytesSent > 0 || conn.BytesReceived > 0 {
							updateAppUsage(conn.ProcessName, conn.ProcessPath, conn.BytesSent, conn.BytesReceived)
						}
					}
				}
			}
			connectionsMux.RUnlock()

		case <-cleanupTicker.C:
			// Cleanup old seen connections to allow re-logging
			seenConnectionsMux.Lock()
			seenConnections = make(map[string]bool)
			seenConnectionsMux.Unlock()
		}
	}
}

// checkNewApps checks for new applications making network connections
func checkNewApps(conns []NetworkConnection) {
	for _, conn := range conns {
		if conn.ProcessPath == "" || conn.State != "Established" {
			continue
		}

		// Skip localhost connections
		if isLocalhost(conn.RemoteAddress) {
			continue
		}

		seenAppsMux.RLock()
		alreadySeen := seenApps[conn.ProcessPath]
		seenAppsMux.RUnlock()

		if alreadySeen {
			continue
		}

		// Check if app is known in database
		if !isKnownApp(conn.ProcessPath) {
			// New app detected - send alert
			alert := Alert{
				Type:      "new_app",
				Title:     "New Application Network Access",
				Message:   fmt.Sprintf("%s is trying to access the network", conn.ProcessName),
				Data: map[string]interface{}{
					"processName": conn.ProcessName,
					"processPath": conn.ProcessPath,
					"remoteAddress": conn.RemoteAddress,
					"remotePort": conn.RemotePort,
				},
				Timestamp: time.Now(),
			}

			select {
			case alertChan <- alert:
				log.Printf("New app alert: %s", conn.ProcessName)
			default:
				log.Println("Alert channel full")
			}

			// Add to known apps (allowed by default for now)
			addKnownApp(conn.ProcessPath, conn.ProcessName, true)
		}

		// Mark as seen for this session
		seenAppsMux.Lock()
		seenApps[conn.ProcessPath] = true
		seenAppsMux.Unlock()
	}
}

// Debug flag for traffic monitoring
var trafficMonitorDebugOnce sync.Once

func monitorTraffic() {
	var prevReceived, prevSent uint64
	ticker := time.NewTicker(1 * time.Second)
	logTicker := time.NewTicker(60 * time.Second) // Log to database every 60 seconds
	debugTicker := time.NewTicker(10 * time.Second) // Debug logging every 10 seconds

	// Initialize with first reading
	prevReceived, prevSent = getNetworkStats()
	log.Printf("monitorTraffic: Initial stats - received=%d, sent=%d", prevReceived, prevSent)

	for {
		select {
		case <-ticker.C:
			received, sent := getNetworkStats()

			trafficMux.Lock()
			// Calculate delta (current - previous)
			if prevReceived > 0 && received >= prevReceived {
				trafficStats.Download = received - prevReceived
			} else {
				trafficStats.Download = 0
			}
			if prevSent > 0 && sent >= prevSent {
				trafficStats.Upload = sent - prevSent
			} else {
				trafficStats.Upload = 0
			}
			trafficStats.TotalDownload = received
			trafficStats.TotalUpload = sent
			trafficStats.Timestamp = time.Now()
			trafficMux.Unlock()

			prevReceived = received
			prevSent = sent

		case <-debugTicker.C:
			// Debug logging periodically
			trafficMux.RLock()
			download := trafficStats.Download
			upload := trafficStats.Upload
			totalDown := trafficStats.TotalDownload
			totalUp := trafficStats.TotalUpload
			trafficMux.RUnlock()

			trafficMonitorDebugOnce.Do(func() {
				log.Printf("monitorTraffic DEBUG: Download=%d B/s, Upload=%d B/s, TotalDown=%d, TotalUp=%d",
					download, upload, totalDown, totalUp)
			})

		case <-logTicker.C:
			// Log traffic to database for history
			trafficMux.RLock()
			download := trafficStats.Download
			upload := trafficStats.Upload
			trafficMux.RUnlock()

			if download > 0 || upload > 0 {
				logTraffic(download, upload)
			}
		}
	}
}

func monitorDevices() {
	// Initial scan
	scanDevices()

	// Scan every 10 seconds for faster new device detection
	ticker := time.NewTicker(10 * time.Second)
	for range ticker.C {
		scanDevices()
	}
}

func monitorWiFi() {
	ticker := time.NewTicker(30 * time.Second)
	for range ticker.C {
		scanWiFiNetworks()
	}
}

func monitorRDP() {
	ticker := time.NewTicker(10 * time.Second)
	for range ticker.C {
		getRDPSessions()
	}
}

func scanDevices() {
	// First do a ping sweep to populate the ARP table
	pingSweepSubnet()

	// Then get the ARP table
	newDevices := getARPTable()

	// Check for new devices
	knownDevMux.Lock()
	isFirstScan := len(knownDevices) == 0

	var newAlerts []Alert

	for _, device := range newDevices {
		// Save/update device in database
		upsertDevice(device.MACAddress, device.IPAddress, device.Hostname, device.Vendor)

		if _, exists := knownDevices[device.MACAddress]; !exists {
			// Add to known devices
			knownDevices[device.MACAddress] = device

			// Only alert if not the first scan
			if !isFirstScan {
				vendorInfo := device.Vendor
				if vendorInfo == "" {
					vendorInfo = "Unknown vendor"
				}

				alert := Alert{
					Type:      "new_device",
					Title:     "New Device Detected",
					Message:   fmt.Sprintf("%s (%s) joined the network at %s", vendorInfo, device.MACAddress, device.IPAddress),
					Data:      device,
					Timestamp: time.Now(),
				}
				newAlerts = append(newAlerts, alert)
			}
		}
	}
	knownDevMux.Unlock()

	// Send alerts outside of lock
	for _, alert := range newAlerts {
		select {
		case alertChan <- alert:
			log.Printf("New device alert: %s", alert.Message)
		default:
			log.Println("Alert channel full, dropping alert")
		}
	}

	devicesMux.Lock()
	devices = newDevices
	devicesMux.Unlock()
}

func init() {
	connections = []NetworkConnection{}
	devices = []NetworkDevice{}
	wifiNetworks = []WiFiNetwork{}
	rdpSessions = []RDPSession{}
	trafficStats = TrafficStats{}
	knownDevices = make(map[string]NetworkDevice)
	wsClients = make(map[*websocket.Conn]bool)
	alertChan = make(chan Alert, 100)

	// Start alert broadcaster
	go alertBroadcaster()

	fmt.Println("NetGuard backend initialized")
}

func alertBroadcaster() {
	for alert := range alertChan {
		// Store alert in memory and database
		storeAlert(alert)
		addAlert(alert.Type, "info", alert.Title, alert.Message)

		// Broadcast to WebSocket clients
		wsClientsMux.RLock()
		for client := range wsClients {
			err := client.WriteJSON(map[string]interface{}{
				"type":  "alert",
				"alert": alert,
			})
			if err != nil {
				log.Println("Error sending alert to client:", err)
			}
		}
		wsClientsMux.RUnlock()
	}
}

// Settings handlers
func handleSettings(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type")

	if r.Method == "OPTIONS" {
		w.WriteHeader(http.StatusOK)
		return
	}

	if r.Method == "GET" {
		settings := getSettings()
		json.NewEncoder(w).Encode(APIResponse{Success: true, Data: settings})
		return
	}

	if r.Method == "POST" {
		var newSettings map[string]interface{}
		if err := json.NewDecoder(r.Body).Decode(&newSettings); err != nil {
			json.NewEncoder(w).Encode(APIResponse{Success: false, Error: err.Error()})
			return
		}

		if err := saveSettings(newSettings); err != nil {
			json.NewEncoder(w).Encode(APIResponse{Success: false, Error: err.Error()})
			return
		}

		json.NewEncoder(w).Encode(APIResponse{Success: true, Data: getSettings()})
		return
	}

	json.NewEncoder(w).Encode(APIResponse{Success: false, Error: "Method not allowed"})
}

// Alerts handlers
func handleAlerts(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Access-Control-Allow-Origin", "*")

	alerts := getAlerts()
	json.NewEncoder(w).Encode(APIResponse{Success: true, Data: alerts})
}

func handleAlertsClear(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Access-Control-Allow-Origin", "*")

	if r.Method != "POST" {
		json.NewEncoder(w).Encode(APIResponse{Success: false, Error: "Method not allowed"})
		return
	}

	if clearAlerts() {
		json.NewEncoder(w).Encode(APIResponse{Success: true})
	} else {
		json.NewEncoder(w).Encode(APIResponse{Success: false, Error: "Failed to clear alerts"})
	}
}

func handleAlertsRead(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Access-Control-Allow-Origin", "*")

	if r.Method != "POST" {
		json.NewEncoder(w).Encode(APIResponse{Success: false, Error: "Method not allowed"})
		return
	}

	var req struct {
		ID int64 `json:"id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		json.NewEncoder(w).Encode(APIResponse{Success: false, Error: err.Error()})
		return
	}

	if markAlertRead(req.ID) {
		json.NewEncoder(w).Encode(APIResponse{Success: true})
	} else {
		json.NewEncoder(w).Encode(APIResponse{Success: false, Error: "Failed to mark alert as read"})
	}
}

// History handler
func handleHistory(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Access-Control-Allow-Origin", "*")

	startTime := r.URL.Query().Get("start")
	endTime := r.URL.Query().Get("end")

	if startTime == "" || endTime == "" {
		// Default to last 24 hours
		now := time.Now()
		endTime = now.Format(time.RFC3339)
		startTime = now.Add(-24 * time.Hour).Format(time.RFC3339)
	}

	data := getHistoryData(startTime, endTime)
	json.NewEncoder(w).Encode(APIResponse{Success: true, Data: data})
}

// App usage handler
func handleAppUsage(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Access-Control-Allow-Origin", "*")

	timeRange := r.URL.Query().Get("range")
	if timeRange == "" {
		timeRange = "today"
	}

	usage := getAppUsage(timeRange)
	json.NewEncoder(w).Encode(APIResponse{Success: true, Data: usage})
}

// Device name handler
func handleDeviceName(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "POST, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type")

	if r.Method == "OPTIONS" {
		w.WriteHeader(http.StatusOK)
		return
	}

	if r.Method != "POST" {
		json.NewEncoder(w).Encode(APIResponse{Success: false, Error: "Method not allowed"})
		return
	}

	var req struct {
		MACAddress string `json:"macAddress"`
		Name       string `json:"name"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		json.NewEncoder(w).Encode(APIResponse{Success: false, Error: err.Error()})
		return
	}

	if updateDeviceName(req.MACAddress, req.Name) {
		json.NewEncoder(w).Encode(APIResponse{Success: true})
	} else {
		json.NewEncoder(w).Encode(APIResponse{Success: false, Error: "Failed to update device name"})
	}
}

// OUI database handlers
func handleOUIStats(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Access-Control-Allow-Origin", "*")

	stats := GetOUIStats()
	json.NewEncoder(w).Encode(APIResponse{Success: true, Data: stats})
}

func handleOUIRefresh(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Access-Control-Allow-Origin", "*")

	if r.Method != "POST" {
		json.NewEncoder(w).Encode(APIResponse{Success: false, Error: "Method not allowed"})
		return
	}

	ForceOUIRefresh()
	json.NewEncoder(w).Encode(APIResponse{Success: true, Data: "OUI refresh started"})
}

// Debug endpoint to check database stats
func handleDBStats(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Access-Control-Allow-Origin", "*")

	stats := getDBStats()
	json.NewEncoder(w).Encode(APIResponse{Success: true, Data: stats})
}

// Clear known apps - used when enabling "Ask to Connect" to reset the app list
func handleClearKnownApps(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Access-Control-Allow-Origin", "*")

	if r.Method != "POST" {
		json.NewEncoder(w).Encode(APIResponse{Success: false, Error: "Method not allowed"})
		return
	}

	// Clear database
	if clearKnownApps() {
		// Also clear the in-memory seen apps
		seenAppsMux.Lock()
		seenApps = make(map[string]bool)
		seenAppsMux.Unlock()

		log.Println("Known apps cleared - Ask to Connect will now prompt for all apps")
		json.NewEncoder(w).Encode(APIResponse{Success: true})
	} else {
		json.NewEncoder(w).Encode(APIResponse{Success: false, Error: "Failed to clear known apps"})
	}
}

// handleDevicePorts returns open ports for a device by MAC address
func handleDevicePorts(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Access-Control-Allow-Origin", "*")

	mac := r.URL.Query().Get("mac")
	if mac == "" {
		json.NewEncoder(w).Encode(APIResponse{Success: false, Error: "MAC address required"})
		return
	}

	ports := getDeviceOpenPorts(mac)
	json.NewEncoder(w).Encode(APIResponse{Success: true, Data: ports})
}

// handleScanDevicePorts triggers a port scan on a specific device
func handleScanDevicePorts(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Access-Control-Allow-Origin", "*")

	if r.Method != "POST" {
		json.NewEncoder(w).Encode(APIResponse{Success: false, Error: "Method not allowed"})
		return
	}

	var req struct {
		IP  string `json:"ip"`
		MAC string `json:"mac"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		json.NewEncoder(w).Encode(APIResponse{Success: false, Error: "Invalid request"})
		return
	}

	// Scan ports
	ports := scanDevicePorts(req.IP)

	// Cache results if MAC provided
	if req.MAC != "" {
		deviceOpenPortsMux.Lock()
		deviceOpenPorts[req.MAC] = ports
		deviceOpenPortsMux.Unlock()
	}

	json.NewEncoder(w).Encode(APIResponse{Success: true, Data: ports})
}

// handlePendingConnections returns pending connections awaiting user approval
func handlePendingConnections(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Access-Control-Allow-Origin", "*")

	pending := getPendingConnections()
	json.NewEncoder(w).Encode(APIResponse{Success: true, Data: pending})
}

// handleRespondToPendingConnection handles user response to a pending connection
func handleRespondToPendingConnection(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Access-Control-Allow-Origin", "*")

	if r.Method != "POST" {
		json.NewEncoder(w).Encode(APIResponse{Success: false, Error: "Method not allowed"})
		return
	}

	var req struct {
		ID       string `json:"id"`
		Allowed  bool   `json:"allowed"`
		Remember bool   `json:"remember"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		json.NewEncoder(w).Encode(APIResponse{Success: false, Error: "Invalid request"})
		return
	}

	if err := respondToPendingConnection(req.ID, req.Allowed, req.Remember); err != nil {
		json.NewEncoder(w).Encode(APIResponse{Success: false, Error: err.Error()})
		return
	}

	json.NewEncoder(w).Encode(APIResponse{Success: true})
}

// handleBlockApp blocks an application using Windows Firewall
func handleBlockApp(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Access-Control-Allow-Origin", "*")

	if r.Method != "POST" {
		json.NewEncoder(w).Encode(APIResponse{Success: false, Error: "Method not allowed"})
		return
	}

	var req struct {
		ProcessPath string `json:"processPath"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		json.NewEncoder(w).Encode(APIResponse{Success: false, Error: "Invalid request"})
		return
	}

	if err := blockApplicationWFP(req.ProcessPath); err != nil {
		json.NewEncoder(w).Encode(APIResponse{Success: false, Error: err.Error()})
		return
	}

	json.NewEncoder(w).Encode(APIResponse{Success: true})
}

// handleUnblockApp removes firewall block for an application
func handleUnblockApp(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Access-Control-Allow-Origin", "*")

	if r.Method != "POST" {
		json.NewEncoder(w).Encode(APIResponse{Success: false, Error: "Method not allowed"})
		return
	}

	var req struct {
		ProcessPath string `json:"processPath"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		json.NewEncoder(w).Encode(APIResponse{Success: false, Error: "Invalid request"})
		return
	}

	if err := unblockApplicationWFP(req.ProcessPath); err != nil {
		json.NewEncoder(w).Encode(APIResponse{Success: false, Error: err.Error()})
		return
	}

	json.NewEncoder(w).Encode(APIResponse{Success: true})
}
