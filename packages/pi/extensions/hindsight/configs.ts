import os from 'node:os'
import path from 'node:path'

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

type State = { sessionId: string }

export function createState(): State {
  return { sessionId: '' }
}
