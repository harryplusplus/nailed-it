import subprocess
import sys
from pathlib import Path

from dev_cli.common import REPO_ROOT, link_file


def setup_opencode_config() -> None:
    print("Setting up OpenCode...")

    print("Linking OpenCode agent configuration files...")
    src_dir = REPO_ROOT / "assets" / "config" / "opencode"
    dest_dir = Path.home() / ".config" / "opencode"
    link_file(src_dir, dest_dir, "opencode.jsonc")

    print("Checking opencode command...")
    result = subprocess.run(
        ["opencode", "--version"],
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        msg = "opencode command not found. Is OpenCode installed?"
        raise RuntimeError(msg)
    print(f"  opencode {result.stdout.strip()}", file=sys.stderr)

    print("Linking OpenCode plugins...")
    src_dir = REPO_ROOT / "packages" / "opencode" / "plugins"
    dest_dir = Path.home() / ".config" / "opencode" / "plugins"
    link_file(src_dir, dest_dir, "temperature-zero.ts")

    print("OpenCode setup complete!")
