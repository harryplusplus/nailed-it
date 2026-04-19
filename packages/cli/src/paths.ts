import {
  Context,
  Effect,
  Path,
  FileSystem,
  Schema,
  Layer,
  Option,
} from 'effect'
import os from 'node:os'

export class InvalidPathError extends Schema.TaggedErrorClass<InvalidPathError>()(
  'InvalidPathError',
  { message: Schema.String, path: Schema.String },
) {}

export class Paths extends Context.Service<Paths>()('Paths', {
  make: Effect.gen(function* () {
    const path = yield* Path.Path
    const fs = yield* FileSystem.FileSystem

    const repoRoot = path.resolve(import.meta.dirname, '../../..')
    const hasPackageJson = yield* fs.exists(path.join(repoRoot, 'package.json'))
    if (!hasPackageJson) {
      return yield* new InvalidPathError({
        message: `Expected to find package.json in repo root`,
        path: repoRoot,
      })
    }

    const globalConfigOpencodeDir = path.join(
      os.homedir(),
      '.config',
      'opencode',
    )
    return {
      repo: {
        root: repoRoot,
        pi: {
          agent: path.join(repoRoot, 'assets', 'pi', 'agent'),
          package: path.join(repoRoot, 'packages', 'pi'),
        },
        opencode: {
          config: path.join(repoRoot, 'assets', 'config', 'opencode'),
          plugins: path.join(repoRoot, 'packages', 'opencode', 'plugins'),
        },
      },
      global: {
        pi: { agent: path.join(os.homedir(), '.pi', 'agent') },
        opencode: {
          config: globalConfigOpencodeDir,
          plugins: path.join(globalConfigOpencodeDir, 'plugins'),
        },
      },
    }
  }),
}) {
  static readonly layer = Layer.effect(this, this.make)
}

export const copyFile = (srcDir: string, destDir: string, fileName: string) =>
  Effect.gen(function* () {
    const path = yield* Path.Path
    const fs = yield* FileSystem.FileSystem

    const src = path.resolve(srcDir, fileName)
    const absDestDir = path.resolve(destDir)
    yield* fs.makeDirectory(absDestDir, { recursive: true })
    const dest = path.join(absDestDir, fileName)
    yield* prepareDest(dest)
    yield* fs.copyFile(src, dest)
  })

const prepareDest = (dest: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem

    const info = yield* Effect.option(fs.stat(dest))
    if (Option.isSome(info)) {
      if (info.value.type === 'SymbolicLink') {
        yield* fs.remove(dest)
      } else if (info.value.type === 'File') {
        yield* fs.remove(`${dest}.bak`).pipe(Effect.ignore)
        yield* fs.rename(dest, `${dest}.bak`)
      } else {
        return yield* new InvalidPathError({
          message: `Expected ${dest} to be a file or symlink`,
          path: dest,
        })
      }
    }
  })
