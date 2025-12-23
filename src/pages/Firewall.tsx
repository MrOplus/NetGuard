import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import {
  Shield,
  ShieldOff,
  Plus,
  Search,
  Filter,
  Lock,
  Unlock,
  Trash2,
  FileText,
  ArrowDownCircle,
  ArrowUpCircle
} from 'lucide-react'

interface FirewallRule {
  name: string
  displayName: string
  enabled: boolean
  direction: 'Inbound' | 'Outbound'
  action: 'Allow' | 'Block'
  program?: string
  profile: string
}

export default function Firewall() {
  const [rules, setRules] = useState<FirewallRule[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [filterDirection, setFilterDirection] = useState<'all' | 'Inbound' | 'Outbound'>('all')
  const [filterAction, setFilterAction] = useState<'all' | 'Allow' | 'Block'>('all')

  useEffect(() => {
    loadRules()
  }, [])

  const loadRules = async () => {
    setLoading(true)
    try {
      const fetchedRules = await window.electron?.getFirewallRules() || []
      setRules(fetchedRules)
    } catch (error) {
      console.error('Failed to load firewall rules:', error)
    } finally {
      setLoading(false)
    }
  }

  const toggleRule = async (ruleName: string, enabled: boolean) => {
    try {
      await window.electron?.toggleFirewallRule(ruleName, enabled)
      setRules(rules.map(r =>
        r.name === ruleName ? { ...r, enabled } : r
      ))
    } catch (error) {
      console.error('Failed to toggle rule:', error)
    }
  }

  const deleteRule = async (ruleName: string) => {
    if (!confirm('Are you sure you want to delete this rule?')) return
    try {
      await window.electron?.removeFirewallRule(ruleName)
      setRules(rules.filter(r => r.name !== ruleName))
    } catch (error) {
      console.error('Failed to delete rule:', error)
    }
  }

  const blockApp = async () => {
    const appPath = await window.electron?.selectApp()
    if (appPath) {
      try {
        await window.electron?.blockApp(appPath)
        loadRules()
      } catch (error) {
        console.error('Failed to block app:', error)
      }
    }
  }

  const filteredRules = rules.filter(rule => {
    const matchesSearch =
      rule.displayName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      rule.program?.toLowerCase().includes(searchQuery.toLowerCase())
    const matchesDirection = filterDirection === 'all' || rule.direction === filterDirection
    const matchesAction = filterAction === 'all' || rule.action === filterAction
    return matchesSearch && matchesDirection && matchesAction
  })

  const stats = {
    total: rules.length,
    enabled: rules.filter(r => r.enabled).length,
    blocked: rules.filter(r => r.action === 'Block').length,
    allowed: rules.filter(r => r.action === 'Allow').length
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
          <h1 className="text-2xl font-bold text-dark-100">Firewall</h1>
          <p className="text-dark-400 mt-1">Manage Windows Firewall rules</p>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={blockApp} className="btn-secondary">
            <Lock className="w-4 h-4" />
            Block App
          </button>
          <button onClick={() => console.log('Add rule not implemented')} className="btn-primary">
            <Plus className="w-4 h-4" />
            Add Rule
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4">
        <StatCard
          icon={Shield}
          label="Total Rules"
          value={stats.total}
          color="text-primary-400"
        />
        <StatCard
          icon={ShieldOff}
          label="Enabled"
          value={stats.enabled}
          color="text-green-400"
        />
        <StatCard
          icon={Lock}
          label="Blocked"
          value={stats.blocked}
          color="text-red-400"
        />
        <StatCard
          icon={Unlock}
          label="Allowed"
          value={stats.allowed}
          color="text-cyan-400"
        />
      </div>

      {/* Filters */}
      <div className="card">
        <div className="flex items-center gap-4">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-dark-500" />
            <input
              type="text"
              placeholder="Search rules..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="input pl-10"
            />
          </div>
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-dark-500" />
            <select
              value={filterDirection}
              onChange={(e) => setFilterDirection(e.target.value as any)}
              className="input w-auto"
            >
              <option value="all">All Directions</option>
              <option value="Inbound">Inbound</option>
              <option value="Outbound">Outbound</option>
            </select>
            <select
              value={filterAction}
              onChange={(e) => setFilterAction(e.target.value as any)}
              className="input w-auto"
            >
              <option value="all">All Actions</option>
              <option value="Allow">Allow</option>
              <option value="Block">Block</option>
            </select>
          </div>
        </div>
      </div>

      {/* Rules List */}
      <div className="card">
        {loading ? (
          <div className="text-center py-12 text-dark-500">
            Loading firewall rules...
          </div>
        ) : filteredRules.length === 0 ? (
          <div className="text-center py-12 text-dark-500">
            No firewall rules found
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="text-left text-sm text-dark-400 border-b border-dark-700">
                  <th className="pb-3 font-medium">Rule Name</th>
                  <th className="pb-3 font-medium">Direction</th>
                  <th className="pb-3 font-medium">Action</th>
                  <th className="pb-3 font-medium">Program</th>
                  <th className="pb-3 font-medium">Status</th>
                  <th className="pb-3 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredRules.map((rule, index) => (
                  <tr key={`${rule.name}-${index}`} className="table-row">
                    <td className="py-3">
                      <div className="flex items-center gap-2">
                        <FileText className="w-4 h-4 text-dark-500" />
                        <span className="text-dark-100 truncate max-w-xs">
                          {rule.displayName}
                        </span>
                      </div>
                    </td>
                    <td className="py-3">
                      <span className="flex items-center gap-1 text-sm">
                        {rule.direction === 'Inbound' ? (
                          <ArrowDownCircle className="w-4 h-4 text-blue-400" />
                        ) : (
                          <ArrowUpCircle className="w-4 h-4 text-green-400" />
                        )}
                        {rule.direction}
                      </span>
                    </td>
                    <td className="py-3">
                      <span
                        className={`badge ${
                          rule.action === 'Block' ? 'badge-danger' : 'badge-success'
                        }`}
                      >
                        {rule.action}
                      </span>
                    </td>
                    <td className="py-3">
                      <span className="text-sm text-dark-400 truncate block max-w-xs">
                        {rule.program || 'Any'}
                      </span>
                    </td>
                    <td className="py-3">
                      <button
                        onClick={() => toggleRule(rule.name, !rule.enabled)}
                        className={`relative w-10 h-5 rounded-full transition-colors ${
                          rule.enabled ? 'bg-green-500' : 'bg-dark-600'
                        }`}
                      >
                        <span
                          className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
                            rule.enabled ? 'translate-x-5' : ''
                          }`}
                        />
                      </button>
                    </td>
                    <td className="py-3 text-right">
                      <button
                        onClick={() => deleteRule(rule.name)}
                        className="p-2 hover:bg-red-500/20 rounded-lg transition-colors"
                      >
                        <Trash2 className="w-4 h-4 text-red-400" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
