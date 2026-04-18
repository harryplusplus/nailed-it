import type { ExtensionAPI } from '@mariozechner/pi-coding-agent'

function formatElapsed(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60

  const parts: string[] = []
  if (hours > 0) parts.push(`${hours}h`)
  if (minutes > 0) parts.push(`${minutes}m`)
  parts.push(`${seconds}s`)

  return parts.join(' ')
}

export default function (pi: ExtensionAPI) {
  let agentStartTime: number | null = null

  pi.on('agent_start', async () => {
    agentStartTime = Date.now()
  })

  pi.on('agent_end', async (_event, ctx) => {
    if (agentStartTime) {
      const elapsed = Date.now() - agentStartTime
      ctx.ui.notify(`⏳ Elapsed time: ${formatElapsed(elapsed)}`, 'info')
      agentStartTime = null
    }
  })
}
