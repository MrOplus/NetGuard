/// <reference types="vite/client" />

interface Window {
  electron: {
    // Window controls
    minimize: () => void
    maximize: () => void
    close: () => void
    toggleMini: () => void

    // Network
    getConnections: () => Promise<any[]>
    getTrafficHistory: (timeRange: string) => Promise<any[]>
    getAppUsage: (timeRange: string) => Promise<any[]>
    getRealtimeStats: () => Promise<{ download: number; upload: number }>
    killConnection: (id: string) => Promise<boolean>
    blockConnection: (remoteAddress: string, remotePort: number) => Promise<boolean>

    // Firewall
    getFirewallRules: () => Promise<any[]>
    addFirewallRule: (rule: any) => Promise<boolean>
    removeFirewallRule: (ruleName: string) => Promise<boolean>
    toggleFirewallRule: (ruleName: string, enabled: boolean) => Promise<boolean>
    blockApp: (appPath: string) => Promise<boolean>
    allowApp: (appPath: string) => Promise<boolean>
    getFirewallProfiles: () => Promise<string[]>
    setFirewallProfile: (profile: string) => Promise<boolean>

    // Devices
    getDevices: () => Promise<any[]>
    scanDevices: () => Promise<any[]>
    updateDeviceName: (mac: string, name: string) => Promise<boolean>

    // Alerts
    getAlerts: () => Promise<any[]>
    markAlertRead: (id: number) => Promise<boolean>
    clearAlerts: () => Promise<boolean>

    // GeoIP
    lookupIP: (ip: string) => Promise<any>
    getConnectionsMap: () => Promise<any[]>

    // History
    getHistoryData: (startTime: string, endTime: string) => Promise<any>

    // Settings
    getSettings: () => Promise<any>
    saveSettings: (settings: any) => Promise<boolean>

    // Ask to connect
    getPendingConnections: () => Promise<any[]>
    respondToConnection: (id: string, allowed: boolean, remember: boolean) => Promise<boolean>

    // RDP
    getRDPSessions: () => Promise<any[]>

    // WiFi
    getWiFiNetworks: () => Promise<any[]>

    // Dialog
    selectApp: () => Promise<string | undefined>

    // External links
    openExternal: (url: string) => void

    // Event listeners
    onNavigate: (callback: (path: string) => void) => void
    onNetworkUpdate: (callback: (data: any) => void) => void
    onAlert: (callback: (alert: any) => void) => void
    onAskConnect: (callback: (request: any) => void) => void
    removeAllListeners: (channel: string) => void
  }
}
