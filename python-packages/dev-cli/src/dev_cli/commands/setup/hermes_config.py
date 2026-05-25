import subprocess
import sys
from pathlib import Path

from dev_cli.common import REPO_ROOT, link_file


def _run(
    cmd: list[str],
    cwd: Path | None = None,
    env: dict[str, str] | None = None,
) -> None:
    print(f"  $ {' '.join(cmd)}", file=sys.stderr)
    result = subprocess.run(cmd, cwd=cwd, env=env, capture_output=True, text=True)
    if result.returncode != 0:
        print(result.stdout, end="", file=sys.stderr)
        print(result.stderr, end="", file=sys.stderr)
        msg = f"Command failed: {' '.join(cmd)}"
        raise RuntimeError(msg)
    if result.stdout:
        print(result.stdout, end="")
    if result.stderr:
        print(result.stderr, end="", file=sys.stderr)


def setup_hermes_config() -> None:
    print("Setting up Hermes Agent...")

    print("Linking Hindsight config...")
    src_dir = REPO_ROOT / "assets" / "hermes" / "hindsight"
    dest_dir = Path.home() / ".hermes" / "hindsight"
    link_file(src_dir, dest_dir, "config.json")

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
