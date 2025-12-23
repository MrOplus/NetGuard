import { Globe, Lock, ArrowUpRight, ArrowDownRight } from 'lucide-react'

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

interface ConnectionsListProps {
  connections: Connection[]
  limit?: number
  onBlock?: (connection: Connection) => void
  showDetails?: boolean
}

function formatBytes(bytes: number): string {
  if (!bytes || bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
}

export default function ConnectionsList({
  connections,
  limit,
  onBlock,
  showDetails = false
}: ConnectionsListProps) {
  const displayConnections = limit ? connections.slice(0, limit) : connections

  // Filter to show only established connections by default
  const filteredConnections = displayConnections.filter(
    conn => conn.state === 'Established' || conn.state === 'Listen'
  )

  if (filteredConnections.length === 0) {
    return (
      <div className="text-center py-8 text-dark-500">
        No active connections
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {filteredConnections.map((conn) => (
        <div
          key={conn.id}
          className="flex items-center gap-3 p-3 rounded-lg bg-dark-800/50 hover:bg-dark-700/50 transition-colors group"
        >
          {/* Process Icon */}
          <div className="w-10 h-10 rounded-lg bg-dark-700 flex items-center justify-center text-sm font-bold text-dark-400 shrink-0">
            {conn.processName.substring(0, 2).toUpperCase()}
          </div>

          {/* Connection Info */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-dark-100 truncate">
                {conn.processName}
              </span>
              <span
                className={`text-xs px-1.5 py-0.5 rounded ${
                  conn.state === 'Established'
                    ? 'bg-green-500/10 text-green-400'
                    : conn.state === 'Listen'
                    ? 'bg-blue-500/10 text-blue-400'
                    : conn.state === 'TimeWait'
                    ? 'bg-yellow-500/10 text-yellow-400'
                    : 'bg-dark-600 text-dark-400'
                }`}
              >
                {conn.state}
              </span>
              <span className="text-xs text-dark-600">{conn.protocol}</span>
            </div>
            <div className="flex items-center gap-2 mt-1 text-xs text-dark-500">
              {conn.state === 'Listen' ? (
                // For Listen connections, show local address and port
                <span className="font-mono truncate">
                  Listening on {conn.localAddress}:{conn.localPort}
                </span>
              ) : (
                // For Established and other connections, show remote address
                <>
                  <span className="font-mono truncate">
                    {conn.remoteAddress}:{conn.remotePort}
                  </span>
                  {conn.country && (
                    <span className="flex items-center gap-1 text-primary-400 shrink-0">
                      <Globe className="w-3 h-3" />
                      {conn.city ? `${conn.city}, ${conn.country}` : conn.country}
                    </span>
                  )}
                </>
              )}
            </div>
            {showDetails && (conn.bytesSent || conn.bytesReceived) && (
              <div className="flex items-center gap-3 mt-1 text-xs">
                <span className="flex items-center gap-1 text-green-400">
                  <ArrowUpRight className="w-3 h-3" />
                  {formatBytes(conn.bytesSent || 0)}
                </span>
                <span className="flex items-center gap-1 text-blue-400">
                  <ArrowDownRight className="w-3 h-3" />
                  {formatBytes(conn.bytesReceived || 0)}
                </span>
              </div>
            )}
          </div>

          {/* Actions */}
          {onBlock && (
            <button
              onClick={() => onBlock(conn)}
              className="opacity-0 group-hover:opacity-100 p-2 hover:bg-red-500/20 rounded-lg transition-all shrink-0"
              title="Block this connection"
            >
              <Lock className="w-4 h-4 text-red-400" />
            </button>
          )}
        </div>
      ))}
    </div>
  )
}
