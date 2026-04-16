import { $ as $base } from 'execa'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const $ = $base({ shell: true })
const repoRoot = path.resolve(fileURLToPath(import.meta.url), '../..')
console.log(`Nailed It! directory: ${repoRoot}`)

console.log('Linking .pi directory...')
await $`ln -sfn ${repoRoot}/.pi ~/.pi`

console.log('Checking pi command...')
await $`pi --version`

console.log('Checking OLLAMA_API_KEY environment variable...')
await $`[ -n "$OLLAMA_API_KEY" ]`
