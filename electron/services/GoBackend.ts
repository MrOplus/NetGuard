import { spawn, ChildProcess } from 'child_process'
import { join } from 'path'
import { app } from 'electron'
import { existsSync } from 'fs'

const BACKEND_PORT = 8899
const BACKEND_URL = `http://127.0.0.1:${BACKEND_PORT}`

class GoBackend {
  private process: ChildProcess | null = null
  private isRunning = false

  async start(): Promise<void> {
    // Try to find the backend executable
    const isDev = !app.isPackaged
    let backendPath: string

    if (isDev) {
      backendPath = join(__dirname, '../../backend/netguard-backend.exe')
    } else {
      backendPath = join(process.resourcesPath, 'backend', 'netguard-backend.exe')
    }

    // If backend doesn't exist, we'll rely on PowerShell fallback
    if (!existsSync(backendPath)) {
      console.log('Go backend not found, will use PowerShell fallback')
      return
    }

    return new Promise((resolve, reject) => {
      try {
        this.process = spawn(backendPath, [], {
          stdio: ['ignore', 'pipe', 'pipe'],
          detached: false,
          windowsHide: true
        })

        this.process.stdout?.on('data', (data) => {
          console.log('Backend:', data.toString())
        })

        this.process.stderr?.on('data', (data) => {
          console.error('Backend error:', data.toString())
        })

        this.process.on('error', (error) => {
          console.error('Failed to start backend:', error)
          reject(error)
        })

        this.process.on('exit', (code) => {
          console.log('Backend exited with code:', code)
          this.isRunning = false
        })

        // Wait for backend to be ready
        this.waitForBackend().then(() => {
          this.isRunning = true
          console.log('Go backend started successfully')
          resolve()
        }).catch(reject)

      } catch (error) {
        console.error('Failed to spawn backend:', error)
        reject(error)
      }
    })
  }

