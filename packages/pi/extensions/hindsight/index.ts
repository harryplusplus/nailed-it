import type { ExtensionAPI } from '@mariozechner/pi-coding-agent'
import { setSessionId } from './client.js'
import { getBankId, ensureBankExists, configureBankMissions } from './bank.js'
import { recallAndInject } from './recall.js'
import { retainConversation } from './retain.js'
import { RECALL_ENABLED, RETAIN_ENABLED } from './config.js'

let bankId = ''
let recallEnabled = RECALL_ENABLED
let retainEnabled = RETAIN_ENABLED

export default async function (pi: ExtensionAPI) {
  pi.on('session_start', async (_event, ctx) => {
    const sessionId = ctx.sessionManager.getSessionId()
    setSessionId(sessionId)

    bankId = getBankId()
    recallEnabled = RECALL_ENABLED
    retainEnabled = RETAIN_ENABLED

    const bankOk = await ensureBankExists(bankId)
    if (!bankOk) {
      recallEnabled = false
      retainEnabled = false
      ctx.ui.notify('Hindsight unavailable — memory disabled', 'warning')
      return
    }

    await configureBankMissions(bankId)
  })

  pi.on('before_agent_start', async (event, ctx) => {
    if (!recallEnabled) return

    const result = await recallAndInject(bankId, event.prompt, ctx.signal)
    if (!result) return

    return { systemPrompt: event.systemPrompt + result.systemPrompt }
  })

  pi.on('agent_end', async (_event, ctx) => {
    if (!retainEnabled) return

    const sessionId = ctx.sessionManager.getSessionId()
    const entries = ctx.sessionManager.getBranch()

    await retainConversation(bankId, sessionId, entries, ctx.signal)
  })
}
