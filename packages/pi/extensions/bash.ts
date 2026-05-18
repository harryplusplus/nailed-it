import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import Parser from 'tree-sitter'
import Bash from 'tree-sitter-bash'
import { replaceRgPipeEscape } from '../src/bash.js'

export default async function (pi: ExtensionAPI) {
  const rgPipeFixLog = new Map<string, { count: number }>()
  const parser = new Parser()
  parser.setLanguage(Bash as Parser.Language)

  // Before tool execution: auto-fix `\|` → `|` in rg arguments
  pi.on('tool_call', (event, _ctx) => {
    if (event.toolName !== 'bash') return

    const input = event.input as { command: string }
    if (!input.command) return

    try {
      const { command: fixed, count } = replaceRgPipeEscape(parser, input.command)
      if (count > 0) {
        input.command = fixed
        rgPipeFixLog.set(event.toolCallId, { count })
      }
    } catch {
      // Silently ignore parse errors — don't block the tool
    }
  })

  // After tool execution: inform the user about auto-fixes
  pi.on('tool_result', (event, _ctx) => {
    if (event.toolName !== 'bash') return

    const log = rgPipeFixLog.get(event.toolCallId)
    if (!log) return
    rgPipeFixLog.delete(event.toolCallId)

    return {
      content: [
        ...event.content,
        {
          type: 'text' as const,
          text: [
            `> ℹ️ \`\\|\`를 \`|\`로 자동 치환했습니다 (${log.count}곳).`,
            `>    rg는 Rust 정규식을 쓰는데, 여기선 \`|\`가 OR 연산자라 백슬래시가 필요 없습니다.`,
            `>    진짜 literal \`|\`를 매칭하려면 \`[|]\`를 쓰세요.`,
          ].join('\n'),
        },
      ],
    }
  })
}
