import { useMemo } from 'react'
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend
} from 'recharts'
import { formatBytes } from '../../store/networkStore'

interface TrafficData {
  timestamp: string
  download: number
  upload: number
}

interface NetworkGraphProps {
  data: TrafficData[]
  height?: number
  showLegend?: boolean
  timeRange?: string
}

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload || !payload.length) return null

  return (
    <div className="glass-panel-solid p-3 shadow-xl">
      <p className="text-xs text-dark-400 mb-2">
        {new Date(label).toLocaleTimeString()}
      </p>
      {payload.map((entry: any, index: number) => (
        <div key={index} className="flex items-center gap-2 text-sm">
          <div
            className="w-2 h-2 rounded-full"
            style={{ backgroundColor: entry.color }}
          />
          <span className="text-dark-300">{entry.name}:</span>
          <span className="font-mono text-dark-100">
            {formatBytes(entry.value)}
          </span>
        </div>
      ))}
    </div>
  )
}

export default function NetworkGraph({
  data,
  height = 300,
  showLegend = true,
  timeRange = '1h'
}: NetworkGraphProps) {
  // For live view, use placeholder if no data. For historical, show empty state
  const isLiveView = timeRange === '1m'
  const hasData = data && data.length > 0

  const chartData = useMemo(() => {
    if (!data || data.length === 0) {
      if (isLiveView) {
        // Generate placeholder data for live view only
        const now = Date.now()
        return Array.from({ length: 60 }, (_, i) => ({
          timestamp: new Date(now - (59 - i) * 1000).toISOString(),
          download: 0,
          upload: 0
        }))
      }
      return []
    }
    return data
  }, [data, isLiveView])

  // Show empty state for historical views with no data
  if (!isLiveView && !hasData) {
    return (
      <div className="w-full flex items-center justify-center text-dark-500" style={{ height }}>
        No data available for this time range
      </div>
    )
  }

  const formatXAxis = (timestamp: string) => {
    const date = new Date(timestamp)
    if (timeRange === '1m') {
      return date.toLocaleTimeString([], { minute: '2-digit', second: '2-digit' })
    }
    if (timeRange === '1h') {
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    }
    if (timeRange === '24h') {
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    }
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' })
  }

  const formatYAxis = (value: number) => {
    if (value === 0) return '0'
    if (value >= 1073741824) return `${(value / 1073741824).toFixed(1)}GB`
    if (value >= 1048576) return `${(value / 1048576).toFixed(1)}MB`
    if (value >= 1024) return `${(value / 1024).toFixed(1)}KB`
    return `${value}B`
  }

  return (
    <div className="w-full" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart
          data={chartData}
          margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
        >
          <defs>
            <linearGradient id="downloadGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.4} />
              <stop offset="100%" stopColor="#3b82f6" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="uploadGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#10b981" stopOpacity={0.4} />
              <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.5} />
          <XAxis
            dataKey="timestamp"
            tickFormatter={formatXAxis}
            stroke="#64748b"
            fontSize={11}
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            tickFormatter={formatYAxis}
            stroke="#64748b"
            fontSize={11}
            tickLine={false}
            axisLine={false}
            width={50}
          />
          <Tooltip content={<CustomTooltip />} />
          {showLegend && (
            <Legend
              verticalAlign="top"
              height={36}
              iconType="circle"
              iconSize={8}
              wrapperStyle={{ paddingBottom: '10px' }}
            />
          )}
          <Area
            type="monotone"
            dataKey="download"
            name="Download"
            stroke="#3b82f6"
            strokeWidth={2}
            fill="url(#downloadGradient)"
            isAnimationActive={false}
          />
          <Area
            type="monotone"
            dataKey="upload"
            name="Upload"
            stroke="#10b981"
            strokeWidth={2}
            fill="url(#uploadGradient)"
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}
