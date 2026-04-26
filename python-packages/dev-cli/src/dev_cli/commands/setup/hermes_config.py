import subprocess
import sys
from pathlib import Path

from dev_cli.common import REPO_ROOT, link_file


def setup_hermes_config() -> None:
    print("Setting up Hermes Agent...")

    print("Linking Hindsight config...")
    src_dir = REPO_ROOT / "assets" / "hermes" / "hindsight"
    dest_dir = Path.home() / ".hermes" / "hindsight"
    link_file(src_dir, dest_dir, "config.json")

    print("Linking hermes command...")
    src_dir = REPO_ROOT / "external" / "hermes-agent" / "venv" / "bin"
    dest_dir = Path.home() / ".local" / "bin"
    link_file(src_dir, dest_dir, "hermes")

    print("Checking hermes command...")
    result = subprocess.run(
        ["hermes", "--version"],
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        msg = "hermes command not found after linking"
        raise RuntimeError(msg)
    print(f"  {result.stdout.strip()}", file=sys.stderr)

    print("Hermes Agent setup complete!")
