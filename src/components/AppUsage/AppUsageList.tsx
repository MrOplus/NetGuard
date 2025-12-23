import { ArrowDownRight, ArrowUpRight } from 'lucide-react'
import { formatBytes } from '../../store/networkStore'

interface AppUsage {
  processName: string
  processPath: string
  bytesSent: number
  bytesReceived: number
  connections: number
}

interface AppUsageListProps {
  apps: AppUsage[]
  limit?: number
}

export default function AppUsageList({ apps, limit }: AppUsageListProps) {
  const displayApps = limit ? apps.slice(0, limit) : apps
  const maxBytes = Math.max(...apps.map(a => a.bytesSent + a.bytesReceived), 1)

  if (displayApps.length === 0) {
    return (
      <div className="text-center py-8 text-dark-500">
        No application data yet
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {displayApps.map((app, index) => {
        const totalBytes = app.bytesSent + app.bytesReceived
        const percentage = (totalBytes / maxBytes) * 100
        const downloadPercent = totalBytes > 0 ? (app.bytesReceived / totalBytes) * 100 : 50

        return (
          <div key={app.processPath || app.processName} className="group">
            <div className="flex items-center gap-3">
              {/* Rank */}
              <div className="w-6 text-center text-xs font-bold text-dark-500">
                #{index + 1}
              </div>

              {/* App Icon Placeholder */}
              <div className="w-8 h-8 rounded-lg bg-dark-700 flex items-center justify-center text-xs font-bold text-primary-400">
                {app.processName.charAt(0).toUpperCase()}
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-medium text-dark-100 truncate">
                    {app.processName}
                  </span>
                  <span className="text-xs font-mono font-semibold text-dark-200">
                    {formatBytes(totalBytes)}
                  </span>
                </div>

                {/* Dual Progress Bar - Download (blue) / Upload (green) */}
                <div className="h-2 bg-dark-700 rounded-full overflow-hidden flex">
                  <div
                    className="h-full bg-blue-500 transition-all duration-500"
                    style={{ width: `${percentage * (downloadPercent / 100)}%` }}
                  />
                  <div
                    className="h-full bg-green-500 transition-all duration-500"
                    style={{ width: `${percentage * (1 - downloadPercent / 100)}%` }}
                  />
                </div>

                {/* Details */}
                <div className="flex items-center gap-4 mt-1.5 text-xs">
                  <span className="flex items-center gap-1 text-blue-400">
                    <ArrowDownRight className="w-3 h-3" />
                    {formatBytes(app.bytesReceived)}
                  </span>
                  <span className="flex items-center gap-1 text-green-400">
                    <ArrowUpRight className="w-3 h-3" />
                    {formatBytes(app.bytesSent)}
                  </span>
                  <span className="text-dark-500">{app.connections} conn</span>
                </div>
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
