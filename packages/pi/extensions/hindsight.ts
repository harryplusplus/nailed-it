import type { ExtensionAPI } from '@mariozechner/pi-coding-agent'
import {
  HindsightClient,
  recallResponseToPromptString,
} from '@vectorize-io/hindsight-client'
import { Type } from '@sinclair/typebox'
import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs/promises'

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const CONFIG_DIR = path.join(os.homedir(), '.pi', 'agent')
const CONFIG_PATH = path.join(CONFIG_DIR, 'hindsight.json')

interface HindsightConfig {
  /** Hindsight API base URL (required) */
  apiUrl: string
  /** API key for authentication */
  apiKey?: string
  /** Memory bank ID — static or derived from project */
  bankId?: string
  /** Bank ID prefix for namespacing */
  bankIdPrefix?: string
  /** Derive bank ID from context fields */
  dynamicBankId: boolean
  /** Which fields compose the dynamic bank ID */
  dynamicBankGranularity: Array<'agent' | 'project'>
  /** Bank retain mission — steers what facts get extracted during retain */
  retainMission?: string
  /** Auto-recall before each agent turn */
  autoRecall: boolean
  /** Auto-retain after each agent turn */
  autoRetain: boolean
  /** Recall budget: low | mid | high */
  recallBudget: 'low' | 'mid' | 'high'
  /** Max tokens for recall results */
  recallMaxTokens: number
  /** Memory types to recall */
  recallTypes: Array<'world' | 'experience' | 'observation'>
  /** Where to inject recalled memories */
  recallInjectionPosition: 'prepend' | 'append'
  /** Retain every N turns (1 = every turn) */
  retainEveryNTurns: number
  /** Extra overlap turns for chunked retention */
  retainOverlapTurns: number
  /** Roles to include in retained transcript */
  retainRoles: Array<'user' | 'assistant'>
  /** Include tool calls in retained transcript */
  retainToolCalls: boolean
  /** Include tool results in retained transcript */
  retainToolResults: boolean
  /** Tags applied to every retained document */
  retainTags: string[]
  /** Debug logging */
  debug: boolean
}

const DEFAULTS: HindsightConfig = {
  apiUrl: '',
  dynamicBankId: true,
  dynamicBankGranularity: ['agent', 'project'],
  autoRecall: true,
  autoRetain: true,
  recallBudget: 'mid',
  recallMaxTokens: 4096,
  recallTypes: ['world', 'experience'],
  recallInjectionPosition: 'append',
  retainEveryNTurns: 1,
  retainOverlapTurns: 0,
  retainRoles: ['user', 'assistant'],
  retainToolCalls: true,
  retainToolResults: false,
  retainTags: [],
  debug: false,
}

async function loadConfig(): Promise<HindsightConfig> {
  const merged: Record<string, unknown> = { ...DEFAULTS }

  // 1. Config file
  try {
    const raw = await fs.readFile(CONFIG_PATH, 'utf-8')
    const file = JSON.parse(raw)
    for (const [k, v] of Object.entries(file)) {
      if (v !== null && v !== undefined) merged[k] = v
    }
  } catch {
    // file missing or invalid — use defaults
  }

  // 2. Environment variables (highest priority)
  const envMap: Record<
    string,
    [keyof HindsightConfig, 'string' | 'bool' | 'int']
  > = {
    HINDSIGHT_API_URL: ['apiUrl', 'string'],
    HINDSIGHT_API_KEY: ['apiKey', 'string'],
    HINDSIGHT_BANK_ID: ['bankId', 'string'],
    HINDSIGHT_DYNAMIC_BANK_ID: ['dynamicBankId', 'bool'],
    HINDSIGHT_AUTO_RECALL: ['autoRecall', 'bool'],
    HINDSIGHT_AUTO_RETAIN: ['autoRetain', 'bool'],
    HINDSIGHT_RECALL_BUDGET: ['recallBudget', 'string'],
    HINDSIGHT_RECALL_MAX_TOKENS: ['recallMaxTokens', 'int'],
    HINDSIGHT_DEBUG: ['debug', 'bool'],
  }

  for (const [envName, [key, typ]] of Object.entries(envMap)) {
    const val = process.env[envName]
    if (val !== undefined) {
      if (typ === 'bool')
        (merged as any)[key] = ['true', '1', 'yes'].includes(val.toLowerCase())
      else if (typ === 'int') {
        const n = parseInt(val, 10)
        if (!isNaN(n)) (merged as any)[key] = n
      } else (merged as any)[key] = val
    }
  }

  return merged as unknown as HindsightConfig
}

// ---------------------------------------------------------------------------
// Bank ID derivation
// ---------------------------------------------------------------------------

