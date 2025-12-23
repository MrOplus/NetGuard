import { spawn } from 'child_process'

export interface PowerShellResult {
  success: boolean
  output: string
  error?: string
}

export async function executePowerShell(command: string): Promise<PowerShellResult> {
  return new Promise((resolve) => {
    const ps = spawn('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy', 'Bypass',
      '-Command', command
    ])

    let stdout = ''
    let stderr = ''

    ps.stdout.on('data', (data) => {
      stdout += data.toString()
    })

    ps.stderr.on('data', (data) => {
      stderr += data.toString()
    })

    ps.on('close', (code) => {
      resolve({
        success: code === 0,
        output: stdout.trim(),
        error: stderr.trim() || undefined
      })
    })

    ps.on('error', (error) => {
      resolve({
        success: false,
        output: '',
        error: error.message
      })
    })
  })
}

export async function executePowerShellJSON<T>(command: string): Promise<T | null> {
  const result = await executePowerShell(`${command} | ConvertTo-Json -Depth 10`)
  if (!result.success || !result.output) {
    console.error('PowerShell error:', result.error)
    return null
  }

  try {
    return JSON.parse(result.output) as T
  } catch (error) {
    console.error('Failed to parse PowerShell JSON output:', error)
    return null
  }
}

export function parseNetstatOutput(output: string): any[] {
  const lines = output.split('\n').filter(line => line.trim())
  const connections: any[] = []

  for (const line of lines) {
    const parts = line.trim().split(/\s+/)
    if (parts.length >= 4 && (parts[0] === 'TCP' || parts[0] === 'UDP')) {
      const [protocol, localAddress, foreignAddress, state] = parts
      const [localIP, localPort] = localAddress.split(':')
      const [remoteIP, remotePort] = foreignAddress.split(':')

      connections.push({
        protocol,
        localAddress: localIP,
        localPort: parseInt(localPort) || 0,
        remoteAddress: remoteIP,
        remotePort: parseInt(remotePort) || 0,
        state: state || 'UNKNOWN'
      })
    }
  }

  return connections
}
