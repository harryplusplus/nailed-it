import type { ExtensionAPI } from '@mariozechner/pi-coding-agent'
import type { HindsightClients } from './client.js'
import { createClients } from './client.js'
import { getBankId, ensureBankExists, configureBankMissions } from './bank.js'
import { recallAndInject } from './recall.js'
import { retainConversation } from './retain.js'
import { RECALL_ENABLED, RETAIN_ENABLED } from './config.js'

interface SessionState {
  sessionId: string
  bankId: string
  clients: HindsightClients
  recallEnabled: boolean
  retainEnabled: boolean
}

function initState(): SessionState {
  const baseUrl = process.env.HINDSIGHT_API_URL ?? 'http://localhost:8888'
  const apiKey = process.env.HINDSIGHT_API_KEY

  return {
    sessionId: '',
    bankId: getBankId(),
    clients: createClients(baseUrl, apiKey),
    recallEnabled: RECALL_ENABLED,
    retainEnabled: RETAIN_ENABLED,
  }
}

export default async function (pi: ExtensionAPI) {
  const state = initState()

  pi.on('session_start', async (_event, ctx) => {
    state.sessionId = ctx.sessionManager.getSessionId()
    state.bankId = getBankId()
    state.recallEnabled = RECALL_ENABLED
    state.retainEnabled = RETAIN_ENABLED

    const bankOk = await ensureBankExists(
      state.clients,
      state.bankId,
      state.sessionId,
    )
    if (!bankOk) {
      state.recallEnabled = false
      state.retainEnabled = false
      ctx.ui.notify('Hindsight unavailable — memory disabled', 'warning')
      return
    }

    await configureBankMissions(state.clients, state.bankId, state.sessionId)
  })

  pi.on('before_agent_start', async (event, ctx) => {
    if (!state.recallEnabled) return

    const result = await recallAndInject(
      state.clients,
      state.bankId,
      event.prompt,
      state.sessionId,
      ctx.signal,
    )
    if (!result) return

    return { systemPrompt: event.systemPrompt + result.systemPrompt }
  })

  pi.on('agent_end', async (_event, ctx) => {
    if (!state.retainEnabled) return

    const sessionId = ctx.sessionManager.getSessionId()
    const entries = ctx.sessionManager.getBranch()

    await retainConversation(
      state.clients,
      state.bankId,
      sessionId,
      entries,
      ctx.signal,
    )
  })
}
