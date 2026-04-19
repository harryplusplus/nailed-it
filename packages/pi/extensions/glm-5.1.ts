import type { ExtensionAPI } from '@mariozechner/pi-coding-agent'

export default function (pi: ExtensionAPI) {
  pi.on('before_provider_request', event => {
    const payload = event.payload as { max_tokens?: number }
    payload.max_tokens = 131072
  })
}
