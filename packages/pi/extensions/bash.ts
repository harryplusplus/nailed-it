import type { ExtensionAPI } from '@mariozechner/pi-coding-agent'
import Parser from 'tree-sitter'
import Bash from 'tree-sitter-bash'
import { findRgPipeEscape } from '../src/bash.js'

export default async function (pi: ExtensionAPI) {
  const parser = new Parser()
  parser.setLanguage(Bash as Parser.Language)

  pi.on('tool_result', (event, ctx) => {
    if (event.toolName === 'bash') {
      const { command } = event.input as { command?: string }
      if (!command) return

      try {
        const escapes = findRgPipeEscape(parser, command)
        if (escapes.length > 0) {
          const details = escapes.map(e => `  «${e.text}»`).join('\n')
          return {
            content: [
              ...event.content,
              {
                type: 'text' as const,
                text: `> ⚠️ rg argument uses '\\|'. In Rust regex, alternation is bare '|' (no backslash).\n>    Instead of:  foo\\|bar\n>    Use:         foo|bar\n>    (To match a literal '|', write '[|]' instead.)\n${details}`,
              },
            ],
          }
        }
      } catch (err) {
        ctx.ui.notify(`rg escape check failed: ${String(err)}`, 'error')
      }
    }
  })
}
