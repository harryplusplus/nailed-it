import type {
  AgentEndEvent,
  ExtensionAPI,
  ExtensionContext,
  SessionMessageEntry,
} from '@mariozechner/pi-coding-agent'
import { Box, Text, TUI } from '@mariozechner/pi-tui'
import {
  Budget,
  HindsightClient,
  recallResponseToPromptString,
} from '@vectorize-io/hindsight-client'
import { getEncoding } from 'js-tiktoken'
import { formatDuration, formatError } from '../src/common'
import {
  AssistantMessage,
  TextContent,
  ToolResultMessage,
  UserMessage,
} from '@mariozechner/pi-ai'

type AgentMessage = AgentEndEvent['messages'][number]
type BashExecutionMessage = Extract<AgentMessage, { role: 'bashExecution' }>
type RecallDetails = {
  durationMs: number
  results: { type?: string | null; text: string }[]
  query: string
}
type RecallResult = { text: string | null; details: RecallDetails }

const TIKTOKEN_ENCODING = getEncoding('cl100k_base')

function countTokens(text: string): number {
  return TIKTOKEN_ENCODING.encode(text).length
}

function truncateByTokens(text: string, maxTokens: number): string {
  const tokens = TIKTOKEN_ENCODING.encode(text)
  if (tokens.length <= maxTokens) return text
  return TIKTOKEN_ENCODING.decode(tokens.slice(0, maxTokens))
}

const DEFAULT_CONFIG = {
  apiUrl: 'http://localhost:8888',
  apiKey: undefined,
  bankId: 'openclaw',
  autoRecall: true,
  autoRetain: true,
  recallBudget: 'mid' as Budget,
  recallMaxTokens: 4 * 1024,
  recallUserTurns: 3,
  recallMaxQueryTokens: 1500,
}

type Config = typeof DEFAULT_CONFIG

const RECALL_KEY = 'hindsight-recall'

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
const SPINNER_INTERVAL_MS = 80

export default async function (pi: ExtensionAPI) {
  const config = loadConfig()
  const client = new HindsightClient({
    baseUrl: config.apiUrl,
    apiKey: config.apiKey,
  })

  let pendingRecallResult: RecallResult | null = null
  let sessionId = ''

  pi.on('session_start', async (_event, ctx) => {
    sessionId = ctx.sessionManager.getSessionId()
  })

  pi.registerMessageRenderer(RECALL_KEY, (message, { expanded }, theme) => {
    const details = message.details as RecallDetails

    const count = details.results.length
    const duration = details.durationMs

    let text = theme.fg('accent', '🧠 Hindsight Recall')
    text += theme.fg('success', ` ${count} found`)
    text += theme.fg('dim', ` (${formatDuration(duration)})`)

    if (expanded && details.results.length > 0) {
      text += '\n'
      if (details.query) {
        text += theme.fg('accent', 'Query:\n')
        text += theme.fg('dim', details.query) + '\n'
      }
      for (const r of details.results) {
        const type = r.type ? theme.fg('warning', `[${r.type}] `) : ''
        text += `\n${type}${theme.fg('dim', r.text)}`
      }
    }

    const box = new Box(1, 1, t => theme.bg('customMessageBg', t))
    box.addChild(new Text(text, 0, 0))
    return box
  })

  pi.on('before_agent_start', async (event, ctx) => {
    if (!config.autoRecall) return

    const rawQuery = event.prompt.trim()
    if (!rawQuery) return

    const query = composeRecallQuery(
      rawQuery,
      ctx,
      config.recallUserTurns,
      config.recallMaxQueryTokens,
    )

    using _spinner = startRecallSpinner(ctx)

    try {
      const result = await performRecall(client, config, query)

      pi.sendMessage({
        customType: RECALL_KEY,
        content: '',
        display: true,
        details: result.details,
      })

      pendingRecallResult = result
    } catch (err) {
      ctx.ui.notify(`Hindsight recall failed: ${formatError(err)}`, 'error')
    }
  })

  pi.on('context', async event => {
    let messages = filterRecallMessages(event.messages)

    const recallResult = pendingRecallResult
    pendingRecallResult = null

    if (recallResult?.text) {
      const memoryBlock = buildMemoryBlock(recallResult.text)
      const lastUserIdx = messages.findLastIndex(m => m.role === 'user')

      if (lastUserIdx >= 0) {
        messages = messages.map((m, i) => {
          if (i !== lastUserIdx || m.role !== 'user') return m
          if (typeof m.content === 'string') {
            return { ...m, content: memoryBlock + '\n\n' + m.content }
          }

          const textContent: TextContent = { type: 'text', text: memoryBlock }
          return { ...m, content: [textContent, ...m.content] }
        })
      }
    }

    return { messages }
  })

  pi.on('agent_end', async (event, ctx) => {
    if (!config.autoRetain) return

    try {
      await performRetain(client, config, sessionId, event.messages, ctx.cwd)
    } catch (err) {
      ctx.ui.notify(`Hindsight retain failed: ${formatError(err)}`, 'error')
    }
  })
}

