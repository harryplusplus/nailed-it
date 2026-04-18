import type { HindsightApi, RecallResponse } from './client.js'
import { recallMemories } from './client.js'
import { RECALL_PROMPT_HEADER, RECALL_PROMPT_FOOTER } from './config.js'

function recallResponseToPromptString(response: RecallResponse): string {
  return response.results
    .map(r => {
      const parts = [r.text]
      if (r.context) parts.push(`  context: ${r.context}`)
      if (r.entities?.length) parts.push(`  entities: ${r.entities.join(', ')}`)
      return parts.join('\n')
    })
    .join('\n\n')
}

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
