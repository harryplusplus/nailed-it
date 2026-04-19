import { Command } from 'effect/unstable/cli'
import { Effect, Console } from 'effect'
import { exec } from '../common.ts'
import { ChildProcess } from 'effect/unstable/process'
import { copyFile, Paths } from '../paths.ts'

export const pi = Command.make('pi', {}, () =>
  Effect.gen(function* () {
    const paths = yield* Paths

    yield* Console.log('Setting up Pi...')

    yield* Console.log('Copying Pi agent configuration files...')
    yield* copyPiAgentConfig('models.json')
    yield* copyPiAgentConfig('settings.json')

    yield* Console.log('Checking pi command...')
    yield* exec(ChildProcess.make`pi --version`, 'pi command failed')

    yield* Console.log('Installing Pi package...')
    yield* exec(
      ChildProcess.make`pi install ${paths.repo.pi.package}`,
      'pi install failed',
    )

    yield* Console.log('Checking OLLAMA_API_KEY environment variable...')
    yield* exec(
      ChildProcess.make({ shell: true })`sh -c '[ -n "$OLLAMA_API_KEY" ]'`,
      'OLLAMA_API_KEY is not set',
    )

    yield* Console.log('Pi setup complete!')
  }),
)

const copyPiAgentConfig = (fileName: string) =>
  Effect.gen(function* () {
    const paths = yield* Paths
    yield* copyFile(paths.repo.pi.agent, paths.global.pi.agent, fileName)
  })
