import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import {
  Settings as SettingsIcon,
  Moon,
  Sun,
  Bell,
  Shield,
  Database,
  Palette,
  Monitor,
  Save,
  Network
} from 'lucide-react'
import { useThemeStore } from '../store/themeStore'

interface Settings {
  theme: 'dark' | 'light' | 'system'
  accentColor: string
  minimizeToTray: boolean
  startWithWindows: boolean
  showMiniGraph: boolean
  askToConnect: boolean
  lockdownMode: boolean
  retentionDays: number
  alertSounds: boolean
  notifyNewDevice: boolean
  notifyNewApp: boolean
  notifyEvilTwin: boolean
  notifyRDP: boolean
  hideLocalTraffic: boolean
}

const accentColors = [
  { name: 'Sky', value: '#0ea5e9' },
  { name: 'Cyan', value: '#06b6d4' },
  { name: 'Emerald', value: '#10b981' },
  { name: 'Violet', value: '#8b5cf6' },
  { name: 'Pink', value: '#ec4899' },
  { name: 'Orange', value: '#f97316' }
]

export default function Settings() {
  const { setTheme, setAccentColor } = useThemeStore()
  const [settings, setSettings] = useState<Settings>({
    theme: 'dark',
    accentColor: '#0ea5e9',
    minimizeToTray: true,
    startWithWindows: false,
    showMiniGraph: false,
    askToConnect: false,
    lockdownMode: false,
    retentionDays: 30,
    alertSounds: true,
    notifyNewDevice: true,
    notifyNewApp: true,
    notifyEvilTwin: true,
    notifyRDP: true,
    hideLocalTraffic: true
  })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [hasChanges, setHasChanges] = useState(false)

  useEffect(() => {
    loadSettings()
  }, [])

  const loadSettings = async () => {
    try {
      const savedSettings = await window.electron?.getSettings()
      if (savedSettings) {
        setSettings({ ...settings, ...savedSettings })
      }
    } catch (error) {
      console.error('Failed to load settings:', error)
    } finally {
      setLoading(false)
    }
  }

  const updateSetting = async <K extends keyof Settings>(key: K, value: Settings[K]) => {
    const newSettings = { ...settings, [key]: value }
    setSettings(newSettings)
    setHasChanges(true)

    // Apply theme changes immediately
    if (key === 'theme') {
      setTheme(value as 'dark' | 'light' | 'system')
    } else if (key === 'accentColor') {
      setAccentColor(value as string)
    }

    // Auto-save startWithWindows immediately
    if (key === 'startWithWindows') {
      try {
        await window.electron?.saveSettings(newSettings)
        setHasChanges(false)
      } catch (error) {
        console.error('Failed to update Start with Windows:', error)
      }
    }
  }

  const saveSettings = async () => {
    setSaving(true)
    try {
      await window.electron?.saveSettings(settings)
      setHasChanges(false)
    } catch (error) {
      console.error('Failed to save settings:', error)
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-dark-500">Loading settings...</p>
      </div>
    )
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
          <h1 className="text-2xl font-bold text-dark-100">Settings</h1>
          <p className="text-dark-400 mt-1">Configure NetGuard preferences</p>
        </div>
        {hasChanges && (
          <button onClick={saveSettings} disabled={saving} className="btn-primary">
            <Save className="w-4 h-4" />
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
        )}
      </div>

      {/* Appearance */}
      <SettingsSection title="Appearance" icon={Palette}>
        <SettingsRow
          label="Theme"
          description="Choose your preferred color scheme"
        >
          <div className="flex gap-2">
            {(['dark', 'light', 'system'] as const).map((theme) => (
              <button
                key={theme}
                onClick={() => updateSetting('theme', theme)}
                className={`px-4 py-2 rounded-lg flex items-center gap-2 transition-all ${
                  settings.theme === theme
                    ? 'bg-primary-500 text-white'
                    : 'bg-dark-700 text-dark-400 hover:text-dark-100'
                }`}
              >
                {theme === 'dark' && <Moon className="w-4 h-4" />}
                {theme === 'light' && <Sun className="w-4 h-4" />}
                {theme === 'system' && <Monitor className="w-4 h-4" />}
                {theme.charAt(0).toUpperCase() + theme.slice(1)}
              </button>
            ))}
          </div>
        </SettingsRow>

        <SettingsRow
          label="Accent Color"
          description="Customize the app's accent color"
        >
          <div className="flex gap-2">
            {accentColors.map((color) => (
              <button
                key={color.value}
                onClick={() => updateSetting('accentColor', color.value)}
                className={`w-8 h-8 rounded-full transition-transform ${
                  settings.accentColor === color.value ? 'ring-2 ring-white ring-offset-2 ring-offset-dark-800 scale-110' : ''
                }`}
                style={{ backgroundColor: color.value }}
                title={color.name}
              />
            ))}
          </div>
        </SettingsRow>
      </SettingsSection>

      {/* General */}
      <SettingsSection title="General" icon={SettingsIcon}>
        <SettingsToggle
          label="Minimize to System Tray"
          description="Keep NetGuard running in the background when closed"
          value={settings.minimizeToTray}
          onChange={(v) => updateSetting('minimizeToTray', v)}
        />
        <SettingsToggle
          label="Start with Windows"
          description="Automatically start NetGuard when Windows boots"
          value={settings.startWithWindows}
          onChange={(v) => updateSetting('startWithWindows', v)}
        />
        <SettingsToggle
          label="Show Mini Graph"
          description="Display a small always-on-top traffic graph"
          value={settings.showMiniGraph}
          onChange={(v) => updateSetting('showMiniGraph', v)}
        />
      </SettingsSection>

      {/* Security */}
      <SettingsSection title="Security" icon={Shield}>
        <SettingsRow
          label="Ask to Connect"
          description="Prompt before allowing new applications to connect (Coming Soon)"
        >
          <button
            disabled
            className="relative w-12 h-6 rounded-full bg-dark-600 opacity-50 cursor-not-allowed"
          >
            <span className="absolute top-1 left-1 w-4 h-4 rounded-full bg-white" />
          </button>
        </SettingsRow>
        <SettingsRow
          label="Lockdown Mode"
          description="Block all new network connections until approved (Coming Soon)"
        >
          <button
            disabled
            className="relative w-12 h-6 rounded-full bg-dark-600 opacity-50 cursor-not-allowed"
          >
            <span className="absolute top-1 left-1 w-4 h-4 rounded-full bg-white" />
          </button>
        </SettingsRow>
      </SettingsSection>

      {/* Network */}
      <SettingsSection title="Network Monitoring" icon={Network}>
        <SettingsToggle
          label="Hide Local Traffic"
          description="Exclude localhost (127.0.0.1) connections from statistics and views"
          value={settings.hideLocalTraffic}
          onChange={(v) => updateSetting('hideLocalTraffic', v)}
        />
      </SettingsSection>

      {/* Notifications */}
      <SettingsSection title="Notifications" icon={Bell}>
        <SettingsToggle
          label="Alert Sounds"
          description="Play a sound when alerts are triggered"
          value={settings.alertSounds}
          onChange={(v) => updateSetting('alertSounds', v)}
        />
        <SettingsToggle
          label="New Device Alerts"
          description="Notify when a new device joins the network"
          value={settings.notifyNewDevice}
          onChange={(v) => updateSetting('notifyNewDevice', v)}
        />
        <SettingsToggle
          label="New Application Alerts"
          description="Notify when a new app connects to the network"
          value={settings.notifyNewApp}
          onChange={(v) => updateSetting('notifyNewApp', v)}
        />
        <SettingsToggle
          label="Evil Twin Detection"
          description="Alert on potential rogue WiFi access points"
          value={settings.notifyEvilTwin}
          onChange={(v) => updateSetting('notifyEvilTwin', v)}
        />
        <SettingsToggle
          label="RDP Connection Alerts"
          description="Notify on remote desktop connections"
          value={settings.notifyRDP}
          onChange={(v) => updateSetting('notifyRDP', v)}
        />
      </SettingsSection>

      {/* Data */}
      <SettingsSection title="Data & Storage" icon={Database}>
        <SettingsRow
          label="Data Retention"
          description="How long to keep historical network data"
        >
          <select
            value={settings.retentionDays}
            onChange={(e) => updateSetting('retentionDays', parseInt(e.target.value))}
            className="input w-auto"
          >
            <option value={7}>7 days</option>
            <option value={14}>14 days</option>
            <option value={30}>30 days</option>
            <option value={60}>60 days</option>
            <option value={90}>90 days</option>
            <option value={365}>1 year</option>
          </select>
        </SettingsRow>
      </SettingsSection>
    </motion.div>
  )
}

