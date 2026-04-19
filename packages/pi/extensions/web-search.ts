import type { ExtensionAPI } from '@mariozechner/pi-coding-agent'
import { Static, Type } from '@sinclair/typebox'
import { Text } from '@mariozechner/pi-tui'
import { parseOllamaApiKey } from '../src/ollama'

const WebSearchResponse = Type.Object({
  results: Type.Array(
    Type.Object({
      title: Type.String(),
      url: Type.String({ format: 'uri' }),
      content: Type.String(),
    }),
  ),
})

export default function (pi: ExtensionAPI) {
  const apiKey = parseOllamaApiKey()

  pi.registerTool({
    name: 'web_search',
    label: 'Web Search',
    description:
      "Performs a web search for a single query and returns relevant results using the Ollama's web search API.",
    parameters: Type.Object({
      query: Type.String({ description: 'The search query string' }),
      max_results: Type.Optional(
        Type.Number({
          description: 'Maximum results to return',
          default: 5,
          maximum: 10,
        }),
      ),
    }),
    async execute(_toolCallId, params, signal) {
      const response = await fetch('https://ollama.com/api/web_search', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(params),
        signal,
      })

      if (!response.ok) {
        const text = await response.text()
        throw new Error(
          `Web search API error: ${response.status} ${response.statusText} - ${text}`,
        )
      }

      const data: Static<typeof WebSearchResponse> = await response.json()

      let text = ''
      text += '<web_search_results>\n'
      for (const [i, r] of data.results.entries()) {
        text += `  <result index="${i + 1}">\n`
        text += `    <title>${r.title}</title>\n`
        text += `    <url>${r.url}</url>\n`
        text += `    <content>${r.content}</content>\n`
        text += `  </result>\n`
      }
      text += `</web_search_results>`

      return { content: [{ type: 'text', text }], details: data }
    },
    renderCall(args, theme, context) {
      const text =
        (context.lastComponent as Text | undefined) ?? new Text('', 0, 0)
      let content = theme.fg('toolTitle', theme.bold('🔍 web_search '))
      content += theme.fg('muted', args.query)
      text.setText(content)
      return text
    },
    renderResult({ details }, { expanded }, theme) {
      if (!details.results.length) {
        return new Text(theme.fg('toolOutput', 'No results'), 0, 0)
      }

      let text = `${details.results.length} results`
      if (expanded) {
        for (const r of details.results) {
          text += '\n'
          if (r.title) {
            text += `Title: ${r.title}`
          } else {
            text += 'No title'
          }

          text += '\n'
          if (r.url) {
            text += `URL: ${r.url}`
          } else {
            text += 'No URL'
          }

          text += '\n'
          if (r.content) {
            text += 'Content: '
            const graphemes = [...new Intl.Segmenter().segment(r.content)].map(
              s => s.segment,
            )
            if (graphemes.length > 200) {
              text += `${graphemes.slice(0, 200).join('')}...`
            } else {
              text += r.content
            }
          } else {
            text += 'No content'
          }

          text += '\n\n---\n'
        }
      }

      return new Text(theme.fg('toolOutput', text), 0, 0)
    },
  })
}
