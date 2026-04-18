# /// script
# requires-python = ">=3.10"
# dependencies = [
#   "pyyaml",
# ]
# ///
"""Shared utilities for Agent Skills development scripts."""

import json
import sys
from pathlib import Path
from typing import Any, cast

import yaml


def find_skill_md(skill_dir: Path) -> Path | None:
    """Find SKILL.md in a skill directory. Prefers uppercase."""
    for name in ("SKILL.md", "skill.md"):
        path = skill_dir / name
        if path.exists():
            return path
    return None


def parse_frontmatter(content: str) -> tuple[dict[str, Any], str]:
    """Parse YAML frontmatter from SKILL.md content.

    Returns (metadata_dict, body_string).
    Raises ValueError on invalid frontmatter.
    """
    if not content.startswith("---"):
        raise ValueError("SKILL.md must start with YAML frontmatter (---)")

    parts = content.split("---", 2)
    if len(parts) < 3:
        raise ValueError("SKILL.md frontmatter not properly closed with ---")

    frontmatter_str = parts[1]
    body = parts[2].strip()

    try:
        raw_metadata: Any = yaml.safe_load(frontmatter_str)
    except yaml.YAMLError as e:
        raise ValueError(f"Invalid YAML in frontmatter: {e}") from e

    if raw_metadata is None:
        raise ValueError("SKILL.md frontmatter is empty")

    if not isinstance(raw_metadata, dict):
        raise ValueError("SKILL.md frontmatter must be a YAML mapping")

    metadata = cast(dict[str, Any], raw_metadata)

    # Normalize metadata: ensure string values for known string fields
    meta_field = metadata.get("metadata")
    if isinstance(meta_field, dict):
        typed_meta = cast(dict[str, Any], meta_field)
        metadata["metadata"] = {str(k): str(v) for k, v in typed_meta.items()}

    return metadata, body


def read_skill_md(skill_dir: Path) -> tuple[dict[str, Any], str, Path]:
    """Find and parse SKILL.md from a skill directory.

    Returns (metadata_dict, body_string, skill_md_path).
    Raises FileNotFoundError if SKILL.md not found.
    Raises ValueError if frontmatter is invalid.
    """
    skill_dir = Path(skill_dir).resolve()
    skill_md = find_skill_md(skill_dir)

    if skill_md is None:
        raise FileNotFoundError(f"SKILL.md not found in {skill_dir}")

    content = skill_md.read_text(encoding="utf-8")
    metadata, body = parse_frontmatter(content)
    return metadata, body, skill_md


def output_json(data: dict[str, Any] | list[Any]) -> None:
    """Print data as JSON to stdout."""
    print(json.dumps(data, ensure_ascii=False, indent=2))


def error_exit(message: str, code: int = 1) -> None:
    """Print error as JSON to stderr and exit."""
    print(json.dumps({"error": message}, ensure_ascii=False), file=sys.stderr)
    sys.exit(code)
