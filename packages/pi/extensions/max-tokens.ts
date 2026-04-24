import type { ExtensionAPI } from '@mariozechner/pi-coding-agent'

export default function (pi: ExtensionAPI) {
  pi.on('before_provider_request', (event, ctx) => {
    const model = ctx.model
    if (!model) return

    const payload = event.payload as {
      max_tokens?: number
      max_completion_tokens?: number
    }
    payload.max_tokens = model.maxTokens
    payload.max_completion_tokens = model.maxTokens
  })
}
