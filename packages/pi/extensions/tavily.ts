import type { ExtensionAPI } from '@mariozechner/pi-coding-agent'
import { Static, Type } from 'typebox'
import { Text } from '@mariozechner/pi-tui'

const TavilySearchResponse = Type.Object({
  query: Type.String(),
  results: Type.Array(
    Type.Object({
      title: Type.String(),
      url: Type.String({ format: 'uri' }),
      content: Type.String(),
      score: Type.Number(),
    }),
  ),
  answer: Type.Optional(Type.String()),
})

export default function (pi: ExtensionAPI) {
  const apiKey = process.env.TAVILY_API_KEY
  if (!apiKey) {
    throw new Error('TAVILY_API_KEY environment variable is required')
  }

  pi.registerTool({
    name: 'tavily_search',
    label: 'Tavily Search',
    description:
      'Performs a real-time web search via Tavily and returns relevant results with optional AI-generated answer.',
    parameters: Type.Object({
      query: Type.String({ description: 'The search query string' }),
      max_results: Type.Optional(
        Type.Number({
          description: 'Maximum results to return (1-20)',
          default: 5,
          minimum: 1,
          maximum: 20,
        }),
      ),
      search_depth: Type.Optional(
        Type.Union([Type.Literal('basic'), Type.Literal('advanced')], {
          description: 'Search depth: basic (fast) or advanced (comprehensive)',
          default: 'basic',
        }),
      ),
      include_answer: Type.Optional(
        Type.Boolean({
          description: 'Include an AI-generated answer summarizing results',
          default: false,
        }),
      ),
    }),
    async execute(_toolCallId, params, signal) {
      const response = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          api_key: apiKey,
          query: params.query,
          max_results: params.max_results ?? 5,
          search_depth: params.search_depth ?? 'basic',
          include_answer: params.include_answer ?? false,
        }),
        signal,
      })

      if (!response.ok) {
        const text = await response.text()
        throw new Error(
          `Tavily search error: ${response.status} ${response.statusText} - ${text}`,
        )
      }

      const data: Static<typeof TavilySearchResponse> = await response.json()

      let text = ''
      text += '<tavily_search_results>\n'
      if (data.answer) {
        text += `  <answer>${data.answer}</answer>\n`
      }
      for (const [i, r] of data.results.entries()) {
        text += `  <result index="${i + 1}">\n`
        text += `    <title>${r.title}</title>\n`
        text += `    <url>${r.url}</url>\n`
        text += `    <content>${r.content}</content>\n`
        text += `    <score>${r.score}</score>\n`
        text += `  </result>\n`
      }
      text += '</tavily_search_results>'

      return { content: [{ type: 'text', text }], details: data }
    },
    renderCall(args, theme, context) {
      const text =
        (context.lastComponent as Text | undefined) ?? new Text('', 0, 0)
      let content = theme.fg('toolTitle', theme.bold('🔍 tavily_search '))
      content += theme.fg('muted', args.query)
      text.setText(content)
      return text
    },
    renderResult({ details }, { expanded }, theme) {
      let text = `${details.results.length} results`
      if (details.answer) {
        text += ` | Answer: ${details.answer.slice(0, 100)}${details.answer.length > 100 ? '...' : ''}`
      }

      if (expanded) {
        for (const r of details.results) {
          text += '\n'
          text += `Title: ${r.title}\n`
          text += `URL: ${r.url}\n`

          const graphemes = [...new Intl.Segmenter().segment(r.content)].map(
            s => s.segment,
          )
          if (graphemes.length > 200) {
            text += `Content: ${graphemes.slice(0, 200).join('')}...`
          } else {
            text += `Content: ${r.content}`
          }

          text += '\n\n---\n'
        }
      }

      return new Text(theme.fg('toolOutput', text), 0, 0)
    },
  })
}
