// Firewall management is now handled by the Go backend
// This service is kept for compatibility but delegates to the backend

import { goBackend } from './GoBackend'

export interface FirewallRule {
  name: string
  displayName: string
  enabled: boolean
  direction: 'Inbound' | 'Outbound'
  action: 'Allow' | 'Block'
  program?: string
  profile: string
}

export class FirewallManager {
  private rules: Map<string, FirewallRule> = new Map()
  private currentProfile: string = 'Private'
  private interval: NodeJS.Timeout | null = null

  async initialize(): Promise<void> {
    await this.loadRules()

    // Refresh rules every 30 seconds
    this.interval = setInterval(() => this.loadRules(), 30000)

    console.log('Firewall manager initialized - using Go backend')
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval)
      this.interval = null
    }
  }

  async loadRules(): Promise<void> {
    try {
      const rules = await goBackend.getFirewallRules()
      this.rules.clear()

      for (const rule of rules) {
        this.rules.set(rule.name, {
          name: rule.name,
          displayName: rule.displayName || rule.name,
          enabled: rule.enabled,
          direction: rule.direction as 'Inbound' | 'Outbound',
          action: rule.action as 'Allow' | 'Block',
          program: rule.program || rule.appPath || '',
          profile: rule.profile || 'All'
        })
      }
    } catch (error) {
      console.error('Error loading firewall rules:', error)
    }
  }

  getRules(): FirewallRule[] {
    return Array.from(this.rules.values())
  }

  getOutboundRules(): FirewallRule[] {
    return this.getRules().filter(r => r.direction === 'Outbound')
  }

  getInboundRules(): FirewallRule[] {
    return this.getRules().filter(r => r.direction === 'Inbound')
  }

  async blockApp(appPath: string): Promise<boolean> {
    const success = await goBackend.blockApp(appPath)
    if (success) {
      await this.loadRules()
    }
    return success
  }

  async allowApp(appPath: string): Promise<boolean> {
    const success = await goBackend.allowApp(appPath)
    if (success) {
      await this.loadRules()
    }
    return success
  }

  async removeRule(_ruleName: string): Promise<boolean> {
    // Would need a backend API endpoint
    console.log('Remove rule not implemented')
    return false
  }

  async enableRule(_ruleName: string): Promise<boolean> {
    // Would need a backend API endpoint
    console.log('Enable rule not implemented')
    return false
  }

  async disableRule(_ruleName: string): Promise<boolean> {
    // Would need a backend API endpoint
    console.log('Disable rule not implemented')
    return false
  }

  isAppBlocked(appPath: string): boolean {
    for (const rule of this.rules.values()) {
      if (rule.program?.toLowerCase() === appPath.toLowerCase() && rule.action === 'Block') {
        return true
      }
    }
    return false
  }

  getCurrentProfile(): string {
    return this.currentProfile
  }
}