function SettingsSection({
  title,
  icon: Icon,
  children
}: {
  title: string
  icon: any
  children: React.ReactNode
}) {
  return (
    <div className="card">
      <h2 className="text-lg font-semibold text-dark-100 flex items-center gap-2 mb-4">
        <Icon className="w-5 h-5 text-primary-400" />
        {title}
      </h2>
      <div className="space-y-4">{children}</div>
    </div>
  )
}

function SettingsRow({
  label,
  description,
  children
}: {
  label: string
  description: string
  children: React.ReactNode
}) {
  return (
    <div className="flex items-center justify-between py-3 border-b border-dark-700 last:border-0">
      <div>
        <p className="text-dark-100 font-medium">{label}</p>
        <p className="text-sm text-dark-500">{description}</p>
      </div>
      {children}
    </div>
  )
}

function SettingsToggle({
  label,
  description,
  value,
  onChange
}: {
  label: string
  description: string
  value: boolean
  onChange: (value: boolean) => void
}) {
  return (
    <SettingsRow label={label} description={description}>
      <button
        onClick={() => onChange(!value)}
        className={`relative w-12 h-6 rounded-full transition-colors ${
          value ? 'bg-primary-500' : 'bg-dark-600'
        }`}
      >
        <span
          className={`absolute top-1 left-1 w-4 h-4 rounded-full bg-white transition-transform ${
            value ? 'translate-x-6' : ''
          }`}
        />
      </button>
    </SettingsRow>
  )
}
