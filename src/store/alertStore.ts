import { create } from 'zustand'

export interface Alert {
  id: number
  timestamp: string
  type: string
  severity: 'info' | 'warning' | 'critical'
  title: string
  message: string
  read: boolean
}

interface AlertState {
  alerts: Alert[]
  unreadCount: number
  isLoading: boolean

  setAlerts: (alerts: Alert[]) => void
  addAlert: (alert: Omit<Alert, 'id' | 'timestamp' | 'read'>) => void
  markRead: (id: number) => Promise<void>
  clearAll: () => Promise<void>
  fetchAlerts: () => Promise<void>
}

export const useAlertStore = create<AlertState>((set, get) => ({
  alerts: [],
  unreadCount: 0,
  isLoading: false,

  setAlerts: (alerts) => {
    const unreadCount = alerts.filter(a => !a.read).length
    set({ alerts, unreadCount })
  },

  addAlert: (alert) => {
    const newAlert: Alert = {
      ...alert,
      id: Date.now(),
      timestamp: new Date().toISOString(),
      read: false
    }
    const { alerts } = get()
    const updatedAlerts = [newAlert, ...alerts]
    const unreadCount = updatedAlerts.filter(a => !a.read).length
    set({ alerts: updatedAlerts, unreadCount })
  },

  markRead: async (id) => {
    try {
      await window.electron?.markAlertRead(id)
      const { alerts } = get()
      const updatedAlerts = alerts.map(a =>
        a.id === id ? { ...a, read: true } : a
      )
      const unreadCount = updatedAlerts.filter(a => !a.read).length
      set({ alerts: updatedAlerts, unreadCount })
    } catch (error) {
      console.error('Failed to mark alert as read:', error)
    }
  },

  clearAll: async () => {
    try {
      await window.electron?.clearAlerts()
      set({ alerts: [], unreadCount: 0 })
    } catch (error) {
      console.error('Failed to clear alerts:', error)
    }
  },

  fetchAlerts: async () => {
    try {
      set({ isLoading: true })
      console.log('Fetching alerts...')
      const alerts = await window.electron?.getAlerts() || []
      console.log('Got alerts:', alerts?.length || 0, alerts)
      const unreadCount = alerts.filter((a: Alert) => !a.read).length
      set({ alerts, unreadCount, isLoading: false })
    } catch (error) {
      console.error('Failed to fetch alerts:', error)
      set({ isLoading: false })
    }
  }
}))
