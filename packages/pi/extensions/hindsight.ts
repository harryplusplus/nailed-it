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
  recallTimeoutMs: number
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
  debug: true,
  recallTimeoutMs: 10_000,
  recallBudget: 'mid',
  recallMaxTokens: 4 * 1024,
}

function loadConfig(): Config {
  const config: Config = { ...DEFAULT_CONFIG }

  return config
}

const MEMORY_TAG_PATTERN = /<hindsight_memories>[\s\S]*?<\/hindsight_memories>/g

function stripMemoryTags(text: string): string {
  return text.replace(MEMORY_TAG_PATTERN, '')
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

  pi.on('before_agent_start', async (event, _ctx) => {
    if (!config.autoRecall) return

    const query = event.prompt.trim()
    if (!query) return

    if (config.debug) {
      const queryPreview = [...new Intl.Segmenter().segment(query)]
        .map(x => x.segment)
        .slice(0, 80)
        .join('')
      await debug(`recall: query="${queryPreview}..."`)
    }

    // TODO: recall timeout & cancellation
    try {
      const response = await client.recall(config.bankId, query, {
        budget: config.recallBudget,
        maxTokens: config.recallMaxTokens,
        types: ['world', 'experience', 'observation'],
        includeSourceFacts: true,
      })

      const { results } = response
      if (results.length === 0) {
        await debug('recall: no memories found')
        return
      }

      const text = recallResponseToPromptString(response)
      const block = `

<hindsight_memories>
Relevant memories from past conversations (prioritize recent when conflicting). Only use memories that are directly useful to continue this conversation; ignore the rest:
Current time: ${formatCurrentTime()}

${text}
</hindsight_memories>`

      await debug(`recall: injected:\n`, text)

      return { systemPrompt: event.systemPrompt + block }
    } catch (e) {
      await debug('recall error:', e)
    }
  })

  pi.on('agent_end', async event => {
    if (!config.autoRetain) return

    const conversation: {
      role: 'user' | 'assistant'
      content: string
      timestamp: string
    }[] = event.messages
      .filter(m => m.role === 'user' || m.role === 'assistant')
      .map(m => {
        if (m.role === 'user') {
          const content =
            typeof m.content === 'string'
              ? m.content
              : m.content
                  .filter(c => c.type === 'text')
                  .map(t => t.text)
                  .join('\n')

          const timestamp = new Date(m.timestamp).toISOString()

          return { role: 'user', content: stripMemoryTags(content), timestamp }
        } else {
          const content = m.content
            .filter(c => c.type === 'text')
            .map(t => t.text)
            .join('\n')

          const timestamp = new Date(m.timestamp).toISOString()

          return {
            role: 'assistant',
            content: stripMemoryTags(content),
            timestamp,
          }
        }
      })

    const documentId = `pi:${sessionId}`

    // TODO: retain timeout & cancellation
    try {
      await client.retain(config.bankId, JSON.stringify(conversation), {
        documentId,
        updateMode: 'append',
        async: true,
      })
    } catch (e) {
      await debug('retain error:', e)
    }
  })
}
