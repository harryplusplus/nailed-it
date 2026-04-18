/**
 * Discord Bot for Pi Coding Agent
 *
 * Bridges Discord threads to Pi SDK sessions.
 * @mention the bot to start a conversation, then chat naturally in the thread.
 */

import {
  Client,
  GatewayIntentBits,
  SlashCommandBuilder,
  Events,
  type Message,
  type Attachment,
} from 'discord.js'
import {
  createAgentSession,
  createCodingTools,
  SessionManager,
  type AgentSession,
} from '@mariozechner/pi-coding-agent'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// ─── Config ────────────────────────────────────────────────────────

const CWD = process.cwd()
const SESSIONS_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  'sessions',
)

// ─── Types ──────────────────────────────────────────────────────────

interface SessionMapping {
  threadId: string
  sessionFile: string
  createdAt: string
}

interface SessionEntry {
  session: AgentSession
  sessionManager: SessionManager
  busy: boolean
  queue: Array<{ text: string; attachments: Attachment[] }>
}

// ─── Session Pool ────────────────────────────────────────────────────

const sessions = new Map<string, SessionEntry>()

async function getOrCreateSession(threadId: string): Promise<SessionEntry> {
  const existing = sessions.get(threadId)
  if (existing) return existing

  const mapping = await loadMapping(threadId)
  let session: AgentSession
  let sessionManager: SessionManager

  if (mapping) {
    // Resume existing session
    sessionManager = SessionManager.open(mapping.sessionFile)
    const result = await createAgentSession({
      sessionManager,
      cwd: CWD,
      tools: createCodingTools(CWD),
    })
    session = result.session
  } else {
    // Create new session
    sessionManager = SessionManager.create(CWD)
    const result = await createAgentSession({
      sessionManager,
      cwd: CWD,
      tools: createCodingTools(CWD),
    })
    session = result.session

    // Save mapping
    const sessionFile = sessionManager.getSessionFile()
    if (sessionFile) {
      await saveMapping(threadId, {
        threadId,
        sessionFile,
        createdAt: new Date().toISOString(),
      })
    }
  }

  const entry: SessionEntry = {
    session,
    sessionManager,
    busy: false,
    queue: [],
  }
  sessions.set(threadId, entry)
  return entry
}

// ─── Mapping File I/O ───────────────────────────────────────────────

async function loadMapping(threadId: string): Promise<SessionMapping | null> {
  try {
    const data = await readFile(
      resolve(SESSIONS_DIR, `${threadId}.json`),
      'utf-8',
    )
    return JSON.parse(data) as SessionMapping
  } catch {
    return null
  }
}

async function saveMapping(
  threadId: string,
  mapping: SessionMapping,
): Promise<void> {
  await mkdir(SESSIONS_DIR, { recursive: true })
  await writeFile(
    resolve(SESSIONS_DIR, `${threadId}.json`),
    JSON.stringify(mapping, null, 2),
    'utf-8',
  )
}

// ─── Response Collection ─────────────────────────────────────────────

async function collectPiResponse(
  session: AgentSession,
  prompt: string,
): Promise<string> {
  let response = ''
  const unsub = session.subscribe(event => {
    if (
      event.type === 'message_update' &&
      event.assistantMessageEvent.type === 'text_delta'
    ) {
      response += event.assistantMessageEvent.delta
    }
  })

  try {
    await session.prompt(prompt)
  } finally {
    unsub()
  }

  return response
}

// ─── Attachment Handling ─────────────────────────────────────────────

async function buildPrompt(
  text: string,
  attachments: Attachment[],
): Promise<string> {
  let prompt = text
  for (const att of attachments) {
    if (!att.size || att.size > 100_000) {
      prompt += `\n\n[Skipped attachment: ${att.name} (${att.contentType ?? 'unknown type'}, too large)]`
      continue
    }
    try {
      const resp = await fetch(att.url)
      const content = await resp.text()
      prompt += `\n\n--- ${att.name} ---\n\`\`\`\n${content}\n\`\`\``
    } catch {
      prompt += `\n\n[Could not read attachment: ${att.name}]`
    }
  }
  return prompt
}

// ─── Message Queue Processing ───────────────────────────────────────

async function processQueue(
  threadId: string,
  channel: Message['channel'],
): Promise<void> {
  const entry = sessions.get(threadId)
  if (!entry || entry.busy) return

  while (entry.queue.length > 0) {
    const { text, attachments } = entry.queue.shift()!
    entry.busy = true
    try {
      if ('sendTyping' in channel) {
        await (channel as { sendTyping(): Promise<void> }).sendTyping()
      }
      const prompt = await buildPrompt(text, attachments)
      const response = await collectPiResponse(entry.session, prompt)
      if (response) {
        await (channel as { send(content: string): Promise<unknown> }).send(
          response,
        )
      } else {
        await (channel as { send(content: string): Promise<unknown> }).send(
          '(no response)',
        )
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      try {
        await (channel as { send(content: string): Promise<unknown> }).send(
          `❌ Error: ${message}`,
        )
      } catch {
        // Channel might be unavailable
      }
    } finally {
      entry.busy = false
    }
  }
}

// ─── Discord Bot ────────────────────────────────────────────────────

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMessageTyping,
    GatewayIntentBits.MessageContent,
  ],
})

client.on(Events.ClientReady, async () => {
  console.log(`🤖 Logged in as ${client.user?.tag ?? 'unknown'}`)

  // Register /stop slash command
  const stopCommand = new SlashCommandBuilder()
    .setName('stop')
    .setDescription('현재 실행 중인 Pi 작업을 중단합니다')

  await client.application?.commands.set([stopCommand])
  console.log('📝 Slash commands registered')
})

client.on(Events.MessageCreate, async (message: Message) => {
  // Ignore bot messages
  if (message.author.bot) return

  const threadId = message.channelId

  // Check if the message is in a thread we're tracking, or if it's a new mention
  const isMention = client.user ? message.mentions.has(client.user.id) : false
  const isTrackedThread = sessions.has(threadId)

  if (!isMention && !isTrackedThread) return

  // Remove the bot mention from the message text
  const content = message.content
    .replace(/<@!\d+>/g, '')
    .replace(/<@\d+>/g, '')
    .trim()
  if (!content && message.attachments.size === 0) return

  // Get or create session
  const entry = await getOrCreateSession(threadId)

  // Enqueue message
  entry.queue.push({
    text: content,
    attachments: [...message.attachments.values()],
  })

  // Process queue
  processQueue(threadId, message.channel).catch(console.error)
})

client.on(Events.InteractionCreate, async interaction => {
  if (!interaction.isChatInputCommand()) return
  if (interaction.commandName !== 'stop') return

  const threadId = interaction.channelId
  const entry = sessions.get(threadId)

  if (entry?.busy) {
    void entry.session.abort()
    await interaction.reply('⏹ 실행을 중단했습니다.')
  } else {
    await interaction.reply('실행 중인 작업이 없습니다.')
  }
})

// ─── Start ──────────────────────────────────────────────────────────

const token = process.env.DISCORD_BOT_TOKEN
if (!token) {
  console.error('❌ DISCORD_BOT_TOKEN environment variable is required')
  process.exit(1)
}

void client.login(token)
