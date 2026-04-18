import { client, healthCheck, logError } from './client.js'
import { BANK_ID_PREFIX, DEFAULT_AGENT_ID, AGENT_PROFILES } from './config.js'

export function getBankId(): string {
  const agentId = process.env.NI_AGENT_ID ?? DEFAULT_AGENT_ID
  return `${BANK_ID_PREFIX}${agentId}`
}

export async function ensureBankExists(bankId: string): Promise<boolean> {
  // Health check first
  const healthy = await healthCheck()
  if (!healthy) {
    logError('health_check_failed', 'Hindsight server unreachable')
    return false
  }

  try {
    // Try to get existing bank profile — if it exists, we're done
    await client.getBankProfile(bankId)
    return true
  } catch {
    // Bank doesn't exist, create it
  }

  try {
    await client.createBank(bankId)
    return true
  } catch (e) {
    logError('bank_create_failed', e, { bankId })
    return false
  }
}

export async function configureBankMissions(bankId: string): Promise<void> {
  const agentId = process.env.NI_AGENT_ID ?? DEFAULT_AGENT_ID
  const profile = AGENT_PROFILES[agentId]
  if (!profile) return

  try {
    await client.updateBankConfig(bankId, {
      retainMission: profile.retainMission,
      observationsMission: profile.observationsMission,
    })
  } catch (e) {
    logError('bank_config_failed', e, { bankId, agentId })
  }
}
