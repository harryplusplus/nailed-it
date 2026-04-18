import type { ExtensionAPI } from '@mariozechner/pi-coding-agent'

export default async function (pi: ExtensionAPI) {
  pi.on('session_start', async () => {
    try {
      await pi.exec('fd', ['--version'])
    } catch (e) {
      throw new Error(
        'The fd extension requires fd. See https://github.com/sharkdp/fd',
        { cause: e },
      )
    }
  })
  pi.on('before_agent_start', async event => {
    return {
      systemPrompt: event.systemPrompt + '\n\nUse `fd` instead of `find`.',
    }
  })
}
