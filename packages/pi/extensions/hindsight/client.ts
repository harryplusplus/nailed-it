import { appendFileSync, mkdirSync } from 'node:fs'
import {
  HindsightClient,
  createClient,
  createConfig,
  sdk,
  recallResponseToPromptString,
} from '@vectorize-io/hindsight-client'
import type {
  Client,
  RecallResponse,
  RetainResponse,
} from '@vectorize-io/hindsight-client'
import {
  HINDSIGHT_BASE_URL,
  HINDSIGHT_API_KEY,
  RECALL_TIMEOUT_MS,
  RECALL_BUDGET,
  RECALL_MAX_TOKENS,
  RETAIN_TIMEOUT_MS,
  RETAIN_ASYNC,
  ERROR_LOG_DIR,
  RUNTIME_PREFIX,
} from './config.js'

// ─── Low-level client (supports AbortSignal via RequestInit) ───

const headers: Record<string, string> = {
  'User-Agent': 'nailed-it-hindsight/0.1.0',
}
if (HINDSIGHT_API_KEY) {
  headers.Authorization = `Bearer ${HINDSIGHT_API_KEY}`
}

const internalClient: Client = createClient(
  createConfig({ baseUrl: HINDSIGHT_BASE_URL, headers }),
)

// ─── High-level client (for bank management) ───

export const client = new HindsightClient({
  baseUrl: HINDSIGHT_BASE_URL,
  apiKey: HINDSIGHT_API_KEY ?? undefined,
})

export { recallResponseToPromptString }

// ─── Error logging ───

let currentSessionId = 'unknown'

export function setSessionId(id: string) {
  currentSessionId = id
}

export function logError(
  event: string,
  error: unknown,
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
      sessionId: currentSessionId,
      ...context,
    })
    const logPath = `${ERROR_LOG_DIR}/${RUNTIME_PREFIX}-session-${currentSessionId}.jsonl`
    appendFileSync(logPath, entry + '\n')
  } catch {
    // logging failure must not affect extension behavior
  }
}

// ─── Recall with timeout ───

export async function recallWithTimeout(
  bankId: string,
  query: string,
  signal?: AbortSignal,
): Promise<RecallResponse | null> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), RECALL_TIMEOUT_MS)

  const onPiAbort = () => controller.abort()
  signal?.addEventListener('abort', onPiAbort)

  try {
    const response = await sdk.recallMemories({
      client: internalClient,
      path: { bank_id: bankId },
      body: { query, budget: RECALL_BUDGET, max_tokens: RECALL_MAX_TOKENS },
      signal: controller.signal,
    })

    if (!response.data) {
      logError('recall_empty', 'No data in response')
      return null
    }

    return response.data as RecallResponse
  } catch (e) {
    if (controller.signal.aborted && !signal?.aborted) {
      logError('recall_timeout', e, { timeoutMs: RECALL_TIMEOUT_MS })
    } else {
      logError('recall_error', e)
    }
    return null
  } finally {
    clearTimeout(timeoutId)
    signal?.removeEventListener('abort', onPiAbort)
  }
}

// ─── Retain with timeout ───

export async function retainWithTimeout(
  bankId: string,
  content: string,
  options: { documentId: string; context?: string },
  signal?: AbortSignal,
): Promise<RetainResponse | null> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), RETAIN_TIMEOUT_MS)

  const onPiAbort = () => controller.abort()
  signal?.addEventListener('abort', onPiAbort)

  try {
    const response = await sdk.retainMemories({
      client: internalClient,
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
      logError('retain_empty', 'No data in response')
      return null
    }

    return response.data as RetainResponse
  } catch (e) {
    if (controller.signal.aborted && !signal?.aborted) {
      logError('retain_timeout', e, { timeoutMs: RETAIN_TIMEOUT_MS })
    } else {
      logError('retain_error', e)
    }
    return null
  } finally {
    clearTimeout(timeoutId)
    signal?.removeEventListener('abort', onPiAbort)
  }
}

// ─── Health check ───

export async function healthCheck(): Promise<boolean> {
  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 3_000)
    const response = await fetch(`${HINDSIGHT_BASE_URL}/health`, {
      signal: controller.signal,
    })
    clearTimeout(timeoutId)
    return response.ok
  } catch {
    return false
  }
}
