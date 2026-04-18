import { recallWithTimeout } from './client.js'
import type { HindsightClients } from './client.js'
import { recallResponseToPromptString } from '@vectorize-io/hindsight-client'
import { RECALL_PROMPT_HEADER, RECALL_PROMPT_FOOTER } from './config.js'

export async function recallAndInject(
  clients: HindsightClients,
  bankId: string,
  userMessage: string,
  sessionId: string,
  signal?: AbortSignal,
): Promise<{ systemPrompt: string } | undefined> {
  const response = await recallWithTimeout(
    clients,
    bankId,
    userMessage,
    sessionId,
    signal,
  )
  if (!response || !response.results || response.results.length === 0) {
    return undefined
  }

  const memorySection = recallResponseToPromptString(response)

  return {
    systemPrompt:
      '\n\n' +
      RECALL_PROMPT_HEADER +
      '\n' +
      memorySection +
      '\n' +
      RECALL_PROMPT_FOOTER,
  }
}
