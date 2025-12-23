import { Routes, Route, useLocation } from 'react-router-dom'
import { useEffect } from 'react'
import { AnimatePresence } from 'framer-motion'
import Sidebar from './components/Sidebar/Sidebar'
import TitleBar from './components/TitleBar/TitleBar'
import Dashboard from './pages/Dashboard'
import Connections from './pages/Connections'
import Firewall from './pages/Firewall'
import Network from './pages/Network'
import Alerts from './pages/Alerts'
import History from './pages/History'
import Settings from './pages/Settings'
import MiniGraph from './pages/MiniGraph'
import { useNetworkStore } from './store/networkStore'
import { useAlertStore } from './store/alertStore'
import { useThemeStore } from './store/themeStore'

function App() {
  const location = useLocation()
  const isMiniMode = location.pathname === '/mini'
  const { startPolling, stopPolling } = useNetworkStore()
  const { addAlert } = useAlertStore()
  const { initializeTheme } = useThemeStore()

  useEffect(() => {
    // Initialize theme from settings
    initializeTheme()

    // Start network data polling
    startPolling()

    // Listen for navigation events from main process
    window.electron?.onNavigate((path: string) => {
      window.location.hash = path
    })

    // Listen for new alerts
    window.electron?.onAlert((alert) => {
      addAlert(alert)
    })

    return () => {
      stopPolling()
      window.electron?.removeAllListeners('navigate')
      window.electron?.removeAllListeners('new-alert')
    }
  }, [startPolling, stopPolling, addAlert])

  if (isMiniMode) {
    return <MiniGraph />
  }

  return (
    <div className="flex flex-col h-screen">
      <TitleBar />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar />
        <main className="flex-1 overflow-auto p-6 bg-dark-900">
          <AnimatePresence mode="wait">
            <Routes location={location} key={location.pathname}>
              <Route path="/" element={<Dashboard />} />
              <Route path="/connections" element={<Connections />} />
              <Route path="/firewall" element={<Firewall />} />
              <Route path="/network" element={<Network />} />
              <Route path="/alerts" element={<Alerts />} />
              <Route path="/history" element={<History />} />
              <Route path="/settings" element={<Settings />} />
            </Routes>
          </AnimatePresence>
        </main>
      </div>
    </div>
  )
}

export default App
