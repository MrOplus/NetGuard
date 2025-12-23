package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"sync"
	"time"

	_ "modernc.org/sqlite"
)

var (
	db        *sql.DB
	dbMutex   sync.RWMutex
	dbPath    string
	settings  Settings
	settingsMux sync.RWMutex
)

type Settings struct {
	Theme            string `json:"theme"`
	AccentColor      string `json:"accentColor"`
	MinimizeToTray   bool   `json:"minimizeToTray"`
	StartWithWindows bool   `json:"startWithWindows"`
	ShowMiniGraph    bool   `json:"showMiniGraph"`
	AskToConnect     bool   `json:"askToConnect"`
	LockdownMode     bool   `json:"lockdownMode"`
	RetentionDays    int    `json:"retentionDays"`
	AlertSounds      bool   `json:"alertSounds"`
	NotifyNewDevice  bool   `json:"notifyNewDevice"`
	NotifyNewApp     bool   `json:"notifyNewApp"`
	NotifyEvilTwin   bool   `json:"notifyEvilTwin"`
	NotifyRDP        bool   `json:"notifyRDP"`
	HideLocalTraffic bool   `json:"hideLocalTraffic"`
}

type StoredAlert struct {
	ID        int64     `json:"id"`
	Timestamp time.Time `json:"timestamp"`
	Type      string    `json:"type"`
	Severity  string    `json:"severity"`
	Title     string    `json:"title"`
	Message   string    `json:"message"`
	Read      bool      `json:"read"`
}

type TrafficHistory struct {
	Timestamp time.Time `json:"timestamp"`
	Download  uint64    `json:"download"`
	Upload    uint64    `json:"upload"`
}

type AppUsage struct {
	ProcessName   string `json:"processName"`
	ProcessPath   string `json:"processPath"`
	BytesSent     uint64 `json:"bytesSent"`
	BytesReceived uint64 `json:"bytesReceived"`
	Connections   int    `json:"connections"`
}

type StoredDevice struct {
	MACAddress string    `json:"macAddress"`
	IPAddress  string    `json:"ipAddress"`
	Hostname   string    `json:"hostname"`
	Vendor     string    `json:"vendor"`
	CustomName string    `json:"customName,omitempty"`
	FirstSeen  time.Time `json:"firstSeen"`
	LastSeen   time.Time `json:"lastSeen"`
	IsOnline   bool      `json:"isOnline"`
}

type KnownApp struct {
	ProcessPath string    `json:"processPath"`
	ProcessName string    `json:"processName"`
	Allowed     bool      `json:"allowed"`
	FirstSeen   time.Time `json:"firstSeen"`
}

func getDefaultSettings() Settings {
	return Settings{
		Theme:            "dark",
		AccentColor:      "#0ea5e9",
		MinimizeToTray:   true,
		StartWithWindows: false,
		ShowMiniGraph:    false,
		AskToConnect:     false,
		LockdownMode:     false,
		RetentionDays:    30,
		AlertSounds:      true,
		NotifyNewDevice:  true,
		NotifyNewApp:     true,
		NotifyEvilTwin:   true,
		NotifyRDP:        true,
		HideLocalTraffic: true,
	}
}

func initDatabase() error {
	// Get app data directory
	appData := os.Getenv("APPDATA")
	if appData == "" {
		appData = "."
	}

	dataDir := filepath.Join(appData, "NetGuard")
	if err := os.MkdirAll(dataDir, 0755); err != nil {
		return err
	}

	dbPath = filepath.Join(dataDir, "netguard.db")

	var err error
	db, err = sql.Open("sqlite", dbPath+"?_journal_mode=WAL&_busy_timeout=5000")
	if err != nil {
		return err
	}

	// Create tables
	if err := createTables(); err != nil {
		return err
	}

	// Load settings
	loadSettings()

	log.Printf("Database initialized at %s", dbPath)
	return nil
}

