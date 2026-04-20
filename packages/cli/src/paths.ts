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
import fs from 'node:fs/promises'

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
        external: {
          vectorChord: path.join(repoRoot, 'external', 'VectorChord'),
          vectorChordBm25: path.join(repoRoot, 'external', 'VectorChord-bm25'),
          pgTokenizerRs: path.join(repoRoot, 'external', 'pg_tokenizer.rs'),
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

    const info = yield* lstat(dest).pipe(Effect.option)
    if (Option.isSome(info)) {
      if (info.value.isSymbolicLink()) {
        yield* fs.remove(dest)
      } else if (info.value.isFile()) {
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

export const lstat = (path: string) =>
  Effect.tryPromise({
    try: () => fs.lstat(path),
    catch: () => new InvalidPathError({ message: `Failed to stat path`, path }),
  })

export const linkFile = (srcDir: string, destDir: string, fileName: string) =>
  Effect.gen(function* () {
    const path = yield* Path.Path
    const fs = yield* FileSystem.FileSystem

    const src = path.resolve(srcDir, fileName)
    const absDestDir = path.resolve(destDir)
    yield* fs.makeDirectory(absDestDir, { recursive: true })
    const dest = path.join(absDestDir, fileName)
    yield* prepareDest(dest)
    const relSrc = path.relative(absDestDir, src)
    yield* fs.symlink(relSrc, dest)
  })

export const removeBrokenSymlinks = (dir: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path

    const entries = yield* fs.readDirectory(dir)
    yield* Effect.forEach(
      entries,
      entry =>
        Effect.gen(function* () {
          const fullPath = path.join(dir, entry)
          const stat = yield* lstat(fullPath).pipe(Effect.option)
          if (Option.isSome(stat) && stat.value.isSymbolicLink()) {
            const target = yield* fs.stat(fullPath).pipe(Effect.option)
            if (Option.isNone(target)) {
              yield* fs.remove(fullPath)
            }
          }
        }),
      { concurrency: 'unbounded' },
    )
  })
