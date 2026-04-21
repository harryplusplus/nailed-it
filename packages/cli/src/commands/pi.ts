import { Command } from 'commander'
import { linkFile, withGracefulShutdown, createPathMap } from '../common.ts'
import path from 'node:path'
import os from 'node:os'
import { exec } from 'node:child_process'
import { promisify } from 'node:util'

const execAsync = promisify(exec)

export const pi = new Command('pi').action(() =>
  withGracefulShutdown(async signal => {
    console.log('Setting up Pi...')
    const { repoRoot } = await createPathMap()

    console.log('Linking Pi agent configuration files...')
    {
      const srcDir = path.join(repoRoot, 'assets', 'pi', 'agent')
      const destDir = path.join(os.homedir(), '.pi', 'agent')
      await linkFile(srcDir, destDir, 'models.json')
      await linkFile(srcDir, destDir, 'settings.json')
    }

    console.log('Checking pi command...')
    await execAsync('pi --version', { signal })

    console.log('Installing Pi package...')
    {
      const packageDir = path.join(repoRoot, 'packages', 'pi')
      await execAsync(`pi install ${packageDir}`, { signal })
    }

    console.log('Checking OLLAMA_API_KEY environment variable...')
    await execAsync(`sh -c '[ -n "$OLLAMA_API_KEY" ]'`, { signal })

    console.log('Pi setup complete!')
  }),
)
