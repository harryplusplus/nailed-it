import type { ExtensionAPI } from '@mariozechner/pi-coding-agent'
import { setSessionId } from './client.js'
import { getBankId, ensureBankExists, configureBankMissions } from './bank.js'
import { recallAndInject } from './recall.js'
import { retainConversation } from './retain.js'
import { RECALL_ENABLED, RETAIN_ENABLED } from './config.js'

interface SessionState {
  bankId: string
  recallEnabled: boolean
  retainEnabled: boolean
}

export default async function (pi: ExtensionAPI) {
  const state: SessionState = {
    bankId: '',
    recallEnabled: RECALL_ENABLED,
    retainEnabled: RETAIN_ENABLED,
  }

  pi.on('session_start', async (_event, ctx) => {
    const sessionId = ctx.sessionManager.getSessionId()
    setSessionId(sessionId)

    state.bankId = getBankId()
    state.recallEnabled = RECALL_ENABLED
    state.retainEnabled = RETAIN_ENABLED

    const bankOk = await ensureBankExists(state.bankId)
    if (!bankOk) {
      state.recallEnabled = false
      state.retainEnabled = false
      ctx.ui.notify('Hindsight unavailable — memory disabled', 'warning')
      return
    }

    await configureBankMissions(state.bankId)
  })

  pi.on('before_agent_start', async (event, ctx) => {
    if (!state.recallEnabled) return

    const result = await recallAndInject(state.bankId, event.prompt, ctx.signal)
    if (!result) return

    return { systemPrompt: event.systemPrompt + result.systemPrompt }
  })

  pi.on('agent_end', async (_event, ctx) => {
    if (!state.retainEnabled) return

    const sessionId = ctx.sessionManager.getSessionId()
    const entries = ctx.sessionManager.getBranch()

    await retainConversation(state.bankId, sessionId, entries, ctx.signal)
  })
}
