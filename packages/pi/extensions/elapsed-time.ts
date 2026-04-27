import type { ExtensionAPI } from '@mariozechner/pi-coding-agent'
import { formatDuration } from '../src/common'

export default function (pi: ExtensionAPI) {
  let agentStartTime: number | null = null

  pi.on('agent_start', async () => {
    agentStartTime = Date.now()
  })

  pi.on('agent_end', async (_event, ctx) => {
    if (agentStartTime) {
      const elapsed = Date.now() - agentStartTime
      ctx.ui.notify(`⏳ Elapsed time: ${formatDuration(elapsed)}`, 'info')
      agentStartTime = null
    }
  })
}
