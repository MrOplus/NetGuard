//go:build windows
// +build windows

package main

import (
	"bufio"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"
)

var (
	ouiDatabase    = make(map[string]string) // MAC prefix -> Vendor name
	ouiDatabaseMux sync.RWMutex
	ouiLoaded      bool
	ouiLoadMux     sync.Mutex

	// Common MAC prefixes as fallback (subset of frequently seen vendors)
	fallbackVendors = map[string]string{
		// Apple
		"00:03:93": "Apple", "3C:22:FB": "Apple", "AC:DE:48": "Apple", "F0:DB:F8": "Apple",
		"78:31:C1": "Apple", "A4:D1:8C": "Apple", "70:56:81": "Apple", "14:7D:DA": "Apple",
		"6C:94:F8": "Apple", "9C:20:7B": "Apple", "C8:69:CD": "Apple", "D0:E1:40": "Apple",
		// Samsung
		"B8:AC:6F": "Samsung", "34:23:BA": "Samsung", "78:47:1D": "Samsung", "C4:42:02": "Samsung",
		"D0:22:BE": "Samsung", "E4:E0:C5": "Samsung", "F0:25:B7": "Samsung", "8C:71:F8": "Samsung",
		// Google/Nest
		"54:60:09": "Google", "F4:F5:D8": "Google", "94:EB:2C": "Google", "1C:F2:9A": "Google",
		"90:B6:86": "Google", "18:D6:C7": "Google", "64:16:66": "Google", "20:DF:B9": "Google",
		// Amazon
		"00:FC:8B": "Amazon", "0C:47:C9": "Amazon", "10:CE:A9": "Amazon", "18:74:2E": "Amazon",
		"34:D2:70": "Amazon", "38:F7:3D": "Amazon", "40:A2:DB": "Amazon", "44:65:0D": "Amazon",
		// Microsoft
		"00:03:FF": "Microsoft", "00:15:5D": "Microsoft", "28:18:78": "Microsoft", "3C:83:75": "Microsoft",
		// Intel
		"00:02:B3": "Intel", "3C:A9:F4": "Intel", "8C:8D:28": "Intel", "70:68:71": "Intel",
		// Xiaomi
		"00:9E:C8": "Xiaomi", "04:CF:8C": "Xiaomi", "28:6C:07": "Xiaomi", "78:11:DC": "Xiaomi",
		// TP-Link
		"14:CC:20": "TP-Link", "50:C7:BF": "TP-Link", "60:E3:27": "TP-Link", "90:F6:52": "TP-Link",
		// Huawei
		"00:18:82": "Huawei", "20:F4:1B": "Huawei", "48:46:FB": "Huawei", "88:3F:D3": "Huawei",
		// Raspberry Pi
		"B8:27:EB": "Raspberry Pi", "DC:A6:32": "Raspberry Pi", "E4:5F:01": "Raspberry Pi",
		// VMware/VirtualBox
		"00:50:56": "VMware", "00:0C:29": "VMware", "08:00:27": "VirtualBox",
		// Asus
		"00:1F:C6": "Asus", "04:92:26": "Asus", "10:7B:44": "Asus", "14:DA:E9": "Asus",
		// Dell
		"14:18:77": "Dell", "18:03:73": "Dell", "18:A9:9B": "Dell", "00:14:22": "Dell",
		// HP
		"00:14:38": "HP", "3C:D9:2B": "HP", "28:92:4A": "HP", "2C:27:D7": "HP",
		// Netgear
		"00:14:6C": "Netgear", "20:4E:7F": "Netgear", "28:C6:8E": "Netgear", "84:1B:5E": "Netgear",
		// Cisco/Linksys
		"00:00:0C": "Cisco", "C0:25:67": "Linksys", "00:01:42": "Cisco",
		// Ubiquiti
		"04:18:D6": "Ubiquiti", "18:E8:29": "Ubiquiti", "44:D9:E7": "Ubiquiti", "68:72:51": "Ubiquiti",
		// Nintendo
		"00:17:AB": "Nintendo", "00:19:FD": "Nintendo", "40:F4:07": "Nintendo", "98:41:5C": "Nintendo",
		// Sony
		"00:0A:D9": "Sony", "00:15:C1": "Sony", "28:0D:FC": "Sony", "AC:9B:0A": "Sony",
		// LG
		"00:1C:62": "LG", "10:68:3F": "LG", "58:A2:B5": "LG", "78:5D:C8": "LG",
		// Roku
		"08:05:81": "Roku", "10:59:32": "Roku", "B0:A7:37": "Roku", "C8:3A:6B": "Roku",
		// Philips Hue
		"00:17:88": "Philips Hue", "EC:B5:FA": "Philips Hue",
		// Sonos
		"00:0E:58": "Sonos", "34:7E:5C": "Sonos", "78:28:CA": "Sonos",
		// Espressif (ESP32/ESP8266)
		"24:0A:C4": "Espressif", "24:6F:28": "Espressif", "30:AE:A4": "Espressif",
		"5C:CF:7F": "Espressif", "84:CC:A8": "Espressif", "A4:CF:12": "Espressif",
		// D-Link
		"00:0D:88": "D-Link", "1C:7E:E5": "D-Link", "28:10:7B": "D-Link", "78:54:2E": "D-Link",
		// OnePlus
		"94:65:2D": "OnePlus", "C0:EE:FB": "OnePlus", "64:A2:F9": "OnePlus",
		// Realtek
		"00:E0:4C": "Realtek",
		// MikroTik
		"E4:8D:8C": "MikroTik", "4C:5E:0C": "MikroTik", "48:8F:5A": "MikroTik",
		// Lenovo
		"00:16:D4": "Lenovo", "28:D2:44": "Lenovo", "50:3C:C4": "Lenovo",
	}
)

