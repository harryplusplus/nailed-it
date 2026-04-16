import { $ as $base } from 'execa'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs/promises'
import os from 'node:os'

const AGENT_FILES = ['models.json', 'SYSTEM.md', 'settings.json']

const $ = $base({ shell: true })

const repoPath = path.resolve(fileURLToPath(import.meta.url), '../..')
const repoPackageJsonPath = path.join(repoPath, 'package.json')
const repoPiAgentDir = path.join(repoPath, 'pi_home', 'agent')
const repoPiPackageDir = path.join(repoPath, 'packages', 'pi')
const userPiAgentDir = path.join(os.homedir(), '.pi', 'agent')
const settingsPath = path.join(userPiAgentDir, 'settings.json')

if (!(await fs.stat(repoPackageJsonPath).catch(() => false))) {
  throw new Error(`Expected to find package.json in ${repoPath}`)
}

console.log(`Nailed It! path: ${repoPath}`)

console.log('Checking pi command...')
await $`pi --version`

console.log('Checking OLLAMA_API_KEY environment variable...')
await $`[ -n "$OLLAMA_API_KEY" ]`

console.log('Copying Pi files to Pi home...')
await fs.mkdir(userPiAgentDir, { recursive: true })
for (const file of AGENT_FILES) {
  const src = path.join(repoPiAgentDir, file)
  const dest = path.join(userPiAgentDir, file)
  await fs.copyFile(src, dest)
}

const settings = JSON.parse(await fs.readFile(settingsPath, 'utf8'))
settings.packages ??= []
settings.packages.push(repoPiPackageDir)
await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2), 'utf8')
