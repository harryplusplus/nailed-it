import type { HindsightApi } from './client.js'
import { retainMemories } from './client.js'
import { RUNTIME_PREFIX } from './config.js'

function extractTextContent(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .filter(
        (block: any) => block.type === 'text' && typeof block.text === 'string',
      )
      .map((block: any) => block.text)
      .join('\n')
  }
  return ''
}

function isMeaningfulMessage(entry: any): boolean {
  if (entry.type !== 'message') return false
  const msg = entry.message
  if (!msg) return false

  if (msg.role !== 'user' && msg.role !== 'assistant') return false

  const text = extractTextContent(msg.content)
  return text.trim().length > 0
}

function formatMessage(entry: any): string {
  const msg = entry.message
  const role = msg.role === 'user' ? 'User' : 'Assistant'
  const text = extractTextContent(msg.content)
  const ts = msg.timestamp
    ? new Date(msg.timestamp).toISOString()
    : new Date().toISOString()

  return `${role} (${ts}): ${text}`
}

export function filterAndFormatMessages(entries: any[]): string {
  const meaningful = entries.filter(isMeaningfulMessage)
  if (meaningful.length === 0) return ''

  return meaningful.map(formatMessage).join('\n')
}

export async function retainConversation(
  api: HindsightApi,
  bankId: string,
  sessionId: string,
  entries: any[],
  signal?: AbortSignal,
): Promise<void> {
  const formatted = filterAndFormatMessages(entries)
  if (!formatted) return

  const documentId = `${RUNTIME_PREFIX}-session-${sessionId}`

  await retainMemories(
    api,
    bankId,
    formatted,
    { documentId, context: 'coding session' },
    sessionId,
    signal,
  )
}
