export function parseOllamaApiKey() {
  const apiKey = process.env.OLLAMA_API_KEY
  if (!apiKey) {
    throw new Error('OLLAMA_API_KEY not found')
  }

  return apiKey
}
