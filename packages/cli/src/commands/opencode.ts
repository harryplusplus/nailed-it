import { Command } from 'effect/unstable/cli'
import { Effect, Console } from 'effect'
import { exec } from '../common.ts'
import { ChildProcess } from 'effect/unstable/process'
import { copyFile, linkFile, Paths, removeBrokenSymlinks } from '../paths.ts'

export const opencode = Command.make('opencode', {}, () =>
  Effect.gen(function* () {
    const paths = yield* Paths

    yield* Console.log('Setting up OpenCode...')

    yield* Console.log('Removing broken plugin symlinks...')
    yield* removeBrokenSymlinks(paths.global.opencode.plugins)

    yield* Console.log('Copying OpenCode configuration files...')
    yield* copyFile(
      paths.repo.opencode.config,
      paths.global.opencode.config,
      'opencode.jsonc',
    )

    yield* Console.log('Linking OpenCode plugins...')
    yield* linkFile(
      paths.repo.opencode.plugins,
      paths.global.opencode.plugins,
      'temperature-zero.ts',
    )

    yield* Console.log('Checking opencode command...')
    yield* exec(
      ChildProcess.make`opencode --version`,
      'opencode command failed',
    )

    yield* Console.log('OpenCode setup complete!')
  }),
)