func createTables() error {
	// First, run migrations for existing tables
	migrations := []string{
		// Add bytes columns to connection_log if they don't exist
		`ALTER TABLE connection_log ADD COLUMN bytes_sent INTEGER DEFAULT 0`,
		`ALTER TABLE connection_log ADD COLUMN bytes_received INTEGER DEFAULT 0`,
	}

	for _, migration := range migrations {
		// Ignore errors - columns may already exist
		db.Exec(migration)
	}

	tables := `
	CREATE TABLE IF NOT EXISTS settings (
		key TEXT PRIMARY KEY,
		value TEXT
	);

	CREATE TABLE IF NOT EXISTS alerts (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
		type TEXT,
		severity TEXT,
		title TEXT,
		message TEXT,
		read INTEGER DEFAULT 0
	);

	CREATE TABLE IF NOT EXISTS traffic_history (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
		download INTEGER,
		upload INTEGER
	);

	CREATE TABLE IF NOT EXISTS app_usage (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		date TEXT,
		process_name TEXT,
		process_path TEXT,
		bytes_sent INTEGER DEFAULT 0,
		bytes_received INTEGER DEFAULT 0,
		connections INTEGER DEFAULT 0,
		UNIQUE(date, process_path)
	);

	CREATE TABLE IF NOT EXISTS devices (
		mac_address TEXT PRIMARY KEY,
		ip_address TEXT,
		hostname TEXT,
		vendor TEXT,
		custom_name TEXT,
		first_seen DATETIME,
		last_seen DATETIME,
		is_online INTEGER DEFAULT 1
	);

	CREATE TABLE IF NOT EXISTS known_apps (
		process_path TEXT PRIMARY KEY,
		process_name TEXT,
		allowed INTEGER,
		first_seen DATETIME
	);

	CREATE TABLE IF NOT EXISTS connection_log (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
		process_name TEXT,
		process_path TEXT,
		local_address TEXT,
		local_port INTEGER,
		remote_address TEXT,
		remote_port INTEGER,
		protocol TEXT,
		country TEXT,
		city TEXT,
		bytes_sent INTEGER DEFAULT 0,
		bytes_received INTEGER DEFAULT 0
	);

	CREATE INDEX IF NOT EXISTS idx_alerts_timestamp ON alerts(timestamp);
	CREATE INDEX IF NOT EXISTS idx_traffic_timestamp ON traffic_history(timestamp);
	CREATE INDEX IF NOT EXISTS idx_app_usage_date ON app_usage(date);
	CREATE INDEX IF NOT EXISTS idx_connection_log_timestamp ON connection_log(timestamp);
	`

	_, err := db.Exec(tables)
	return err
}

func loadSettings() {
	settingsMux.Lock()
	defer settingsMux.Unlock()
	loadSettingsInternal()
}

// loadSettingsInternal loads settings without acquiring mutex (caller must hold lock)
func loadSettingsInternal() {
	settings = getDefaultSettings()

	rows, err := db.Query("SELECT key, value FROM settings")
	if err != nil {
		return
	}
	defer rows.Close()

	settingsMap := make(map[string]string)
	for rows.Next() {
		var key, value string
		if err := rows.Scan(&key, &value); err == nil {
			settingsMap[key] = value
		}
	}

	// Parse settings from map
	if v, ok := settingsMap["theme"]; ok {
		settings.Theme = v
	}
	if v, ok := settingsMap["accentColor"]; ok {
		settings.AccentColor = v
	}
	if v, ok := settingsMap["minimizeToTray"]; ok {
		settings.MinimizeToTray = v == "true"
	}
	if v, ok := settingsMap["startWithWindows"]; ok {
		settings.StartWithWindows = v == "true"
	}
	if v, ok := settingsMap["showMiniGraph"]; ok {
		settings.ShowMiniGraph = v == "true"
	}
	if v, ok := settingsMap["askToConnect"]; ok {
		settings.AskToConnect = v == "true"
	}
	if v, ok := settingsMap["lockdownMode"]; ok {
		settings.LockdownMode = v == "true"
	}
	if v, ok := settingsMap["alertSounds"]; ok {
		settings.AlertSounds = v == "true"
	}
	if v, ok := settingsMap["notifyNewDevice"]; ok {
		settings.NotifyNewDevice = v == "true"
	}
	if v, ok := settingsMap["notifyNewApp"]; ok {
		settings.NotifyNewApp = v == "true"
	}
	if v, ok := settingsMap["notifyEvilTwin"]; ok {
		settings.NotifyEvilTwin = v == "true"
	}
	if v, ok := settingsMap["notifyRDP"]; ok {
		settings.NotifyRDP = v == "true"
	}
	if v, ok := settingsMap["hideLocalTraffic"]; ok {
		settings.HideLocalTraffic = v == "true"
	}
}

func getSettings() Settings {
	settingsMux.RLock()
	defer settingsMux.RUnlock()
	return settings
}

