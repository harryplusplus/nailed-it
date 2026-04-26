import os
import subprocess
import sys
from pathlib import Path

from dev_cli.common import REPO_ROOT, link_file


def setup_pi_config() -> None:
    print("Setting up Pi...")

    print("Linking Pi agent configuration files...")
    src_dir = REPO_ROOT / "assets" / "pi" / "agent"
    dest_dir = Path.home() / ".pi" / "agent"
    link_file(src_dir, dest_dir, "models.json")
    link_file(src_dir, dest_dir, "settings.json")

    print("Checking pi command...")
    result = subprocess.run(
        ["pi", "--version"],
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        msg = "pi command not found. Is pi-coding-agent installed?"
        raise RuntimeError(msg)
    print(f"  pi {result.stdout.strip()}", file=sys.stderr)

    print("Installing Pi package...")
    package_dir = REPO_ROOT / "packages" / "pi"
    result = subprocess.run(
        ["pi", "install", str(package_dir)],
    )
    if result.returncode != 0:
        msg = "Failed to install Pi package"
        raise RuntimeError(msg)

    print("Checking OLLAMA_API_KEY environment variable...")
    if not os.environ.get("OLLAMA_API_KEY"):
        msg = "OLLAMA_API_KEY is not set"
        raise RuntimeError(msg)
    print("  OLLAMA_API_KEY is set", file=sys.stderr)

    print("Pi setup complete!")
