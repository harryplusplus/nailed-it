import { Command } from 'effect/unstable/cli'
import { Console, Effect } from 'effect'
import { ChildProcess } from 'effect/unstable/process'
import { exec } from '../common.ts'

export const submodules = Command.make('submodules', {}, () =>
  Effect.gen(function* () {
    yield* Console.log('Updating git submodules...')

    yield* exec(
      ChildProcess.make`git submodule update --init --recursive`,
      'Failed to update git submodules',
    )

    yield* Console.log('Git submodules updated successfully!')
  }),
)
