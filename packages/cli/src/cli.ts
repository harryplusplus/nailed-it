import { Command } from 'effect/unstable/cli'
import { Effect, Layer } from 'effect'
import { NodeServices, NodeRuntime } from '@effect/platform-node'
import { submodules } from './commands/submodules.ts'
import { pi } from './commands/pi.ts'
import { Paths } from './paths.ts'
import { opencode } from './commands/opencode.ts'

const program = Command.make('cli').pipe(
  Command.withSubcommands([submodules, pi, opencode]),
  Command.run({ version: '0.0.0' }),
)

NodeRuntime.runMain(
  program.pipe(
    Effect.scoped,
    Effect.provide(
      Layer.mergeAll(
        Layer.provide(Paths.layer, NodeServices.layer),
        NodeServices.layer,
      ),
    ),
  ),
)
