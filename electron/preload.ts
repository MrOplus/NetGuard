import { contextBridge, ipcRenderer } from 'electron'

export interface NetworkConnection {
  id: string
  processName: string
  processPath: string
  localAddress: string
  localPort: number
  remoteAddress: string
  remotePort: number
  protocol: string
  state: string
  bytesSent: number
  bytesReceived: number
  country?: string
  city?: string
  lat?: number
  lon?: number
}

export interface FirewallRule {
  name: string
  displayName: string
  enabled: boolean
  direction: 'Inbound' | 'Outbound'
  action: 'Allow' | 'Block'
  program?: string
  profile: string
}

export interface NetworkDevice {
  id: string
  macAddress: string
  ipAddress: string
  hostname: string
  vendor: string
  customName?: string
  firstSeen: string
  lastSeen: string
  isOnline: boolean
}

export interface Alert {
  id: number
  timestamp: string
  type: string
  severity: 'info' | 'warning' | 'critical'
  title: string
  message: string
  read: boolean
}

export interface TrafficData {
  timestamp: string
  download: number
  upload: number
}

export interface AppUsage {
  processName: string
  processPath: string
  bytesSent: number
  bytesReceived: number
  connections: number
}

export interface GeoConnection {
  ip: string
  country: string
  city: string
  lat: number
  lon: number
  processName: string
  bytesTransferred: number
}

export interface Settings {
  theme: 'dark' | 'light' | 'system'
  accentColor: string
  minimizeToTray: boolean
  startWithWindows: boolean
  showMiniGraph: boolean
  askToConnect: boolean
  lockdownMode: boolean
  retentionDays: number
  alertSounds: boolean
  notifyNewDevice: boolean
  notifyNewApp: boolean
  notifyEvilTwin: boolean
  notifyRDP: boolean
}

const electronAPI = {
  // Window controls
  minimize: () => ipcRenderer.send('window:minimize'),
  maximize: () => ipcRenderer.send('window:maximize'),
  close: () => ipcRenderer.send('window:close'),
  toggleMini: () => ipcRenderer.send('window:toggle-mini'),

  // Network
  getConnections: (): Promise<NetworkConnection[]> =>
    ipcRenderer.invoke('network:get-connections'),
  getTrafficHistory: (timeRange: string): Promise<TrafficData[]> =>
    ipcRenderer.invoke('network:get-traffic-history', timeRange),
  getAppUsage: (timeRange: string): Promise<AppUsage[]> =>
    ipcRenderer.invoke('network:get-app-usage', timeRange),
  getRealtimeStats: (): Promise<{ download: number; upload: number }> =>
    ipcRenderer.invoke('network:get-realtime-stats'),
  killConnection: (connectionId: string): Promise<boolean> =>
    ipcRenderer.invoke('connection:kill', connectionId),
  blockConnection: (remoteAddress: string, remotePort: number): Promise<boolean> =>
    ipcRenderer.invoke('connection:block', remoteAddress, remotePort),

  // Firewall
  getFirewallRules: (): Promise<FirewallRule[]> =>
    ipcRenderer.invoke('firewall:get-rules'),
  addFirewallRule: (rule: Partial<FirewallRule>): Promise<boolean> =>
    ipcRenderer.invoke('firewall:add-rule', rule),
  removeFirewallRule: (ruleName: string): Promise<boolean> =>
    ipcRenderer.invoke('firewall:remove-rule', ruleName),
  toggleFirewallRule: (ruleName: string, enabled: boolean): Promise<boolean> =>
    ipcRenderer.invoke('firewall:toggle-rule', ruleName, enabled),
  blockApp: (appPath: string): Promise<boolean> =>
    ipcRenderer.invoke('firewall:block-app', appPath),
  allowApp: (appPath: string): Promise<boolean> =>
    ipcRenderer.invoke('firewall:allow-app', appPath),
  getFirewallProfiles: (): Promise<string[]> =>
    ipcRenderer.invoke('firewall:get-profiles'),
  setFirewallProfile: (profile: string): Promise<boolean> =>
    ipcRenderer.invoke('firewall:set-profile', profile),

  // Devices
  getDevices: (): Promise<NetworkDevice[]> =>
    ipcRenderer.invoke('devices:get-all'),
  scanDevices: (): Promise<NetworkDevice[]> =>
    ipcRenderer.invoke('devices:scan'),
  updateDeviceName: (mac: string, name: string): Promise<boolean> =>
    ipcRenderer.invoke('devices:update-name', mac, name),
  scanDevicePorts: (ip: string, mac: string): Promise<{ port: number; service: string; open: boolean }[]> =>
    ipcRenderer.invoke('devices:scan-ports', ip, mac),

  // Alerts
  getAlerts: (): Promise<Alert[]> =>
    ipcRenderer.invoke('alerts:get-all'),
  markAlertRead: (id: number): Promise<boolean> =>
    ipcRenderer.invoke('alerts:mark-read', id),
  clearAlerts: (): Promise<boolean> =>
    ipcRenderer.invoke('alerts:clear-all'),

  // GeoIP
  lookupIP: (ip: string): Promise<GeoConnection | null> =>
    ipcRenderer.invoke('geoip:lookup', ip),
  getConnectionsMap: (): Promise<GeoConnection[]> =>
    ipcRenderer.invoke('geoip:get-connections-map'),

  // History
  getHistoryData: (startTime: string, endTime: string): Promise<any> =>
    ipcRenderer.invoke('history:get-data', startTime, endTime),

  // Settings
  getSettings: (): Promise<Settings> =>
    ipcRenderer.invoke('settings:get'),
  saveSettings: (settings: Partial<Settings>): Promise<boolean> =>
    ipcRenderer.invoke('settings:set', settings),

  // Ask to connect
  getPendingConnections: (): Promise<any[]> =>
    ipcRenderer.invoke('ask-connect:get-pending'),
  respondToConnection: (id: string, allowed: boolean, remember: boolean): Promise<boolean> =>
    ipcRenderer.invoke('ask-connect:respond', id, allowed, remember),
  clearKnownApps: (): Promise<boolean> =>
    ipcRenderer.invoke('known-apps:clear'),

  // RDP
  getRDPSessions: (): Promise<any[]> =>
    ipcRenderer.invoke('rdp:get-sessions'),

  // WiFi
  getWiFiNetworks: (): Promise<any[]> =>
    ipcRenderer.invoke('wifi:get-networks'),

  // Dialog
  selectApp: (): Promise<string | undefined> =>
    ipcRenderer.invoke('dialog:select-app'),

  // External links
  openExternal: (url: string) =>
    ipcRenderer.send('open-external', url),

  // Event listeners
  onNavigate: (callback: (path: string) => void) => {
    ipcRenderer.on('navigate', (_, path) => callback(path))
  },
  onNetworkUpdate: (callback: (data: any) => void) => {
    ipcRenderer.on('network:update', (_, data) => callback(data))
  },
  onAlert: (callback: (alert: Alert) => void) => {
    ipcRenderer.on('new-alert', (_, alert) => callback(alert))
  },
  onAskConnect: (callback: (request: any) => void) => {
    ipcRenderer.on('ask-connect:request', (_, request) => callback(request))
  },
  removeAllListeners: (channel: string) => {
    ipcRenderer.removeAllListeners(channel)
  }
}

contextBridge.exposeInMainWorld('electron', electronAPI)

declare global {
  interface Window {
    electron: typeof electronAPI
  }
}
