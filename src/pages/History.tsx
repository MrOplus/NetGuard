import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import {
  History as HistoryIcon,
  Calendar,
  ChevronLeft,
  ChevronRight,
  Download,
  Filter
} from 'lucide-react'
import NetworkGraph from '../components/NetworkGraph/NetworkGraph'
import { formatBytes } from '../store/networkStore'

interface HistoryData {
  connections: any[]
  traffic: { timestamp: string; download: number; upload: number }[]
}

export default function History() {
  const [selectedDate, setSelectedDate] = useState(new Date())
  const [historyData, setHistoryData] = useState<HistoryData>({ connections: [], traffic: [] })
  const [loading, setLoading] = useState(false)
  const [viewMode, setViewMode] = useState<'day' | 'week' | 'month'>('day')

  useEffect(() => {
    loadHistoryData()
  }, [selectedDate, viewMode])

  const loadHistoryData = async () => {
    setLoading(true)
    try {
      const start = getStartDate()
      const end = getEndDate()

      const data = await window.electron?.getHistoryData(
        start.toISOString(),
        end.toISOString()
      )
      // Ensure data has proper structure
      setHistoryData({
        connections: Array.isArray(data?.connections) ? data.connections : [],
        traffic: Array.isArray(data?.traffic) ? data.traffic : []
      })
    } catch (error) {
      console.error('Failed to load history:', error)
      setHistoryData({ connections: [], traffic: [] })
    } finally {
      setLoading(false)
    }
  }

  const getStartDate = () => {
    const date = new Date(selectedDate)
    date.setHours(0, 0, 0, 0)
    if (viewMode === 'week') {
      date.setDate(date.getDate() - date.getDay())
    } else if (viewMode === 'month') {
      date.setDate(1)
    }
    // Subtract a day to account for timezone differences
    date.setDate(date.getDate() - 1)
    return date
  }

  const getEndDate = () => {
    const date = new Date(selectedDate)
    date.setHours(23, 59, 59, 999)
    if (viewMode === 'week') {
      date.setDate(date.getDate() + (6 - date.getDay()))
    } else if (viewMode === 'month') {
      date.setMonth(date.getMonth() + 1)
      date.setDate(0)
    }
    // Add a day to account for timezone differences
    date.setDate(date.getDate() + 1)
    return date
  }

  const navigateDate = (direction: 'prev' | 'next') => {
    const newDate = new Date(selectedDate)
    const delta = direction === 'prev' ? -1 : 1

    if (viewMode === 'day') {
      newDate.setDate(newDate.getDate() + delta)
    } else if (viewMode === 'week') {
      newDate.setDate(newDate.getDate() + delta * 7)
    } else {
      newDate.setMonth(newDate.getMonth() + delta)
    }

    setSelectedDate(newDate)
  }

  const formatDateRange = () => {
    const start = getStartDate()
    const end = getEndDate()

    if (viewMode === 'day') {
      return start.toLocaleDateString(undefined, {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      })
    } else if (viewMode === 'week') {
      return `${start.toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric'
      })} - ${end.toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric'
      })}`
    } else {
      return start.toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'long'
      })
    }
  }

  const totalDownload = historyData.traffic?.reduce((acc, d) => acc + (d.download || 0), 0) || 0
  const totalUpload = historyData.traffic?.reduce((acc, d) => acc + (d.upload || 0), 0) || 0

  const exportData = () => {
    const csv = [
      ['Timestamp', 'Download (bytes)', 'Upload (bytes)'],
      ...historyData.traffic.map(t => [t.timestamp, t.download, t.upload])
    ].map(row => row.join(',')).join('\n')

    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `netguard-history-${selectedDate.toISOString().split('T')[0]}.csv`
    a.click()
    URL.revokeObjectURL(url)
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
          <h1 className="text-2xl font-bold text-dark-100">Network Time Machine</h1>
          <p className="text-dark-400 mt-1">Browse historical network data</p>
        </div>
        <button onClick={exportData} className="btn-secondary">
          <Download className="w-4 h-4" />
          Export CSV
        </button>
      </div>

      {/* Controls */}
      <div className="card">
        <div className="flex items-center justify-between">
          {/* View Mode */}
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-dark-500" />
            {(['day', 'week', 'month'] as const).map((mode) => (
              <button
                key={mode}
                onClick={() => setViewMode(mode)}
                className={`px-3 py-1.5 text-sm rounded-lg transition-all ${
                  viewMode === mode
                    ? 'bg-primary-500 text-white'
                    : 'bg-dark-700 text-dark-400 hover:text-dark-100'
                }`}
              >
                {mode.charAt(0).toUpperCase() + mode.slice(1)}
              </button>
            ))}
          </div>

          {/* Date Navigation */}
          <div className="flex items-center gap-4">
            <button
              onClick={() => navigateDate('prev')}
              className="p-2 hover:bg-dark-700 rounded-lg transition-colors"
            >
              <ChevronLeft className="w-5 h-5 text-dark-400" />
            </button>

            <div className="flex items-center gap-2">
              <Calendar className="w-4 h-4 text-dark-500" />
              <span className="text-dark-100 font-medium">{formatDateRange()}</span>
            </div>

            <button
              onClick={() => navigateDate('next')}
              className="p-2 hover:bg-dark-700 rounded-lg transition-colors"
              disabled={getEndDate() >= new Date()}
            >
              <ChevronRight className="w-5 h-5 text-dark-400" />
            </button>

            <button
              onClick={() => setSelectedDate(new Date())}
              className="btn-ghost text-sm"
            >
              Today
            </button>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        <div className="stat-card">
          <p className="text-sm text-dark-400">Total Download</p>
          <p className="text-2xl font-bold text-chart-download font-mono">
            {formatBytes(totalDownload)}
          </p>
        </div>
        <div className="stat-card">
          <p className="text-sm text-dark-400">Total Upload</p>
          <p className="text-2xl font-bold text-chart-upload font-mono">
            {formatBytes(totalUpload)}
          </p>
        </div>
        <div className="stat-card">
          <p className="text-sm text-dark-400">Connections</p>
          <p className="text-2xl font-bold text-purple-400">
            {historyData.connections.length}
          </p>
        </div>
      </div>

      {/* Traffic Graph */}
      <div className="card">
        <h2 className="text-lg font-semibold text-dark-100 flex items-center gap-2 mb-4">
          <HistoryIcon className="w-5 h-5 text-primary-400" />
          Traffic History
        </h2>
        {loading ? (
          <div className="h-80 flex items-center justify-center text-dark-500">
            Loading history...
          </div>
        ) : historyData.traffic.length === 0 ? (
          <div className="h-80 flex items-center justify-center text-dark-500">
            No data available for this period
          </div>
        ) : (
          <NetworkGraph
            data={historyData.traffic}
            height={320}
            timeRange={viewMode === 'day' ? '24h' : viewMode === 'week' ? '7d' : '30d'}
          />
        )}
      </div>

      {/* Connection Log */}
      <div className="card">
        <h2 className="text-lg font-semibold text-dark-100 mb-4">
          Connection Log
        </h2>
        {loading ? (
          <div className="text-center py-8 text-dark-500">Loading...</div>
        ) : historyData.connections.length === 0 ? (
          <div className="text-center py-8 text-dark-500">
            No connections recorded for this period
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-dark-400 border-b border-dark-700">
                  <th className="pb-3 font-medium">Time</th>
                  <th className="pb-3 font-medium">Application</th>
                  <th className="pb-3 font-medium">Remote Address</th>
                  <th className="pb-3 font-medium">Location</th>
                  <th className="pb-3 font-medium">Data</th>
                </tr>
              </thead>
              <tbody>
                {historyData.connections.slice(0, 50).map((conn, index) => (
                  <tr key={index} className="table-row">
                    <td className="py-2 text-dark-400">
                      {new Date(conn.timestamp).toLocaleTimeString()}
                    </td>
                    <td className="py-2 text-dark-100">{conn.process_name}</td>
                    <td className="py-2 font-mono text-dark-300">
                      {conn.remote_address}:{conn.remote_port}
                    </td>
                    <td className="py-2 text-dark-400">
                      {conn.city ? `${conn.city}, ${conn.country}` : conn.country || '-'}
                    </td>
                    <td className="py-2 text-dark-400">
                      ↓{formatBytes(conn.bytes_received)} ↑{formatBytes(conn.bytes_sent)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </motion.div>
  )
}
