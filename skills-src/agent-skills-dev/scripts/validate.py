# /// script
# requires-python = ">=3.10"
# dependencies = [
#   "pyyaml",
# ]
# ///
"""Validate an Agent Skill directory against the specification.

Checks SKILL.md frontmatter, naming conventions, and structure.
Outputs JSON with validation results.

Usage:
    uv run scripts/validate.py <skill_dir>

Exit codes:
    0: Valid skill (may have warnings)
    1: Validation errors found
    2: Usage error
"""

import argparse
import sys
import unicodedata
from pathlib import Path
from typing import Any, cast

from _common import find_skill_md, output_json, parse_frontmatter

MAX_NAME_LENGTH = 64
MAX_DESCRIPTION_LENGTH = 1024
MAX_COMPATIBILITY_LENGTH = 500

ALLOWED_FIELDS: set[str] = {
    "name",
    "description",
    "license",
    "allowed-tools",
    "metadata",
    "compatibility",
}


def _validate_name(name: Any, skill_dir: Path) -> list[str]:
    """Validate skill name format and directory match."""
    errors: list[str] = []

    if not isinstance(name, str) or not name.strip():
        errors.append("Field 'name' must be a non-empty string")
        return errors

    normalized = unicodedata.normalize("NFKC", name.strip())

    if len(normalized) > MAX_NAME_LENGTH:
        errors.append(f"Skill name exceeds {MAX_NAME_LENGTH} character limit ({len(normalized)} chars)")

    if normalized != normalized.lower():
        errors.append(f"Skill name '{normalized}' must be lowercase")

    if normalized.startswith("-") or normalized.endswith("-"):
        errors.append("Skill name cannot start or end with a hyphen")

    if "--" in normalized:
        errors.append("Skill name cannot contain consecutive hyphens")

    if not all(c.isalnum() or c == "-" for c in normalized):
        errors.append(
            f"Skill name '{normalized}' contains invalid characters. Only letters, digits, and hyphens are allowed."
        )

    if skill_dir:
        dir_name = unicodedata.normalize("NFKC", skill_dir.name)
        if dir_name != normalized:
            errors.append(f"Directory name '{skill_dir.name}' must match skill name '{normalized}'")

    return errors


def _validate_description(description: Any) -> list[str]:
    """Validate description field."""
    errors: list[str] = []

    if not isinstance(description, str) or not description.strip():
        errors.append("Field 'description' must be a non-empty string")
        return errors

    if len(description) > MAX_DESCRIPTION_LENGTH:
        errors.append(f"Description exceeds {MAX_DESCRIPTION_LENGTH} character limit ({len(description)} chars)")

    return errors


def _validate_compatibility(compatibility: Any) -> list[str]:
    """Validate compatibility field."""
    errors: list[str] = []

    if not isinstance(compatibility, str):
        errors.append("Field 'compatibility' must be a string")
        return errors

    if len(compatibility) > MAX_COMPATIBILITY_LENGTH:
        errors.append(f"Compatibility exceeds {MAX_COMPATIBILITY_LENGTH} character limit ({len(compatibility)} chars)")

    return errors


def _validate_metadata_field(metadata_val: Any) -> list[str]:
    """Validate metadata field."""
    errors: list[str] = []

    if not isinstance(metadata_val, dict):
        errors.append("Field 'metadata' must be a mapping")
        return errors

    typed_meta = cast(dict[str, Any], metadata_val)
    for k, v in typed_meta.items():
        if not isinstance(v, str):
            errors.append(f"Metadata value for key '{k}' must be a string")

    return errors


def _validate_allowed_fields(metadata: dict[str, Any]) -> list[str]:
    """Validate that only allowed fields are present."""
    errors: list[str] = []
    extra = set(metadata.keys()) - ALLOWED_FIELDS
    if extra:
        errors.append(
            f"Unexpected fields in frontmatter: {', '.join(sorted(extra))}. Allowed: {sorted(ALLOWED_FIELDS)}"
        )
    return errors


