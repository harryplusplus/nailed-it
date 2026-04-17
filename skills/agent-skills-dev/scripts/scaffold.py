# /// script
# requires-python = ">=3.10"
# dependencies = [
#   "pyyaml",
# ]
# ///
"""Scaffold a new Agent Skill directory with a template SKILL.md.

Creates the directory structure and a SKILL.md template following
the Agent Skills specification best practices.

Usage:
    uv run scripts/scaffold.py <skill_name> [--output-dir DIR]

Exit codes:
    0: Success
    1: Error (invalid name, directory exists, etc.)
    2: Usage error
"""

import argparse
import re
from pathlib import Path
from typing import Any

from _common import error_exit, output_json

# Same rules as the spec
NAME_PATTERN = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*$")


def validate_skill_name(name: str) -> list[str]:
    """Validate a skill name for scaffolding."""
    errors: list[str] = []

    if not name:
        errors.append("Skill name cannot be empty")
        return errors

    if len(name) > 64:
        errors.append(f"Skill name exceeds 64 character limit ({len(name)} chars)")

    if name != name.lower():
        errors.append(f"Skill name '{name}' must be lowercase")

    if name.startswith("-") or name.endswith("-"):
        errors.append("Skill name cannot start or end with a hyphen")

    if "--" in name:
        errors.append("Skill name cannot contain consecutive hyphens")

    if not NAME_PATTERN.match(name):
        errors.append(
            f"Skill name '{name}' contains invalid characters. Only lowercase letters, digits, and hyphens are allowed."
        )

    return errors


SKILL_MD_TEMPLATE: str = """\
---
name: {name}
description: >-
  [Describe what this skill does and when to use it. Be specific about
  the tasks and keywords that should trigger activation. Max 1024 chars.]
---

# {title}

## When to use this skill

[Describe the scenarios where this skill should be activated.
Focus on user intent, not just keywords. See optimizing-descriptions
in the Agent Skills docs for guidance.]

## Instructions

[Step-by-step instructions for the agent to follow when this skill
is activated. Be prescriptive for fragile operations; give freedom
for flexible ones. Provide defaults, not menus.]

## Gotchas

- [List non-obvious facts, edge cases, and common mistakes the agent
  might make without being told. This is often the highest-value section.]

## Available scripts

- **`scripts/example.py`** — [Description of what this script does]
"""


def scaffold(name: str, output_dir: Path) -> dict[str, Any]:
    """Create a new skill scaffold.

    Returns a dict with the created paths.
    """
    skill_dir = output_dir / name
    created: list[str] = []

    # Create main directory
    skill_dir.mkdir(parents=True, exist_ok=False)
    created.append(f"{name}/")

    # Create SKILL.md
    title = name.replace("-", " ").title()
    skill_md_content = SKILL_MD_TEMPLATE.format(name=name, title=title)
    (skill_dir / "SKILL.md").write_text(skill_md_content, encoding="utf-8")
    created.append(f"{name}/SKILL.md")

    # Create optional directories
    for subdir in ("scripts", "references", "assets"):
        (skill_dir / subdir).mkdir(exist_ok=False)
        created.append(f"{name}/{subdir}/")

    return {
        "skill_name": name,
        "skill_dir": str(skill_dir.resolve()),
        "created": created,
    }


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Scaffold a new Agent Skill directory with a template SKILL.md.",
        epilog=(
            "Examples:\n"
            "  uv run scripts/scaffold.py my-new-skill\n"
            "  uv run scripts/scaffold.py data-pipeline --output-dir ./skills\n"
        ),
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "skill_name",
        help="Name for the new skill (lowercase, hyphens allowed)",
    )
    parser.add_argument(
        "--output-dir",
        default=".",
        help="Directory to create the skill in (default: current directory)",
    )
    args = parser.parse_args()

    name = args.skill_name.strip()
    output_dir = Path(args.output_dir)

    # Validate name
    name_errors = validate_skill_name(name)
    if name_errors:
        error_exit("; ".join(name_errors))

    # Check output directory exists
    if not output_dir.exists():
        error_exit(f"Output directory does not exist: {output_dir}")

    # Check skill directory doesn't already exist
    skill_dir = output_dir / name
    if skill_dir.exists():
        error_exit(f"Directory already exists: {skill_dir}")

    try:
        result = scaffold(name, output_dir)
        output_json(result)
    except FileExistsError as e:
        error_exit(str(e))
    except OSError as e:
        error_exit(f"Failed to create scaffold: {e}")


if __name__ == "__main__":
    main()
