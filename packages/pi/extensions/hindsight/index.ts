import type { ExtensionAPI } from '@mariozechner/pi-coding-agent'

export default async function (pi: ExtensionAPI) {
  const options = parseOptions()
  let state: State | null = null

  pi.on('session_start', () => {
    state = createState()
  })

  pi.on('before_agent_start', async event => {
    if (!state?.enabled) {
      return
    }
  })

  pi.on('agent_end', async event => {
    if (!state?.enabled) {
      return
    }
  })
}

type Options = {
  bankId: string
  apiUrl: string
  apiKey?: string
  recallTimeoutMs: number
  retainTimeoutMs: number
}

function parseOptions(): Options {
  const bankId = process.env.HINDSIGHT_BANK_ID || 'openclaw'
  const apiUrl = process.env.HINDSIGHT_API_URL || 'http://localhost:8080'
  const apiKey = process.env.HINDSIGHT_API_KEY

  return {
    bankId,
    apiUrl,
    apiKey,
    recallTimeoutMs: 10_000,
    retainTimeoutMs: 5_000,
  }
}

type State = { enabled: boolean }

function createState(): State {
  return { enabled: true }
}
