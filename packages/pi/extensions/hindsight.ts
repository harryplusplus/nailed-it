import type { ExtensionAPI } from '@mariozechner/pi-coding-agent'
import {
  Budget,
  HindsightClient,
  recallResponseToPromptString,
} from '@vectorize-io/hindsight-client'
import path from 'node:path'
import fs from 'node:fs/promises'

interface Config {
  bankId: string
  autoRecall: boolean
  autoRetain: boolean
  debug: boolean
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
  debug: false,
  recallBudget: 'mid',
  recallMaxTokens: 4 * 1024,
}

function loadConfig(): Config {
  const config: Config = { ...DEFAULT_CONFIG }

  return config
}

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
const SPINNER_INTERVAL_MS = 80
const RECALL_SPINNER_KEY = 'hindsight-recall'

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

export default async function (pi: ExtensionAPI) {
  const config = loadConfig()

  let sessionId = ''
  let logPath = ''

  const debug = async (...args: unknown[]) => {
    if (!config.debug) return
    if (!logPath) return

    try {
      await fs.appendFile(
        logPath,
        `${new Date().toISOString()} ${args
          .map(a => (typeof a === 'string' ? a : JSON.stringify(a)))
          .join(' ')}\n`,
      )
    } catch {
      // Ignore logging errors
    }
  }

  const client = new HindsightClient({
    baseUrl: config.apiUrl,
    apiKey: config.apiKey,
  })

  pi.on('session_start', async (_event, ctx) => {
    sessionId = ctx.sessionManager.getSessionId()

    if (config.debug) {
      const sessionFile = ctx.sessionManager.getSessionFile()
      if (sessionFile) {
        logPath = path.format({
          ...path.parse(sessionFile),
          ext: '.log',
          base: undefined,
        })
      }
    }
  })

  pi.on('before_agent_start', async (event, ctx) => {
    if (!config.autoRecall) return

    const query = event.prompt.trim()
    if (!query) return

    if (config.debug) {
      const queryPreview = [...new Intl.Segmenter().segment(query)]
        .map(x => x.segment)
        .slice(0, 80)
        .join('')
      await debug('recall', 'query:\n', `${queryPreview}...`)
    }

    // Show spinner widget while recalling
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

    using disposer = new DisposableStack()
    disposer.defer(() => ctx.ui.setWidget(RECALL_SPINNER_KEY, undefined))

    using _spinnerInterval = setInterval(() => {
      frameIndex = (frameIndex + 1) % SPINNER_FRAMES.length
      tuiRef?.requestRender()
    }, SPINNER_INTERVAL_MS)

    // TODO: recall timeout & cancellation
    try {
      const response = await client.recall(config.bankId, query, {
        budget: config.recallBudget,
        maxTokens: config.recallMaxTokens,
        types: ['world', 'experience', 'observation'],
      })

      const { results } = response
      if (results.length === 0) {
        await debug('recall', 'no memories found')
        return
      }

      const text = recallResponseToPromptString(response)
      const block = `

<hindsight_memories>
Relevant memories from past conversations (prioritize recent when conflicting). Only use memories that are directly useful to continue this conversation; ignore the rest:
Current time: ${formatCurrentTime()}

${text}
</hindsight_memories>`

      await debug('recall', 'text:\n', text)

      return { systemPrompt: event.systemPrompt + block }
    } catch (e) {
      await debug('recall', 'error:\n', e)
      const errMsg = e instanceof Error ? e.message : String(e)
      ctx.ui.notify(`Hindsight recall failed: ${errMsg}`, 'error')
    }
  })

  pi.on('agent_end', async (event, ctx) => {
    if (!config.autoRetain) return

    const transcript = event.messages
      .map(m => {
        if (m.role === 'user') {
          return {
            role: m.role,
            content:
              typeof m.content === 'string'
                ? m.content
                : m.content
                    .filter(c => c.type === 'text')
                    .map(c => c.text)
                    .join('\n'),
            timestamp: new Date(m.timestamp).toISOString(),
          }
        }

        if (m.role === 'assistant') {
          return {
            role: m.role,
            content: m.content
              .map(c => {
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
              })
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
                .filter(c => c.type === 'text')
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
                    .filter(c => c.type === 'text')
                    .map(c => c.text)
                    .join('\n'),
            timestamp: new Date(m.timestamp).toISOString(),
          }
        }
      })
      .filter(Boolean)

    if (transcript.length === 0) return

    const content = stripMemoryTags(JSON.stringify(transcript)).trim()
    if (!content) return

    const documentId = `pi:${sessionId}`

    await debug(
      'retain',
      'bankId',
      config.bankId,
      'documentId',
      documentId,
      'messageCount',
      transcript.length,
    )

    const lastMessage = event.messages.at(-1)
    const timestamp = lastMessage
      ? new Date(lastMessage.timestamp).toISOString()
      : new Date().toISOString()

    // TODO: retain timeout & cancellation
    try {
      await client.retain(config.bankId, content, {
        documentId,
        timestamp,
        context: 'Pi coding agent session',
        updateMode: 'append',
        async: true,
        metadata: {
          source: 'pi',
          cwd: ctx.cwd,
          message_count: String(transcript.length),
        },
        tags: ['pi-session'],
      })
    } catch (e) {
      await debug('retain', 'error:\n', e)
      const errMsg = e instanceof Error ? e.message : String(e)
      ctx.ui.notify(`Hindsight retain failed: ${errMsg}`, 'error')
    }
  })
}
