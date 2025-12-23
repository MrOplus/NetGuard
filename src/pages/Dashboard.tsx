import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import {
  Activity,
  ArrowDownCircle,
  ArrowUpCircle,
  Globe,
  Laptop,
  Shield,
  Clock
} from 'lucide-react'
import NetworkGraph from '../components/NetworkGraph/NetworkGraph'
import AppUsageList from '../components/AppUsage/AppUsageList'
import ConnectionsList from '../components/Connections/ConnectionsList'
import WorldMap from '../components/WorldMap/WorldMap'
import { useNetworkStore, formatBytes, formatSpeed } from '../store/networkStore'

const timeRanges = [
  { value: 'live', label: 'Live' },
  { value: '1h', label: '1 Hour' },
  { value: '24h', label: '24 Hours' },
  { value: '7d', label: '7 Days' },
  { value: '30d', label: '30 Days' }
]

export default function Dashboard() {
  const {
    connections,
    trafficHistory,
    realtimeHistory,
    appUsage,
    geoConnections,
    realtimeStats,
    timeRange,
    setTimeRange,
    fetchAppUsage,
    fetchTrafficHistory
  } = useNetworkStore()

  const [activeTab, setActiveTab] = useState<'apps' | 'connections'>('apps')

  useEffect(() => {
    fetchAppUsage()
    // Refresh app usage every 3 seconds for live updates
    const interval = setInterval(fetchAppUsage, 3000)
    return () => clearInterval(interval)
  }, [fetchAppUsage])

  // Use real-time history for live view, otherwise use historical data from store
  const chartData = timeRange === 'live' ? realtimeHistory : trafficHistory

  useEffect(() => {
    if (timeRange !== 'live') {
      fetchTrafficHistory()
    }
  }, [timeRange, fetchTrafficHistory])

  // Calculate totals from the appropriate data source
  const totalDownload = chartData.reduce((acc, d) => acc + d.download, 0)
  const totalUpload = chartData.reduce((acc, d) => acc + d.upload, 0)

  const stats = [
    {
      icon: ArrowDownCircle,
      label: 'Download',
      value: formatSpeed(realtimeStats.download),
      color: 'text-chart-download',
      bgColor: 'bg-blue-500/10'
    },
    {
      icon: ArrowUpCircle,
      label: 'Upload',
      value: formatSpeed(realtimeStats.upload),
      color: 'text-chart-upload',
      bgColor: 'bg-green-500/10'
    },
    {
      icon: Globe,
      label: 'Connections',
      value: connections.length.toString(),
      color: 'text-purple-400',
      bgColor: 'bg-purple-500/10'
    },
    {
      icon: Laptop,
      label: 'Active Apps',
      value: appUsage.length.toString(),
      color: 'text-cyan-400',
      bgColor: 'bg-cyan-500/10'
    }
  ]

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
          <h1 className="text-2xl font-bold text-dark-100">Dashboard</h1>
          <p className="text-dark-400 mt-1">Real-time network monitoring</p>
        </div>
        <div className="flex items-center gap-2">
          <Clock className="w-4 h-4 text-dark-500" />
          {timeRanges.map(({ value, label }) => (
            <button
              key={value}
              onClick={() => setTimeRange(value)}
              className={`px-3 py-1.5 text-sm rounded-lg transition-all ${
                timeRange === value
                  ? 'bg-primary-500 text-white'
                  : 'bg-dark-800 text-dark-400 hover:text-dark-100'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-4 gap-4">
        {stats.map(({ icon: Icon, label, value, color, bgColor }) => (
          <motion.div
            key={label}
            whileHover={{ scale: 1.02 }}
            className="stat-card"
          >
            <div className="flex items-center gap-3">
              <div className={`p-2 rounded-lg ${bgColor}`}>
                <Icon className={`w-5 h-5 ${color}`} />
              </div>
              <div>
                <p className="text-sm text-dark-400">{label}</p>
                <p className={`text-xl font-bold font-mono ${color}`}>{value}</p>
              </div>
            </div>
          </motion.div>
        ))}
      </div>

      {/* Main Content Grid */}
      <div className="grid grid-cols-3 gap-6">
        {/* Traffic Graph */}
        <div className="col-span-2 card">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-dark-100 flex items-center gap-2">
              <Activity className="w-5 h-5 text-primary-400" />
              Network Traffic
            </h2>
            <div className="flex items-center gap-4 text-sm">
              <div className="flex items-center gap-2">
                <span className="text-dark-400">Total:</span>
                <span className="text-chart-download font-mono">
                  ↓ {formatBytes(totalDownload)}
                </span>
                <span className="text-chart-upload font-mono">
                  ↑ {formatBytes(totalUpload)}
                </span>
              </div>
            </div>
          </div>
          <NetworkGraph data={chartData} height={280} timeRange={timeRange === 'live' ? '1m' : timeRange} />
        </div>

        {/* World Map */}
        <div className="card">
          <h2 className="text-lg font-semibold text-dark-100 flex items-center gap-2 mb-4">
            <Globe className="w-5 h-5 text-primary-400" />
            Connection Map
          </h2>
          <WorldMap connections={geoConnections} height={280} />
        </div>
      </div>

      {/* Bottom Section */}
      <div className="grid grid-cols-2 gap-6">
        {/* Apps / Connections Tabs */}
        <div className="card">
          <div className="flex items-center gap-4 mb-4">
            <button
              onClick={() => setActiveTab('apps')}
              className={`text-lg font-semibold transition-colors ${
                activeTab === 'apps'
                  ? 'text-dark-100'
                  : 'text-dark-500 hover:text-dark-300'
              }`}
            >
              Top Applications
            </button>
            <button
              onClick={() => setActiveTab('connections')}
              className={`text-lg font-semibold transition-colors ${
                activeTab === 'connections'
                  ? 'text-dark-100'
                  : 'text-dark-500 hover:text-dark-300'
              }`}
            >
              Active Connections
            </button>
          </div>
          {activeTab === 'apps' ? (
            <AppUsageList apps={appUsage} limit={8} />
          ) : (
            <ConnectionsList connections={connections} limit={8} />
          )}
        </div>

        {/* Security Status */}
        <div className="card">
          <h2 className="text-lg font-semibold text-dark-100 flex items-center gap-2 mb-4">
            <Shield className="w-5 h-5 text-primary-400" />
            Security Status
          </h2>
          <div className="space-y-4">
            <SecurityItem
              label="Firewall"
              status="active"
              description="Windows Firewall is enabled"
            />
            <SecurityItem
              label="Network Monitoring"
              status="active"
              description="Tracking all network activity"
            />
            <SecurityItem
              label="Evil Twin Detection"
              status="active"
              description="Scanning for rogue access points"
            />
            <SecurityItem
              label="RDP Detection"
              status="active"
              description="Monitoring remote connections"
            />
          </div>
        </div>
      </div>
    </motion.div>
  )
}

function SecurityItem({
  label,
  status,
  description
}: {
  label: string
  status: 'active' | 'inactive' | 'warning'
  description: string
}) {
  const statusColors = {
    active: 'bg-green-500',
    inactive: 'bg-dark-600',
    warning: 'bg-yellow-500'
  }

  return (
    <div className="flex items-center gap-3 p-3 rounded-lg bg-dark-800/50">
      <div className={`w-2 h-2 rounded-full ${statusColors[status]}`} />
      <div className="flex-1">
        <p className="text-sm font-medium text-dark-100">{label}</p>
        <p className="text-xs text-dark-500">{description}</p>
      </div>
      <span
        className={`text-xs font-medium ${
          status === 'active'
            ? 'text-green-400'
            : status === 'warning'
            ? 'text-yellow-400'
            : 'text-dark-500'
        }`}
      >
        {status.charAt(0).toUpperCase() + status.slice(1)}
      </span>
    </div>
  )
}
