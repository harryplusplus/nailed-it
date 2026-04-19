import { Command } from 'effect/unstable/cli'
import { Effect } from 'effect'
import { NodeServices, NodeRuntime } from '@effect/platform-node'
import { submodules } from './commands/submodules.ts'
import { pi } from './commands/pi.ts'
import { Paths } from './paths.ts'

const mainLayer = Effect.provide(NodeServices.layer, Paths.layer)

Command.make('ni').pipe(
  Command.withSubcommands([submodules, pi]),
  Command.run({ version: '0.0.0' }),
  Effect.scoped,
  mainLayer,
  NodeRuntime.runMain,
)
