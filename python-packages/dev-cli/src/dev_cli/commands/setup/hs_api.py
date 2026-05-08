import subprocess
import sys

from dev_cli.common import REPO_ROOT


def setup_hs_api() -> None:
    """Set up Hindsight API server."""

    print("Setting up Hindsight API server...")

    # Step 1: Install hindsight-api-slim via uv tool (isolated from workspace)
    print("Installing/updating hindsight-api-slim...")
    subprocess.run(
        [
            "uv", "tool", "install",
            "hindsight-api-slim",
            "--with", "sentence-transformers",
        ],
        check=True,
    )

    # Verify hindsight-api is available
    print("Verifying hindsight-api...")

    # Check uv tool list (confirms it's installed as a tool, not temp via uvx)
    result = subprocess.run(
        ["uv", "tool", "list"],
        capture_output=True,
        text=True,
        check=True,
    )
    if "hindsight-api-slim" in result.stdout:
        print("  hindsight-api-slim tool installed", file=sys.stderr)
    else:
        print("  ERROR: hindsight-api-slim not found in uv tools", file=sys.stderr)
        raise SystemExit(1)

    # Verify actual execution works
    subprocess.run(
        ["uvx", "hindsight-api", "--help"],
        capture_output=True,
        check=True,
    )
    print("  hindsight-api executes successfully", file=sys.stderr)

    # Link run.sh
    script_path = REPO_ROOT / "assets" / "hs-api" / "run.sh"
    print(f"  run.sh: {script_path}", file=sys.stderr)

    print()
    print("Setup complete!")
    print()
    print("1. Create .env.hs-api from template:")
    print("   cp .env.hs-api.example .env.hs-api")
    print("   # Then fill in your keys")
    print()
    print("2. Start the server:")
    print("   sh assets/hs-api/run.sh")