function deriveBankId(config: HindsightConfig, cwd: string): string {
  if (!config.dynamicBankId) {
    const base = config.bankId || 'pi'
    return config.bankIdPrefix ? `${config.bankIdPrefix}-${base}` : base
  }

  const fields = config.dynamicBankGranularity.length
    ? config.dynamicBankGranularity
    : ['agent', 'project']

  const fieldMap: Record<string, string> = {
    agent: 'pi',
    project: cwd ? path.basename(cwd) : 'unknown',
  }

  const segments = fields.map(f => encodeURIComponent(fieldMap[f] || 'unknown'))
  const baseBankId = segments.join('::')
  return config.bankIdPrefix
    ? `${config.bankIdPrefix}-${baseBankId}`
    : baseBankId
}

// ---------------------------------------------------------------------------
// Transcript builder
// ---------------------------------------------------------------------------

const MEMORY_TAG_RE = /<hindsight_memories>[\s\S]*?<\/hindsight_memories>/g

function stripMemoryTags(text: string): string {
  return text.replace(MEMORY_TAG_RE, '')
}

const TOOL_RESULT_MAX_CHARS = 2000
const OPERATIONAL_TOOL_RE =
  /(?:recall|retain|reflect|search|extract|create_|delete_|update_|get_|list_)/i

function buildTranscript(
  entries: Array<{ type: string; message?: any }>,
  config: HindsightConfig,
): string | null {
  const allowedRoles = new Set(config.retainRoles)
  const structured: Array<{
    role: string
    content: any[]
    timestamp?: string
  }> = []

  for (const entry of entries) {
    if (entry.type !== 'message' || !entry.message) continue
    const msg = entry.message
    const role = msg.role

    // Tool results → fold into synthetic user message (Anthropic convention)
    if (role === 'toolResult') {
      if (!config.retainToolResults) continue
      const block = buildToolResultBlock(msg)
      if (!block) continue
      const last = structured[structured.length - 1]
      if (
        last &&
        last.role === 'user' &&
        last.content.every((b: any) => b.type === 'tool_result')
      ) {
        last.content.push(block)
      } else {
        structured.push({ role: 'user', content: [block] })
      }
      continue
    }

    if (!allowedRoles.has(role)) continue

    const blocks = extractBlocks(msg, role, config)
    if (blocks.length > 0) {
      const timestamp = normalizeTimestamp(msg.timestamp)
      structured.push(
        timestamp
          ? { role, content: blocks, timestamp }
          : { role, content: blocks },
      )
    }
  }

  if (structured.length === 0) return null
  const json = JSON.stringify(structured)
  if (json.trim().length < 10) return null
  return json
}

function extractBlocks(msg: any, role: string, config: HindsightConfig): any[] {
  const content = msg.content
  if (typeof content === 'string') {
    const cleaned = stripMemoryTags(content).trim()
    return cleaned ? [{ type: 'text', text: cleaned }] : []
  }
  if (!Array.isArray(content)) return []

  const blocks: any[] = []
  for (const block of content) {
    if (!block || typeof block !== 'object') continue
    if (block.type === 'text') {
      const cleaned = stripMemoryTags(block.text ?? '').trim()
      if (cleaned) blocks.push({ type: 'text', text: cleaned })
    } else if (
      block.type === 'toolCall' &&
      role === 'assistant' &&
      config.retainToolCalls
    ) {
      const name = typeof block.name === 'string' ? block.name : 'unknown'
      // Skip Hindsight's own tools to avoid feedback loops
      if (name.startsWith('hindsight_') && OPERATIONAL_TOOL_RE.test(name))
        continue
      const input =
        block.arguments && typeof block.arguments === 'object'
          ? block.arguments
          : {}
      const toolUse: any = { type: 'tool_use', name, input }
      if (block.id) toolUse.id = block.id
      blocks.push(toolUse)
    }
    // thinking / unknown → dropped
  }
  return blocks
}

function buildToolResultBlock(msg: any): any | null {
  const toolUseId = typeof msg.toolCallId === 'string' ? msg.toolCallId : ''
  let text = ''
  if (typeof msg.content === 'string') {
    text = msg.content
  } else if (Array.isArray(msg.content)) {
    text = msg.content
      .filter((b: any) => b?.type === 'text' && typeof b.text === 'string')
      .map((b: any) => b.text)
      .join('\n')
  }
  text = text.trim()
  if (!text) return null
  if (text.length > TOOL_RESULT_MAX_CHARS) {
    text = text.slice(0, TOOL_RESULT_MAX_CHARS) + '... (truncated)'
  }
  const block: any = { type: 'tool_result', content: text }
  if (toolUseId) block.tool_use_id = toolUseId
  return block
}

