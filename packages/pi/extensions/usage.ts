import { Usage } from '@mariozechner/pi-ai'
import type { ExtensionAPI } from '@mariozechner/pi-coding-agent'
import { Text } from '@mariozechner/pi-tui'

const CUSTOM_TYPE = 'usage'

export default function (pi: ExtensionAPI) {
  pi.registerMessageRenderer(CUSTOM_TYPE, (message, _options, theme) => {
    const u = message.details as Usage

    let text = theme.fg('dim', '📊')
    text += theme.fg('muted', ` ${u.input}↑ ${u.output}↓`)
    if (u.cacheRead) text += theme.fg('accent', `  📖${u.cacheRead}`)
    if (u.cacheWrite) text += theme.fg('warning', `  📝${u.cacheWrite}`)
    text += theme.fg('dim', `  Σ${u.totalTokens}`)

    return new Text(text, 0, 0)
  })

  pi.on('context', async event => {
    const filtered = event.messages.filter(m => {
      if ('customType' in m && m.customType === CUSTOM_TYPE) return false
      return true
    })
    return { messages: filtered }
  })

  pi.on('turn_end', event => {
    const msg = event.message
    if (msg.role === 'assistant' && msg.usage) {
      pi.sendMessage({
        customType: CUSTOM_TYPE,
        content: '',
        display: true,
        details: msg.usage,
      })
    }
  })
}
