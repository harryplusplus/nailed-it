export function parseOllamaApiKey() {
  const { OLLAMA_API_KEY } = process.env
  if (!OLLAMA_API_KEY) {
    throw new Error('OLLAMA_API_KEY not found')
  }

  return OLLAMA_API_KEY
}
