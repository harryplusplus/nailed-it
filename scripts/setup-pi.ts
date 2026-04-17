import { $ as $base } from 'execa'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs/promises'
import os from 'node:os'

const $ = $base({ shell: true })

const repoRoot = path.resolve(fileURLToPath(import.meta.url), '../..')
const repoPiAgentDir = path.join(repoRoot, 'assets', 'pi', 'agent')
const repoPackagePiDir = path.join(repoRoot, 'packages', 'pi')
const globalPiAgentDir = path.join(os.homedir(), '.pi', 'agent')
const repoPiPath = path.join(repoRoot, 'node_modules', '.bin', 'pi')
const dotLocalPiPath = path.join(os.homedir(), '.local', 'bin', 'pi')

main()

async function main() {
  console.log('Setting up Pi...')

  console.log('Checking repository root...')
  await checkRepoRoot()

  console.log('Copying Pi agent configuration files...')
  await copyConfig('models.json')
  await copyConfig('settings.json')

  console.log('Creating ~/.local/bin/pi script...')
  await createDotLocalPi()

  console.log('Checking pi command...')
  await $`pi --version`

  console.log('Installing Pi package...')
  await $`pi install ${repoPackagePiDir}`

  console.log('Checking OLLAMA_API_KEY environment variable...')
  await $`[ -n "$OLLAMA_API_KEY" ]`

  console.log('Setup complete!')
}

async function checkRepoRoot() {
  const hasPackageJson = await fs
    .stat(path.join(repoRoot, 'package.json'))
    .then(s => s.isFile())
    .catch(() => false)
  if (!hasPackageJson) {
    throw new Error(`Invalid repo root: ${repoRoot}. package.json not found.`)
  }
}

async function copyConfig(fileName: string) {
  const src = path.join(repoPiAgentDir, fileName)
  const dest = path.join(globalPiAgentDir, fileName)
  await fs.mkdir(globalPiAgentDir, { recursive: true })
  const hasDest = await fs
    .stat(dest)
    .then(s => s.isFile())
    .catch(() => false)
  if (hasDest) {
    await fs.rm(dest + '.bak').catch(() => {})
    await fs.rename(dest, dest + '.bak')
  }
  await fs.copyFile(src, dest)
}

async function createDotLocalPi() {
  const wrapperScript = `#!/bin/sh
exec ${repoPiPath} "$@"
`
  await fs.writeFile(dotLocalPiPath, wrapperScript)
  await fs.chmod(dotLocalPiPath, 0o755)
}