function normalizeTimestamp(raw: any): string | undefined {
  if (raw === undefined || raw === null) return undefined
  const date =
    typeof raw === 'number'
      ? new Date(raw)
      : typeof raw === 'string'
        ? new Date(raw)
        : undefined
  if (!date || isNaN(date.getTime())) return undefined
  return date.toISOString()
}

// ---------------------------------------------------------------------------
// Recall query composition
// composeRecallQuery / truncateRecallQuery — kept for future multi-turn recall context
// (currently recall uses the latest user prompt only, matching recallContextTurns: 1)

// ---------------------------------------------------------------------------
// Memory formatting
// ---------------------------------------------------------------------------

const RECALL_PREAMBLE =
  'Relevant memories from past conversations (prioritize recent when conflicting). ' +
  'Only use memories that are directly useful to continue this conversation; ignore the rest:'

function formatCurrentTime(): string {
  const now = new Date()
  const y = now.getUTCFullYear()
  const m = String(now.getUTCMonth() + 1).padStart(2, '0')
  const d = String(now.getUTCDate()).padStart(2, '0')
  const h = String(now.getUTCHours()).padStart(2, '0')
  const min = String(now.getUTCMinutes()).padStart(2, '0')
  return `${y}-${m}-${d} ${h}:${min} UTC`
}

// ---------------------------------------------------------------------------
// Extension
// ---------------------------------------------------------------------------

