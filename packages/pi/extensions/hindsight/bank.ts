import type { HindsightClients } from './client.js'
import { healthCheck, logError } from './client.js'
import { BANK_ID_PREFIX, DEFAULT_AGENT_ID, AGENT_PROFILES } from './config.js'

export function getBankId(): string {
  const agentId = process.env.NI_AGENT_ID ?? DEFAULT_AGENT_ID
  return `${BANK_ID_PREFIX}${agentId}`
}

export async function ensureBankExists(
  clients: HindsightClients,
  bankId: string,
  sessionId: string,
): Promise<boolean> {
  const healthy = await healthCheck(clients)
  if (!healthy) {
    logError('health_check_failed', 'Hindsight server unreachable', sessionId)
    return false
  }

  try {
    await clients.highLevel.getBankProfile(bankId)
    return true
  } catch {}

  try {
    await clients.highLevel.createBank(bankId)
    return true
  } catch (e) {
    logError('bank_create_failed', e, sessionId, { bankId })
    return false
  }
}

export async function configureBankMissions(
  clients: HindsightClients,
  bankId: string,
  sessionId: string,
): Promise<void> {
  const agentId = process.env.NI_AGENT_ID ?? DEFAULT_AGENT_ID
  const profile = AGENT_PROFILES[agentId]
  if (!profile) return

  try {
    await clients.highLevel.updateBankConfig(bankId, {
      retainMission: profile.retainMission,
      observationsMission: profile.observationsMission,
    })
  } catch (e) {
    logError('bank_config_failed', e, sessionId, { bankId, agentId })
  }
}
