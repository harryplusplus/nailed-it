import { Usage } from '@mariozechner/pi-ai'
import type { ExtensionAPI } from '@mariozechner/pi-coding-agent'
import { Text } from '@mariozechner/pi-tui'

const CUSTOM_TYPE = 'usage'

type TurnUsage = Usage & { turn: number }
type UsageData = { previousUsages: TurnUsage[]; currentUsages: TurnUsage[] }

export default function (pi: ExtensionAPI) {
  let previousUsages: TurnUsage[] = []
  let currentUsages: TurnUsage[] = []

  pi.registerMessageRenderer(CUSTOM_TYPE, (message, options, theme) => {
    const data = message.details as UsageData | undefined
    if (!data) return new Text('', 0, 0)

    if (options.expanded) {
      let text = theme.fg('dim', '📊 Usages\n')

      for (const [label, items] of [
        ['Previous:', data.previousUsages],
        ['Current:', data.currentUsages],
      ] as const) {
        if (items.length === 0) continue
        text += '\n' + theme.fg('dim', label)
        for (const u of items) {
          text += '\n'
          text += theme.fg(
            'muted',
            `  T${u.turn} in:${u.input} out:${u.output} cr:${u.cacheRead} cw:${u.cacheWrite} total:${u.totalTokens}`,
          )
        }
      }

      return new Text(text, 1, 1, s => theme.bg('customMessageBg', s))
    }

    const sum = data.currentUsages.reduce(
      (acc, u) => ({
        input: acc.input + u.input,
        output: acc.output + u.output,
        cacheRead: acc.cacheRead + u.cacheRead,
        cacheWrite: acc.cacheWrite + u.cacheWrite,
        totalTokens: acc.totalTokens + u.totalTokens,
      }),
      { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 },
    )

    let text = theme.fg('dim', '📊 Usages')

    const allUsages = [...data.previousUsages, ...data.currentUsages]

    let cacheReadDecreased = false
    for (let i = 1; i < allUsages.length; i++) {
      if (allUsages[i]!.cacheRead < allUsages[i - 1]!.cacheRead) {
        cacheReadDecreased = true
        break
      }
    }

    if (cacheReadDecreased) {
      text += ' ' + theme.fg('warning', theme.bold('⚠️ Cache read shrunk'))
    }

    if (data.currentUsages.length > 0) {
      const parts = [
        `${data.currentUsages.length}t`,
        `in:${sum.input}`,
        `out:${sum.output}`,
        `cr:${sum.cacheRead}`,
        `cw:${sum.cacheWrite}`,
        `total:${sum.totalTokens}`,
      ]
      text += ' ' + theme.fg('muted', parts.join(' '))
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
