import type { ExtensionAPI } from '@mariozechner/pi-coding-agent'
import { Type } from '@sinclair/typebox'

export default function (pi: ExtensionAPI) {
  const apiKey = process.env.OLLAMA_API_KEY
  if (!apiKey) {
    throw new Error(
      'OLLAMA_API_KEY environment variable is required for web search',
    )
  }

  pi.registerTool({
    name: 'web-search',
    label: 'Web Search',
    description:
      "Performs a web search for a single query and returns relevant results using the Ollama's web search API.",
    parameters: Type.Object({
      query: Type.String({ description: 'The search query string' }),
      max_results: Type.Number({
        description: 'Maximum results to return',
        default: 5,
        maximum: 10,
      }),
    }),
    async execute(_toolCallId, params, signal) {
      const response = await fetch('https://ollama.com/api/web_search', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify(params),
        signal,
      })
      if (!response.ok) {
        const text = await response.text()
        throw new Error(
          `Web search API error: ${response.status} ${response.statusText} - ${text}`,
        )
      }
      const data = await response.json()
      const text = data.results
        .map(
          (r: any, i: number) =>
            `[${i + 1}] ${r.title}\n${r.url}\n${r.content}`,
        )
        .join('\n\n')
      return { content: [{ type: 'text', text }], details: data }
    },
  })
}