func saveSettings(newSettings map[string]interface{}) error {
	settingsMux.Lock()
	defer settingsMux.Unlock()

	tx, err := db.Begin()
	if err != nil {
		return err
	}

	stmt, err := tx.Prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)")
	if err != nil {
		tx.Rollback()
		return err
	}
	defer stmt.Close()

	for key, value := range newSettings {
		var strValue string
		switch v := value.(type) {
		case bool:
			if v {
				strValue = "true"
			} else {
				strValue = "false"
			}
		case string:
			strValue = v
		case float64:
			strValue = fmt.Sprintf("%v", v)
		default:
			strValue = fmt.Sprintf("%v", v)
		}

		if _, err := stmt.Exec(key, strValue); err != nil {
			tx.Rollback()
			return err
		}
	}

	if err := tx.Commit(); err != nil {
		return err
	}

	// Reload settings (we already hold the lock)
	loadSettingsInternal()
	return nil
}

// Alert functions
func addAlert(alertType, severity, title, message string) int64 {
	dbMutex.Lock()
	defer dbMutex.Unlock()

	result, err := db.Exec(
		"INSERT INTO alerts (type, severity, title, message) VALUES (?, ?, ?, ?)",
		alertType, severity, title, message,
	)
	if err != nil {
		log.Printf("Error adding alert: %v", err)
		return 0
	}

	id, _ := result.LastInsertId()

	// Cleanup old alerts (keep last 100)
	db.Exec("DELETE FROM alerts WHERE id NOT IN (SELECT id FROM alerts ORDER BY id DESC LIMIT 100)")

	return id
}

func getAlerts() []StoredAlert {
	dbMutex.RLock()
	defer dbMutex.RUnlock()

	rows, err := db.Query("SELECT id, timestamp, type, severity, title, message, read FROM alerts ORDER BY id DESC LIMIT 100")
	if err != nil {
		return []StoredAlert{}
	}
	defer rows.Close()

	var alerts []StoredAlert
	for rows.Next() {
		var a StoredAlert
		var read int
		if err := rows.Scan(&a.ID, &a.Timestamp, &a.Type, &a.Severity, &a.Title, &a.Message, &read); err == nil {
			a.Read = read == 1
			alerts = append(alerts, a)
		}
	}
	return alerts
}

func markAlertRead(id int64) bool {
	dbMutex.Lock()
	defer dbMutex.Unlock()

	_, err := db.Exec("UPDATE alerts SET read = 1 WHERE id = ?", id)
	return err == nil
}

func clearAlerts() bool {
	dbMutex.Lock()
	defer dbMutex.Unlock()

	_, err := db.Exec("DELETE FROM alerts")
	return err == nil
}

// Traffic history functions
func logTraffic(download, upload uint64) {
	dbMutex.Lock()
	defer dbMutex.Unlock()

	db.Exec("INSERT INTO traffic_history (download, upload) VALUES (?, ?)", download, upload)

	// Get retention days from settings (default 30 days)
	settings := getSettings()
	retentionDays := settings.RetentionDays
	if retentionDays <= 0 {
		retentionDays = 30
	}

	// Cleanup old entries based on retention setting
	db.Exec("DELETE FROM traffic_history WHERE timestamp < datetime('now', ?)", fmt.Sprintf("-%d days", retentionDays))
}

func getTrafficHistory(timeRange string) []TrafficHistory {
	dbMutex.RLock()
	defer dbMutex.RUnlock()

	var interval string
	switch timeRange {
	case "1h":
		interval = "-1 hour"
	case "24h":
		interval = "-1 day"
	case "7d":
		interval = "-7 days"
	case "30d":
		interval = "-30 days"
	default:
		interval = "-1 hour"
	}

	rows, err := db.Query(
		"SELECT timestamp, download, upload FROM traffic_history WHERE timestamp > datetime('now', ?) ORDER BY timestamp",
		interval,
	)
	if err != nil {
		return []TrafficHistory{}
	}
	defer rows.Close()

	var history []TrafficHistory
	for rows.Next() {
		var h TrafficHistory
		if err := rows.Scan(&h.Timestamp, &h.Download, &h.Upload); err == nil {
			history = append(history, h)
		}
	}
	return history
}

// App usage functions
func updateAppUsage(processName, processPath string, bytesSent, bytesReceived uint64) {
	dbMutex.Lock()
	defer dbMutex.Unlock()

	today := time.Now().Format("2006-01-02")

	_, err := db.Exec(`
		INSERT INTO app_usage (date, process_name, process_path, bytes_sent, bytes_received, connections)
		VALUES (?, ?, ?, ?, ?, 1)
		ON CONFLICT(date, process_path) DO UPDATE SET
			bytes_sent = bytes_sent + excluded.bytes_sent,
			bytes_received = bytes_received + excluded.bytes_received,
			connections = connections + 1
	`, today, processName, processPath, bytesSent, bytesReceived)

	if err != nil {
		log.Printf("Error updating app usage: %v", err)
	}
}