function filterRecallMessages(messages: AgentMessage[]): AgentMessage[] {
  return messages.filter(m => {
    if (m.role === 'custom' && m.customType === RECALL_KEY) {
      return false
    }
    return true
  })
}

function loadConfig(): Config {
  return { ...DEFAULT_CONFIG }
}

function startRecallSpinner(ctx: ExtensionContext): Disposable {
  let frameIndex = 0
  let tuiRef: TUI | null = null

  ctx.ui.setWidget(RECALL_KEY, (tui, theme) => {
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
      ctx.ui.setWidget(RECALL_KEY, undefined)
    },
  }
}

function stripMemoryTag(text: string): string {
  return text.replace(/<hindsight_memories>[\s\S]*?<\/hindsight_memories>/g, '')
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

function composeRecallQuery(
  latestQuery: string,
  ctx: ExtensionContext,
  recallUserTurns: number,
  maxTokens: number,
): string {
  const userMessages = ctx.sessionManager
    .getBranch()
    .filter((e): e is SessionMessageEntry => e.type === 'message')
    .map(e => e.message)
    .filter((m): m is UserMessage => m.role === 'user')
    .map(m => {
      if (typeof m.content === 'string') {
        return m.content.trim()
      }
      return m.content
        .filter((c): c is TextContent => c.type === 'text')
        .map(c => c.text.trim())
        .filter(t => t)
        .join('\n')
    })
    .map(t => stripMemoryTag(t))
    .filter(t => t)

  if (recallUserTurns <= 1) {
    return truncateByTokens(latestQuery, maxTokens)
  }

  const priorMessages = userMessages.slice(-(recallUserTurns - 1))
  const priorBlocks: string[] = []
  for (const priorMessage of [...priorMessages].reverse()) {
    const priorBlock = `User: ${priorMessage}`
    const candidate = [...priorBlocks, priorBlock, latestQuery].join('\n\n')
    if (countTokens(candidate) > maxTokens) break
    priorBlocks.push(priorBlock)
  }
  priorBlocks.reverse()

  return truncateByTokens([...priorBlocks, latestQuery].join('\n\n'), maxTokens)
}

function buildMemoryBlock(text: string): string {
  return [
    '<hindsight_memories>',
    'Relevant memories from past conversations (prioritize recent when conflicting). Only use memories that are directly useful to continue this conversation; ignore the rest:',
    `Current time: ${formatCurrentTime()}`,
    '',
    text,
    '</hindsight_memories>',
  ].join('\n')
}

function buildTranscript(messages: AgentMessage[]): string {
  const parts: string[] = []

  for (const m of messages) {
    if (m.role === 'user') {
      parts.push(normalizeUserMessage(m))
    } else if (m.role === 'assistant') {
      parts.push(normalizeAssistantMessage(m))
    } else if (m.role === 'toolResult') {
      parts.push(normalizeToolResultMessage(m))
    } else if (m.role === 'bashExecution' && !m.excludeFromContext) {
      parts.push(normalizeBashExecutionMessage(m))
    }
  }

  return parts.join('\n\n')
}

function normalizeUserMessage(message: UserMessage): string {
  const parts: string[] = []

  const timestamp = formatTimestamp(message.timestamp)
  parts.push(`User (timestamp: ${timestamp})`)

  if (typeof message.content === 'string') {
    const text = message.content.trim()
    if (text) {
      parts.push('<text>')
      parts.push(text)
      parts.push('</text>')
    }
  } else {
    const text = message.content
      .filter((c): c is TextContent => c.type === 'text')
      .map(c => c.text.trim())
      .filter(t => t)
      .join('\n')
    if (text) {
      parts.push('<text>')
      parts.push(text)
      parts.push('</text>')
    }
  }

  const text = parts.join('\n')
  return normalizeNewlines(text)
}

function normalizeAssistantMessage(message: AssistantMessage): string {
  const parts: string[] = []

  const timestamp = formatTimestamp(message.timestamp)
  parts.push(
    `Assistant (${message.provider}/${message.model}, timestamp: ${timestamp})`,
  )
  parts.push(`Stop reason: ${message.stopReason}`)

  if (message.stopReason === 'error' || message.stopReason === 'aborted') {
    const errorMessage = message.errorMessage?.trim()
    if (errorMessage) {
      parts.push('<error>')
      parts.push(errorMessage)
      parts.push('</error>')
    }
  } else if (message.stopReason === 'length') {
    parts.push(`Response was cut off because it exceeded the maximum length.`)
  }

  for (const c of message.content) {
    if (c.type === 'text') {
      const text = c.text.trim()
      if (text) {
        parts.push('<text>')
        parts.push(text)
        parts.push('</text>')
      }
    } else if (c.type === 'toolCall') {
      parts.push(`Tool call: ${c.name}(${JSON.stringify(c.arguments)})`)
    }
  }

  const text = parts.join('\n')
  return normalizeNewlines(text)
}

function normalizeToolResultMessage(message: ToolResultMessage): string {
  const timestamp = formatTimestamp(message.timestamp)
  const text = `Tool result (${message.toolName}, is_error: ${message.isError}, timestamp: ${timestamp})`
  return normalizeNewlines(text)
}

function normalizeBashExecutionMessage(message: BashExecutionMessage): string {
  const parts: string[] = []

  const timestamp = formatTimestamp(message.timestamp)
  if (message.cancelled) {
    parts.push(`Bash execution (cancelled, timestamp: ${timestamp})`)
  } else if (message.exitCode !== undefined) {
    parts.push(
      `Bash execution (exit_code: ${message.exitCode}, timestamp: ${timestamp})`,
    )
  } else {
    parts.push(`Bash execution (timestamp: ${timestamp})`)
  }

  const command = message.command.trim()
  if (command) {
    parts.push('<command>')
    parts.push(command)
    parts.push('</command>')
  }

  const text = parts.join('\n')
  return normalizeNewlines(text)
}

function normalizeNewlines(text: string): string {
  return text.replace(/\n{2,}/g, '\n')
}

function formatTimestamp(timestamp: number): string {
  return new Date(timestamp).toISOString()
}

async function performRecall(
  client: HindsightClient,
  config: Config,
  query: string,
): Promise<RecallResult> {
  const startTime = Date.now()
  const response = await client.recall(config.bankId, query, {
    budget: config.recallBudget,
    maxTokens: config.recallMaxTokens,
    types: ['world', 'experience', 'observation'],
    queryTimestamp: new Date().toISOString(),
  })

  const durationMs = Date.now() - startTime
  const { results } = response
  if (results.length === 0) {
    return { text: null, details: { durationMs, results: [], query } }
  }

  const text = recallResponseToPromptString(response)
  return {
    text,
    details: {
      durationMs,
      results: results.map(r => ({ type: r.type, text: r.text })),
      query,
    },
  }
}

async function performRetain(
  client: HindsightClient,
  config: Config,
  sessionId: string,
  messages: AgentMessage[],
  cwd: string,
): Promise<void> {
  const transcript = buildTranscript(messages)
  const content = stripMemoryTag(transcript)
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
    metadata: { cwd },
    tags: ['pi'],
  })
}