export default async function (pi: ExtensionAPI) {
  const config = await loadConfig()

  if (!config.apiUrl) {
    // No Hindsight configured — no-op
    return
  }

  const client = new HindsightClient({
    baseUrl: config.apiUrl,
    apiKey: config.apiKey,
  })

  // Per-session state
  let bankId = ''
  let sessionId = ''
  let missionSet = false
  let agentCycleCount = 0

  const debug = (...args: unknown[]) => {
    if (!config.debug) return
    console.error('[Hindsight]', ...args)
  }

  // ---------------------------------------------------------------------------
  // session_start — initialize bank
  // ---------------------------------------------------------------------------
  pi.on('session_start', async (_event, ctx) => {
    bankId = deriveBankId(config, ctx.cwd)
    sessionId = ctx.sessionManager.getSessionId?.() ?? `pi-${Date.now()}`
    agentCycleCount = 0
    missionSet = false

    debug(`session_start: bank=${bankId}, sessionId=${sessionId}`)

    // Set bank mission on first use
    if (config.retainMission && !missionSet) {
      try {
        await client.createBank(bankId, { retainMission: config.retainMission })
        missionSet = true
        debug(`mission set for bank ${bankId}`)
      } catch (e) {
        debug(`could not set mission: ${e instanceof Error ? e.message : e}`)
      }
    }
  })

  // ---------------------------------------------------------------------------
  // before_agent_start — recall + inject
  // ---------------------------------------------------------------------------
  pi.on('before_agent_start', async (event, _ctx) => {
    if (!config.autoRecall) return

    const query = event.prompt?.trim()
    if (!query || query.length < 5) return

    debug(`recall: query="${query.slice(0, 80)}..."`)

    try {
      const response = await client.recall(bankId, query, {
        budget: config.recallBudget,
        maxTokens: config.recallMaxTokens,
        types: config.recallTypes,
      })

      const results = response.results ?? []
      if (results.length === 0) {
        debug('recall: no memories found')
        return
      }

      const memoriesText = recallResponseToPromptString(response)
      const contextBlock =
        `<hindsight_memories>\n` +
        `${RECALL_PREAMBLE}\n` +
        `Current time: ${formatCurrentTime()}\n\n` +
        `${memoriesText}\n` +
        `</hindsight_memories>`

      debug(`recall: injected ${results.length} memories`)

      const position = config.recallInjectionPosition
      if (position === 'append') {
        return { systemPrompt: event.systemPrompt + '\n\n' + contextBlock }
      }
      // "prepend"
      return { systemPrompt: contextBlock + '\n\n' + event.systemPrompt }
    } catch (e) {
      debug(`recall error: ${e instanceof Error ? e.message : e}`)
      // Non-fatal — agent continues without memories
    }
  })

  // ---------------------------------------------------------------------------
  // agent_end — retain conversation
  // ---------------------------------------------------------------------------
  pi.on('agent_end', async (event, ctx) => {
    if (!config.autoRetain) return

    agentCycleCount++
    debug(`agent_end: cycle=${agentCycleCount}`)

    // Chunked retention: skip non-Nth turns
    const retainEveryN = config.retainEveryNTurns
    if (retainEveryN > 1 && agentCycleCount % retainEveryN !== 0) {
      const nextAt = Math.ceil(agentCycleCount / retainEveryN) * retainEveryN
      debug(`retain: skipping (next at turn ${nextAt})`)
      return
    }

    // Build transcript from session entries
    const entries = ctx.sessionManager.getBranch()
    const transcript = buildTranscript(entries, config)
    if (!transcript) {
      debug('retain: no messages to retain')
      return
    }

    const documentId = `pi:${sessionId}`

    debug(
      `retain: ${transcript.length} chars → bank=${bankId}, doc=${documentId}`,
    )

    try {
      await client.retain(bankId, transcript, {
        documentId,
        updateMode: 'append',
        async: true,
        tags: config.retainTags.length > 0 ? config.retainTags : undefined,
        metadata: {
          source: 'pi',
          session_id: sessionId,
          cycle_index: String(agentCycleCount),
        },
      })

      debug(`retain: success (cycle ${agentCycleCount})`)
    } catch (e) {
      debug(`retain error: ${e instanceof Error ? e.message : e}`)
      // Non-fatal — we'll try again next turn
    }
  })

  // ---------------------------------------------------------------------------
  // Custom tools — explicit recall / retain / reflect
  // ---------------------------------------------------------------------------
  pi.registerTool({
    name: 'hindsight_recall',
    label: 'Recall Memory',
    description:
      'Search long-term memory for relevant information. Use proactively before ' +
      'answering questions about past conversations, user preferences, project history, ' +
      'or any topic where prior context would help. When in doubt, recall first.',
    promptSnippet: 'Search long-term memory for relevant context',
    promptGuidelines: [
      'Use hindsight_recall before answering questions about past work, preferences, or decisions.',
    ],
    parameters: Type.Object({
      query: Type.String({ description: 'Natural language search query' }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      try {
        const response = await client.recall(bankId, params.query, {
          budget: config.recallBudget,
          maxTokens: config.recallMaxTokens,
          types: config.recallTypes,
          tags: config.retainTags.length > 0 ? config.retainTags : undefined,
        })

        const results = response.results ?? []
        if (results.length === 0) {
          return {
            content: [{ type: 'text', text: 'No relevant memories found.' }],
            details: { count: 0 },
          }
        }

        const formatted = recallResponseToPromptString(response)
        return {
          content: [
            {
              type: 'text',
              text: `Found ${results.length} relevant memories (as of ${formatCurrentTime()}):\n\n${formatted}`,
            },
          ],
          details: { count: results.length },
        }
      } catch (e: any) {
        return {
          content: [
            { type: 'text', text: `Memory recall failed: ${e.message ?? e}` },
          ],
          details: { error: true },
        }
      }
    },
  })

  pi.registerTool({
    name: 'hindsight_retain',
    label: 'Store Memory',
    description:
      'Store information in long-term memory. Use this to remember important facts, ' +
      'user preferences, project context, decisions, and anything worth recalling in future sessions.',
    promptSnippet: 'Store important information in long-term memory',
    promptGuidelines: [
      'Use hindsight_retain when the user explicitly asks to remember something.',
    ],
    parameters: Type.Object({
      content: Type.String({ description: 'The information to remember' }),
      context: Type.Optional(
        Type.String({
          description: 'Optional context about where this came from',
        }),
      ),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      try {
        await client.retain(bankId, params.content, {
          context: params.context,
          async: true,
          tags: config.retainTags.length > 0 ? config.retainTags : undefined,
        })
        return {
          content: [{ type: 'text', text: 'Memory stored successfully.' }],
          details: {},
        }
      } catch (e: any) {
        return {
          content: [
            { type: 'text', text: `Failed to store memory: ${e.message ?? e}` },
          ],
          details: { error: true },
        }
      }
    },
  })

  // ---------------------------------------------------------------------------
  // /hindsight command — status & config
  // ---------------------------------------------------------------------------
  pi.registerCommand('hindsight', {
    description: 'Show Hindsight memory status',
    handler: async (_args, ctx) => {
      const lines = [
        `Bank: ${bankId || '(not initialized)'}`,
        `Session: ${sessionId || '(none)'}`,
        `API: ${config.apiUrl}`,
        `Auto-recall: ${config.autoRecall}`,
        `Auto-retain: ${config.autoRetain}`,
        `Cycle: ${agentCycleCount}`,
        `Dynamic bank: ${config.dynamicBankId} [${config.dynamicBankGranularity.join(', ')}]`,
      ]

      // Try health check
      try {
        const resp = await fetch(`${config.apiUrl.replace(/\/$/, '')}/health`, {
          signal: AbortSignal.timeout(5000),
        })
        lines.push(`Health: ${resp.ok ? '✓ OK' : `✗ HTTP ${resp.status}`}`)
      } catch {
        lines.push('Health: ✗ unreachable')
      }

      ctx.ui.notify(lines.join('\n'), 'info')
    },
  })
}
