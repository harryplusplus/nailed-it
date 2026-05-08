import subprocess
import sys
from pathlib import Path

from dev_cli.common import REPO_ROOT, link_file


def setup_ll_hs() -> None:
    """Set up LiteLLM proxy for Hindsight."""

    print("Setting up LiteLLM proxy for Hindsight...")

    # Step 1: Install litellm via uv tool (isolated from workspace)
    print("Installing/updating litellm...")
    subprocess.run(
        ["uv", "tool", "install", "litellm", "--python", "3.13"],
        check=True,
    )

    # Step 2: Link config.yaml
    config_dir = Path.home() / ".ll-hs"
    link_file(
        REPO_ROOT / "assets" / "ll-hs",
        config_dir,
        "config.yaml",
    )

    # Step 4: Verify litellm works
    print("Verifying litellm...")
    result = subprocess.run(
        ["litellm", "--version"],
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        msg = "litellm command not found"
        raise RuntimeError(msg)
    print(f"  {result.stdout.strip()}", file=sys.stderr)

    print()
    print("Setup complete!")
    print()
    print("1. Set required environment variables:")
    print("   export CROF_API_KEY=...")
    print("   export LF_HINDSIGHT_PUBLIC_KEY=...")
    print("   export LF_HINDSIGHT_SECRET_KEY=...")
    print()
    print("2. Start the proxy:")
    print("   sh assets/ll-hs/run.sh")
    print()
    print("3. Update Hindsight .env:")
    print("   HINDSIGHT_API_LLM_BASE_URL=http://localhost:4000")
