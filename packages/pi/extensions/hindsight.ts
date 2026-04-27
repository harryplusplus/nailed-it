import type {
  AgentEndEvent,
  ExtensionAPI,
  ExtensionContext,
} from '@mariozechner/pi-coding-agent'
import { Box, Text } from '@mariozechner/pi-tui'
import {
  Budget,
  HindsightClient,
  recallResponseToPromptString,
} from '@vectorize-io/hindsight-client'
import { formatDuration } from '../src/common'

type AgentMessage = AgentEndEvent['messages'][number]

interface Config {
  bankId: string
  autoRecall: boolean
  autoRetain: boolean
  recallBudget: Budget
  recallMaxTokens: number
  apiUrl: string
  apiKey?: string
}

const DEFAULT_CONFIG: Config = {
  apiUrl: 'http://localhost:8888',
  bankId: 'openclaw',
  autoRecall: true,
  autoRetain: true,
  recallBudget: 'mid',
  recallMaxTokens: 4 * 1024,
}

const RECALL_MESSAGE_TYPE = 'hindsight-recall'
const RECALL_SPINNER_KEY = 'hindsight-recall'
const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
const SPINNER_INTERVAL_MS = 80

const MEMORY_TAG_PATTERN = /<hindsight_memories>[\s\S]*?<\/hindsight_memories>/g

function stripMemoryTags(text: string): string {
  return text.replace(MEMORY_TAG_PATTERN, '')
}

function truncate(text: string, maxLen: number): string {
  const segments = [...new Intl.Segmenter().segment(text)]
  if (segments.length <= maxLen) return text
  return (
    segments
      .slice(0, maxLen)
      .map(s => s.segment)
      .join('') + '...[truncated]'
  )
}

function formatCurrentTime(): string {
  const now = new Date()
  const y = now.getUTCFullYear()
  const m = String(now.getUTCMonth() + 1).padStart(2, '0')
  const d = String(now.getUTCDate()).padStart(2, '0')
  const h = String(now.getUTCHours()).padStart(2, '0')
  const min = String(now.getUTCMinutes()).padStart(2, '0')
  return `${y}-${m}-${d} ${h}:${min} UTC`
}

function registerRecallRenderer(pi: ExtensionAPI): void {
  pi.registerMessageRenderer(
    RECALL_MESSAGE_TYPE,
    (message, { expanded }, theme) => {
      const details = message.details as
        | {
            count: number
            durationMs: number
            results: Array<{ id: string; text: string; type?: string | null }>
            query: string
          }
        | undefined

      const count = details?.count ?? 0
      const duration = details?.durationMs ?? 0

      let text = theme.fg('accent', '🧠 Hindsight Recall  ')
      text += theme.fg('success', `${count}개`)
      text += theme.fg('dim', ` · ${formatDuration(duration)}`)

      if (expanded && details && details.results.length > 0) {
        text += '\n' + theme.fg('dim', '─'.repeat(50))
        for (const r of details.results) {
          const typeStr = r.type ? theme.fg('warning', `[${r.type}] `) : ''
          const snippet = r.text.replace(/\n/g, ' ').slice(0, 60)
          text += `\n  ${typeStr}${theme.fg('dim', snippet)}`
        }
      }

      const box = new Box(1, 1, t => theme.bg('customMessageBg', t))
      box.addChild(new Text(text, 0, 0))
      return box
    },
  )
}

function registerRecallFilter(pi: ExtensionAPI): void {
  pi.on('context', async event => {
    const filtered = event.messages.filter(m => {
      if (m.role === 'custom' && m.customType === RECALL_MESSAGE_TYPE) {
        return false
      }
      return true
    })
    return { messages: filtered }
  })
}

function startRecallSpinner(ctx: ExtensionContext): Disposable {
  let frameIndex = 0
  let tuiRef: { requestRender: () => void } | null = null

  ctx.ui.setWidget(RECALL_SPINNER_KEY, (tui, theme) => {
    tuiRef = tui
    return {
      render: () => [
        theme.fg(
          'accent',
          `${SPINNER_FRAMES[frameIndex]} Recalling memories...`,
        ),
      ],
      invalidate: () => {},
    }
  })

  const interval = setInterval(() => {
    frameIndex = (frameIndex + 1) % SPINNER_FRAMES.length
    tuiRef?.requestRender()
  }, SPINNER_INTERVAL_MS)

  return {
    [Symbol.dispose]() {
      clearInterval(interval)
      ctx.ui.setWidget(RECALL_SPINNER_KEY, undefined)
    },
  }
}

async function performRecall(
  client: HindsightClient,
  config: Config,
  query: string,
): Promise<{
  text: string
  results: Array<{ id: string; text: string; type?: string | null }>
  durationMs: number
} | null> {
  const startTime = Date.now()
  const response = await client.recall(config.bankId, query, {
    budget: config.recallBudget,
    maxTokens: config.recallMaxTokens,
    types: ['world', 'experience', 'observation'],
    queryTimestamp: new Date().toISOString(),
  })
  const durationMs = Date.now() - startTime
  const { results } = response

  if (results.length === 0) return null

  const text = recallResponseToPromptString(response)
  return {
    text,
    results: results.map(r => ({ id: r.id, text: r.text, type: r.type })),
    durationMs,
  }
}

