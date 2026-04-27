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
    const lines = [
      '',
      '',
      'Always use `rg` instead of `grep`.',
      '',
      'When using `rg`, keep the following rules in mind. In `rg` patterns, the pipe character `|` is an alternation (OR) operator. Do NOT escape it with a backslash. For example, write `rg "foo|bar" file.ts`, not `rg "foo\\|bar" file.ts`. The latter searches for the literal string "foo|bar" and will not match either "foo" or "bar".',
      '',
      'Examples:',
      '1. To find either `isStreaming` or `agent_end`, use `rg "isStreaming|agent_end" file.js`.',
      "2. To match a literal backslash-pipe (`\\|`), use a character class: `rg '[\\|]' file.js`.",
    ]
    return { systemPrompt: event.systemPrompt + lines.join('\n') }
  })
}
