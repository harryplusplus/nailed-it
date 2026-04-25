import subprocess
import sys
from typing import TYPE_CHECKING

from dev_cli.common import REPO_ROOT, check_repo_root

if TYPE_CHECKING:
    from pathlib import Path

HERMES_AGENT_DIR = REPO_ROOT / "external" / "hermes-agent"
HINDSIGHT_DIR = REPO_ROOT / "external" / "hindsight"


def _run(cmd: list[str], cwd: Path) -> None:
    print(f"  $ {' '.join(cmd)}", file=sys.stderr)
    result = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True)
    if result.returncode != 0:
        print(result.stdout, end="", file=sys.stderr)
        print(result.stderr, end="", file=sys.stderr)
        msg = f"Command failed: {' '.join(cmd)}"
        raise RuntimeError(msg)
    if result.stdout:
        print(result.stdout, end="")
    if result.stderr:
        print(result.stderr, end="", file=sys.stderr)


def _run_ignore_error(
    cmd: list[str],
    cwd: Path,
    ignore_stderr_pattern: str = "",
) -> None:
    print(f"  $ {' '.join(cmd)}", file=sys.stderr)
    result = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True)
    if result.returncode != 0:
        if ignore_stderr_pattern and ignore_stderr_pattern in result.stderr:
            return
        print(result.stdout, end="", file=sys.stderr)
        print(result.stderr, end="", file=sys.stderr)
        msg = f"Command failed: {' '.join(cmd)}"
        raise RuntimeError(msg)
    if result.stdout:
        print(result.stdout, end="")
    if result.stderr:
        print(result.stderr, end="", file=sys.stderr)


def _update_submodule(submodule_dir: Path, name: str, upstream_url: str) -> None:
    """Add an upstream remote to a submodule."""
    print(f"Updating {name} submodule...")

    _run_ignore_error(
        ["git", "remote", "add", "upstream", upstream_url],
        cwd=submodule_dir,
        ignore_stderr_pattern="remote upstream already exists",
    )

    print(f"{name} submodule updated successfully!")


def setup_git_submodules() -> None:
    print("Updating git submodules...")

    check_repo_root()

    _run(["git", "submodule", "update", "--init", "--recursive"], cwd=REPO_ROOT)
    print("Git submodules updated successfully!")

    _update_submodule(
        HERMES_AGENT_DIR,
        "Hermes Agent",
        "https://github.com/NousResearch/hermes-agent.git",
    )
    _update_submodule(
        HINDSIGHT_DIR,
        "Hindsight",
        "https://github.com/vectorize-io/hindsight.git",
    )
