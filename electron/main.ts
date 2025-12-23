import { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, shell, dialog, Notification } from 'electron'
import { join } from 'path'
import { spawn, ChildProcess } from 'child_process'
import { existsSync } from 'fs'
import { Database } from './services/Database'
import { AlertManager } from './services/AlertManager'

let mainWindow: BrowserWindow | null = null
let miniWindow: BrowserWindow | null = null
let tray: Tray | null = null
let backendProcess: ChildProcess | null = null
let database: Database
let alertManager: AlertManager
let alertPollInterval: NodeJS.Timeout | null = null
let lastAlertCount = 0

// GeoIP cache to avoid excessive API calls
const geoCache: Map<string, { country: string; city: string; lat: number; lon: number } | null> = new Map()
const geoCacheExpiry: Map<string, number> = new Map()
const GEO_CACHE_TTL = 3600000 // 1 hour

const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged
const BACKEND_PORT = 8899
const BACKEND_URL = `http://127.0.0.1:${BACKEND_PORT}`
const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173'

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    frame: false,
    transparent: false,
    backgroundColor: '#0f172a',
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false
    },
    icon: join(__dirname, '../public/icon.png'),
    show: false
  })

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show()
  })

  if (isDev) {
    mainWindow.loadURL(VITE_DEV_SERVER_URL)
    // DevTools disabled - uncomment below line to enable for debugging
    // mainWindow.webContents.openDevTools()
  } else {
    mainWindow.loadFile(join(__dirname, '../dist/index.html'))
  }

  mainWindow.on('close', (event) => {
    if (!app.isQuitting) {
      event.preventDefault()
      mainWindow?.hide()
    }
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

function createMiniWindow() {
  miniWindow = new BrowserWindow({
    width: 300,
    height: 100,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    }
  })

  if (isDev) {
    miniWindow.loadURL(`${VITE_DEV_SERVER_URL}/#/mini`)
  } else {
    miniWindow.loadFile(join(__dirname, '../dist/index.html'), { hash: '/mini' })
  }

  miniWindow.on('closed', () => {
    miniWindow = null
  })
}

function createTray() {
  const iconPath = join(__dirname, '../public/icon.svg')
  let icon: Electron.NativeImage

  try {
    icon = nativeImage.createFromPath(iconPath)
    if (icon.isEmpty()) {
      icon = nativeImage.createEmpty()
    }
  } catch {
    icon = nativeImage.createEmpty()
  }

  tray = new Tray(icon.resize({ width: 16, height: 16 }))

  const contextMenu = Menu.buildFromTemplate([
    { label: 'Open NetGuard', click: () => mainWindow?.show() },
    { label: 'Mini Graph', click: () => toggleMiniWindow() },
    { type: 'separator' },
    { label: 'Quit', click: () => { app.isQuitting = true; app.quit() }}
  ])

  tray.setToolTip('NetGuard - Network Monitor')
  tray.setContextMenu(contextMenu)

  tray.on('click', () => {
    mainWindow?.show()
  })
}

function toggleMiniWindow() {
  if (miniWindow) {
    miniWindow.close()
    miniWindow = null
  } else {
    createMiniWindow()
  }
}

async function startElevatedBackend(backendPath: string): Promise<boolean> {
  console.log('Starting backend with elevation...')

  return new Promise((resolve) => {
    // Kill any existing backend process first
    spawn('taskkill', ['/F', '/IM', 'netguard-backend.exe'], { stdio: 'ignore' })

    // Use shell execute with runas to trigger UAC
    setTimeout(() => {
      const { exec } = require('child_process')

      // Use PowerShell Start-Process which properly triggers UAC, run hidden
      exec(
        `powershell -Command "Start-Process -FilePath '${backendPath}' -Verb RunAs -WindowStyle Hidden"`,
        (error: any) => {
          if (error) {
            console.error('Failed to start elevated backend:', error)
          }
        }
      )

      // Wait for backend to be ready after elevation
      const checkElevatedBackend = async () => {
        for (let i = 0; i < 50; i++) {
          try {
            const response = await fetch(`${BACKEND_URL}/health`)
            if (response.ok) {
              console.log('Elevated backend started successfully')
              resolve(true)
              return
            }
          } catch {
            // Not ready yet
          }
          await new Promise(r => setTimeout(r, 200))
        }
        console.log('Elevated backend startup timeout')
        resolve(false)
      }

      // Give UAC prompt time to appear and user to respond
      setTimeout(checkElevatedBackend, 2000)
    }, 500)
  })
}

async function startGoBackend(): Promise<boolean> {
  const backendPath = join(__dirname, '../backend/netguard-backend.exe')

  if (!existsSync(backendPath)) {
    console.log('Go backend not found at:', backendPath)
    return false
  }

  // Check if backend is already running
  try {
    const response = await fetch(`${BACKEND_URL}/health`)
    if (response.ok) {
      console.log('Go backend already running - killing to ensure fresh version')
      // Kill existing backend to ensure we use the latest version
      try {
        await fetch(`${BACKEND_URL}/shutdown`, { method: 'POST' })
        // Wait for it to die
        await new Promise(resolve => setTimeout(resolve, 1000))
      } catch {
        // Shutdown endpoint might not exist or backend already died
      }
    }
  } catch {
    // Not running, start it
  }

  console.log('Starting Go backend with admin privileges...')

  // Always use elevated start since the backend has admin manifest
  return startElevatedBackend(backendPath)
}

async function startGoBackendOld(): Promise<boolean> {
  const backendPath = join(__dirname, '../backend/netguard-backend.exe')

  if (!existsSync(backendPath)) {
    console.log('Go backend not found at:', backendPath)
    return false
  }

  return new Promise((resolve) => {
    try {
      // First try to start without elevation (for when app is already elevated)
      backendProcess = spawn(backendPath, [], {
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: false,
        windowsHide: true
      })

      let startupFailed = false

      backendProcess.stdout?.on('data', (data) => {
        console.log('Backend:', data.toString().trim())
      })

      backendProcess.stderr?.on('data', (data) => {
        console.error('Backend error:', data.toString().trim())
      })

      backendProcess.on('error', (error) => {
        console.error('Failed to start backend:', error)
        startupFailed = true
        // Try with elevation using PowerShell
        startElevatedBackend(backendPath).then(resolve)
      })

      // Wait for backend to be ready
      const checkBackend = async () => {
        for (let i = 0; i < 30; i++) {
          if (startupFailed) return
          try {
            const response = await fetch(`${BACKEND_URL}/health`)
            if (response.ok) {
              console.log('Go backend started successfully')
              resolve(true)
              return
            }
          } catch {
            // Not ready yet
          }
          await new Promise(r => setTimeout(r, 100))
        }
        if (!startupFailed) {
          console.log('Backend startup timeout, trying elevated...')
          startElevatedBackend(backendPath).then(resolve)
        }
      }

      checkBackend()
    } catch (error) {
      console.error('Failed to spawn backend:', error)
      resolve(false)
    }
  })
}

async function fetchFromBackend(endpoint: string): Promise<any> {
  try {
    const response = await fetch(`${BACKEND_URL}${endpoint}`)
    const data = await response.json()
    return data.success ? data.data : null
  } catch {
    return null
  }
}

async function postToBackend(endpoint: string, body: any): Promise<boolean> {
  try {
    const response = await fetch(`${BACKEND_URL}${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })
    const data = await response.json()
    return data.success
  } catch {
    return false
  }
}

async function initializeServices() {
  try {
    // Initialize database first
    try {
      database = new Database()
      await database.initialize()
      console.log('Database initialized')
    } catch (dbError) {
      console.error('Database initialization failed:', dbError)
      // Continue without database - some features won't work
    }

    // Initialize alert manager
    try {
      alertManager = new AlertManager(mainWindow)
    } catch (alertError) {
      console.error('Alert manager initialization failed:', alertError)
    }

    // Try to start Go backend
    try {
      const backendStarted = await startGoBackend()
      if (!backendStarted) {
        console.log('Running without Go backend - some features may be limited')
      } else {
        // Start polling for alerts
        startAlertPolling()
        console.log('Go backend started and alert polling enabled')
      }
    } catch (backendError) {
      console.error('Backend startup failed:', backendError)
    }

    console.log('Services initialization complete')
  } catch (error) {
    console.error('Failed to initialize services:', error)
  }
}

function startAlertPolling() {
  // Poll for new alerts every 3 seconds
  alertPollInterval = setInterval(async () => {
    try {
      const response = await fetch(`${BACKEND_URL}/api/alerts/recent`)
      const data = await response.json()

      if (data.success && Array.isArray(data.data)) {
        const alerts = data.data
        // Check for new alerts
        if (alerts.length > lastAlertCount) {
          // Get the new alerts (ones we haven't seen yet)
          const newAlerts = alerts.slice(lastAlertCount)
          for (const alert of newAlerts) {
            handleAlert(alert)
          }
        }
        lastAlertCount = alerts.length
      }
    } catch {
      // Backend not available, skip
    }
  }, 3000)

  console.log('Alert polling started')
}

function handleAlert(alert: { type: string; title: string; message: string; data?: any }) {
  console.log('Alert received:', alert.title)

  // Show system notification
  if (Notification.isSupported()) {
    const notification = new Notification({
      title: alert.title,
      body: alert.message,
      icon: join(__dirname, '../public/icon.png'),
      silent: false
    })

    notification.on('click', () => {
      mainWindow?.show()
      mainWindow?.focus()
    })

    notification.show()
  }

  // Send to renderer for in-app display
  if (mainWindow) {
    mainWindow.webContents.send('new-alert', alert)
  }

  // Store in database
  if (database) {
    database.addAlert({
      type: alert.type,
      title: alert.title,
      message: alert.message,
      severity: 'info'
    })
  }
}

function setupIPC() {
  // Window controls
  ipcMain.on('window:minimize', () => mainWindow?.minimize())
  ipcMain.on('window:maximize', () => {
    if (mainWindow?.isMaximized()) {
      mainWindow.unmaximize()
    } else {
      mainWindow?.maximize()
    }
  })
  ipcMain.on('window:close', () => mainWindow?.hide())
  ipcMain.on('window:toggle-mini', () => toggleMiniWindow())

  // Network data from Go backend
  ipcMain.handle('network:get-connections', async () => {
    const settings = database?.getSettingsSync() || {}
    const hideLocal = settings.hideLocalTraffic !== false // Default to true
    const connections = await fetchFromBackend(`/api/connections?hideLocal=${hideLocal}`) || []

    // Enrich connections with geo data (use cache, don't block)
    for (const conn of connections) {
      const ip = conn.remoteAddress
      if (ip && !ip.startsWith('127.') && !ip.startsWith('0.') && !ip.startsWith('192.168.') && !ip.startsWith('10.')) {
        const cached = geoCache.get(ip)
        if (cached) {
          conn.country = cached.country
          conn.city = cached.city
          conn.lat = cached.lat
          conn.lon = cached.lon
        }
      }
    }

    return connections
  })

  ipcMain.handle('network:get-traffic-history', async (_, timeRange: string) => {
    return await database?.getTrafficHistory(timeRange) || []
  })

  ipcMain.handle('network:get-app-usage', async (_, timeRange: string) => {
    // Get live connections from backend and aggregate by process
    const settings = database?.getSettingsSync() || {}
    const hideLocal = settings.hideLocalTraffic !== false // Default to true
    const connections = await fetchFromBackend(`/api/connections?hideLocal=${hideLocal}`) || []

    // Aggregate by process
    const appMap = new Map<string, { processName: string; processPath: string; bytesSent: number; bytesReceived: number; connections: number }>()

    for (const conn of connections) {
      const key = conn.processPath || conn.processName
      if (!appMap.has(key)) {
        appMap.set(key, {
          processName: conn.processName,
          processPath: conn.processPath || '',
          bytesSent: 0,
          bytesReceived: 0,
          connections: 0
        })
      }
      const app = appMap.get(key)!
      app.bytesSent += conn.bytesSent || 0
      app.bytesReceived += conn.bytesReceived || 0
      app.connections += 1
    }

    // Sort by total bytes
    return Array.from(appMap.values()).sort((a, b) =>
      (b.bytesSent + b.bytesReceived) - (a.bytesSent + a.bytesReceived)
    )
  })

  ipcMain.handle('network:get-realtime-stats', async () => {
    const traffic = await fetchFromBackend('/api/traffic')
    return traffic || { download: 0, upload: 0 }
  })

  // Firewall
  ipcMain.handle('firewall:get-rules', async () => {
    return await fetchFromBackend('/api/firewall/rules') || []
  })

  ipcMain.handle('firewall:block-app', async (_, appPath) => {
    return await postToBackend('/api/firewall/block', { appPath })
  })

  ipcMain.handle('firewall:allow-app', async (_, appPath) => {
    return await postToBackend('/api/firewall/allow', { appPath })
  })

  ipcMain.handle('connection:kill', async (_, connectionId: string) => {
    return await postToBackend('/api/connections/kill', { connectionId })
  })

  ipcMain.handle('connection:block', async (_, remoteAddress: string, remotePort: number) => {
    return await postToBackend('/api/connections/block', { remoteAddress, remotePort })
  })

  // Devices
  ipcMain.handle('devices:get-all', async () => {
    const devices = await fetchFromBackend('/api/devices')
    return devices || database?.getDevices() || []
  })

  ipcMain.handle('devices:scan', async () => {
    return await fetchFromBackend('/api/devices/scan') || []
  })

  ipcMain.handle('devices:update-name', async (_, mac, name) => {
    // Update in Go backend's database (which is the source of truth for devices)
    const backendResult = await postToBackend('/api/devices/name', { macAddress: mac, name })
    // Also update local database as fallback
    database?.updateDeviceName(mac, name)
    return backendResult
  })

  ipcMain.handle('devices:scan-ports', async (_, ip, mac) => {
    // Scan ports on a specific device
    try {
      const response = await fetch(`${BACKEND_URL}/api/devices/scan-ports`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ip, mac })
      })
      const data = await response.json()
      return data.success ? data.data : []
    } catch {
      return []
    }
  })

  // Alerts
  ipcMain.handle('alerts:get-all', async () => {
    console.log('IPC: alerts:get-all called')
    const alerts = await database?.getAlerts() || []
    console.log('IPC: returning', alerts?.length || 0, 'alerts')
    return alerts
  })

  ipcMain.handle('alerts:mark-read', async (_, id) => {
    return database?.markAlertRead(id) || false
  })

  ipcMain.handle('alerts:clear-all', async () => {
    return database?.clearAlerts() || false
  })

  // GeoIP - using free API with caching
  let geoRateLimitUntil = 0

  async function lookupGeoIP(ip: string): Promise<{ country: string; city: string; lat: number; lon: number } | null> {
    // Check cache first
    const cached = geoCache.get(ip)
    const expiry = geoCacheExpiry.get(ip)
    if (cached !== undefined && expiry && Date.now() < expiry) {
      return cached
    }

    // Skip private/local IPs
    if (ip.startsWith('10.') || ip.startsWith('192.168.') || ip.startsWith('172.') ||
        ip.startsWith('127.') || ip.startsWith('0.') || ip === '0.0.0.0') {
      geoCache.set(ip, null)
      geoCacheExpiry.set(ip, Date.now() + GEO_CACHE_TTL)
      return null
    }

    // Check if we're rate limited
    if (Date.now() < geoRateLimitUntil) {
      return null
    }

    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 5000)

      const response = await fetch(`http://ip-api.com/json/${ip}?fields=status,country,city,lat,lon`, {
        signal: controller.signal
      })
      clearTimeout(timeoutId)

      const data = await response.json()
      if (data.status === 'success') {
        const geo = { country: data.country, city: data.city, lat: data.lat, lon: data.lon }
        geoCache.set(ip, geo)
        geoCacheExpiry.set(ip, Date.now() + GEO_CACHE_TTL)
        return geo
      } else if (data.status === 'fail' && data.message === 'rate limited') {
        geoRateLimitUntil = Date.now() + 60000 // Wait 1 minute
      }
    } catch (err: any) {
      // Don't log aborted requests or connection resets
      if (err.name !== 'AbortError' && !err.message?.includes('ECONNRESET')) {
        console.error('GeoIP lookup failed for', ip)
      }
      // Cache null for short time to avoid hammering the API
      geoCache.set(ip, null)
      geoCacheExpiry.set(ip, Date.now() + 30000) // 30 seconds for errors
      return null
    }

    geoCache.set(ip, null)
    geoCacheExpiry.set(ip, Date.now() + GEO_CACHE_TTL)
    return null
  }

  ipcMain.handle('geoip:lookup', async (_, ip) => {
    return await lookupGeoIP(ip)
  })

  ipcMain.handle('geoip:get-connections-map', async () => {
    const settings = database?.getSettingsSync() || {}
    const hideLocal = settings.hideLocalTraffic !== false
    const connections = await fetchFromBackend(`/api/connections?hideLocal=${hideLocal}`) || []

    // Get unique external IPs
    const ipSet = new Set<string>()
    const ipProcessMap = new Map<string, string[]>()

    for (const conn of connections) {
      const ip = conn.remoteAddress
      if (ip && ip !== '0.0.0.0' && !ip.startsWith('127.')) {
        ipSet.add(ip)
        if (!ipProcessMap.has(ip)) {
          ipProcessMap.set(ip, [])
        }
        const processes = ipProcessMap.get(ip)!
        if (!processes.includes(conn.processName)) {
          processes.push(conn.processName)
        }
      }
    }

    // Lookup geo data for each unique IP (with rate limiting)
    const geoConnections: Array<{
      ip: string
      country: string
      city: string
      lat: number
      lon: number
      count: number
      processes: string[]
    }> = []

    const ips = Array.from(ipSet)

    // Process in batches to avoid rate limiting (ip-api allows 45 requests/minute)
    for (let i = 0; i < ips.length && i < 20; i++) {
      const ip = ips[i]

      // Check if already cached
      const cached = geoCache.get(ip)
      if (cached !== undefined) {
        if (cached && cached.lat && cached.lon) {
          const count = connections.filter((c: any) => c.remoteAddress === ip).length
          geoConnections.push({
            ip,
            country: cached.country,
            city: cached.city,
            lat: cached.lat,
            lon: cached.lon,
            count,
            processes: ipProcessMap.get(ip) || []
          })
        }
        continue
      }

      // Add small delay between uncached lookups
      if (i > 0) {
        await new Promise(r => setTimeout(r, 200))
      }

      const geo = await lookupGeoIP(ip)

      if (geo && geo.lat && geo.lon) {
        const count = connections.filter((c: any) => c.remoteAddress === ip).length
        geoConnections.push({
          ip,
          country: geo.country,
          city: geo.city,
          lat: geo.lat,
          lon: geo.lon,
          count,
          processes: ipProcessMap.get(ip) || []
        })
      }
    }

    return geoConnections
  })

  // History
  ipcMain.handle('history:get-data', async (_, startTime, endTime) => {
    return database?.getHistoryData(startTime, endTime) || { connections: [], traffic: [] }
  })

  // Settings
  ipcMain.handle('settings:get', async () => {
    return database?.getSettings() || {}
  })

  ipcMain.handle('settings:set', async (_, settings) => {
    // Apply Start with Windows setting
    if (settings.startWithWindows !== undefined) {
      app.setLoginItemSettings({
        openAtLogin: settings.startWithWindows,
        path: process.execPath,
        args: []
      })
    }
    return database?.saveSettings(settings) || false
  })

  // Clear known apps (for Ask to Connect feature)
  ipcMain.handle('known-apps:clear', async () => {
    return await postToBackend('/api/known-apps/clear', {})
  })

  // WiFi Networks
  ipcMain.handle('wifi:get-networks', async () => {
    return await fetchFromBackend('/api/wifi') || []
  })

  // RDP Sessions
  ipcMain.handle('rdp:get-sessions', async () => {
    return await fetchFromBackend('/api/rdp') || []
  })

  // File dialog
  ipcMain.handle('dialog:select-app', async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      properties: ['openFile'],
      filters: [{ name: 'Executables', extensions: ['exe'] }]
    })
    return result.filePaths[0]
  })

  // External links
  ipcMain.on('open-external', (_, url) => {
    shell.openExternal(url)
  })
}

// Traffic logging interval
let trafficLogInterval: NodeJS.Timeout | null = null

function startTrafficLogging() {
  trafficLogInterval = setInterval(async () => {
    const traffic = await fetchFromBackend('/api/traffic')
    if (traffic && database) {
      database.logTraffic(traffic.download || 0, traffic.upload || 0)
    }
  }, 60000) // Log every minute
}

app.whenReady().then(async () => {
  createMainWindow()
  createTray()
  setupIPC()
  await initializeServices()
  startTrafficLogging()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  if (trafficLogInterval) {
    clearInterval(trafficLogInterval)
  }
  if (alertPollInterval) {
    clearInterval(alertPollInterval)
  }
  if (backendProcess) {
    backendProcess.kill()
  }
  database?.close()
})

declare module 'electron' {
  interface App {
    isQuitting?: boolean
  }
}