// OUI database URL (Wireshark format)
const ouiDatabaseURL = "https://www.wireshark.org/download/automated/data/manuf"

func initOUIDatabase() {
	ouiLoadMux.Lock()
	defer ouiLoadMux.Unlock()

	if ouiLoaded {
		return
	}

	// Try to load from local cache first
	cacheFile := getOUICacheFile()
	if loadOUIFromFile(cacheFile) {
		log.Printf("OUI database loaded from cache: %d entries", len(ouiDatabase))
		ouiLoaded = true
		return
	}

	// Try to download in background
	go downloadOUIDatabase()

	// Use fallback for now
	ouiDatabaseMux.Lock()
	for prefix, vendor := range fallbackVendors {
		ouiDatabase[normalizeMAC(prefix)] = vendor
	}
	ouiDatabaseMux.Unlock()

	ouiLoaded = true
	log.Printf("OUI database using fallback: %d entries", len(ouiDatabase))
}

func getOUICacheFile() string {
	appData := os.Getenv("APPDATA")
	if appData == "" {
		appData = "."
	}
	return filepath.Join(appData, "NetGuard", "oui.txt")
}

func loadOUIFromFile(filename string) bool {
	// Check if file exists and is not too old (7 days)
	info, err := os.Stat(filename)
	if err != nil {
		return false
	}

	if time.Since(info.ModTime()) > 7*24*time.Hour {
		// File is too old, trigger background download
		go downloadOUIDatabase()
	}

	file, err := os.Open(filename)
	if err != nil {
		return false
	}
	defer file.Close()

	return parseOUIData(file)
}

func parseOUIData(reader io.Reader) bool {
	ouiDatabaseMux.Lock()
	defer ouiDatabaseMux.Unlock()

	scanner := bufio.NewScanner(reader)
	// Regex to match OUI entries: XX:XX:XX<tab>VendorName or XX-XX-XX<tab>VendorName
	ouiRegex := regexp.MustCompile(`^([0-9A-Fa-f]{2}[:\-][0-9A-Fa-f]{2}[:\-][0-9A-Fa-f]{2})\s+(.+)$`)

	count := 0
	for scanner.Scan() {
		line := scanner.Text()

		// Skip comments and empty lines
		if strings.HasPrefix(line, "#") || len(strings.TrimSpace(line)) == 0 {
			continue
		}

		matches := ouiRegex.FindStringSubmatch(line)
		if len(matches) >= 3 {
			prefix := normalizeMAC(matches[1])
			vendor := strings.TrimSpace(matches[2])

			// Some entries have format "ShortName\tFullName", use the short name
			if tabIdx := strings.Index(vendor, "\t"); tabIdx > 0 {
				vendor = vendor[:tabIdx]
			}

			ouiDatabase[prefix] = vendor
			count++
		}
	}

	return count > 0
}

func downloadOUIDatabase() {
	log.Println("Downloading OUI database...")

	resp, err := http.Get(ouiDatabaseURL)
	if err != nil {
		log.Printf("Failed to download OUI database: %v", err)
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		log.Printf("Failed to download OUI database: HTTP %d", resp.StatusCode)
		return
	}

	// Read into memory first
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		log.Printf("Failed to read OUI database: %v", err)
		return
	}

	// Parse the data
	if !parseOUIData(strings.NewReader(string(body))) {
		log.Println("Failed to parse OUI database")
		return
	}

	// Save to cache
	cacheFile := getOUICacheFile()
	if err := os.MkdirAll(filepath.Dir(cacheFile), 0755); err != nil {
		log.Printf("Failed to create cache directory: %v", err)
		return
	}

	if err := os.WriteFile(cacheFile, body, 0644); err != nil {
		log.Printf("Failed to save OUI cache: %v", err)
		return
	}

	log.Printf("OUI database downloaded and cached: %d entries", len(ouiDatabase))
}

func normalizeMAC(mac string) string {
	// Convert to uppercase and use colons
	mac = strings.ToUpper(mac)
	mac = strings.ReplaceAll(mac, "-", ":")
	return mac
}

// lookupMACVendor looks up the vendor for a MAC address prefix
func lookupMACVendor(macPrefix string) string {
	if !ouiLoaded {
		initOUIDatabase()
	}

	prefix := normalizeMAC(macPrefix)

	ouiDatabaseMux.RLock()
	vendor, ok := ouiDatabase[prefix]
	ouiDatabaseMux.RUnlock()

	if ok {
		return vendor
	}

	// Check if it's a randomized/locally administered MAC
	if len(prefix) >= 2 {
		secondChar := string(prefix[1])
		if secondChar == "2" || secondChar == "6" || secondChar == "A" || secondChar == "E" {
			return "Private Device"
		}
	}

	return ""
}

// ForceOUIRefresh forces a refresh of the OUI database
func ForceOUIRefresh() {
	go downloadOUIDatabase()
}

// GetOUIStats returns statistics about the OUI database
func GetOUIStats() map[string]interface{} {
	ouiDatabaseMux.RLock()
	defer ouiDatabaseMux.RUnlock()

	return map[string]interface{}{
		"entries": len(ouiDatabase),
		"loaded":  ouiLoaded,
	}
}

func init() {
	// Initialize OUI database in background
	go initOUIDatabase()
}

// Suppress unused import warnings
var _ = fmt.Sprintf
