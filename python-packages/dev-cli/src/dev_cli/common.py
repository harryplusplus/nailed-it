from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[4]


def check_repo_root() -> None:
    if not REPO_ROOT.exists():
        msg = f"Repo root not found at {REPO_ROOT}"
        raise RuntimeError(msg)
