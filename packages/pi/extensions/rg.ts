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
      '## `rg`: `|` needs NO escape — Rust regex, opposite of grep',
      '',
      'rg uses Rust regex. `|` is the OR operator. Do NOT escape it.',
      '- `rg "foo|bar"` → matches `foo` or `bar`',
      '- `rg "foo\\|bar"` → literal `foo|bar` — you will miss both',
      '',
      'To match a literal `|`, use a character class: `rg "[|]" file.ts`.',
    ]
    return { systemPrompt: event.systemPrompt + lines.join('\n') }
  })
}
