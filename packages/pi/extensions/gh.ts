import type { ExtensionAPI } from '@mariozechner/pi-coding-agent'

export default async function (pi: ExtensionAPI) {
  pi.on('session_start', async () => {
    try {
      await pi.exec('gh', ['--version'])
    } catch (e) {
      throw new Error(
        'The gh extension requires gh. See https://github.com/cli/cli',
        { cause: e },
      )
    }
  })

  pi.on('before_agent_start', async event => {
    return {
      systemPrompt:
        event.systemPrompt + '\n\nUse `gh` for GitHub CLI commands.',
    }
  })
}
