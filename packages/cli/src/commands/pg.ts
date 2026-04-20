import { Console, Effect } from 'effect'
import { Command } from 'effect/unstable/cli'
import { Paths } from '../paths.ts'
import { exec } from '../common.ts'
import { ChildProcess } from 'effect/unstable/process'

export const pg = Command.make('pg', {}, () =>
  Effect.gen(function* () {
    const paths = yield* Paths

    yield* Console.log('Installing VectorChord...')
    yield* exec(
      ChildProcess.make({ cwd: paths.repo.external.vectorChord })`make build`,
      'Failed to build VectorChord',
    )
    yield* exec(
      ChildProcess.make({ cwd: paths.repo.external.vectorChord })`make install`,
      'Failed to install VectorChord',
    )

    yield* Console.log('Installing pgrx...')
    yield* exec(
      ChildProcess.make`cargo install cargo-pgrx --version 0.16.1 --locked`,
      'Failed to install cargo-pgrx',
    )

    yield* Console.log('Installing pg_tokenizer.rs...')
    yield* exec(
      ChildProcess.make({
        cwd: paths.repo.external.pgTokenizerRs,
      })`cargo pgrx install --release --pg-config /opt/homebrew/bin/pg_config`,
      'Failed to install pg_tokenizer.rs',
    )

    yield* Console.log('Installing VectorChord-bm25...')
    yield* exec(
      ChildProcess.make({
        cwd: paths.repo.external.vectorChordBm25,
      })`cargo pgrx install --release --pg-config /opt/homebrew/bin/pg_config`,
      'Failed to install VectorChord-bm25',
    )

    yield* Console.log('Installation complete!')

    yield* Console.log(`# 1. Check current shared_preload_libraries`)
    yield* Console.log(`psql -c "SHOW shared_preload_libraries;"`)

    yield* Console.log(`# → If empty:`)
    yield* Console.log(
      `psql -c "ALTER SYSTEM SET shared_preload_libraries = 'vchord,pg_tokenizer';"`,
    )
    yield* Console.log(`# → If has existing values:`)
    yield* Console.log(
      `psql -c "ALTER SYSTEM SET shared_preload_libraries = '<existing>,vchord,pg_tokenizer';"`,
    )

    yield* Console.log(`# 2. Restart PostgreSQL`)
    yield* Console.log(
      `brew services restart postgresql@<VERSION>  # macOS Homebrew`,
    )

    yield* Console.log(`# 3. Create database (skip if exists)`)
    yield* Console.log(
      `psql -c "SELECT 1 FROM pg_database WHERE datname='hindsight'"`,
    )
    yield* Console.log(`createdb hindsight`)

    yield* Console.log(`# 4. Configure search_path and extensions`)
    yield* Console.log(
      `psql -d hindsight -c "ALTER DATABASE hindsight SET search_path TO public,tokenizer_catalog,bm25_catalog;"`,
    )
    yield* Console.log(
      `psql -d hindsight -c "CREATE EXTENSION IF NOT EXISTS vector CASCADE;"`,
    )
    yield* Console.log(
      `psql -d hindsight -c "CREATE EXTENSION IF NOT EXISTS vchord CASCADE;"`,
    )
    yield* Console.log(
      `psql -d hindsight -c "CREATE EXTENSION IF NOT EXISTS vchord_bm25 CASCADE;"`,
    )
    yield* Console.log(
      `psql -d hindsight -c "CREATE EXTENSION IF NOT EXISTS pg_tokenizer CASCADE;"`,
    )

    yield* Console.log(`# 5. Create tokenizer (skip if already exists)`)
    yield* Console.log(
      `psql -d hindsight -c "SELECT tokenizer_catalog.create_tokenizer('llmlingua2', \\$\\$model = \\"llmlingua2\\"\\$\\$);"`,
    )
  }),
)
