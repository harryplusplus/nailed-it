import type { ExtensionAPI } from '@mariozechner/pi-coding-agent'
import { parseOllamaApiKey } from '../src/ollama'
import { Static, Type } from '@sinclair/typebox'
import { Text } from '@mariozechner/pi-tui'

const WebFetchResponse = Type.Object({
  title: Type.String(),
  content: Type.String(),
  links: Type.Array(Type.String({ format: 'uri' })),
})

export default function (pi: ExtensionAPI) {
  const apiKey = parseOllamaApiKey()

  pi.registerTool({
    name: 'web_fetch',
    label: 'Web Fetch',
    description:
      'Fetches a single web page by URL and returns its content using the Ollama Web fetch API.',
    parameters: Type.Object({
      url: Type.String({ format: 'uri', description: 'The URL to fetch' }),
    }),
    async execute(_toolCallId, params, signal) {
      const response = await fetch('https://ollama.com/api/web_fetch', {
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
          `Web fetch error: ${response.status} ${response.statusText} - ${text}`,
        )
      }

      const data: Static<typeof WebFetchResponse> = await response.json()

      let text = ''
      text += `<web_fetch_result>\n`
      text += `  <title>${data.title}</title>\n`
      text += `  <content>\n${data.content}\n</content>\n`
      if (data.links.length > 0) {
        text += `  <links>\n`
        for (const link of data.links) {
          text += `    <link>${link}</link>\n`
        }
        text += `  </links>\n`
      }
      text += `</web_fetch_result>`

      return { content: [{ type: 'text', text }], details: data }
    },
    renderCall(args, theme, context) {
      const text =
        (context.lastComponent as Text | undefined) ?? new Text('', 0, 0)
      let content = theme.fg('toolTitle', theme.bold('🌐 web_fetch '))
      content += theme.fg('muted', args.url)
      text.setText(content)
      return text
    },
    renderResult({ details }, { expanded }, theme) {
      let text = ''
      if (details.title) {
        text += `Title: ${details.title}`
      } else {
        text += 'No title'
      }

      if (expanded) {
        if (text) {
          text += '\n'
        }

        const graphemes = [
          ...new Intl.Segmenter().segment(details.content),
        ].map(s => s.segment)
        if (graphemes.length > 200) {
          text += `${graphemes.slice(0, 200).join('')}...`
        } else if (details.content) {
          text += details.content
        } else {
          text += 'No content'
        }
      }

      return new Text(theme.fg('toolOutput', text), 0, 0)
    },
  })
}
