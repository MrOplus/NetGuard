// Device scanning is now handled by the Go backend
// This service is kept for compatibility but delegates to the backend

import { goBackend } from './GoBackend'

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

export class DeviceScanner {
  private devices: Map<string, NetworkDevice> = new Map()
  private interval: NodeJS.Timeout | null = null

  constructor(_database: any, _alertManager: any) {
    // Dependencies not needed - Go backend handles everything
  }

  async start(): Promise<void> {
    // Initial scan
    await this.scan()

    // Poll for devices every 10 seconds (Go backend handles the actual scanning)
    this.interval = setInterval(() => this.scan(), 10000)

    console.log('Device scanner started - using Go backend')
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval)
      this.interval = null
    }
  }

  async scan(): Promise<NetworkDevice[]> {
    try {
      const devices = await goBackend.scanDevices()
      this.devices.clear()

      for (const device of devices) {
        this.devices.set(device.macAddress, {
          id: device.macAddress,
          macAddress: device.macAddress,
          ipAddress: device.ipAddress,
          hostname: device.hostname || '',
          vendor: device.vendor || '',
          customName: device.customName,
          firstSeen: device.firstSeen,
          lastSeen: device.lastSeen,
          isOnline: device.isOnline
        })
      }

      return Array.from(this.devices.values())
    } catch (error) {
      console.error('Error scanning devices:', error)
      return this.getDevices()
    }
  }

  getDevices(): NetworkDevice[] {
    return Array.from(this.devices.values())
  }

  async getLocalIP(): Promise<string | null> {
    // This can be derived from the device list or from system info
    const devices = await this.scan()
    // The first device is usually the local machine
    if (devices.length > 0) {
      return devices[0].ipAddress
    }
    return null
  }

  updateSettings(_settings: any): void {
    // Settings are now handled by Go backend
  }
}
