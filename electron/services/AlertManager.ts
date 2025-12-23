import { BrowserWindow, Notification } from 'electron'

export interface AlertData {
  type: string
  severity: 'info' | 'warning' | 'critical'
  title: string
  message: string
}

export class AlertManager {
  private mainWindow: BrowserWindow | null

  constructor(mainWindow: BrowserWindow | null) {
    this.mainWindow = mainWindow
  }

  sendAlert(alert: AlertData): void {
    // Send to renderer
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('alert:new', alert)
    }

    // Show Windows notification
    if (Notification.isSupported()) {
      const notification = new Notification({
        title: alert.title,
        body: alert.message,
        icon: this.getIconForSeverity(alert.severity),
        urgency: this.getUrgency(alert.severity)
      })

      notification.on('click', () => {
        if (this.mainWindow) {
          this.mainWindow.show()
          this.mainWindow.focus()
        }
      })

      notification.show()
    }
  }

  private getIconForSeverity(severity: string): string | undefined {
    // Return different icons based on severity
    // In production, these would be actual icon paths
    return undefined
  }

  private getUrgency(severity: string): 'normal' | 'critical' | 'low' {
    switch (severity) {
      case 'critical':
        return 'critical'
      case 'warning':
        return 'normal'
      default:
        return 'low'
    }
  }

  updateMainWindow(window: BrowserWindow): void {
    this.mainWindow = window
  }
}
