import os
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[4]


def check_repo_root() -> None:
    if not REPO_ROOT.exists():
        msg = f"Repo root not found at {REPO_ROOT}"
        raise RuntimeError(msg)


def link_file(
    src_dir: str | Path,
    dest_dir: str | Path,
    file_name: str,
) -> None:
    src = Path(src_dir).resolve() / file_name
    if not src.exists():
        msg = f"Source file not found: {src}"
        raise RuntimeError(msg)

    abs_dest_dir = Path(dest_dir).resolve()
    abs_dest_dir.mkdir(parents=True, exist_ok=True)
    dest = abs_dest_dir / file_name

    if dest.is_symlink():
        dest.unlink()
    elif dest.is_file():
        bak = dest.with_suffix(dest.suffix + ".bak")
        bak.unlink(missing_ok=True)
        dest.rename(bak)
    elif dest.exists():
        msg = f"Expected {dest} to be a file or symlink"
        raise RuntimeError(msg)

    rel_src = os.path.relpath(src, abs_dest_dir)
    dest.symlink_to(rel_src)
    print(f"  Linked {dest} -> {rel_src}", file=sys.stderr)
