import { appendFileSync, mkdirSync } from 'node:fs'
import {
  HindsightClient,
  createClient,
  createConfig,
  sdk,
} from '@vectorize-io/hindsight-client'
import type {
  Client,
  RecallResponse,
  RetainResponse,
} from '@vectorize-io/hindsight-client'
import {
  RECALL_TIMEOUT_MS,
  RECALL_BUDGET,
  RECALL_MAX_TOKENS,
  RETAIN_TIMEOUT_MS,
  RETAIN_ASYNC,
  ERROR_LOG_DIR,
  RUNTIME_PREFIX,
} from './config.js'

export interface HindsightClients {
  internal: Client
  highLevel: HindsightClient
  baseUrl: string
}

export function createClients(
  baseUrl: string,
  apiKey?: string,
): HindsightClients {
  const headers: Record<string, string> = {
    'User-Agent': 'nailed-it-hindsight/0.1.0',
  }
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`
  }

  return {
    internal: createClient(createConfig({ baseUrl, headers })),
    highLevel: new HindsightClient({ baseUrl, apiKey }),
    baseUrl,
  }
}

export function logError(
  event: string,
  error: unknown,
  sessionId: string,
  context?: Record<string, unknown>,
) {
  try {
    mkdirSync(ERROR_LOG_DIR, { recursive: true })
    const entry = JSON.stringify({
      ts: new Date().toISOString(),
      event,
      error:
        error instanceof Error
          ? { message: error.message, name: error.name }
          : String(error),
      sessionId,
      ...context,
    })
    const logPath = `${ERROR_LOG_DIR}/${RUNTIME_PREFIX}-session-${sessionId}.jsonl`
    appendFileSync(logPath, entry + '\n')
  } catch {
    // logging failure must not affect extension behavior
  }
}

export async function recallWithTimeout(
  clients: HindsightClients,
  bankId: string,
  query: string,
  sessionId: string,
  signal?: AbortSignal,
): Promise<RecallResponse | null> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), RECALL_TIMEOUT_MS)

  const onPiAbort = () => controller.abort()
  signal?.addEventListener('abort', onPiAbort)

  try {
    const response = await sdk.recallMemories({
      client: clients.internal,
      path: { bank_id: bankId },
      body: { query, budget: RECALL_BUDGET, max_tokens: RECALL_MAX_TOKENS },
      signal: controller.signal,
    })

    if (!response.data) {
      logError('recall_empty', 'No data in response', sessionId)
      return null
    }

    return response.data as RecallResponse
  } catch (e) {
    if (controller.signal.aborted && !signal?.aborted) {
      logError('recall_timeout', e, sessionId, { timeoutMs: RECALL_TIMEOUT_MS })
    } else {
      logError('recall_error', e, sessionId)
    }
    return null
  } finally {
    clearTimeout(timeoutId)
    signal?.removeEventListener('abort', onPiAbort)
  }
}

export async function retainWithTimeout(
  clients: HindsightClients,
  bankId: string,
  content: string,
  options: { documentId: string; context?: string },
  sessionId: string,
  signal?: AbortSignal,
): Promise<RetainResponse | null> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), RETAIN_TIMEOUT_MS)

  const onPiAbort = () => controller.abort()
  signal?.addEventListener('abort', onPiAbort)

  try {
    const response = await sdk.retainMemories({
      client: clients.internal,
      path: { bank_id: bankId },
      body: {
        items: [
          {
            content,
            document_id: options.documentId,
            ...(options.context ? { context: options.context } : {}),
          },
        ],
        async: RETAIN_ASYNC,
      },
      signal: controller.signal,
    })

    if (!response.data) {
      logError('retain_empty', 'No data in response', sessionId)
      return null
    }

    return response.data as RetainResponse
  } catch (e) {
    if (controller.signal.aborted && !signal?.aborted) {
      logError('retain_timeout', e, sessionId, { timeoutMs: RETAIN_TIMEOUT_MS })
    } else {
      logError('retain_error', e, sessionId)
    }
    return null
  } finally {
    clearTimeout(timeoutId)
    signal?.removeEventListener('abort', onPiAbort)
  }
}

export async function healthCheck(clients: HindsightClients): Promise<boolean> {
  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 3_000)
    const response = await fetch(`${clients.baseUrl}/health`, {
      signal: controller.signal,
    })
    clearTimeout(timeoutId)
    return response.ok
  } catch {
    return false
  }
}
