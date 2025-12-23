// Bandwidth tracking is now handled by the Go backend
// This service is kept for compatibility but delegates to the backend

import { goBackend } from './GoBackend'

export interface AppBandwidth {
  processName: string
  processPath: string
  bytesSent: number
  bytesReceived: number
  connections: number
}

export class BandwidthTracker {
  constructor(_database: any) {
    // Database not needed - Go backend handles everything
  }

  updateUsage(_processName: string, _processPath: string, _bytesSent: number, _bytesReceived: number): void {
    // Go backend handles usage tracking automatically
  }

  async getAppUsage(timeRange: string): Promise<AppBandwidth[]> {
    return await goBackend.getAppUsage(timeRange)
  }

  getCurrentUsage(): AppBandwidth[] {
    // This is now derived from connections in NetworkMonitor
    return []
  }

  resetCurrentUsage(): void {
    // No-op - Go backend handles this
  }

  formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B'

    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))

    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
  }

  formatSpeed(bytesPerSecond: number): string {
    return this.formatBytes(bytesPerSecond) + '/s'
  }
}
