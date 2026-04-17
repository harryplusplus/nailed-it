# /// script
# requires-python = ">=3.10"
# dependencies = [
#   "pyyaml",
# ]
# ///
"""Generate <available_skills> XML for agent prompts.

Accepts one or more skill directories and generates the XML block
that can be included in agent system prompts.

Usage:
    uv run scripts/to_prompt.py <skill_dir1> [skill_dir2 ...]

Exit codes:
    0: Success
    1: Error
    2: Usage error
"""

import argparse
import html
import sys
from pathlib import Path
from typing import Any

from _common import error_exit, output_json, read_skill_md


def to_prompt(skill_dirs: list[Path]) -> dict[str, Any]:
    """Generate <available_skills> XML and structured data.

    Returns a dict with 'skills' (list of skill info) and 'prompt' (XML).
    """
    skills_info: list[dict[str, str]] = []
    xml_lines: list[str] = ["<available_skills>"]

    for skill_dir in skill_dirs:
        skill_dir = Path(skill_dir).resolve()

        try:
            metadata, _body, skill_md_path = read_skill_md(skill_dir)
        except (FileNotFoundError, ValueError) as e:
            print(f"Warning: skipping {skill_dir}: {e}", file=sys.stderr)
            continue

        name: Any = metadata.get("name", "")
        description: Any = metadata.get("description", "")

        if not name or not description:
            print(
                f"Warning: skipping {skill_dir}: missing name or description",
                file=sys.stderr,
            )
            continue

        name_str = str(name)
        desc_str = str(description)

        # Build structured info
        skill_data: dict[str, str] = {
            "name": name_str,
            "description": desc_str,
            "location": str(skill_md_path),
        }
        skills_info.append(skill_data)

        # Build XML
        xml_lines.append("<skill>")
        xml_lines.append(f"<name>{html.escape(name_str)}</name>")
        xml_lines.append(f"<description>{html.escape(desc_str)}</description>")
        xml_lines.append(f"<location>{html.escape(str(skill_md_path))}</location>")
        xml_lines.append("</skill>")

    xml_lines.append("</available_skills>")
    xml_str = "\n".join(xml_lines)

    return {"skills": skills_info, "prompt": xml_str}


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Generate <available_skills> XML for agent prompts.",
        epilog=(
            "Examples:\n"
            "  uv run scripts/to_prompt.py ./skill-a ./skill-b\n"
            "  uv run scripts/to_prompt.py ~/.agents/skills/*/\n"
        ),
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "skill_paths",
        nargs="+",
        help="One or more paths to skill directories (or SKILL.md files)",
    )
    args = parser.parse_args()

    # Resolve paths — if pointed at SKILL.md, use parent directory
    skill_dirs: list[Path] = []
    for p in args.skill_paths:
        path = Path(p)
        if path.is_file() and path.name.lower() == "skill.md":
            skill_dirs.append(path.parent)
        else:
            skill_dirs.append(path)

    try:
        result = to_prompt(skill_dirs)
        output_json(result)
    except Exception as e:
        error_exit(str(e))


if __name__ == "__main__":
    main()
