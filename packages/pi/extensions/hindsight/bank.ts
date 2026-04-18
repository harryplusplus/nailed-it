import type { HindsightApi } from './client.js'
import {
  healthCheck,
  getBankProfile,
  createBank,
  updateBankConfig,
  logError,
} from './client.js'
import { BANK_ID_PREFIX, DEFAULT_AGENT_ID, AGENT_PROFILES } from './config.js'

export function getBankId(): string {
  const agentId = process.env.NI_AGENT_ID ?? DEFAULT_AGENT_ID
  return `${BANK_ID_PREFIX}${agentId}`
}

export async function ensureBankExists(
  api: HindsightApi,
  bankId: string,
  sessionId: string,
  signal?: AbortSignal,
): Promise<boolean> {
  const healthy = await healthCheck(api, signal)
  if (!healthy) {
    logError('health_check_failed', 'Hindsight server unreachable', sessionId)
    return false
  }

  const exists = await getBankProfile(api, bankId, signal)
  if (exists) return true

  const created = await createBank(api, bankId, signal)
  if (!created) {
    logError('bank_create_failed', 'Failed to create bank', sessionId, {
      bankId,
    })
    return false
  }

  return true
}

export async function configureBankMissions(
  api: HindsightApi,
  bankId: string,
  sessionId: string,
): Promise<void> {
  const agentId = process.env.NI_AGENT_ID ?? DEFAULT_AGENT_ID
  const profile = AGENT_PROFILES[agentId]
  if (!profile) return

  const ok = await updateBankConfig(api, bankId, {
    retain_mission: profile.retainMission,
    observations_mission: profile.observationsMission,
  })
  if (!ok) {
    logError('bank_config_failed', 'Failed to update bank config', sessionId, {
      bankId,
      agentId,
    })
  }
}
