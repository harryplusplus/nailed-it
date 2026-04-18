import type { ExtensionAPI } from '@mariozechner/pi-coding-agent'
import type { HindsightApi } from './client.js'
import { createApi } from './client.js'
import { getBankId, ensureBankExists, configureBankMissions } from './bank.js'
import { recallAndInject } from './recall.js'
import { retainConversation } from './retain.js'

interface SessionState {
  sessionId: string
  bankId: string
  api: HindsightApi
  recallEnabled: boolean
  retainEnabled: boolean
}

function initState(): SessionState {
  const baseUrl = process.env.HINDSIGHT_API_URL ?? 'http://localhost:8888'
  const apiKey = process.env.HINDSIGHT_API_KEY

  return {
    sessionId: '',
    bankId: getBankId(),
    api: createApi(baseUrl, apiKey),
    recallEnabled: true,
    retainEnabled: true,
  }
}

export default async function (pi: ExtensionAPI) {
  const state = initState()

  pi.on('session_start', async (_event, ctx) => {
    state.sessionId = ctx.sessionManager.getSessionId()
    state.bankId = getBankId()
    state.recallEnabled = true
    state.retainEnabled = true

    const bankOk = await ensureBankExists(
      state.api,
      state.bankId,
      state.sessionId,
      ctx.signal,
    )
    if (!bankOk) {
      state.recallEnabled = false
      state.retainEnabled = false
      ctx.ui.notify('Hindsight unavailable — memory disabled', 'warning')
      return
    }

    await configureBankMissions(state.api, state.bankId, state.sessionId)
  })

  pi.on('before_agent_start', async (event, ctx) => {
    if (!state.recallEnabled) return

    const result = await recallAndInject(
      state.api,
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
      state.api,
      state.bankId,
      sessionId,
      entries,
      ctx.signal,
    )
  })
}