  private async waitForBackend(maxAttempts = 30): Promise<void> {
    for (let i = 0; i < maxAttempts; i++) {
      try {
        const response = await fetch(`${BACKEND_URL}/health`)
        if (response.ok) {
          return
        }
      } catch {
        // Backend not ready yet
      }
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    throw new Error('Backend failed to start')
  }

  async stop(): Promise<void> {
    if (this.process) {
      this.process.kill()
      this.process = null
      this.isRunning = false
    }
  }

  isAvailable(): boolean {
    return this.isRunning
  }

  async getConnections(): Promise<any[]> {
    try {
      const response = await fetch(`${BACKEND_URL}/api/connections`)
      const data = await response.json()
      return data.success ? data.data : []
    } catch {
      return []
    }
  }

  async getTraffic(): Promise<{ download: number; upload: number }> {
    try {
      const response = await fetch(`${BACKEND_URL}/api/traffic`)
      const data = await response.json()
      return data.success ? data.data : { download: 0, upload: 0 }
    } catch {
      return { download: 0, upload: 0 }
    }
  }

  async getDevices(): Promise<any[]> {
    try {
      const response = await fetch(`${BACKEND_URL}/api/devices`)
      const data = await response.json()
      return data.success ? data.data : []
    } catch {
      return []
    }
  }

  async scanDevices(): Promise<any[]> {
    try {
      const response = await fetch(`${BACKEND_URL}/api/devices/scan`)
      const data = await response.json()
      return data.success ? data.data : []
    } catch {
      return []
    }
  }

  async getWiFiNetworks(): Promise<any[]> {
    try {
      const response = await fetch(`${BACKEND_URL}/api/wifi`)
      const data = await response.json()
      return data.success ? data.data : []
    } catch {
      return []
    }
  }

  async getRDPSessions(): Promise<any[]> {
    try {
      const response = await fetch(`${BACKEND_URL}/api/rdp`)
      const data = await response.json()
      return data.success ? data.data : []
    } catch {
      return []
    }
  }

  async getFirewallRules(): Promise<any[]> {
    try {
      const response = await fetch(`${BACKEND_URL}/api/firewall/rules`)
      const data = await response.json()
      return data.success ? data.data : []
    } catch {
      return []
    }
  }

  async blockApp(appPath: string): Promise<boolean> {
    try {
      const response = await fetch(`${BACKEND_URL}/api/firewall/block`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appPath })
      })
      const data = await response.json()
      return data.success
    } catch {
      return false
    }
  }

  async allowApp(appPath: string): Promise<boolean> {
    try {
      const response = await fetch(`${BACKEND_URL}/api/firewall/allow`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appPath })
      })
      const data = await response.json()
      return data.success
    } catch {
      return false
    }
  }

  async killConnection(connectionId: string): Promise<boolean> {
    try {
      const response = await fetch(`${BACKEND_URL}/api/connections/kill`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ connectionId })
      })
      const data = await response.json()
      return data.success
    } catch {
      return false
    }
  }

  async blockRemoteAddress(remoteAddress: string, remotePort?: number): Promise<boolean> {
    try {
      const response = await fetch(`${BACKEND_URL}/api/connections/block`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ remoteAddress, remotePort: remotePort || 0 })
      })
      const data = await response.json()
      return data.success
    } catch {
      return false
    }
  }

  // Settings API
  async getSettings(): Promise<any> {
    try {
      const response = await fetch(`${BACKEND_URL}/api/settings`)
      const data = await response.json()
      return data.success ? data.data : null
    } catch {
      return null
    }
  }

  async saveSettings(settings: any): Promise<boolean> {
    try {
      const response = await fetch(`${BACKEND_URL}/api/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings)
      })
      const data = await response.json()
      return data.success
    } catch {
      return false
    }
  }

  // Alerts API
  async getAlerts(): Promise<any[]> {
    try {
      const response = await fetch(`${BACKEND_URL}/api/alerts`)
      const data = await response.json()
      return data.success && Array.isArray(data.data) ? data.data : []
    } catch {
      return []
    }
  }

  async clearAlerts(): Promise<boolean> {
    try {
      const response = await fetch(`${BACKEND_URL}/api/alerts/clear`, {
        method: 'POST'
      })
      const data = await response.json()
      return data.success
    } catch {
      return false
    }
  }

  async markAlertRead(id: number): Promise<boolean> {
    try {
      const response = await fetch(`${BACKEND_URL}/api/alerts/read`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id })
      })
      const data = await response.json()
      return data.success
    } catch {
      return false
    }
  }

  // History API
  async getHistoryData(startTime: string, endTime: string): Promise<any> {
    try {
      const response = await fetch(`${BACKEND_URL}/api/history?start=${encodeURIComponent(startTime)}&end=${encodeURIComponent(endTime)}`)
      const data = await response.json()
      return data.success ? data.data : { connections: [], traffic: [] }
    } catch {
      return { connections: [], traffic: [] }
    }
  }

  // App usage API
  async getAppUsage(timeRange: string = 'today'): Promise<any[]> {
    try {
      const response = await fetch(`${BACKEND_URL}/api/app-usage?range=${timeRange}`)
      const data = await response.json()
      return data.success ? data.data : []
    } catch {
      return []
    }
  }

  // Device name API
  async updateDeviceName(macAddress: string, name: string): Promise<boolean> {
    try {
      const response = await fetch(`${BACKEND_URL}/api/devices/name`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ macAddress, name })
      })
      const data = await response.json()
      return data.success
    } catch {
      return false
    }
  }

  // WebSocket connection for real-time updates
  connectWebSocket(onMessage: (data: any) => void): WebSocket | null {
    try {
      const ws = new WebSocket(`ws://127.0.0.1:${BACKEND_PORT}/ws`)
      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data)
          onMessage(data)
        } catch {
          // Ignore parse errors
        }
      }
      ws.onerror = (error) => {
        console.error('WebSocket error:', error)
      }
      return ws
    } catch {
      return null
    }
  }
}

export const goBackend = new GoBackend()
