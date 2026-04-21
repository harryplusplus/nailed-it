import { Command } from 'commander'
import { createPathMap, withGracefulShutdown } from '../common.ts'
import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import path from 'node:path'

const execAsync = promisify(exec)

export const pg = new Command('pg').action(() =>
  withGracefulShutdown(async signal => {
    const { repoRoot } = await createPathMap()

    console.log('Installing VectorChord...')
    {
      const cwd = path.join(repoRoot, 'external', 'VectorChord')
      await execAsync('make build', { cwd, signal })
      await execAsync('make install', { cwd, signal })
    }

    console.log('Installing pgrx...')
    await execAsync('cargo install cargo-pgrx --version 0.16.1 --locked', {
      signal,
    })

    console.log('Installing pg_tokenizer.rs...')
    {
      const cwd = path.join(repoRoot, 'external', 'pg_tokenizer.rs')
      await execAsync(
        'cargo pgrx install --release --pg-config /opt/homebrew/bin/pg_config',
        { cwd, signal },
      )
    }

    console.log('Installing VectorChord-bm25...')
    {
      const cwd = path.join(repoRoot, 'external', 'VectorChord-bm25')
      await execAsync(
        'cargo pgrx install --release --pg-config /opt/homebrew/bin/pg_config',
        { cwd, signal },
      )
    }

    console.log('Installation complete!')

    console.log(`# 1. Check current shared_preload_libraries`)
    console.log(`psql -c "SHOW shared_preload_libraries;"`)

    console.log(`# → If empty:`)
    console.log(
      `psql -c "ALTER SYSTEM SET shared_preload_libraries = 'vchord,pg_tokenizer';"`,
    )
    console.log(`# → If has existing values:`)
    console.log(
      `psql -c "ALTER SYSTEM SET shared_preload_libraries = '<existing>,vchord,pg_tokenizer';"`,
    )

    console.log(`# 2. Restart PostgreSQL`)
    console.log(`brew services restart postgresql@<VERSION>  # macOS Homebrew`)

    console.log(`# 3. Create database (skip if exists)`)
    console.log(`psql -c "SELECT 1 FROM pg_database WHERE datname='hindsight'"`)
    console.log(`createdb hindsight`)

    console.log(`# 4. Configure search_path and extensions`)
    console.log(
      `psql -d hindsight -c "ALTER DATABASE hindsight SET search_path TO public,tokenizer_catalog,bm25_catalog;"`,
    )
    console.log(
      `psql -d hindsight -c "CREATE EXTENSION IF NOT EXISTS vector CASCADE;"`,
    )
    console.log(
      `psql -d hindsight -c "CREATE EXTENSION IF NOT EXISTS vchord CASCADE;"`,
    )
    console.log(
      `psql -d hindsight -c "CREATE EXTENSION IF NOT EXISTS vchord_bm25 CASCADE;"`,
    )
    console.log(
      `psql -d hindsight -c "CREATE EXTENSION IF NOT EXISTS pg_tokenizer CASCADE;"`,
    )

    console.log(`# 5. Create tokenizer (skip if already exists)`)
    console.log(
      `psql -d hindsight -c "SELECT tokenizer_catalog.create_tokenizer('llmlingua2', \\$\\$model = \\"llmlingua2\\"\\$\\$);"`,
    )
  }),
)
