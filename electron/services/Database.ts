import { goBackend } from './GoBackend'

const defaultSettings = {
  theme: 'dark',
  accentColor: '#0ea5e9',
  minimizeToTray: true,
  startWithWindows: false,
  showMiniGraph: false,
  askToConnect: false,
  lockdownMode: false,
  retentionDays: 30,
  alertSounds: true,
  notifyNewDevice: true,
  notifyNewApp: true,
  notifyEvilTwin: true,
  notifyRDP: true,
  hideLocalTraffic: true
}

// Local cache for settings to avoid repeated API calls
let settingsCache: any = null
let settingsCacheTime = 0
const SETTINGS_CACHE_TTL = 5000 // 5 seconds

export class Database {
  async initialize(): Promise<void> {
    console.log('Database initialized - using Go backend SQLite')
  }

  // Connection logging - now handled by Go backend
  logConnection(_connection: any): void {
    // Go backend handles connection logging automatically
  }

  // Traffic history - now handled by Go backend
  logTraffic(_download: number, _upload: number): void {
    // Go backend handles traffic logging automatically
  }

  async getTrafficHistory(timeRange: string): Promise<any[]> {
    const now = new Date()
    let startTime: Date

    switch (timeRange) {
      case '1h':
        startTime = new Date(now.getTime() - 60 * 60 * 1000)
        break
      case '24h':
        startTime = new Date(now.getTime() - 24 * 60 * 60 * 1000)
        break
      case '7d':
        startTime = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
        break
      case '30d':
        startTime = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
        break
      default:
        startTime = new Date(now.getTime() - 60 * 60 * 1000)
    }

    const data = await goBackend.getHistoryData(startTime.toISOString(), now.toISOString())
    return data.traffic || []
  }

  // App usage - now handled by Go backend
  updateAppUsage(_processName: string, _processPath: string, _bytesSent: number, _bytesReceived: number): void {
    // Go backend handles app usage tracking automatically
  }

  async getAppUsage(timeRange: string): Promise<any[]> {
    return await goBackend.getAppUsage(timeRange)
  }

  // Devices - now handled by Go backend
  upsertDevice(_device: any): void {
    // Go backend handles device tracking automatically
  }

  async getDevices(): Promise<any[]> {
    return await goBackend.getDevices()
  }

  async updateDeviceName(mac: string, name: string): Promise<boolean> {
    return await goBackend.updateDeviceName(mac, name)
  }

  markDevicesOffline(): void {
    // Go backend handles this automatically
  }

  isNewDevice(_mac: string): boolean {
    // Go backend handles new device detection
    return false
  }

  // Alerts - now handled by Go backend
  addAlert(alert: { type: string; severity: string; title: string; message: string }): void {
    // Alerts are added by the Go backend automatically
    // This method is kept for compatibility but alerts are now WebSocket-based
  }

  async getAlerts(): Promise<any[]> {
    return await goBackend.getAlerts()
  }

  async markAlertRead(id: number): Promise<boolean> {
    return await goBackend.markAlertRead(id)
  }

  async clearAlerts(): Promise<boolean> {
    return await goBackend.clearAlerts()
  }

  // Known apps - now handled by Go backend
  isKnownApp(_processPath: string): boolean {
    // Go backend handles this
    return true
  }

  isAppAllowed(_processPath: string): boolean | null {
    // Go backend handles this
    return true
  }

  addKnownApp(_processPath: string, _processName: string, _allowed: boolean): void {
    // Go backend handles this
  }

  // History - now handled by Go backend
  async getHistoryData(startTime: string, endTime: string): Promise<any> {
    return await goBackend.getHistoryData(startTime, endTime)
  }

  // Settings - now handled by Go backend with local cache
  async getSettings(): Promise<any> {
    const now = Date.now()
    if (settingsCache && (now - settingsCacheTime) < SETTINGS_CACHE_TTL) {
      return settingsCache
    }

    const settings = await goBackend.getSettings()
    if (settings) {
      settingsCache = settings
      settingsCacheTime = now
      return settings
    }

    return defaultSettings
  }

  async saveSettings(settings: any): Promise<boolean> {
    const success = await goBackend.saveSettings(settings)
    if (success) {
      // Invalidate cache
      settingsCache = null
      settingsCacheTime = 0
    }
    return success
  }

  // Synchronous version for backward compatibility
  getSettingsSync(): any {
    return settingsCache || defaultSettings
  }

  close(): void {
    // Nothing to do - Go backend handles cleanup
  }
}

export { Database as DatabaseService }
