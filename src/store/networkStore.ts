import { create } from 'zustand'

interface NetworkConnection {
  id: string
  processName: string
  processPath: string
  localAddress: string
  localPort: number
  remoteAddress: string
  remotePort: number
  protocol: string
  state: string
  country?: string
  city?: string
  lat?: number
  lon?: number
}

interface TrafficData {
  timestamp: string
  download: number
  upload: number
}

interface AppUsage {
  processName: string
  processPath: string
  bytesSent: number
  bytesReceived: number
  connections: number
}

interface GeoConnection {
  ip: string
  country: string
  city: string
  lat: number
  lon: number
  count: number
  processes: string[]
}

interface NetworkState {
  connections: NetworkConnection[]
  trafficHistory: TrafficData[]
  realtimeHistory: TrafficData[]
  appUsage: AppUsage[]
  geoConnections: GeoConnection[]
  realtimeStats: { download: number; upload: number }
  isLoading: boolean
  error: string | null
  timeRange: string
  pollInterval: NodeJS.Timeout | null

  setConnections: (connections: NetworkConnection[]) => void
  setTrafficHistory: (data: TrafficData[]) => void
  setAppUsage: (data: AppUsage[]) => void
  setGeoConnections: (data: GeoConnection[]) => void
  setRealtimeStats: (stats: { download: number; upload: number }) => void
  setTimeRange: (range: string) => void
  setLoading: (loading: boolean) => void
  setError: (error: string | null) => void
  addRealtimePoint: (point: TrafficData) => void

  fetchConnections: () => Promise<void>
  fetchTrafficHistory: () => Promise<void>
  fetchAppUsage: () => Promise<void>
  fetchGeoConnections: () => Promise<void>
  fetchRealtimeStats: () => Promise<void>

  startPolling: () => void
  stopPolling: () => void
}

// Initialize realtime history with 60 zero points
const initRealtimeHistory = (): TrafficData[] => {
  const now = Date.now()
  return Array.from({ length: 60 }, (_, i) => ({
    timestamp: new Date(now - (59 - i) * 1000).toISOString(),
    download: 0,
    upload: 0
  }))
}

export const useNetworkStore = create<NetworkState>((set, get) => ({
  connections: [],
  trafficHistory: [],
  realtimeHistory: initRealtimeHistory(),
  appUsage: [],
  geoConnections: [],
  realtimeStats: { download: 0, upload: 0 },
  isLoading: false,
  error: null,
  timeRange: 'live',
  pollInterval: null,

  setConnections: (connections) => set({ connections }),
  setTrafficHistory: (trafficHistory) => set({ trafficHistory }),
  setAppUsage: (appUsage) => set({ appUsage }),
  setGeoConnections: (geoConnections) => set({ geoConnections }),
  setRealtimeStats: (realtimeStats) => set({ realtimeStats }),
  setTimeRange: (timeRange) => set({ timeRange }),
  setLoading: (isLoading) => set({ isLoading }),
  setError: (error) => set({ error }),
  addRealtimePoint: (point) => set((state) => ({
    realtimeHistory: [...state.realtimeHistory.slice(1), point]
  })),

  fetchConnections: async () => {
    try {
      const connections = await window.electron?.getConnections() || []
      set({ connections })
    } catch (error) {
      console.error('Failed to fetch connections:', error)
    }
  },

  fetchTrafficHistory: async () => {
    try {
      const { timeRange } = get()
      // Don't fetch historical data for live view
      if (timeRange === 'live') {
        return
      }
      // Clear previous data before fetching new data
      set({ trafficHistory: [] })
      const trafficHistory = await window.electron?.getTrafficHistory(timeRange) || []
      set({ trafficHistory })
    } catch (error) {
      console.error('Failed to fetch traffic history:', error)
      set({ trafficHistory: [] })
    }
  },

  fetchAppUsage: async () => {
    try {
      const appUsage = await window.electron?.getAppUsage('today') || []
      set({ appUsage })
    } catch (error) {
      console.error('Failed to fetch app usage:', error)
    }
  },

  fetchGeoConnections: async () => {
    try {
      const geoConnections = await window.electron?.getConnectionsMap() || []
      set({ geoConnections })
    } catch (error) {
      console.error('Failed to fetch geo connections:', error)
    }
  },

  fetchRealtimeStats: async () => {
    try {
      const stats = await window.electron?.getRealtimeStats() || { download: 0, upload: 0 }
      // Update both realtimeStats and realtimeHistory in a single state update
      set((state) => ({
        realtimeStats: stats,
        realtimeHistory: [
          ...state.realtimeHistory.slice(1),
          {
            timestamp: new Date().toISOString(),
            download: stats.download,
            upload: stats.upload
          }
        ]
      }))
    } catch (error) {
      console.error('Failed to fetch realtime stats:', error)
    }
  },

  startPolling: () => {
    const { fetchConnections, fetchTrafficHistory, fetchRealtimeStats, fetchGeoConnections } = get()

    // Initial fetch
    fetchConnections()
    fetchTrafficHistory()
    fetchRealtimeStats()
    fetchGeoConnections()

    // Set up polling
    const interval = setInterval(() => {
      fetchConnections()
      fetchRealtimeStats()
    }, 1000)

    // Slower polling for history and geo data
    const slowInterval = setInterval(() => {
      fetchTrafficHistory()
      fetchGeoConnections()
    }, 5000)

    set({ pollInterval: interval })

    // Store slow interval reference
    ;(window as any).__slowInterval = slowInterval
  },

  stopPolling: () => {
    const { pollInterval } = get()
    if (pollInterval) {
      clearInterval(pollInterval)
      set({ pollInterval: null })
    }
    if ((window as any).__slowInterval) {
      clearInterval((window as any).__slowInterval)
    }
  }
}))

// Utility functions
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}

export function formatSpeed(bytesPerSecond: number): string {
  return formatBytes(bytesPerSecond) + '/s'
}