func getAppUsage(timeRange string) []AppUsage {
	dbMutex.RLock()
	defer dbMutex.RUnlock()

	var interval string
	switch timeRange {
	case "today":
		interval = "0 days"
	case "week":
		interval = "-7 days"
	case "month":
		interval = "-30 days"
	default:
		interval = "0 days"
	}

	rows, err := db.Query(`
		SELECT process_name, process_path, SUM(bytes_sent), SUM(bytes_received), SUM(connections)
		FROM app_usage
		WHERE date >= date('now', ?)
		GROUP BY process_path
		ORDER BY (SUM(bytes_sent) + SUM(bytes_received)) DESC
	`, interval)
	if err != nil {
		return []AppUsage{}
	}
	defer rows.Close()

	var usage []AppUsage
	for rows.Next() {
		var u AppUsage
		if err := rows.Scan(&u.ProcessName, &u.ProcessPath, &u.BytesSent, &u.BytesReceived, &u.Connections); err == nil {
			usage = append(usage, u)
		}
	}
	return usage
}

// Device functions
func upsertDevice(mac, ip, hostname, vendor string) bool {
	dbMutex.Lock()
	defer dbMutex.Unlock()

	_, err := db.Exec(`
		INSERT INTO devices (mac_address, ip_address, hostname, vendor, first_seen, last_seen, is_online)
		VALUES (?, ?, ?, ?, datetime('now'), datetime('now'), 1)
		ON CONFLICT(mac_address) DO UPDATE SET
			ip_address = excluded.ip_address,
			hostname = COALESCE(NULLIF(excluded.hostname, ''), hostname),
			vendor = COALESCE(NULLIF(excluded.vendor, ''), vendor),
			last_seen = datetime('now'),
			is_online = 1
	`, mac, ip, hostname, vendor)

	return err == nil
}

func getDevicesFromDB() []StoredDevice {
	dbMutex.RLock()
	defer dbMutex.RUnlock()

	rows, err := db.Query(`
		SELECT mac_address, ip_address, hostname, vendor, COALESCE(custom_name, ''), first_seen, last_seen, is_online
		FROM devices ORDER BY last_seen DESC
	`)
	if err != nil {
		return []StoredDevice{}
	}
	defer rows.Close()

	var devices []StoredDevice
	for rows.Next() {
		var d StoredDevice
		var isOnline int
		if err := rows.Scan(&d.MACAddress, &d.IPAddress, &d.Hostname, &d.Vendor, &d.CustomName, &d.FirstSeen, &d.LastSeen, &isOnline); err == nil {
			d.IsOnline = isOnline == 1
			devices = append(devices, d)
		}
	}
	return devices
}

func updateDeviceName(mac, name string) bool {
	dbMutex.Lock()
	defer dbMutex.Unlock()

	// First ensure the device exists in the database
	db.Exec(`
		INSERT OR IGNORE INTO devices (mac_address, ip_address, hostname, vendor, first_seen, last_seen, is_online)
		VALUES (?, '', '', '', datetime('now'), datetime('now'), 1)
	`, mac)

	// Then update the custom name
	_, err := db.Exec("UPDATE devices SET custom_name = ? WHERE mac_address = ?", name, mac)
	return err == nil
}

func markDevicesOffline() {
	dbMutex.Lock()
	defer dbMutex.Unlock()

	db.Exec("UPDATE devices SET is_online = 0 WHERE last_seen < datetime('now', '-5 minutes')")
}

func isNewDevice(mac string) bool {
	dbMutex.RLock()
	defer dbMutex.RUnlock()

	var count int
	db.QueryRow("SELECT COUNT(*) FROM devices WHERE mac_address = ?", mac).Scan(&count)
	return count == 0
}

// Known apps functions
func isKnownApp(processPath string) bool {
	dbMutex.RLock()
	defer dbMutex.RUnlock()

	var count int
	db.QueryRow("SELECT COUNT(*) FROM known_apps WHERE process_path = ?", processPath).Scan(&count)
	return count > 0
}

func isAppAllowed(processPath string) *bool {
	dbMutex.RLock()
	defer dbMutex.RUnlock()

	var allowed int
	err := db.QueryRow("SELECT allowed FROM known_apps WHERE process_path = ?", processPath).Scan(&allowed)
	if err != nil {
		return nil
	}
	result := allowed == 1
	return &result
}

func addKnownApp(processPath, processName string, allowed bool) {
	dbMutex.Lock()
	defer dbMutex.Unlock()

	allowedInt := 0
	if allowed {
		allowedInt = 1
	}

	db.Exec(`
		INSERT OR REPLACE INTO known_apps (process_path, process_name, allowed, first_seen)
		VALUES (?, ?, ?, datetime('now'))
	`, processPath, processName, allowedInt)
}

