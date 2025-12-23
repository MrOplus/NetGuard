import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { AreaChart, Area, ResponsiveContainer } from 'recharts'
import { ArrowDown, ArrowUp, X } from 'lucide-react'
import { formatSpeed } from '../store/networkStore'

interface TrafficPoint {
  download: number
  upload: number
}

export default function MiniGraph() {
  const [stats, setStats] = useState({ download: 0, upload: 0 })
  const [history, setHistory] = useState<TrafficPoint[]>([])

  useEffect(() => {
    // Initial data
    setHistory(Array(30).fill({ download: 0, upload: 0 }))

    // Poll for stats
    const interval = setInterval(async () => {
      try {
        const newStats = await window.electron?.getRealtimeStats() || { download: 0, upload: 0 }
        setStats(newStats)

        setHistory((prev) => {
          const updated = [...prev.slice(1), newStats]
          return updated
        })
      } catch (error) {
        console.error('Failed to fetch stats:', error)
      }
    }, 1000)

    return () => clearInterval(interval)
  }, [])

  const handleClose = () => {
    window.electron?.toggleMini()
  }

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      className="w-full h-screen flex flex-col bg-dark-900/95 backdrop-blur-sm rounded-lg border border-dark-700 overflow-hidden cursor-move"
      style={{ WebkitAppRegion: 'drag' } as any}
    >
      {/* Close Button */}
      <button
        onClick={handleClose}
        className="absolute top-1 right-1 p-1 hover:bg-dark-700 rounded-full z-10 cursor-pointer"
        style={{ WebkitAppRegion: 'no-drag' } as any}
      >
        <X className="w-3 h-3 text-dark-500 hover:text-dark-300" />
      </button>

      {/* Mini Chart */}
      <div className="flex-1 px-2 pt-1 min-h-0">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={history} margin={{ top: 5, right: 5, left: 5, bottom: 0 }}>
            <defs>
              <linearGradient id="miniDownload" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.6} />
                <stop offset="100%" stopColor="#3b82f6" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="miniUpload" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#10b981" stopOpacity={0.6} />
                <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
              </linearGradient>
            </defs>
            <Area
              type="monotone"
              dataKey="download"
              stroke="#3b82f6"
              strokeWidth={1.5}
              fill="url(#miniDownload)"
              isAnimationActive={false}
            />
            <Area
              type="monotone"
              dataKey="upload"
              stroke="#10b981"
              strokeWidth={1.5}
              fill="url(#miniUpload)"
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Stats */}
      <div className="flex items-center justify-between px-3 py-1.5 shrink-0">
        <div className="flex items-center gap-1">
          <ArrowDown className="w-3 h-3 text-chart-download" />
          <span className="text-xs font-mono text-chart-download">
            {formatSpeed(stats.download)}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <ArrowUp className="w-3 h-3 text-chart-upload" />
          <span className="text-xs font-mono text-chart-upload">
            {formatSpeed(stats.upload)}
          </span>
        </div>
      </div>
    </motion.div>
  )
}
