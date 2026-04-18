import type { ExtensionAPI } from '@mariozechner/pi-coding-agent'

export default async function (pi: ExtensionAPI) {
  pi.on('session_start', async () => {
    try {
      await pi.exec('rg', ['--version'])
    } catch (e) {
      throw new Error(
        'The rg extension requires ripgrep (rg). See https://github.com/burntsushi/ripgrep',
        { cause: e },
      )
    }
  })

  pi.on('before_agent_start', async event => {
    return {
      systemPrompt: event.systemPrompt + '\n\nUse `rg` instead of `grep`.',
    }
  })
}
