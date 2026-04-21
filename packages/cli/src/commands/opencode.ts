import { Command } from 'commander'
import { linkFile, withGracefulShutdown, createPathMap } from '../common.ts'
import path from 'node:path'
import os from 'node:os'
import { exec } from 'node:child_process'
import { promisify } from 'node:util'

const execAsync = promisify(exec)

export const opencode = new Command('opencode').action(() =>
  withGracefulShutdown(async signal => {
    console.log('Setting up OpenCode...')
    const { repoRoot } = await createPathMap()

    console.log('Linking OpenCode agent configuration files...')
    {
      const srcDir = path.join(repoRoot, 'assets', 'config', 'opencode')
      const destDir = path.join(os.homedir(), '.config', 'opencode')
      await linkFile(srcDir, destDir, 'opencode.jsonc')
    }

    console.log('Checking opencode command...')
    await execAsync('opencode --version', { signal })

    console.log('Linking OpenCode plugins...')
    {
      const srcDir = path.join(repoRoot, 'packages', 'opencode', 'plugins')
      const destDir = path.join(os.homedir(), '.config', 'opencode', 'plugins')
      await linkFile(srcDir, destDir, 'temperature-zero.ts')
    }

    console.log('OpenCode setup complete!')
  }),
)
