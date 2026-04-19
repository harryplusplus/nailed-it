import { Effect, Schema } from 'effect'
import { ChildProcess } from 'effect/unstable/process'

export class ExecError extends Schema.TaggedErrorClass<ExecError>()(
  'ExecError',
  { message: Schema.String, exitCode: Schema.Number },
) {}

export const exec = (command: ChildProcess.Command, errorMessage: string) =>
  command.asEffect().pipe(
    Effect.flatMap(handle => handle.exitCode),
    Effect.filterOrFail(
      code => code === 0,
      code => new ExecError({ message: errorMessage, exitCode: code }),
    ),
    Effect.asVoid,
  )
