// RDP detection is now handled by the Go backend
// This service is kept for compatibility but delegates to the backend

import { goBackend } from './GoBackend'

interface RDPSession {
  sessionId: string
  username: string
  sessionName: string
  state: string
  clientName: string
  clientAddress: string
}

export class RDPDetector {
  private sessions: Map<string, RDPSession> = new Map()
  private interval: NodeJS.Timeout | null = null

  constructor(_alertManager: any) {
    // AlertManager not needed - Go backend handles alerts
  }

  async start(): Promise<void> {
    // Poll for RDP sessions every 10 seconds
    this.interval = setInterval(() => this.checkSessions(), 10000)

    // Initial check
    await this.checkSessions()

    console.log('RDP detector started - using Go backend')
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval)
      this.interval = null
    }
  }

  async checkSessions(): Promise<void> {
    try {
      const sessions = await goBackend.getRDPSessions()
      this.sessions.clear()

      for (const session of sessions) {
        this.sessions.set(session.sessionId || session.id, {
          sessionId: session.sessionId || session.id,
          username: session.username || 'Unknown',
          sessionName: session.sessionName || '',
          state: session.state || 'Active',
          clientName: session.clientName || '',
          clientAddress: session.clientAddress || ''
        })
      }
    } catch (error) {
      console.error('Error checking RDP sessions:', error)
    }
  }

  getSessions(): RDPSession[] {
    return Array.from(this.sessions.values())
  }

  getActiveSessions(): RDPSession[] {
    return Array.from(this.sessions.values()).filter(s => s.state === 'Active')
  }
}
