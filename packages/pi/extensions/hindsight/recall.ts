import type { HindsightApi } from './client.js'
import { recallMemories, recallResponseToPromptString } from './client.js'
import { RECALL_PROMPT_HEADER, RECALL_PROMPT_FOOTER } from './configs.js'

export async function recallAndInject(
  api: HindsightApi,
  bankId: string,
  userMessage: string,
  sessionId: string,
  signal?: AbortSignal,
): Promise<{ systemPrompt: string } | undefined> {
  const response = await recallMemories(
    api,
    bankId,
    userMessage,
    sessionId,
    signal,
  )
  if (!response) return undefined

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
