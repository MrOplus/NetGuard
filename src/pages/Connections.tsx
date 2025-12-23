import { useEffect, useState, useCallback, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Globe,
  Search,
  RefreshCw,
  Shield,
  X,
  ArrowUpRight,
  ArrowDownRight,
  Filter,
  ChevronDown,
  ChevronRight,
  CheckCircle,
  AlertCircle
} from 'lucide-react'
import { useNetworkStore, formatBytes } from '../store/networkStore'

interface Toast {
  id: number
  type: 'success' | 'error'
  message: string
}

interface Connection {
  id: string
  processName: string
  processPath: string
  localAddress: string
  localPort: number
  remoteAddress: string
  remotePort: number
  protocol: string
  state: string
  bytesSent?: number
  bytesReceived?: number
  country?: string
  city?: string
}

interface ProcessGroup {
  processName: string
  processPath: string
  connections: Connection[]
  totalBytesSent: number
  totalBytesReceived: number
  states: Record<string, number>
}

type FilterState = 'all' | 'established' | 'listen' | 'other'

export default function Connections() {
  const { connections, fetchConnections } = useNetworkStore()
  const [searchQuery, setSearchQuery] = useState('')
  const [filterState, setFilterState] = useState<FilterState>('all')
  const [expandedProcesses, setExpandedProcesses] = useState<Set<string>>(new Set())
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [toasts, setToasts] = useState<Toast[]>([])

  const showToast = (type: 'success' | 'error', message: string) => {
    const id = Date.now()
    setToasts(prev => [...prev, { id, type, message }])
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id))
    }, 4000)
  }

  // Use a ref to track if user is interacting
  const [isPaused, setIsPaused] = useState(false)

  useEffect(() => {
    fetchConnections()
    // Only refresh when not paused (hovering over the list)
    const interval = setInterval(() => {
      if (!isPaused) {
        fetchConnections()
      }
    }, 3000) // Slower refresh rate
    return () => clearInterval(interval)
  }, [fetchConnections, isPaused])

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true)
    await fetchConnections()
    setTimeout(() => setIsRefreshing(false), 500)
  }, [fetchConnections])

  const handleKillConnection = async (conn: Connection) => {
    setActionLoading(conn.id)
    try {
      const success = await window.electron?.killConnection(conn.id)
      if (success) {
        showToast('success', `Killed connection for ${conn.processName}`)
        await fetchConnections()
      } else {
        showToast('error', 'Failed to kill connection. Admin rights may be required.')
      }
    } catch (error) {
      console.error('Failed to kill connection:', error)
      showToast('error', 'Failed to kill connection')
    } finally {
      setActionLoading(null)
    }
  }

  const handleBlockConnection = async (conn: Connection) => {
    setActionLoading(conn.id)
    try {
      const success = await window.electron?.blockConnection(conn.remoteAddress, conn.remotePort)
      if (success) {
        showToast('success', `Blocked ${conn.remoteAddress}:${conn.remotePort}`)
        await fetchConnections()
      } else {
        showToast('error', 'Failed to block address. Admin rights may be required.')
      }
    } catch (error) {
      console.error('Failed to block connection:', error)
      showToast('error', 'Failed to block connection')
    } finally {
      setActionLoading(null)
    }
  }

  const handleBlockApp = async (processPath: string, processName: string) => {
    if (!processPath) return
    setActionLoading(processPath)
    try {
      const success = await window.electron?.blockApp(processPath)
      if (success) {
        showToast('success', `Blocked ${processName}`)
        await fetchConnections()
      } else {
        showToast('error', 'Failed to block application. Admin rights may be required.')
      }
    } catch (error) {
      console.error('Failed to block app:', error)
      showToast('error', 'Failed to block application')
    } finally {
      setActionLoading(null)
    }
  }

  const toggleProcess = (key: string) => {
    setExpandedProcesses(prev => {
      const next = new Set(prev)
      if (next.has(key)) {
        next.delete(key)
      } else {
        next.add(key)
      }
      return next
    })
  }

  const expandAll = () => {
    setExpandedProcesses(new Set(processGroups.map(g => g.processPath || g.processName)))
  }

  const collapseAll = () => {
    setExpandedProcesses(new Set())
  }

  // Filter connections
  const filteredConnections = useMemo(() => {
    return (connections as Connection[]).filter(conn => {
      const searchLower = searchQuery.toLowerCase()
      const matchesSearch =
        conn.processName.toLowerCase().includes(searchLower) ||
        conn.remoteAddress.includes(searchLower) ||
        conn.localAddress.includes(searchLower) ||
        (conn.country?.toLowerCase().includes(searchLower) ?? false) ||
        (conn.city?.toLowerCase().includes(searchLower) ?? false)

      let matchesState = true
      if (filterState === 'established') {
        matchesState = conn.state === 'Established'
      } else if (filterState === 'listen') {
        matchesState = conn.state === 'Listen'
      } else if (filterState === 'other') {
        matchesState = conn.state !== 'Established' && conn.state !== 'Listen'
      }

      return matchesSearch && matchesState
    })
  }, [connections, searchQuery, filterState])

  // Group by process
  const processGroups = useMemo(() => {
    const groups = new Map<string, ProcessGroup>()

    for (const conn of filteredConnections) {
      const key = conn.processPath || conn.processName

      if (!groups.has(key)) {
        groups.set(key, {
          processName: conn.processName,
          processPath: conn.processPath,
          connections: [],
          totalBytesSent: 0,
          totalBytesReceived: 0,
          states: {}
        })
      }

      const group = groups.get(key)!
      group.connections.push(conn)
      group.totalBytesSent += conn.bytesSent || 0
      group.totalBytesReceived += conn.bytesReceived || 0
      group.states[conn.state] = (group.states[conn.state] || 0) + 1
    }

    // Sort by process name for stable ordering (traffic-based sorting causes constant reordering)
    return Array.from(groups.values()).sort((a, b) =>
      a.processName.toLowerCase().localeCompare(b.processName.toLowerCase())
    )
  }, [filteredConnections])

  const stateStats = useMemo(() => ({
    all: connections.length,
    established: connections.filter((c: Connection) => c.state === 'Established').length,
    listen: connections.filter((c: Connection) => c.state === 'Listen').length,
    other: connections.filter((c: Connection) => c.state !== 'Established' && c.state !== 'Listen').length
  }), [connections])

  const getStateColor = (state: string) => {
    switch (state) {
      case 'Established':
        return 'bg-green-500/10 text-green-400'
      case 'Listen':
        return 'bg-blue-500/10 text-blue-400'
      case 'TimeWait':
        return 'bg-yellow-500/10 text-yellow-400'
      case 'CloseWait':
        return 'bg-orange-500/10 text-orange-400'
      default:
        return 'bg-dark-600 text-dark-400'
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      className="space-y-6"
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-dark-100">Active Connections</h1>
          <p className="text-dark-400 mt-1">
            {processGroups.length} app{processGroups.length !== 1 ? 's' : ''} with {filteredConnections.length} connection{filteredConnections.length !== 1 ? 's' : ''}
          </p>
        </div>
        <button
          onClick={handleRefresh}
          disabled={isRefreshing}
          className="btn-primary"
        >
          <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-4">
        {/* Search */}
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-dark-500" />
          <input
            type="text"
            placeholder="Search by process, IP, or location..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="input pl-10 w-full"
          />
        </div>

        {/* Expand/Collapse */}
        <div className="flex items-center gap-1">
          <button
            onClick={expandAll}
            className="px-3 py-2 text-sm text-dark-400 hover:text-dark-100 hover:bg-dark-700 rounded-lg transition-colors"
          >
            Expand All
          </button>
          <button
            onClick={collapseAll}
            className="px-3 py-2 text-sm text-dark-400 hover:text-dark-100 hover:bg-dark-700 rounded-lg transition-colors"
          >
            Collapse All
          </button>
        </div>

        {/* State Filter */}
        <div className="flex items-center gap-1 bg-dark-800 rounded-lg p-1">
          <Filter className="w-4 h-4 text-dark-500 mx-2" />
          {(['all', 'established', 'listen', 'other'] as FilterState[]).map((state) => (
            <button
              key={state}
              onClick={() => setFilterState(state)}
              className={`px-3 py-1.5 text-sm rounded-md transition-all ${
                filterState === state
                  ? 'bg-primary-500 text-white'
                  : 'text-dark-400 hover:text-dark-100'
              }`}
            >
              {state.charAt(0).toUpperCase() + state.slice(1)} ({stateStats[state]})
            </button>
          ))}
        </div>
      </div>

      {/* Process Groups */}
      <div
        className="space-y-3"
        onMouseEnter={() => setIsPaused(true)}
        onMouseLeave={() => setIsPaused(false)}
      >
        {processGroups.length === 0 ? (
          <div className="card p-12 text-center text-dark-500">
            No connections found
          </div>
        ) : (
          processGroups.map((group) => {
            const key = group.processPath || group.processName
            const isExpanded = expandedProcesses.has(key)

            return (
              <div key={key} className="card overflow-hidden">
                {/* Process Header */}
                <div
                  className="flex items-center gap-4 p-4 cursor-pointer hover:bg-dark-750 transition-colors"
                  onClick={() => toggleProcess(key)}
                >
                  {/* Expand Icon */}
                  <div className="text-dark-500">
                    {isExpanded ? (
                      <ChevronDown className="w-5 h-5" />
                    ) : (
                      <ChevronRight className="w-5 h-5" />
                    )}
                  </div>

                  {/* Process Icon */}
                  <div className="w-10 h-10 rounded-lg bg-dark-700 flex items-center justify-center text-sm font-bold text-primary-400">
                    {group.processName.charAt(0).toUpperCase()}
                  </div>

                  {/* Process Info */}
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-dark-100 truncate">
                      {group.processName}
                    </p>
                    <p className="text-xs text-dark-500 truncate">
                      {group.processPath || 'System Process'}
                    </p>
                  </div>

                  {/* Connection Count */}
                  <div className="text-center px-4">
                    <p className="text-lg font-semibold text-dark-100">
                      {group.connections.length}
                    </p>
                    <p className="text-xs text-dark-500">
                      connection{group.connections.length !== 1 ? 's' : ''}
                    </p>
                  </div>

                  {/* State Badges */}
                  <div className="flex items-center gap-2">
                    {Object.entries(group.states).map(([state, count]) => (
                      <span
                        key={state}
                        className={`text-xs px-2 py-1 rounded ${getStateColor(state)}`}
                      >
                        {count} {state}
                      </span>
                    ))}
                  </div>

                  {/* Traffic */}
                  <div className="flex items-center gap-4 text-xs min-w-[180px] justify-end">
                    <span className="flex items-center gap-1 text-green-400">
                      <ArrowUpRight className="w-3 h-3" />
                      {formatBytes(group.totalBytesSent)}
                    </span>
                    <span className="flex items-center gap-1 text-blue-400">
                      <ArrowDownRight className="w-3 h-3" />
                      {formatBytes(group.totalBytesReceived)}
                    </span>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                    {group.processPath && (
                      <button
                        onClick={() => handleBlockApp(group.processPath, group.processName)}
                        disabled={actionLoading === group.processPath}
                        className="p-2 hover:bg-red-500/20 rounded-lg transition-colors"
                        title="Block application"
                      >
                        <Shield className="w-4 h-4 text-red-400" />
                      </button>
                    )}
                  </div>
                </div>

                {/* Expanded Connections */}
                <AnimatePresence>
                  {isExpanded && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.2 }}
                      className="overflow-hidden"
                    >
                      <div className="border-t border-dark-700">
                        <table className="w-full">
                          <thead>
                            <tr className="bg-dark-850">
                              <th className="text-left py-2 px-4 text-xs font-medium text-dark-500">Local</th>
                              <th className="text-left py-2 px-4 text-xs font-medium text-dark-500">Remote</th>
                              <th className="text-left py-2 px-4 text-xs font-medium text-dark-500">State</th>
                              <th className="text-left py-2 px-4 text-xs font-medium text-dark-500">Protocol</th>
                              <th className="text-left py-2 px-4 text-xs font-medium text-dark-500">Traffic</th>
                              <th className="text-right py-2 px-4 text-xs font-medium text-dark-500">Actions</th>
                            </tr>
                          </thead>
                          <tbody>
                            {group.connections.map((conn) => (
                              <tr
                                key={conn.id}
                                className="border-t border-dark-800 hover:bg-dark-800/50 transition-colors group"
                              >
                                {/* Local */}
                                <td className="py-2 px-4">
                                  <span className="text-sm font-mono text-dark-300">
                                    {conn.localAddress}:{conn.localPort}
                                  </span>
                                </td>

                                {/* Remote */}
                                <td className="py-2 px-4">
                                  <div className="min-w-0">
                                    <span className="text-sm font-mono text-dark-300">
                                      {conn.remoteAddress}:{conn.remotePort}
                                    </span>
                                    {conn.country && (
                                      <div className="flex items-center gap-1 mt-0.5 text-xs text-primary-400">
                                        <Globe className="w-3 h-3" />
                                        {conn.city ? `${conn.city}, ${conn.country}` : conn.country}
                                      </div>
                                    )}
                                  </div>
                                </td>

                                {/* State */}
                                <td className="py-2 px-4">
                                  <span className={`text-xs px-2 py-1 rounded ${getStateColor(conn.state)}`}>
                                    {conn.state}
                                  </span>
                                </td>

                                {/* Protocol */}
                                <td className="py-2 px-4">
                                  <span className="text-xs text-dark-400">{conn.protocol}</span>
                                </td>

                                {/* Traffic */}
                                <td className="py-2 px-4">
                                  {(conn.bytesSent || conn.bytesReceived) ? (
                                    <div className="flex items-center gap-3 text-xs">
                                      <span className="flex items-center gap-1 text-green-400">
                                        <ArrowUpRight className="w-3 h-3" />
                                        {formatBytes(conn.bytesSent || 0)}
                                      </span>
                                      <span className="flex items-center gap-1 text-blue-400">
                                        <ArrowDownRight className="w-3 h-3" />
                                        {formatBytes(conn.bytesReceived || 0)}
                                      </span>
                                    </div>
                                  ) : (
                                    <span className="text-xs text-dark-500">-</span>
                                  )}
                                </td>

                                {/* Actions */}
                                <td className="py-2 px-4 text-right">
                                  <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                    <button
                                      onClick={() => handleKillConnection(conn)}
                                      disabled={actionLoading === conn.id}
                                      className="p-1.5 hover:bg-red-500/20 rounded-lg transition-colors"
                                      title="Kill connection"
                                    >
                                      <X className="w-4 h-4 text-red-400" />
                                    </button>
                                    <button
                                      onClick={() => handleBlockConnection(conn)}
                                      disabled={actionLoading === conn.id}
                                      className="p-1.5 hover:bg-red-500/20 rounded-lg transition-colors"
                                      title="Block remote address"
                                    >
                                      <Shield className="w-4 h-4 text-red-400" />
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            )
          })
        )}
      </div>

      {/* Toast Notifications */}
      <div className="fixed bottom-6 right-6 z-50 space-y-2">
        <AnimatePresence>
          {toasts.map(toast => (
            <motion.div
              key={toast.id}
              initial={{ opacity: 0, y: 20, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -10, scale: 0.95 }}
              className={`flex items-center gap-3 px-4 py-3 rounded-lg shadow-lg ${
                toast.type === 'success'
                  ? 'bg-green-500/20 border border-green-500/30 text-green-400'
                  : 'bg-red-500/20 border border-red-500/30 text-red-400'
              }`}
            >
              {toast.type === 'success' ? (
                <CheckCircle className="w-5 h-5" />
              ) : (
                <AlertCircle className="w-5 h-5" />
              )}
              <span className="text-sm">{toast.message}</span>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </motion.div>
  )
}
