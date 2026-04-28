import { Usage } from '@mariozechner/pi-ai'
import type { ExtensionAPI } from '@mariozechner/pi-coding-agent'
import { Text } from '@mariozechner/pi-tui'

const CUSTOM_TYPE = 'usage'

type TurnUsage = Usage & { turn: number }
type UsageData = { previousUsages: TurnUsage[]; currentUsages: TurnUsage[] }

export default function (pi: ExtensionAPI) {
  let previousUsages: TurnUsage[] = []
  let currentUsages: TurnUsage[] = []

  pi.registerMessageRenderer(CUSTOM_TYPE, (message, _options, theme) => {
    const data = message.details as UsageData | undefined
    if (!data) return new Text('', 0, 0)

    let text = theme.fg('dim', '📊 Usages')

    for (const [label, items] of [
      ['Previous:', data.previousUsages],
      ['Current:', data.currentUsages],
    ] as const) {
      if (items.length === 0) continue
      text += '\n' + theme.fg('dim', label)
      for (const u of items) {
        text += '\n'
        text += theme.fg('dim', `  T${u.turn} -`)
        text += theme.fg('muted', ` input: ${u.input}`)
        text += theme.fg('muted', `, output: ${u.output}`)
        text += theme.fg('muted', `, cache read: ${u.cacheRead}`)
        text += theme.fg('muted', `, cache write: ${u.cacheWrite}`)
        text += theme.fg('muted', `, total: ${u.totalTokens}`)
      }
    }

    return new Text(text, 1, 1, s => theme.bg('customMessageBg', s))
  })

  pi.on('agent_start', () => {
    previousUsages = currentUsages
    currentUsages = []
  })

  pi.on('turn_end', event => {
    const { message } = event
    if (message.role === 'assistant' && message.usage) {
      currentUsages.push({ ...message.usage, turn: event.turnIndex })
    }
  })

  pi.on('agent_end', () => {
    pi.sendMessage({
      customType: CUSTOM_TYPE,
      content: '',
      display: true,
      details: {
        previousUsages: [...previousUsages],
        currentUsages: [...currentUsages],
      } satisfies UsageData,
    })
  })

  pi.on('context', async event => {
    const filtered = event.messages.filter(m => {
      if (m.role === 'custom' && m.customType === CUSTOM_TYPE) return false
      return true
    })
    return { messages: filtered }
  })
}
