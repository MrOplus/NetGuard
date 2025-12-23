import { NavLink } from 'react-router-dom'
import {
  LayoutDashboard,
  Shield,
  Wifi,
  Bell,
  History,
  Settings,
  Activity,
  MonitorSmartphone,
  Globe
} from 'lucide-react'
import { useAlertStore } from '../../store/alertStore'
import { useNetworkStore, formatSpeed } from '../../store/networkStore'

const navItems = [
  { path: '/', icon: LayoutDashboard, label: 'Dashboard' },
  { path: '/connections', icon: Globe, label: 'Connections' },
  { path: '/firewall', icon: Shield, label: 'Firewall' },
  { path: '/network', icon: Wifi, label: 'Network' },
  { path: '/alerts', icon: Bell, label: 'Alerts' },
  { path: '/history', icon: History, label: 'History' },
  { path: '/settings', icon: Settings, label: 'Settings' }
]

export default function Sidebar() {
  const { unreadCount } = useAlertStore()
  const { realtimeStats } = useNetworkStore()

  const handleToggleMini = () => {
    window.electron?.toggleMini()
  }

  return (
    <aside className="w-64 bg-dark-850 border-r border-dark-800 flex flex-col">
      {/* Real-time Stats */}
      <div className="p-4 border-b border-dark-800">
        <div className="glass-panel p-4">
          <div className="flex items-center gap-2 mb-3">
            <Activity className="w-4 h-4 text-primary-400 animate-pulse" />
            <span className="text-sm font-medium text-dark-300">Live Traffic</span>
          </div>
          <div className="space-y-2">
            <div className="flex justify-between items-center">
              <span className="text-xs text-dark-500">Download</span>
              <span className="text-sm font-mono text-chart-download">
                {formatSpeed(realtimeStats.download)}
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-xs text-dark-500">Upload</span>
              <span className="text-sm font-mono text-chart-upload">
                {formatSpeed(realtimeStats.upload)}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-4 space-y-1 overflow-y-auto scrollbar-thin">
        {navItems.map(({ path, icon: Icon, label }) => (
          <NavLink
            key={path}
            to={path}
            className={({ isActive }) =>
              `nav-item ${isActive ? 'active' : ''}`
            }
          >
            <Icon className="w-5 h-5" />
            <span className="flex-1">{label}</span>
            {label === 'Alerts' && unreadCount > 0 && (
              <span className="px-2 py-0.5 text-xs font-medium bg-red-500 text-white rounded-full">
                {unreadCount > 99 ? '99+' : unreadCount}
              </span>
            )}
          </NavLink>
        ))}
      </nav>

      {/* Mini Graph Toggle */}
      <div className="p-4 border-t border-dark-800">
        <button
          onClick={handleToggleMini}
          className="w-full nav-item hover:bg-dark-700"
        >
          <MonitorSmartphone className="w-5 h-5" />
          <span>Mini Graph</span>
        </button>
      </div>

      {/* Status Bar */}
      <div className="p-4 border-t border-dark-800">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
          <span className="text-xs text-dark-500">Monitoring Active</span>
        </div>
      </div>
    </aside>
  )
}
