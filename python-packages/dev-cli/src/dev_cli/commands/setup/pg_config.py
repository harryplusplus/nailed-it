import subprocess
import sys
from typing import TYPE_CHECKING

from dev_cli.common import REPO_ROOT, check_repo_root

if TYPE_CHECKING:
    from pathlib import Path


def _run(cmd: str, cwd: Path | None = None) -> None:
    print(f"  $ {cmd}", file=sys.stderr)
    result = subprocess.run(
        cmd,
        shell=True,
        cwd=cwd,
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        print(result.stdout, end="", file=sys.stderr)
        print(result.stderr, end="", file=sys.stderr)
        msg = f"Command failed: {cmd}"
        raise RuntimeError(msg)
    if result.stdout:
        print(result.stdout, end="")
    if result.stderr:
        print(result.stderr, end="", file=sys.stderr)


def setup_pg_config() -> None:
    check_repo_root()

    print("Installing VectorChord...")
    _run("make build", cwd=REPO_ROOT / "external" / "VectorChord")
    _run("make install", cwd=REPO_ROOT / "external" / "VectorChord")

    print("Installing pgrx...")
    _run("cargo install cargo-pgrx --version 0.16.1 --locked")

    print("Installing pg_tokenizer.rs...")
    _run(
        "cargo pgrx install --release --pg-config /opt/homebrew/bin/pg_config",
        cwd=REPO_ROOT / "external" / "pg_tokenizer.rs",
    )

    print("Installing VectorChord-bm25...")
    _run(
        "cargo pgrx install --release --pg-config /opt/homebrew/bin/pg_config",
        cwd=REPO_ROOT / "external" / "VectorChord-bm25",
    )

    print("Installation complete!")

    print()
    print("# 1. Check current shared_preload_libraries")
    print('psql -c "SHOW shared_preload_libraries;"')
    print()
    print("# → If empty:")
    print(
        'psql -c "ALTER SYSTEM '
        "SET shared_preload_libraries = 'vchord,pg_tokenizer';\"",
    )
    print("# → If has existing values:")
    print(
        'psql -c "ALTER SYSTEM '
        "SET shared_preload_libraries = '<existing>,vchord,pg_tokenizer';\"",
    )
    print()
    print("# 2. Restart PostgreSQL")
    print("brew services restart postgresql@<VERSION>  # macOS Homebrew")
    print()
    print("# 3. Create database (skip if exists)")
    print("psql -c \"SELECT 1 FROM pg_database WHERE datname='hindsight'\"")
    print("createdb hindsight")
    print()
    print("# 4. Configure search_path and extensions")
    print(
        "psql -d hindsight -c ALTER DATABASE hindsight "
        'SET search_path TO public,tokenizer_catalog,bm25_catalog;"',
    )
    print(
        'psql -d hindsight -c "CREATE EXTENSION IF NOT EXISTS vector CASCADE;"',
    )
    print(
        'psql -d hindsight -c "CREATE EXTENSION IF NOT EXISTS vchord CASCADE;"',
    )
    print(
        'psql -d hindsight -c "CREATE EXTENSION IF NOT EXISTS vchord_bm25 CASCADE;"',
    )
    print(
        'psql -d hindsight -c "CREATE EXTENSION IF NOT EXISTS pg_tokenizer CASCADE;"',
    )
    print()
    print("# 5. Create tokenizer (skip if already exists)")
    print(
        'psql -d hindsight -c "SELECT tokenizer_catalog.create_tokenizer('
        '\'llmlingua2\', $$model = "llmlingua2"$$);"',
    )
