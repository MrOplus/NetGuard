import { Minus, Square, X, Shield } from 'lucide-react'

export default function TitleBar() {
  const handleMinimize = () => window.electron?.minimize()
  const handleMaximize = () => window.electron?.maximize()
  const handleClose = () => window.electron?.close()

  return (
    <div className="h-10 bg-dark-900 border-b border-dark-800 flex items-center justify-between px-4 drag-region">
      {/* App Logo and Title */}
      <div className="flex items-center gap-2 no-drag">
        <div className="w-6 h-6 rounded-lg bg-gradient-to-br from-primary-400 to-accent-cyan flex items-center justify-center">
          <Shield className="w-4 h-4 text-white" />
        </div>
        <span className="font-semibold text-dark-100">NetGuard</span>
        <span className="text-xs text-dark-500 ml-2">v1.0.0</span>
      </div>

      {/* Window Controls */}
      <div className="flex items-center gap-1 no-drag">
        <button
          onClick={handleMinimize}
          className="w-8 h-8 flex items-center justify-center rounded hover:bg-dark-700 transition-colors"
        >
          <Minus className="w-4 h-4 text-dark-400" />
        </button>
        <button
          onClick={handleMaximize}
          className="w-8 h-8 flex items-center justify-center rounded hover:bg-dark-700 transition-colors"
        >
          <Square className="w-3.5 h-3.5 text-dark-400" />
        </button>
        <button
          onClick={handleClose}
          className="w-8 h-8 flex items-center justify-center rounded hover:bg-red-500/20 transition-colors group"
        >
          <X className="w-4 h-4 text-dark-400 group-hover:text-red-400" />
        </button>
      </div>
    </div>
  )
}
