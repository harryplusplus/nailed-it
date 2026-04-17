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

const repoOpencodeConfigDir = path.join(
  repoRoot,
  'assets',
  'config',
  'opencode',
)
const repoOpencodePluginsDir = path.join(
  repoRoot,
  'packages',
  'opencode',
  'plugins',
)
const globalOpencodeConfigDir = path.join(os.homedir(), '.config', 'opencode')
const globalOpencodePluginsDir = path.join(globalOpencodeConfigDir, 'plugins')

const repoSkillsDir = path.join(repoRoot, 'skills')
const globalSkillsDir = path.join(os.homedir(), '.agents', 'skills')

main()

async function main() {
  console.log('Checking repository root...')
  await checkRepoRoot()
  await setupPi()
  await setupOpencode()
  await setupSkills()
  console.log('Setup complete!')
}

async function setupSkills() {
  console.log('Setting up skills...')
  await fs.mkdir(globalSkillsDir, { recursive: true })

  console.log('Removing broken skill symlinks...')
  await removeBrokenSymlinks(globalSkillsDir)

  console.log('Linking skills from repository...')
  await linkSkills()
}

async function linkSkills() {
  const skillDirs = await fs.readdir(repoSkillsDir)
  for (const dir of skillDirs) {
    const src = path.join(repoSkillsDir, dir)
    const dest = path.join(globalSkillsDir, dir)
    const stat = await fs.lstat(dest).catch(() => null)
    if (stat?.isSymbolicLink()) {
      await fs.unlink(dest)
    } else if (stat) {
      await fs.rm(dest + '.bak').catch(() => {})
      await fs.rename(dest, dest + '.bak')
    }
    await fs.symlink(src, dest)
  }
}

async function setupPi() {
  console.log('Setting up Pi...')

  console.log('Copying Pi agent configuration files...')
  await copyPiConfig('models.json')
  await copyPiConfig('settings.json')

  console.log('Creating ~/.local/bin/pi script...')
  await createDotLocalPi()

  console.log('Checking pi command...')
  await $`pi --version`

  console.log('Installing Pi package...')
  await $`pi install ${repoPackagePiDir}`

  console.log('Checking OLLAMA_API_KEY environment variable...')
  await $`[ -n "$OLLAMA_API_KEY" ]`
}

async function copyPiConfig(fileName: string) {
  await copyConfig(repoPiAgentDir, globalPiAgentDir, fileName)
}

async function setupOpencode() {
  console.log('Setting up Opencode...')

  console.log('Copying Opencode configuration files...')
  await copyOpencodeConfig('opencode.jsonc')

  console.log('Linking Opencode plugins...')
  await linkOpencodePlugin('temperature.ts')

  console.log('Checking opencode command...')
  await $`opencode --version`
}

async function copyOpencodeConfig(fileName: string) {
  await copyConfig(repoOpencodeConfigDir, globalOpencodeConfigDir, fileName)
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

async function copyConfig(srcDir: string, destDir: string, fileName: string) {
  const src = path.join(srcDir, fileName)
  const dest = path.join(destDir, fileName)
  await fs.mkdir(destDir, { recursive: true })
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

async function linkOpencodePlugin(fileName: string) {
  const src = path.join(repoOpencodePluginsDir, fileName)
  const dest = path.join(globalOpencodePluginsDir, fileName)
  await fs.mkdir(globalOpencodePluginsDir, { recursive: true })
  const stat = await fs.lstat(dest).catch(() => null)
  if (stat?.isSymbolicLink()) {
    await fs.unlink(dest)
  } else if (stat) {
    await fs.rm(dest + '.bak').catch(() => {})
    await fs.rename(dest, dest + '.bak')
  }
  await fs.access(src, fs.constants.R_OK)
  await fs.symlink(src, dest)
}

async function removeBrokenSymlinks(dir: string) {
  const entries = await fs.readdir(dir, { withFileTypes: true })
  await Promise.all(
    entries
      .filter(e => e.isSymbolicLink())
      .map(async e => {
        const fullPath = path.join(dir, e.name)
        const target = path.resolve(dir, await fs.readlink(fullPath))
        try {
          await fs.lstat(target)
        } catch {
          await fs.unlink(fullPath)
        }
      }),
  )
}