function buildMemoryBlock(text: string): string {
  return `

<hindsight_memories>
Relevant memories from past conversations (prioritize recent when conflicting). Only use memories that are directly useful to continue this conversation; ignore the rest:
Current time: ${formatCurrentTime()}

${text}
</hindsight_memories>`
}

function buildTranscript(messages: AgentMessage[]): unknown[] {
  return messages
    .map(m => {
      if (m.role === 'user') {
        return {
          role: m.role,
          content:
            typeof m.content === 'string'
              ? m.content
              : m.content
                  .filter(
                    (c): c is { type: 'text'; text: string } =>
                      c.type === 'text',
                  )
                  .map(c => c.text)
                  .join('\n'),
          timestamp: new Date(m.timestamp).toISOString(),
        }
      }

      if (m.role === 'assistant') {
        return {
          role: m.role,
          content: m.content
            .map(
              (c: {
                type: string
                text?: string
                id?: string
                name?: string
                arguments?: unknown
              }) => {
                if (c.type === 'text') {
                  return { type: c.type, text: c.text }
                }
                if (c.type === 'toolCall') {
                  return {
                    type: 'tool_use',
                    id: c.id,
                    name: c.name,
                    input: truncate(JSON.stringify(c.arguments), 500),
                  }
                }
                return null
              },
            )
            .filter(Boolean),
          model: `${m.provider}/${m.model}`,
          timestamp: new Date(m.timestamp).toISOString(),
        }
      }

      if (m.role === 'toolResult') {
        return {
          role: 'tool_result',
          tool_use_id: m.toolCallId,
          name: m.toolName,
          content: truncate(
            m.content
              .filter(
                (c): c is { type: 'text'; text: string } => c.type === 'text',
              )
              .map(c => c.text)
              .join('\n'),
            500,
          ),
          is_error: m.isError,
          timestamp: new Date(m.timestamp).toISOString(),
        }
      }

      if (m.role === 'bashExecution') {
        return {
          role: 'bash_execution',
          command: m.command,
          output: truncate(m.output, 500),
          exit_code: m.exitCode,
          timestamp: new Date(m.timestamp).toISOString(),
        }
      }

      if (m.role === 'custom') {
        return {
          role: 'custom',
          custom_type: m.customType,
          content:
            typeof m.content === 'string'
              ? m.content
              : m.content
                  .filter(
                    (c): c is { type: 'text'; text: string } =>
                      c.type === 'text',
                  )
                  .map(c => c.text)
                  .join('\n'),
          timestamp: new Date(m.timestamp).toISOString(),
        }
      }
    })
    .filter(Boolean)
}

async function performRetain(
  client: HindsightClient,
  config: Config,
  sessionId: string,
  messages: AgentMessage[],
  cwd: string,
): Promise<void> {
  const transcript = buildTranscript(messages)
  if (transcript.length === 0) return

  const content = stripMemoryTags(JSON.stringify(transcript)).trim()
  if (!content) return

  const documentId = `pi:${sessionId}`
  const lastMessage = messages.at(-1)
  const timestamp = lastMessage
    ? new Date(lastMessage.timestamp).toISOString()
    : new Date().toISOString()

  await client.retain(config.bankId, content, {
    documentId,
    timestamp,
    context: 'Pi coding agent session',
    updateMode: 'append',
    async: true,
    metadata: { source: 'pi', cwd, message_count: String(transcript.length) },
    tags: ['pi'],
  })
}

export default async function (pi: ExtensionAPI) {
  const config = DEFAULT_CONFIG

  let sessionId = ''

  const client = new HindsightClient({
    baseUrl: config.apiUrl,
    apiKey: config.apiKey,
  })

  registerRecallRenderer(pi)
  registerRecallFilter(pi)

  pi.on('session_start', async (_event, ctx) => {
    sessionId = ctx.sessionManager.getSessionId()
  })

  pi.on('before_agent_start', async (event, ctx) => {
    if (!config.autoRecall) return

    const query = event.prompt.trim()
    if (!query) return

    using _spinner = startRecallSpinner(ctx)

    // TODO: recall timeout & cancellation
    try {
      const result = await performRecall(client, config, query)

      if (!result) return

      pi.sendMessage({
        customType: RECALL_MESSAGE_TYPE,
        content: `Recalled ${result.results.length} memories in ${formatDuration(result.durationMs)}`,
        display: true,
        details: {
          count: result.results.length,
          durationMs: result.durationMs,
          results: result.results,
          query,
        },
      })

      return {
        systemPrompt: event.systemPrompt + buildMemoryBlock(result.text),
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      ctx.ui.notify(`Hindsight recall failed: ${errMsg}`, 'error')
    }
  })

  pi.on('agent_end', async (event, ctx) => {
    if (!config.autoRetain) return

    // TODO: retain timeout & cancellation
    try {
      await performRetain(client, config, sessionId, event.messages, ctx.cwd)
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      ctx.ui.notify(`Hindsight retain failed: ${errMsg}`, 'error')
    }
  })
}
