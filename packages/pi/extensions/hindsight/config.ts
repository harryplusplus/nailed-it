export const RECALL_TIMEOUT_MS = 10_000
export const RECALL_BUDGET = 'mid' as const
export const RECALL_MAX_TOKENS = 4096

export const RETAIN_TIMEOUT_MS = 5_000
export const RETAIN_ASYNC = true

export const BANK_ID_PREFIX = 'pi-'
export const DEFAULT_AGENT_ID = 'coding'
export const RUNTIME_PREFIX = 'pi'

export const RECALL_PROMPT_HEADER = '<hindsight_recall>'
export const RECALL_PROMPT_FOOTER = '</hindsight_recall>'

export const ERROR_LOG_DIR = `${process.env.HOME}/.nailed-it/logs`

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
