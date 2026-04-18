import { retainWithTimeout } from './client.js'
import { RETAIN_ENABLED, RUNTIME_PREFIX } from './config.js'

// ─── Message filtering ───

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

  // Only user and assistant text messages
  if (msg.role !== 'user' && msg.role !== 'assistant') return false

  // Must have text content (not just images, tool calls, thinking)
  const text = extractTextContent(msg.content)
  return text.trim().length > 0
}

// ─── Conversation formatting ───

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

// ─── Retain ───

export async function retainConversation(
  bankId: string,
  sessionId: string,
  entries: any[],
  signal?: AbortSignal,
): Promise<void> {
  if (!RETAIN_ENABLED) return

  const formatted = filterAndFormatMessages(entries)
  if (!formatted) return

  const documentId = `${RUNTIME_PREFIX}-session-${sessionId}`

  await retainWithTimeout(
    bankId,
    formatted,
    { documentId, context: 'coding session' },
    signal,
  )
}
