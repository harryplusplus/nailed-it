import { appendFileSync, mkdirSync } from 'node:fs'
import {
  RECALL_TIMEOUT_MS,
  RECALL_BUDGET,
  RECALL_MAX_TOKENS,
  RETAIN_TIMEOUT_MS,
  RETAIN_ASYNC,
  ERROR_LOG_DIR,
  RUNTIME_PREFIX,
} from './config.js'

export interface HindsightApi {
  baseUrl: string
  headers: Record<string, string>
}

export function createApi(baseUrl: string, apiKey?: string): HindsightApi {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'User-Agent': 'nailed-it-hindsight/0.1.0',
  }
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`
  }
  return { baseUrl, headers }
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

function withTimeout(
  ms: number,
  signal?: AbortSignal,
): { controller: AbortController; cleanup: () => void } {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), ms)
  const onPiAbort = () => controller.abort()
  signal?.addEventListener('abort', onPiAbort)
  const cleanup = () => {
    clearTimeout(timeoutId)
    signal?.removeEventListener('abort', onPiAbort)
  }
  return { controller, cleanup }
}

async function request(
  api: HindsightApi,
  method: string,
  path: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<Response> {
  const url = `${api.baseUrl}${path}`
  return fetch(url, {
    method,
    headers: api.headers,
    body: body ? JSON.stringify(body) : undefined,
    signal,
  })
}

export async function healthCheck(
  api: HindsightApi,
  signal?: AbortSignal,
): Promise<boolean> {
  try {
    const { controller, cleanup } = withTimeout(3_000, signal)
    const res = await request(
      api,
      'GET',
      '/health',
      undefined,
      controller.signal,
    )
    cleanup()
    return res.ok
  } catch {
    return false
  }
}

export interface RecallResult {
  text: string
  type: string
  id: string
  context?: string
  entities?: string[]
  occurred_start?: string
  occurred_end?: string
}

export interface RecallResponse {
  results: RecallResult[]
  entities?: Record<string, unknown>
  trace?: Record<string, unknown>
}

export async function recallMemories(
  api: HindsightApi,
  bankId: string,
  query: string,
  sessionId: string,
  signal?: AbortSignal,
): Promise<RecallResponse | null> {
  const { controller, cleanup } = withTimeout(RECALL_TIMEOUT_MS, signal)

  try {
    const res = await request(
      api,
      'POST',
      `/v1/default/banks/${bankId}/memories/recall`,
      { query, budget: RECALL_BUDGET, max_tokens: RECALL_MAX_TOKENS },
      controller.signal,
    )

    if (!res.ok) {
      logError('recall_error', `HTTP ${res.status}`, sessionId)
      return null
    }

    const data = (await res.json()) as RecallResponse
    if (!data.results || data.results.length === 0) return null
    return data
  } catch (e) {
    if (controller.signal.aborted && !signal?.aborted) {
      logError('recall_timeout', e, sessionId, { timeoutMs: RECALL_TIMEOUT_MS })
    } else {
      logError('recall_error', e, sessionId)
    }
    return null
  } finally {
    cleanup()
  }
}

export interface RetainResponse {
  success: boolean
  bank_id: string
  items_count: number
  async: boolean
  operation_id?: string
}

export async function retainMemories(
  api: HindsightApi,
  bankId: string,
  content: string,
  options: { documentId: string; context?: string },
  sessionId: string,
  signal?: AbortSignal,
): Promise<RetainResponse | null> {
  const { controller, cleanup } = withTimeout(RETAIN_TIMEOUT_MS, signal)

  try {
    const res = await request(
      api,
      'POST',
      `/v1/default/banks/${bankId}/memories`,
      {
        items: [
          {
            content,
            document_id: options.documentId,
            ...(options.context ? { context: options.context } : {}),
          },
        ],
        async: RETAIN_ASYNC,
      },
      controller.signal,
    )

    if (!res.ok) {
      logError('retain_error', `HTTP ${res.status}`, sessionId)
      return null
    }

    return (await res.json()) as RetainResponse
  } catch (e) {
    if (controller.signal.aborted && !signal?.aborted) {
      logError('retain_timeout', e, sessionId, { timeoutMs: RETAIN_TIMEOUT_MS })
    } else {
      logError('retain_error', e, sessionId)
    }
    return null
  } finally {
    cleanup()
  }
}

export async function getBankProfile(
  api: HindsightApi,
  bankId: string,
  signal?: AbortSignal,
): Promise<boolean> {
  try {
    const res = await request(
      api,
      'GET',
      `/v1/default/banks/${bankId}/profile`,
      undefined,
      signal,
    )
    return res.ok
  } catch {
    return false
  }
}

export async function createBank(
  api: HindsightApi,
  bankId: string,
  signal?: AbortSignal,
): Promise<boolean> {
  try {
    const res = await request(
      api,
      'PUT',
      `/v1/default/banks/${bankId}`,
      {},
      signal,
    )
    return res.ok
  } catch {
    return false
  }
}

export async function updateBankConfig(
  api: HindsightApi,
  bankId: string,
  updates: Record<string, string>,
): Promise<boolean> {
  try {
    const res = await request(
      api,
      'PATCH',
      `/v1/default/banks/${bankId}/config`,
      { updates },
    )
    return res.ok
  } catch {
    return false
  }
}