def _collect_warnings(metadata: dict[str, Any], body: str, skill_dir: Path) -> list[str]:
    """Collect best-practice warnings."""
    warnings: list[str] = []

    # Description quality
    desc = metadata.get("description", "")
    if isinstance(desc, str) and 0 < len(desc.strip()) < 20:
        warnings.append(
            "Description is very short, consider making it more descriptive "
            "and including keywords that help agents identify relevant tasks"
        )

    # Body content
    if not body.strip():
        warnings.append("SKILL.md body is empty — add instructions for the agent")
    else:
        line_count = len(body.splitlines())
        if line_count > 500:
            warnings.append(
                f"SKILL.md body is {line_count} lines "
                f"(recommended: under 500). "
                "Consider moving detailed content to references/ or assets/"
            )

    # Directory structure suggestions
    if not (skill_dir / "scripts").exists():
        warnings.append("No scripts/ directory — consider adding executable scripts if the skill needs them")

    return warnings


def validate(skill_dir: Path) -> dict[str, Any]:
    """Validate a skill directory. Returns result dict."""
    skill_dir = Path(skill_dir).resolve()
    errors: list[str] = []
    warnings: list[str] = []

    # Check path exists
    if not skill_dir.exists():
        return {
            "skill_dir": str(skill_dir),
            "valid": False,
            "errors": [f"Path does not exist: {skill_dir}"],
            "warnings": [],
        }

    if not skill_dir.is_dir():
        return {
            "skill_dir": str(skill_dir),
            "valid": False,
            "errors": [f"Not a directory: {skill_dir}"],
            "warnings": [],
        }

    # Check SKILL.md exists
    skill_md = find_skill_md(skill_dir)
    if skill_md is None:
        return {
            "skill_dir": str(skill_dir),
            "valid": False,
            "errors": ["Missing required file: SKILL.md"],
            "warnings": [],
        }

    # Parse frontmatter
    try:
        content = skill_md.read_text(encoding="utf-8")
        metadata, body = parse_frontmatter(content)
    except (ValueError, FileNotFoundError) as e:
        return {
            "skill_dir": str(skill_dir),
            "valid": False,
            "errors": [str(e)],
            "warnings": [],
        }

    # Validate fields
    errors.extend(_validate_allowed_fields(metadata))

    if "name" not in metadata:
        errors.append("Missing required field in frontmatter: name")
    else:
        errors.extend(_validate_name(metadata["name"], skill_dir))

    if "description" not in metadata:
        errors.append("Missing required field in frontmatter: description")
    else:
        errors.extend(_validate_description(metadata["description"]))

    if "compatibility" in metadata:
        errors.extend(_validate_compatibility(metadata["compatibility"]))

    if "metadata" in metadata:
        errors.extend(_validate_metadata_field(metadata["metadata"]))

    # Optional field type checks
    for field in ("license", "allowed-tools"):
        if field in metadata and not isinstance(metadata[field], str):
            errors.append(f"Field '{field}' must be a string")

    # Collect warnings
    warnings.extend(_collect_warnings(metadata, body, skill_dir))

    return {
        "skill_dir": str(skill_dir),
        "valid": len(errors) == 0,
        "errors": errors,
        "warnings": warnings,
    }


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Validate an Agent Skill directory against the specification.",
        epilog=(
            "Examples:\n  uv run scripts/validate.py ./my-skill\n  uv run scripts/validate.py ./my-skill/SKILL.md\n"
        ),
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "skill_path",
        help="Path to the skill directory (or SKILL.md file)",
    )
    args = parser.parse_args()

    skill_path = Path(args.skill_path)

    # If pointed at SKILL.md, use parent directory
    if skill_path.is_file() and skill_path.name.lower() == "skill.md":
        skill_path = skill_path.parent

    result = validate(skill_path)
    output_json(result)
    sys.exit(0 if result["valid"] else 1)


if __name__ == "__main__":
    main()
