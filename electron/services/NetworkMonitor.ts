// Network monitoring is now handled by the Go backend
// This service is kept for compatibility but delegates to the backend

import { goBackend } from './GoBackend'

interface ConnectionWithProcess {
  id: string
  processName: string
  processPath: string
  processId: number
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

export class NetworkMonitor {
  private connections: Map<string, ConnectionWithProcess> = new Map()
  private interval: NodeJS.Timeout | null = null
  private currentDownload = 0
  private currentUpload = 0

  constructor(
    _database: any,
    _alertManager: any,
    _geoIPService: any,
    _bandwidthTracker: any
  ) {
    // Dependencies not needed - Go backend handles everything
  }

  async start(): Promise<void> {
    // Poll for connections every second
    this.interval = setInterval(() => this.pollConnections(), 1000)

    // Initial poll
    await this.pollConnections()

    console.log('Network monitor started - using Go backend')
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval)
      this.interval = null
    }
  }

  private async pollConnections(): Promise<void> {
    try {
      // Get connections from Go backend
      const connections = await goBackend.getConnections()
      this.connections.clear()

      for (const conn of connections) {
        this.connections.set(conn.id, {
          id: conn.id,
          processName: conn.processName,
          processPath: conn.processPath,
          processId: conn.processId,
          localAddress: conn.localAddress,
          localPort: conn.localPort,
          remoteAddress: conn.remoteAddress,
          remotePort: conn.remotePort,
          protocol: conn.protocol,
          state: conn.state,
          bytesSent: conn.bytesSent,
          bytesReceived: conn.bytesReceived,
          country: conn.country,
          city: conn.city,
          lat: conn.lat,
          lon: conn.lon
        })
      }

      // Get traffic stats from Go backend
      const traffic = await goBackend.getTraffic()
      this.currentDownload = traffic.download
      this.currentUpload = traffic.upload
    } catch (error) {
      console.error('Error polling connections:', error)
    }
  }

  getConnections(): ConnectionWithProcess[] {
    return Array.from(this.connections.values())
  }

  getTopApps(): any[] {
    const appStats = new Map<string, any>()

    for (const conn of this.connections.values()) {
      const key = conn.processPath || conn.processName
      const existing = appStats.get(key) || {
        processName: conn.processName,
        processPath: conn.processPath,
        bytesSent: 0,
        bytesReceived: 0,
        connectionCount: 0
      }

      existing.bytesSent += conn.bytesSent
      existing.bytesReceived += conn.bytesReceived
      existing.connectionCount += 1

      appStats.set(key, existing)
    }

    return Array.from(appStats.values())
      .sort((a, b) => (b.bytesSent + b.bytesReceived) - (a.bytesSent + a.bytesReceived))
      .slice(0, 10)
  }

  getRealtimeStats(): { download: number; upload: number } {
    return {
      download: this.currentDownload,
      upload: this.currentUpload
    }
  }

  updateSettings(_settings: any): void {
    // Settings are now handled by Go backend
  }

  // Block/allow are now handled by Go backend
  async blockApp(appPath: string): Promise<boolean> {
    return await goBackend.blockApp(appPath)
  }

  async allowApp(appPath: string): Promise<boolean> {
    return await goBackend.allowApp(appPath)
  }

  async killConnection(connectionId: string): Promise<boolean> {
    return await goBackend.killConnection(connectionId)
  }

  async blockRemoteAddress(remoteAddress: string, remotePort?: number): Promise<boolean> {
    return await goBackend.blockRemoteAddress(remoteAddress, remotePort)
  }

  // Pending connections are now handled by Go backend
  getPendingConnections(): any[] {
    return []
  }

  async approveConnection(_connectionId: string): Promise<void> {
    // No-op - Go backend handles this
  }

  async rejectConnection(_connectionId: string): Promise<void> {
    // No-op - Go backend handles this
  }
}
