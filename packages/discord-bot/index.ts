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
import {
  Effect,
  Layer,
  Context,
  Queue,
  Ref,
  ManagedRuntime,
  Fiber,
} from 'effect'

const CWD = process.cwd()
const SESSIONS_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  'sessions',
)

interface SessionMapping {
  threadId: string
  sessionFile: string
  createdAt: string
}

interface SessionEntry {
  session: AgentSession
  sessionManager: SessionManager
  queue: Queue.Queue<{ text: string; attachments: Attachment[] }>
  fiber: Fiber.RuntimeFiber<never, void>
}

// ─── Services ────────────────────────────────────────────────────────────────

class DiscordClient extends Context.Tag('DiscordClient')<
  DiscordClient,
  Client
>() {}

class SessionStore extends Context.Tag('SessionStore')<
  SessionStore,
  Ref.Ref<Map<string, SessionEntry>>
>() {}

// ─── Session lifecycle ──────────────────────────────────────────────────────

const loadMapping = (threadId: string) =>
  Effect.tryPromise({
    try: () =>
      readFile(resolve(SESSIONS_DIR, `${threadId}.json`), 'utf-8').then(
        data => JSON.parse(data) as SessionMapping,
      ),
    catch: () => null as SessionMapping | null,
  })

const saveMapping = (threadId: string, mapping: SessionMapping) =>
  Effect.tryPromise({
    try: () =>
      mkdir(SESSIONS_DIR, { recursive: true }).then(() =>
        writeFile(
          resolve(SESSIONS_DIR, `${threadId}.json`),
          JSON.stringify(mapping, null, 2),
          'utf-8',
        ),
      ),
    catch: () => {},
  })

const getOrCreateSession = (threadId: string, channel: Message['channel']) =>
  Effect.gen(function* () {
    const store = yield* SessionStore
    const sessions = yield* Ref.get(store)
    const existing = sessions.get(threadId)
    if (existing) return existing

    const mapping = yield* loadMapping(threadId)
    let session: AgentSession
    let sessionManager: SessionManager

    if (mapping) {
      sessionManager = SessionManager.open(mapping.sessionFile)
      const result = yield* Effect.tryPromise({
        try: () =>
          createAgentSession({
            sessionManager,
            cwd: CWD,
            tools: createCodingTools(CWD),
          }),
        catch: e => new Error(String(e)),
      })
      session = result.session
    } else {
      sessionManager = SessionManager.create(CWD)
      const result = yield* Effect.tryPromise({
        try: () =>
          createAgentSession({
            sessionManager,
            cwd: CWD,
            tools: createCodingTools(CWD),
          }),
        catch: e => new Error(String(e)),
      })
      session = result.session

      const sessionFile = sessionManager.getSessionFile()
      if (sessionFile) {
        yield* saveMapping(threadId, {
          threadId,
          sessionFile,
          createdAt: new Date().toISOString(),
        })
      }
    }

    const queue = yield* Queue.unbounded<{
      text: string
      attachments: Attachment[]
    }>()
    const fiber = yield* Effect.fork(
      processQueue(threadId, channel, session, queue),
    )
    const entry: SessionEntry = { session, sessionManager, queue, fiber }
    yield* Ref.update(store, m => new Map(m).set(threadId, entry))
    return entry
  })

// ─── Message processing ──────────────────────────────────────────────────────

const collectPiResponse = (session: AgentSession, prompt: string) =>
  Effect.async<string>(resume => {
    let response = ''
    const unsub = session.subscribe(event => {
      if (
        event.type === 'message_update' &&
        event.assistantMessageEvent.type === 'text_delta'
      ) {
        response += event.assistantMessageEvent.delta
      }
    })

    session
      .prompt(prompt)
      .then(() => {
        unsub()
        resume(Effect.succeed(response))
      })
      .catch(e => {
        unsub()
        resume(
          Effect.succeed(
            `❌ Error: ${e instanceof Error ? e.message : String(e)}`,
          ),
        )
      })
  })

const buildPrompt = (text: string, attachments: Attachment[]) =>
  Effect.gen(function* () {
    let prompt = text
    for (const att of attachments) {
      if (!att.size || att.size > 100_000) {
        prompt += `\n\n[Skipped attachment: ${att.name} (${att.contentType ?? 'unknown type'}, too large)]`
        continue
      }
      const content = yield* Effect.tryPromise({
        try: () => fetch(att.url).then(r => r.text()),
        catch: () => null as string | null,
      })
      if (content) {
        prompt += `\n\n--- ${att.name} ---\n\`\`\`\n${content}\n\`\`\``
      } else {
        prompt += `\n\n[Could not read attachment: ${att.name}]`
      }
    }
    return prompt
  })

