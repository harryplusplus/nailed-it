import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs/promises'
import os from 'node:os'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

class Setup {
  paths = createPaths()

  async setup() {
    console.log('Checking repository root...')
    await checkRepoRoot(this.paths.repo.root)
    await this.setupPi()
    await this.setupOpencode()
    console.log('Setup complete!')
  }

  async setupPi() {
    console.log('Setting up Pi...')

    console.log('Copying Pi agent configuration files...')
    await this.copyPiConfig('models.json')
    await this.copyPiConfig('settings.json')

    console.log('Checking pi command...')
    await execFileAsync('pi', ['--version'])

    console.log('Installing Pi package...')
    await execFileAsync('pi', ['install', this.paths.repo.pi.packageDir])

    console.log('Checking OLLAMA_API_KEY environment variable...')
    await execFileAsync('sh', ['-c', '[ -n "$OLLAMA_API_KEY" ]'])
  }

  async setupOpencode() {
    console.log('Setting up Opencode...')

    console.log('Removing broken plugin symlinks...')
    await removeBrokenSymlinks(this.paths.global.opencode.pluginsDir)

    console.log('Copying Opencode configuration files...')
    await this.copyOpencodeConfig('opencode.jsonc')

    console.log('Linking Opencode plugins...')
    await this.linkOpencodePlugin('temperature-zero.ts')

    console.log('Checking opencode command...')
    await execFileAsync('opencode', ['--version'])
  }

  async copyPiConfig(fileName: string) {
    await copyConfig(
      this.paths.repo.pi.agentDir,
      this.paths.global.pi.agentDir,
      fileName,
    )
  }

  async copyOpencodeConfig(fileName: string) {
    await copyConfig(
      this.paths.repo.opencode.configDir,
      this.paths.global.opencode.configDir,
      fileName,
    )
  }

  async linkOpencodePlugin(fileName: string) {
    await symlink(
      this.paths.repo.opencode.pluginsDir,
      this.paths.global.opencode.pluginsDir,
      fileName,
    )
  }
}

function createPaths() {
  const repoRoot = path.resolve(fileURLToPath(import.meta.url), '../..')
  const globalOpencodeConfigDir = path.join(os.homedir(), '.config', 'opencode')

  return {
    repo: {
      root: repoRoot,
      pi: {
        agentDir: path.join(repoRoot, 'assets', 'pi', 'agent'),
        packageDir: path.join(repoRoot, 'packages', 'pi'),
      },
      opencode: {
        configDir: path.join(repoRoot, 'assets', 'config', 'opencode'),
        pluginsDir: path.join(repoRoot, 'packages', 'opencode', 'plugins'),
      },
    },
    global: {
      pi: { agentDir: path.join(os.homedir(), '.pi', 'agent') },
      opencode: {
        configDir: globalOpencodeConfigDir,
        pluginsDir: path.join(globalOpencodeConfigDir, 'plugins'),
      },
    },
  }
}

async function checkRepoRoot(repoRoot: string) {
  const hasPackageJson = await fs
    .stat(path.join(repoRoot, 'package.json'))
    .then(s => s.isFile())
    .catch(() => false)
  if (!hasPackageJson) {
    throw new Error(`Invalid repo root: ${repoRoot}. package.json not found.`)
  }
}

async function copyConfig(srcDir: string, destDir: string, fileName: string) {
  const absSrcDir = path.resolve(srcDir)
  const absDestDir = path.resolve(destDir)
  const src = path.join(absSrcDir, fileName)
  const dest = path.join(absDestDir, fileName)
  await fs.mkdir(absDestDir, { recursive: true })
  await prepareDest(dest)
  await fs.copyFile(src, dest)
}

async function removeBrokenSymlinks(dir: string) {
  const entries = await fs.readdir(dir, { withFileTypes: true })
  await Promise.all(
    entries
      .filter(e => e.isSymbolicLink())
      .map(async e => {
        const fullPath = path.join(dir, e.name)
        try {
          await fs.stat(fullPath)
        } catch {
          await fs.unlink(fullPath)
        }
      }),
  )
}

async function symlink(srcDir: string, destDir: string, fileName: string) {
  const absSrcDir = path.resolve(srcDir)
  const absDestDir = path.resolve(destDir)
  const src = path.join(absSrcDir, fileName)
  const dest = path.join(absDestDir, fileName)
  await fs.mkdir(absDestDir, { recursive: true })
  await prepareDest(dest)
  const relSrc = path.relative(absDestDir, src)
  await fs.symlink(relSrc, dest)
}

async function prepareDest(dest: string) {
  const stat = await fs.lstat(dest).catch(() => null)
  if (stat?.isSymbolicLink()) {
    await fs.unlink(dest)
  } else if (stat?.isFile()) {
    await fs.rm(dest + '.bak').catch(() => {})
    await fs.rename(dest, dest + '.bak')
  } else if (stat) {
    throw new Error(
      `Cannot write to ${dest}: destination exists and is not a file or symlink.`,
    )
  }
}

async function main() {
  const setup = new Setup()
  await setup.setup()
}

await main()
