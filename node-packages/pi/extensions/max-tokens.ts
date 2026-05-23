import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'

export default function (pi: ExtensionAPI) {
  pi.on('before_provider_request', (event, ctx) => {
    const model = ctx.model
    if (!model) return

    const payload = event.payload as { max_tokens?: number }
    payload.max_tokens = model.maxTokens
  })
}
