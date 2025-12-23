// WiFi scanning and Evil Twin detection is now handled by the Go backend
// This service is kept for compatibility but delegates to the backend

import { goBackend } from './GoBackend'

interface WiFiNetwork {
  ssid: string
  bssid: string
  signalStrength: number
  channel: number
  security: string
  radioType: string
}

interface EvilTwinCandidate {
  ssid: string
  networks: WiFiNetwork[]
  isEvilTwin: boolean
}

export class EvilTwinDetector {
  private networks: Map<string, WiFiNetwork[]> = new Map()
  private interval: NodeJS.Timeout | null = null

  constructor(_alertManager: any) {
    // AlertManager not needed - Go backend handles alerts
  }

  async start(): Promise<void> {
    // Poll for WiFi networks every 30 seconds
    this.interval = setInterval(() => this.scan(), 30000)

    // Initial scan
    await this.scan()

    console.log('Evil Twin detector started - using Go backend')
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval)
      this.interval = null
    }
  }

  async scan(): Promise<void> {
    try {
      const networks = await goBackend.getWiFiNetworks()
      this.networks.clear()

      // Group by SSID
      for (const network of networks) {
        if (!network.ssid) continue

        const existing = this.networks.get(network.ssid) || []
        existing.push({
          ssid: network.ssid,
          bssid: network.bssid,
          signalStrength: network.signalStrength,
          channel: network.channel,
          security: network.security || network.authentication || '',
          radioType: network.radioType || ''
        })
        this.networks.set(network.ssid, existing)
      }
    } catch (error) {
      console.error('Error scanning WiFi networks:', error)
    }
  }

  getNetworks(): EvilTwinCandidate[] {
    const result: EvilTwinCandidate[] = []

    for (const [ssid, networks] of this.networks) {
      // Check for evil twin indicators
      const isEvilTwin = networks.length > 1 && (
        new Set(networks.map(n => n.security)).size > 1 // Different security types
      )

      result.push({
        ssid,
        networks,
        isEvilTwin
      })
    }

    return result.sort((a, b) => {
      // Evil twins first
      if (a.isEvilTwin && !b.isEvilTwin) return -1
      if (!a.isEvilTwin && b.isEvilTwin) return 1
      // Then by signal strength
      const aSignal = Math.max(...a.networks.map(n => n.signalStrength))
      const bSignal = Math.max(...b.networks.map(n => n.signalStrength))
      return bSignal - aSignal
    })
  }

  clearAlertHistory(): void {
    // No-op - Go backend handles alert history
  }
}
