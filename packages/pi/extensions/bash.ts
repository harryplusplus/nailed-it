import type { ExtensionAPI } from '@mariozechner/pi-coding-agent'
import Parser from 'tree-sitter'
import Bash from 'tree-sitter-bash'

export default async function (pi: ExtensionAPI) {
  const parser = new Parser()
  parser.setLanguage(Bash as Parser.Language)

  pi.on('tool_result', event => {
    if (event.toolName === 'bash') {
      const { command } = event.input as { command?: string }
      if (!command) return
      try {
        const tree = parser.parse(command)
      } catch {
        // TODO: notify
      }
    }
  })
}