const processQueue = (
  threadId: string,
  channel: Message['channel'],
  session: AgentSession,
  queue: Queue.Queue<{ text: string; attachments: Attachment[] }>,
) =>
  Effect.gen(function* () {
    while (true) {
      const item = yield* Queue.take(queue)

      if ('sendTyping' in channel) {
        yield* Effect.tryPromise({
          try: () => (channel as { sendTyping(): Promise<void> }).sendTyping(),
          catch: () => {},
        })
      }

      const prompt = yield* buildPrompt(item.text, item.attachments)
      const response = yield* collectPiResponse(session, prompt)

      yield* Effect.tryPromise({
        try: () =>
          (channel as { send(content: string): Promise<unknown> }).send(
            response || '(no response)',
          ),
        catch: () => {},
      })
    }
  })

// ─── Event handlers ──────────────────────────────────────────────────────────

const handleMessageCreate = (message: Message) =>
  Effect.gen(function* () {
    const client = yield* DiscordClient
    if (message.author.bot) return

    const threadId = message.channelId
    const isMention = client.user ? message.mentions.has(client.user.id) : false
    const store = yield* SessionStore
    const isTrackedThread = (yield* Ref.get(store)).has(threadId)

    if (!isMention && !isTrackedThread) return

    const content = message.content
      .replace(/<@!\d+>/g, '')
      .replace(/<@\d+>/g, '')
      .trim()
    if (!content && message.attachments.size === 0) return

    const entry = yield* getOrCreateSession(threadId, message.channel)
    yield* Queue.offer(entry.queue, {
      text: content,
      attachments: [...message.attachments.values()],
    })
  })

const handleInteractionCreate = (interaction: unknown) =>
  Effect.gen(function* () {
    if (
      typeof interaction !== 'object' ||
      interaction === null ||
      !('isChatInputCommand' in interaction) ||
      typeof (interaction as any).isChatInputCommand !== 'function' ||
      !(interaction as any).isChatInputCommand()
    )
      return
    if ((interaction as any).commandName !== 'stop') return

    const threadId = (interaction as any).channelId
    const store = yield* SessionStore
    const sessions = yield* Ref.get(store)
    const entry = sessions.get(threadId)

    if (entry) {
      void entry.session.abort()
      yield* Effect.tryPromise({
        try: () => (interaction as any).reply('⏹ 실행을 중단했습니다.'),
        catch: () => {},
      })
    } else {
      yield* Effect.tryPromise({
        try: () => (interaction as any).reply('실행 중인 작업이 없습니다.'),
        catch: () => {},
      })
    }
  })

// ─── Layers ──────────────────────────────────────────────────────────────────

const DiscordClientLive = Layer.sync(DiscordClient, () => {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.GuildMessageTyping,
      GatewayIntentBits.MessageContent,
    ],
  })
  return client
})

const SessionStoreLive = Layer.effect(
  SessionStore,
  Ref.make(new Map<string, SessionEntry>()),
)

// ─── Main ────────────────────────────────────────────────────────────────────

const MainLayer = Layer.merge(DiscordClientLive, SessionStoreLive)
const runtime = ManagedRuntime.make(MainLayer)

const program = Effect.gen(function* () {
  const client = yield* DiscordClient

  client.on(Events.ClientReady, async () => {
    console.log(`🤖 Logged in as ${client.user?.tag ?? 'unknown'}`)

    const stopCommand = new SlashCommandBuilder()
      .setName('stop')
      .setDescription('현재 실행 중인 Pi 작업을 중단합니다')

    await client.application?.commands.set([stopCommand])
    console.log('📝 Slash commands registered')
  })

  client.on(Events.MessageCreate, message => {
    runtime.runFork(handleMessageCreate(message))
  })

  client.on(Events.InteractionCreate, interaction => {
    runtime.runFork(handleInteractionCreate(interaction))
  })

  const token = process.env.DISCORD_BOT_TOKEN
  if (!token) {
    console.error('❌ DISCORD_BOT_TOKEN environment variable is required')
    yield* Effect.fail(new Error('DISCORD_BOT_TOKEN not set'))
  }

  yield* Effect.tryPromise({
    try: () => client.login(token!),
    catch: e => new Error(`Login failed: ${String(e)}`),
  })
})

await runtime.runPromise(program)
