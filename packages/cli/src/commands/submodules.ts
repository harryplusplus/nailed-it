import { Command } from 'commander'
import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import { createPathMap, withGracefulShutdown } from '../common.ts'
import path from 'node:path'

const execAsync = promisify(exec)

export const submodules = new Command('submodules').action(() =>
  withGracefulShutdown(async signal => {
    console.log('Updating git submodules...')

    const { repoRoot } = await createPathMap()

    await execAsync('git submodule update --init --recursive', { signal })
    console.log('Git submodules updated successfully!')

    console.log('Updating Hermes Agent submodule...')
    {
      const cwd = path.join(repoRoot, 'external', 'hermes-agent')
      try {
        await execAsync(
          `git remote add upstream https://github.com/NousResearch/hermes-agent.git`,
          { cwd, signal },
        )
      } catch (e) {
        if (!/remote upstream already exists/.test((e as Error).message)) {
          throw e
        }
      }

      await execAsync(`git fetch upstream`, { cwd, signal })
      await execAsync(`git fetch upstream --tags`, { cwd, signal })
      await execAsync(`git checkout main`, { cwd, signal })
      await execAsync(`git merge upstream/main --ff-only`, { cwd, signal })
      await execAsync(`git push origin main --tags`, { cwd, signal })
    }
    console.log('Hermes Agent submodule updated successfully!')
  }),
)
