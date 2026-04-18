import os from 'node:os'
import path from 'node:path'

export const RECALL_PROMPT_HEADER = '<hindsight_recall>'
export const RECALL_PROMPT_FOOTER = '</hindsight_recall>'

export interface AgentProfile {
  retainMission: string
  observationsMission: string
}

export const AGENT_PROFILES: Record<string, AgentProfile> = {
  coding: {
    retainMission:
      'Always include technical decisions, architecture choices, debugging patterns, and user coding preferences. Ignore greetings and social exchanges.',
    observationsMission:
      'Observations are stable facts about projects, codebases, and user preferences. Include recurring patterns and preferences. Ignore one-off events.',
  },
  research: {
    retainMission:
      'Always include research topics, key findings, source quality, and user interests. Ignore greetings and social exchanges.',
    observationsMission:
      'Observations are stable facts about research domains and user interests. Include recurring themes and knowledge gaps. Ignore one-off events.',
  },
}

export type Options = {
  bankId: string
  recallTimeoutMs: number
  retainTimeoutMs: number
  logsDir: string
}

export function parseOptions(): Options {
  const bankId = process.env.HINDSIGHT_BANK_ID
  if (!bankId) {
    throw new Error('HINDSIGHT_BANK_ID is required')
  }

  const logsDir = path.join(os.homedir(), '.nailed-it', 'logs')
  return { bankId, recallTimeoutMs: 10_000, retainTimeoutMs: 5_000, logsDir }
}
