import { useEffect } from 'react'
import { motion } from 'framer-motion'
import {
  Bell,
  BellOff,
  AlertTriangle,
  Info,
  AlertCircle,
  Check,
  Trash2,
  Wifi,
  Shield,
  Monitor,
  Laptop
} from 'lucide-react'
import { useAlertStore, Alert } from '../store/alertStore'

const alertTypeIcons: Record<string, any> = {
  new_app: Laptop,
  new_device: Wifi,
  evil_twin: AlertTriangle,
  rdp: Monitor,
  firewall: Shield,
  default: Bell
}

const severityColors = {
  info: {
    bg: 'bg-blue-500/10',
    border: 'border-blue-500/30',
    text: 'text-blue-400',
    icon: Info
  },
  warning: {
    bg: 'bg-yellow-500/10',
    border: 'border-yellow-500/30',
    text: 'text-yellow-400',
    icon: AlertTriangle
  },
  critical: {
    bg: 'bg-red-500/10',
    border: 'border-red-500/30',
    text: 'text-red-400',
    icon: AlertCircle
  }
}

export default function Alerts() {
  const { alerts, unreadCount, fetchAlerts, markRead, clearAll } = useAlertStore()

  useEffect(() => {
    fetchAlerts()
  }, [fetchAlerts])

  const handleMarkAllRead = () => {
    alerts.forEach(alert => {
      if (!alert.read) {
        markRead(alert.id)
      }
    })
  }

  const groupedAlerts = alerts.reduce((groups, alert) => {
    const date = new Date(alert.timestamp).toLocaleDateString()
    if (!groups[date]) {
      groups[date] = []
    }
    groups[date].push(alert)
    return groups
  }, {} as Record<string, Alert[]>)

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
          <h1 className="text-2xl font-bold text-dark-100">Alerts</h1>
          <p className="text-dark-400 mt-1">
            {unreadCount > 0
              ? `${unreadCount} unread alert${unreadCount !== 1 ? 's' : ''}`
              : 'All caught up!'}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {unreadCount > 0 && (
            <button onClick={handleMarkAllRead} className="btn-secondary">
              <Check className="w-4 h-4" />
              Mark All Read
            </button>
          )}
          {alerts.length > 0 && (
            <button onClick={clearAll} className="btn-danger">
              <Trash2 className="w-4 h-4" />
              Clear All
            </button>
          )}
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4">
        <StatCard
          icon={Bell}
          label="Total Alerts"
          value={alerts.length}
          color="text-primary-400"
        />
        <StatCard
          icon={BellOff}
          label="Unread"
          value={unreadCount}
          color="text-yellow-400"
        />
        <StatCard
          icon={AlertTriangle}
          label="Warnings"
          value={alerts.filter(a => a.severity === 'warning').length}
          color="text-yellow-400"
        />
        <StatCard
          icon={AlertCircle}
          label="Critical"
          value={alerts.filter(a => a.severity === 'critical').length}
          color="text-red-400"
        />
      </div>

      {/* Alerts List */}
      {alerts.length === 0 ? (
        <div className="card text-center py-16">
          <Bell className="w-16 h-16 text-dark-600 mx-auto mb-4" />
          <h3 className="text-xl font-medium text-dark-300 mb-2">
            No Alerts
          </h3>
          <p className="text-dark-500">
            You're all caught up! New security alerts will appear here.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {Object.entries(groupedAlerts).map(([date, dateAlerts]) => (
            <div key={date}>
              <h3 className="text-sm font-medium text-dark-500 mb-3">{date}</h3>
              <div className="space-y-3">
                {dateAlerts.map((alert) => (
                  <AlertCard
                    key={alert.id}
                    alert={alert}
                    onMarkRead={() => markRead(alert.id)}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </motion.div>
  )
}

function AlertCard({
  alert,
  onMarkRead
}: {
  alert: Alert
  onMarkRead: () => void
}) {
  const severity = severityColors[alert.severity] || severityColors.info
  const TypeIcon = alertTypeIcons[alert.type] || alertTypeIcons.default

  return (
    <motion.div
      whileHover={{ scale: 1.01 }}
      className={`card border ${severity.border} ${
        alert.read ? 'opacity-60' : ''
      }`}
    >
      <div className="flex items-start gap-4">
        {/* Icon */}
        <div className={`p-3 rounded-xl ${severity.bg}`}>
          <TypeIcon className={`w-5 h-5 ${severity.text}`} />
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <h4 className="font-medium text-dark-100">{alert.title}</h4>
            <span
              className={`px-2 py-0.5 text-xs rounded-full ${severity.bg} ${severity.text}`}
            >
              {alert.severity}
            </span>
            {!alert.read && (
              <span className="w-2 h-2 rounded-full bg-primary-500" />
            )}
          </div>
          <p className="text-sm text-dark-400">{alert.message}</p>
          <p className="text-xs text-dark-500 mt-2">
            {new Date(alert.timestamp).toLocaleString()}
          </p>
        </div>

        {/* Actions */}
        {!alert.read && (
          <button
            onClick={onMarkRead}
            className="p-2 hover:bg-dark-700 rounded-lg transition-colors"
            title="Mark as read"
          >
            <Check className="w-4 h-4 text-dark-400" />
          </button>
        )}
      </div>
    </motion.div>
  )
}

function StatCard({
  icon: Icon,
  label,
  value,
  color
}: {
  icon: any
  label: string
  value: number
  color: string
}) {
  return (
    <div className="stat-card">
      <div className="flex items-center gap-3">
        <Icon className={`w-5 h-5 ${color}`} />
        <div>
          <p className="text-sm text-dark-400">{label}</p>
          <p className={`text-2xl font-bold ${color}`}>{value}</p>
        </div>
      </div>
    </div>
  )
}
