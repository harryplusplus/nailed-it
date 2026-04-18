import { recallWithTimeout, recallResponseToPromptString } from './client.js'
import {
  RECALL_ENABLED,
  RECALL_PROMPT_HEADER,
  RECALL_PROMPT_FOOTER,
} from './config.js'

export async function recallAndInject(
  bankId: string,
  userMessage: string,
  sessionId: string,
  signal?: AbortSignal,
): Promise<{ systemPrompt: string } | undefined> {
  if (!RECALL_ENABLED) return undefined

  const response = await recallWithTimeout(
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