func clearKnownApps() bool {
	dbMutex.Lock()
	defer dbMutex.Unlock()

	_, err := db.Exec("DELETE FROM known_apps")
	return err == nil
}

// Connection logging
func logConnection(conn NetworkConnection) {
	dbMutex.Lock()
	defer dbMutex.Unlock()

	db.Exec(`
		INSERT INTO connection_log (process_name, process_path, local_address, local_port, remote_address, remote_port, protocol, country, city, bytes_sent, bytes_received)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`, conn.ProcessName, conn.ProcessPath, conn.LocalAddress, conn.LocalPort, conn.RemoteAddress, conn.RemotePort, conn.Protocol, conn.Country, conn.City, conn.BytesSent, conn.BytesReceived)

	// Cleanup old entries
	db.Exec("DELETE FROM connection_log WHERE timestamp < datetime('now', '-7 days')")
}

func getHistoryData(startTime, endTime string) map[string]interface{} {
	dbMutex.RLock()
	defer dbMutex.RUnlock()

	// Get connection log with all fields
	// Use datetime() to parse ISO timestamps for comparison
	connRows, err := db.Query(`
		SELECT timestamp, process_name, process_path, local_address, local_port,
		       remote_address, remote_port, protocol, country, city,
		       COALESCE(bytes_sent, 0), COALESCE(bytes_received, 0)
		FROM connection_log
		WHERE timestamp >= datetime(?) AND timestamp <= datetime(?)
		ORDER BY timestamp DESC
		LIMIT 500
	`, startTime, endTime)

	var connections []map[string]interface{}
	if err == nil {
		defer connRows.Close()
		for connRows.Next() {
			var timestamp time.Time
			var processName, processPath, localAddr, remoteAddr, protocol, country, city string
			var localPort, remotePort int
			var bytesSent, bytesReceived int64
			if connRows.Scan(&timestamp, &processName, &processPath, &localAddr, &localPort,
				&remoteAddr, &remotePort, &protocol, &country, &city, &bytesSent, &bytesReceived) == nil {
				connections = append(connections, map[string]interface{}{
					"timestamp":      timestamp,
					"process_name":   processName,
					"process_path":   processPath,
					"local_address":  localAddr,
					"local_port":     localPort,
					"remote_address": remoteAddr,
					"remote_port":    remotePort,
					"protocol":       protocol,
					"country":        country,
					"city":           city,
					"bytes_sent":     bytesSent,
					"bytes_received": bytesReceived,
				})
			}
		}
	}

	// Ensure connections is never nil
	if connections == nil {
		connections = []map[string]interface{}{}
	}

	// Get traffic history
	// Parse the ISO timestamps and convert to SQLite format for comparison
	trafficRows, err := db.Query(`
		SELECT timestamp, download, upload FROM traffic_history
		WHERE timestamp >= datetime(?) AND timestamp <= datetime(?)
		ORDER BY timestamp
	`, startTime, endTime)

	var traffic []map[string]interface{}
	if err == nil {
		defer trafficRows.Close()
		for trafficRows.Next() {
			var timestamp time.Time
			var download, upload uint64
			if trafficRows.Scan(&timestamp, &download, &upload) == nil {
				traffic = append(traffic, map[string]interface{}{
					"timestamp": timestamp,
					"download":  download,
					"upload":    upload,
				})
			}
		}
	}

	// Ensure traffic is never nil
	if traffic == nil {
		traffic = []map[string]interface{}{}
	}

	return map[string]interface{}{
		"connections": connections,
		"traffic":     traffic,
	}
}

func closeDatabase() {
	if db != nil {
		db.Close()
	}
}

func getDBStats() map[string]interface{} {
	stats := make(map[string]interface{})

	var count int

	db.QueryRow("SELECT COUNT(*) FROM traffic_history").Scan(&count)
	stats["traffic_history_count"] = count

	db.QueryRow("SELECT COUNT(*) FROM connection_log").Scan(&count)
	stats["connection_log_count"] = count

	db.QueryRow("SELECT COUNT(*) FROM alerts").Scan(&count)
	stats["alerts_count"] = count

	db.QueryRow("SELECT COUNT(*) FROM known_apps").Scan(&count)
	stats["known_apps_count"] = count

	db.QueryRow("SELECT COUNT(*) FROM devices").Scan(&count)
	stats["devices_count"] = count

	return stats
}

// Helper to suppress unused import warnings
var _ = json.Marshal
var _ = fmt.Sprintf
