import { create } from 'zustand'

interface ThemeState {
  theme: 'dark' | 'light' | 'system'
  accentColor: string
  setTheme: (theme: 'dark' | 'light' | 'system') => void
  setAccentColor: (color: string) => void
  initializeTheme: () => Promise<void>
}

export const useThemeStore = create<ThemeState>((set) => ({
  theme: 'dark',
  accentColor: '#0ea5e9',

  setTheme: (theme) => {
    set({ theme })
    applyTheme(theme)
  },

  setAccentColor: (accentColor) => {
    set({ accentColor })
    applyAccentColor(accentColor)
  },

  initializeTheme: async () => {
    try {
      const settings = await window.electron?.getSettings()
      if (settings) {
        const theme = settings.theme || 'dark'
        const accentColor = settings.accentColor || '#0ea5e9'
        set({ theme, accentColor })
        applyTheme(theme)
        applyAccentColor(accentColor)
      }
    } catch (error) {
      console.error('Failed to load theme settings:', error)
    }
  }
}))

function applyTheme(theme: 'dark' | 'light' | 'system') {
  const root = document.documentElement

  if (theme === 'system') {
    const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches
    root.classList.toggle('dark', isDark)
    root.classList.toggle('light', !isDark)
  } else if (theme === 'light') {
    root.classList.remove('dark')
    root.classList.add('light')
  } else {
    root.classList.add('dark')
    root.classList.remove('light')
  }
}

function applyAccentColor(color: string) {
  const root = document.documentElement
  root.style.setProperty('--accent-color', color)

  // Generate lighter/darker variants
  const rgb = hexToRgb(color)
  if (rgb) {
    root.style.setProperty('--accent-color-rgb', `${rgb.r}, ${rgb.g}, ${rgb.b}`)
  }
}

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
  return result
    ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16),
      }
    : null
}
