import { Effect, Schema } from 'effect'
import { ChildProcess } from 'effect/unstable/process'

export class ExecError extends Schema.TaggedErrorClass<ExecError>()(
  'ExecError',
  { message: Schema.String, exitCode: Schema.Number },
) {}

export const exec = (command: ChildProcess.Command, errorMessage: string) =>
  Effect.gen(function* () {
    const handle = yield* command
    const exitCode = yield* handle.exitCode
    if (exitCode !== 0) {
      return yield* new ExecError({ message: errorMessage, exitCode })
    }
  })
