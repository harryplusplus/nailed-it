import type { ExtensionAPI } from '@mariozechner/pi-coding-agent'
import type { AssistantMessage } from '@mariozechner/pi-ai'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

function escapeAppleScript(str: string): string {
  return str.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

async function notifyMacOS(
  title: string,
  body: string,
  sound?: string,
): Promise<void> {
  const soundArg = sound ? ` sound name "${escapeAppleScript(sound)}"` : ''
  const script = `display notification "${escapeAppleScript(body)}" with title "${escapeAppleScript(title)}"${soundArg}`
  await execFileAsync('osascript', ['-e', script])
}

async function notify(
  title: string,
  body: string,
  sound?: string,
): Promise<void> {
  await notifyMacOS(title, body, sound)
}

export default function (pi: ExtensionAPI) {
  pi.on('agent_end', async event => {
    const last = [...event.messages]
      .reverse()
      .find((m): m is AssistantMessage => m.role === 'assistant')
    let body = 'Ready for input'
    if (last) {
      const text = last.content
        .filter(
          (b): b is Extract<typeof b, { type: 'text' }> => b.type === 'text',
        )
        .map(b => b.text)
        .join('')
      const codepoints = [...text]
      body =
        codepoints.length > 200
          ? codepoints.slice(0, 200).join('') + '...'
          : text
    }

    await notify('Pi', body, 'Funk')
  })
}
