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
            "--with", "opentelemetry-api",
            "--with", "opentelemetry-sdk",
            "--with", "opentelemetry-exporter-otlp",
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

    # Check uv tool list (confirms it's installed as a tool, not temp via uvx)
    result = subprocess.run(
        ["uv", "tool", "list"],
        capture_output=True,
        text=True,
        check=True,
    )
    if "litellm" in result.stdout:
        print("  litellm tool installed", file=sys.stderr)
    else:
        print("  ERROR: litellm not found in uv tools", file=sys.stderr)
        raise SystemExit(1)

    # Verify actual execution works
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
    print("1. Create .env.ll-hs from template:")
    print("   cp .env.ll-hs.example .env.ll-hs")
    print("   # Then fill in your keys")
    print()
    print("2. Start the proxy:")
    print("   sh assets/ll-hs/run.sh")
