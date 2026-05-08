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
        [
            "uv", "tool", "install",
            "litellm[proxy]", "--python", "3.13",
        ],
        check=True,
    )

    # Step 2: Link config.yaml
    config_dir = Path.home() / ".ll-hs"
    link_file(
        REPO_ROOT / "assets" / "ll-hs",
        config_dir,
        "config.yaml",
    )

    # Verify litellm works via uvx
    print("Verifying litellm...")
    version = subprocess.run(
        ["uvx", "--python", "3.13", "litellm", "--version"],
        capture_output=True,
        text=True,
        check=True,
    ).stdout.strip()
    print(f"  {version}", file=sys.stderr)

    print()
    print("Setup complete!")
    print()
    print("1. Set required environment variables:")
    print("   export CROF_API_KEY=...")
    print("   export LANGFUSE_PUBLIC_KEY=...")
    print("   export LANGFUSE_SECRET_KEY=...")
    print("   export LANGFUSE_OTEL_HOST=http://localhost:3000")
    print()
    print("2. Start the proxy:")
    print("   sh assets/ll-hs/run.sh")
    print()
    print("3. Update Hindsight .env:")
    print("   HINDSIGHT_API_LLM_BASE_URL=http://localhost:4000")
    print()
