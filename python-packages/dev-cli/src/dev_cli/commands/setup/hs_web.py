import subprocess
import sys


def setup_hs_web() -> None:
    """Set up Hindsight Control Plane (Web UI)."""

    print("Setting up Hindsight Control Plane...")

    # Step 1: Install @vectorize-io/hindsight-control-plane globally
    print("Installing/updating hindsight-control-plane...")
    subprocess.run(
        [
            "npm",
            "i",
            "-g",
            "@vectorize-io/hindsight-control-plane@0.6.1",
        ],
        check=True,
    )

    # Verify it works
    print("Verifying hindsight-control-plane...")
    subprocess.run(
        ["hindsight-control-plane", "--help"],
        capture_output=True,
        check=True,
    )
    print("  hindsight-control-plane executes successfully", file=sys.stderr)

    print()
    print("Setup complete!")
    print()
    print("Start the server:")
    print("  sh assets/hs-web/run.sh")
