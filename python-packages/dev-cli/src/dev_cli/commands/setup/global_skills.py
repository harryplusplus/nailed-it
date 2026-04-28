import os
import sys
from pathlib import Path

from dev_cli.common import REPO_ROOT

GLOBAL_SKILLS_DIR = Path.home() / ".agents" / "skills"


def clean_broken_symlinks() -> None:
    """Delete broken symlinks in ~/.agents/skills."""
    print("Cleaning broken symlinks in ~/.agents/skills...")
    for skill_dir in sorted(GLOBAL_SKILLS_DIR.iterdir()):
        if not skill_dir.is_dir():
            continue
        for entry in sorted(skill_dir.iterdir()):
            if entry.is_symlink() and not entry.exists():
                print(f"  Removing broken symlink: {entry}", file=sys.stderr)
                entry.unlink()


def link_skill(name: str) -> None:
    """Symlink ~/.agents/skills/<name>/SKILL.md -> skills-src/<name>/SKILL.md."""
    src = (REPO_ROOT / "skills-src" / name / "SKILL.md").resolve()
    if not src.exists():
        msg = f"Skill source not found: {src}"
        raise RuntimeError(msg)

    dest_dir = (GLOBAL_SKILLS_DIR / name).resolve()
    dest_dir.mkdir(parents=True, exist_ok=True)
    dest = dest_dir / "SKILL.md"

    if dest.is_symlink():
        dest.unlink()
    elif dest.is_file():
        bak = dest.with_suffix(dest.suffix + ".bak")
        bak.unlink(missing_ok=True)
        dest.rename(bak)
    elif dest.exists():
        msg = f"Expected {dest} to be a file or symlink"
        raise RuntimeError(msg)

    rel_src = os.path.relpath(src, dest_dir)
    dest.symlink_to(rel_src)
    print(f"  Linked {dest} -> {rel_src}", file=sys.stderr)


def unlink_skill(name: str) -> None:
    """Remove symlink ~/.agents/skills/<name>/SKILL.md, restore .bak if exists."""
    dest_dir = (GLOBAL_SKILLS_DIR / name).resolve()
    dest = dest_dir / "SKILL.md"

    if not dest.is_symlink():
        print(f"  Not a symlink, skipping: {dest}", file=sys.stderr)
        return

    dest.unlink()
    print(f"  Removed symlink: {dest}", file=sys.stderr)

    bak = dest.with_suffix(dest.suffix + ".bak")
    if bak.exists():
        bak.rename(dest)
        print(f"  Restored backup: {dest}", file=sys.stderr)


def setup_global_skills() -> None:
    """Clean broken symlinks and link global skills."""
    clean_broken_symlinks()

    # Add link_skill("<name>") calls below
    link_skill("memory")
    link_skill("tavily")
