import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  RefreshCw,
  Laptop,
  Smartphone,
  Router,
  HardDrive,
  Search,
  Edit3,
  Check,
  X,
  Server,
  Loader2
} from 'lucide-react'

interface OpenPort {
  port: number
  service: string
  open: boolean
}

interface NetworkDevice {
  id: string
  macAddress: string
  ipAddress: string
  hostname: string
  vendor: string
  customName?: string
  firstSeen: string
  lastSeen: string
  isOnline: boolean
  openPorts?: OpenPort[]
}

const deviceIcons: Record<string, any> = {
  apple: Smartphone,
  samsung: Smartphone,
  xiaomi: Smartphone,
  google: Smartphone,
  dell: Laptop,
  'hewlett-packard': Laptop,
  lenovo: Laptop,
  asus: Laptop,
  intel: Laptop,
  'raspberry pi': HardDrive,
  vmware: HardDrive,
  microsoft: HardDrive,
  default: Router
}

function getDeviceIcon(vendor: string) {
  const lowerVendor = vendor.toLowerCase()
  for (const [key, icon] of Object.entries(deviceIcons)) {
    if (lowerVendor.includes(key)) return icon
  }
  return deviceIcons.default
}

export default function Network() {
  const [devices, setDevices] = useState<NetworkDevice[]>([])
  const [loading, setLoading] = useState(true)
  const [scanning, setScanning] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [editingDevice, setEditingDevice] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [selectedDevice, setSelectedDevice] = useState<NetworkDevice | null>(null)
  const [scanningPorts, setScanningPorts] = useState(false)
  const [devicePorts, setDevicePorts] = useState<OpenPort[]>([])

  useEffect(() => {
    loadDevices()
  }, [])

  const scanDevicePorts = async (device: NetworkDevice) => {
    setSelectedDevice(device)
    setScanningPorts(true)
    setDevicePorts(device.openPorts || [])

    try {
      const ports = await window.electron?.scanDevicePorts(device.ipAddress, device.macAddress) || []
      setDevicePorts(ports)
    } catch (error) {
      console.error('Failed to scan ports:', error)
    } finally {
      setScanningPorts(false)
    }
  }

  const loadDevices = async () => {
    setLoading(true)
    try {
      const fetchedDevices = await window.electron?.getDevices() || []
      setDevices(fetchedDevices)
    } catch (error) {
      console.error('Failed to load devices:', error)
    } finally {
      setLoading(false)
    }
  }

  const scanNetwork = async () => {
    setScanning(true)
    try {
      const scannedDevices = await window.electron?.scanDevices() || []
      setDevices(scannedDevices)
    } catch (error) {
      console.error('Failed to scan network:', error)
    } finally {
      setScanning(false)
    }
  }

  const updateDeviceName = async (mac: string, name: string) => {
    try {
      await window.electron?.updateDeviceName(mac, name)
      setDevices(devices.map(d =>
        d.macAddress === mac ? { ...d, customName: name } : d
      ))
      setEditingDevice(null)
    } catch (error) {
      console.error('Failed to update device name:', error)
    }
  }

  const filteredDevices = devices.filter(device => {
    const searchLower = searchQuery.toLowerCase()
    return (
      device.hostname.toLowerCase().includes(searchLower) ||
      device.ipAddress.includes(searchLower) ||
      device.macAddress.toLowerCase().includes(searchLower) ||
      device.vendor.toLowerCase().includes(searchLower) ||
      device.customName?.toLowerCase().includes(searchLower)
    )
  })

  const onlineDevices = devices.filter(d => d.isOnline)

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
          <h1 className="text-2xl font-bold text-dark-100">Network Devices</h1>
          <p className="text-dark-400 mt-1">
            {onlineDevices.length} device{onlineDevices.length !== 1 ? 's' : ''} online
          </p>
        </div>
        <button
          onClick={scanNetwork}
          disabled={scanning}
          className="btn-primary"
        >
          <RefreshCw className={`w-4 h-4 ${scanning ? 'animate-spin' : ''}`} />
          {scanning ? 'Scanning...' : 'Scan Network'}
        </button>
      </div>

      {/* Search */}
      <div className="card">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-dark-500" />
          <input
            type="text"
            placeholder="Search devices..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="input pl-10"
          />
        </div>
      </div>

      {/* Device Grid */}
      {loading ? (
        <div className="text-center py-12 text-dark-500">
          Loading devices...
        </div>
      ) : filteredDevices.length === 0 ? (
        <div className="text-center py-12 text-dark-500">
          No devices found
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-4">
          {filteredDevices.map((device) => {
            const DeviceIcon = getDeviceIcon(device.vendor)
            const isEditing = editingDevice === device.macAddress

            return (
              <motion.div
                key={device.macAddress}
                whileHover={{ scale: 1.02 }}
                onClick={() => scanDevicePorts(device)}
                className={`card relative cursor-pointer ${
                  device.isOnline ? '' : 'opacity-60'
                }`}
              >
                {/* Online Indicator */}
                <div
                  className={`absolute top-4 right-4 w-3 h-3 rounded-full ${
                    device.isOnline
                      ? 'bg-green-500 animate-pulse'
                      : 'bg-dark-600'
                  }`}
                />

                {/* Device Icon */}
                <div className="flex items-center gap-4 mb-4">
                  <div
                    className={`w-12 h-12 rounded-xl flex items-center justify-center ${
                      device.isOnline ? 'bg-primary-500/10' : 'bg-dark-700'
                    }`}
                  >
                    <DeviceIcon
                      className={`w-6 h-6 ${
                        device.isOnline ? 'text-primary-400' : 'text-dark-500'
                      }`}
                    />
                  </div>
                  <div className="flex-1 min-w-0">
                    {isEditing ? (
                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          className="input py-1 text-sm"
                          autoFocus
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              updateDeviceName(device.macAddress, editName)
                            } else if (e.key === 'Escape') {
                              setEditingDevice(null)
                            }
                          }}
                        />
                        <button
                          onClick={() => updateDeviceName(device.macAddress, editName)}
                          className="p-1 hover:bg-green-500/20 rounded"
                        >
                          <Check className="w-4 h-4 text-green-400" />
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <h3 className="font-medium text-dark-100 truncate">
                          {device.customName || device.hostname || device.vendor || 'Unknown Device'}
                        </h3>
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            setEditingDevice(device.macAddress)
                            setEditName(device.customName || device.hostname || '')
                          }}
                          className="p-1 hover:bg-dark-600 rounded text-dark-500 hover:text-dark-300"
                          title="Edit device name"
                        >
                          <Edit3 className="w-3 h-3" />
                        </button>
                      </div>
                    )}
                    <p className="text-sm text-dark-400 truncate">
                      {device.vendor || 'Unknown vendor'}
                    </p>
                  </div>
                </div>

                {/* Device Details */}
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-dark-500">IP Address</span>
                    <span className="font-mono text-dark-300">
                      {device.ipAddress}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-dark-500">MAC Address</span>
                    <span className="font-mono text-dark-300 text-xs">
                      {device.macAddress}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-dark-500">First Seen</span>
                    <span className="text-dark-300">
                      {new Date(device.firstSeen).toLocaleDateString()}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-dark-500">Last Seen</span>
                    <span className="text-dark-300">
                      {new Date(device.lastSeen).toLocaleString()}
                    </span>
                  </div>
                </div>
              </motion.div>
            )
          })}
        </div>
      )}

      {/* Device Details Modal */}
      <AnimatePresence>
        {selectedDevice && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
            onClick={() => setSelectedDevice(null)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-dark-900 rounded-xl p-6 w-full max-w-lg mx-4 border border-dark-700"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header */}
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                  {(() => {
                    const DeviceIcon = getDeviceIcon(selectedDevice.vendor)
                    return (
                      <div className="w-12 h-12 rounded-xl bg-primary-500/10 flex items-center justify-center">
                        <DeviceIcon className="w-6 h-6 text-primary-400" />
                      </div>
                    )
                  })()}
                  <div>
                    <h2 className="text-lg font-semibold text-dark-100">
                      {selectedDevice.customName || selectedDevice.hostname || selectedDevice.vendor || 'Unknown Device'}
                    </h2>
                    <p className="text-sm text-dark-400">{selectedDevice.ipAddress}</p>
                  </div>
                </div>
                <button
                  onClick={() => setSelectedDevice(null)}
                  className="p-2 hover:bg-dark-700 rounded-lg"
                >
                  <X className="w-5 h-5 text-dark-400" />
                </button>
              </div>

              {/* Device Info */}
              <div className="space-y-3 mb-6">
                <div className="flex justify-between text-sm">
                  <span className="text-dark-500">MAC Address</span>
                  <span className="font-mono text-dark-300">{selectedDevice.macAddress}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-dark-500">Vendor</span>
                  <span className="text-dark-300">{selectedDevice.vendor || 'Unknown'}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-dark-500">Status</span>
                  <span className={selectedDevice.isOnline ? 'text-green-400' : 'text-dark-500'}>
                    {selectedDevice.isOnline ? 'Online' : 'Offline'}
                  </span>
                </div>
              </div>

              {/* Open Ports */}
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <Server className="w-4 h-4 text-primary-400" />
                  <h3 className="text-sm font-medium text-dark-100">Open Ports</h3>
                  {scanningPorts && (
                    <Loader2 className="w-4 h-4 text-primary-400 animate-spin" />
                  )}
                </div>

                {scanningPorts && devicePorts.length === 0 ? (
                  <div className="text-center py-4 text-dark-500 text-sm">
                    Scanning ports...
                  </div>
                ) : devicePorts.length === 0 ? (
                  <div className="text-center py-4 text-dark-500 text-sm">
                    No open ports detected
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-2 max-h-48 overflow-y-auto">
                    {devicePorts.map((port) => (
                      <div
                        key={port.port}
                        className="flex items-center justify-between p-2 rounded-lg bg-dark-800 text-sm"
                      >
                        <span className="font-mono text-primary-400">{port.port}</span>
                        <span className="text-dark-400">{port.service}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}
