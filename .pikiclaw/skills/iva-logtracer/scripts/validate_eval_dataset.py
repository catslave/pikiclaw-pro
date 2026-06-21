#!/usr/bin/env python3

from __future__ import annotations

import argparse
import json
import sys
from collections import Counter
from pathlib import Path


ALLOWED_PRIMARY_COMMANDS = {
    "discover",
    "trace",
    "turn",
    "report",
    "audit_kb",
    "audit_tools",
    "kibana_search",
    "kibana_agg",
    "route_to_kibana",
    "do_not_trigger",
}

ALLOWED_OUTPUT_MODES = {
    "discovery_summary",
    "trace_summary",
    "diagnostic_report",
    "turn_analysis",
    "kb_audit",
    "tool_audit",
    "log_lookup_summary",
    "log_statistics_summary",
    "manual_summary",
    "no_skill",
}

ALLOWED_BOUNDARY_BEHAVIORS = {
    "stay_within_iva_trace",
    "route_to_adjacent_skill",
    "stop_on_missing_artifacts",
    "stop_at_iva_boundary",
    "justify_route_choice",
    "explicit_field_log_lookup",
}


def require_keys(obj: dict, keys: list[str], context: str) -> list[str]:
    errors: list[str] = []
    for key in keys:
        if key not in obj:
            errors.append(f"{context}: missing required key '{key}'")
    return errors


def require_string_list(value: object, context: str) -> list[str]:
    if not isinstance(value, list) or any(not isinstance(item, str) for item in value):
        return [f"{context}: expected list[str]"]
    return []


def validate_row(row: dict, row_number: int) -> list[str]:
    errors: list[str] = []
    context = f"row {row_number}"
    errors.extend(require_keys(row, ["id", "input", "expected", "metadata", "tags"], context))
    if errors:
        return errors

    if not isinstance(row["id"], str) or not row["id"].strip():
        errors.append(f"{context}: 'id' must be a non-empty string")

    if not isinstance(row["input"], dict):
        errors.append(f"{context}: 'input' must be an object")
    else:
        errors.extend(require_keys(row["input"], ["prompt", "request_shape"], f"{context}.input"))
        if isinstance(row["input"].get("prompt"), str):
            if not row["input"]["prompt"].strip():
                errors.append(f"{context}.input: 'prompt' must not be empty")
        else:
            errors.append(f"{context}.input: 'prompt' must be a string")

    if not isinstance(row["expected"], dict):
        errors.append(f"{context}: 'expected' must be an object")
    else:
        expected = row["expected"]
        errors.extend(
            require_keys(
                expected,
                [
                    "skill_should_trigger",
                    "primary_command",
                    "follow_up_commands",
                    "output_mode",
                    "boundary_behavior",
                    "required_checks",
                    "forbidden_moves",
                ],
                f"{context}.expected",
            )
        )
        if not isinstance(expected.get("skill_should_trigger"), bool):
            errors.append(f"{context}.expected: 'skill_should_trigger' must be a bool")
        primary_command = expected.get("primary_command")
        if primary_command not in ALLOWED_PRIMARY_COMMANDS:
            errors.append(
                f"{context}.expected: 'primary_command' must be one of {sorted(ALLOWED_PRIMARY_COMMANDS)}"
            )
        output_mode = expected.get("output_mode")
        if output_mode not in ALLOWED_OUTPUT_MODES:
            errors.append(
                f"{context}.expected: 'output_mode' must be one of {sorted(ALLOWED_OUTPUT_MODES)}"
            )
        boundary_behavior = expected.get("boundary_behavior")
        if boundary_behavior not in ALLOWED_BOUNDARY_BEHAVIORS:
            errors.append(
                f"{context}.expected: 'boundary_behavior' must be one of {sorted(ALLOWED_BOUNDARY_BEHAVIORS)}"
            )
        errors.extend(require_string_list(expected.get("follow_up_commands"), f"{context}.expected.follow_up_commands"))
        errors.extend(require_string_list(expected.get("required_checks"), f"{context}.expected.required_checks"))
        errors.extend(require_string_list(expected.get("forbidden_moves"), f"{context}.expected.forbidden_moves"))

    if not isinstance(row["metadata"], dict):
        errors.append(f"{context}: 'metadata' must be an object")
    else:
        errors.extend(
            require_keys(
                row["metadata"],
                ["category", "runtime_path", "difficulty", "coverage_expectation", "source_refs"],
                f"{context}.metadata",
            )
        )
        errors.extend(require_string_list(row["metadata"].get("source_refs"), f"{context}.metadata.source_refs"))

    errors.extend(require_string_list(row["tags"], f"{context}.tags"))

    return errors


def parse_dataset(path: Path) -> tuple[list[dict], list[str]]:
    rows: list[dict] = []
    errors: list[str] = []
    seen_ids: set[str] = set()

    for row_number, raw_line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
        line = raw_line.strip()
        if not line:
            continue
        try:
            row = json.loads(line)
        except json.JSONDecodeError as exc:
            errors.append(f"row {row_number}: invalid JSON ({exc})")
            continue
        if not isinstance(row, dict):
            errors.append(f"row {row_number}: top-level JSON value must be an object")
            continue
        row_errors = validate_row(row, row_number)
        if row_errors:
            errors.extend(row_errors)
            continue
        row_id = row["id"]
        if row_id in seen_ids:
            errors.append(f"row {row_number}: duplicate id '{row_id}'")
            continue
        seen_ids.add(row_id)
        rows.append(row)

    return rows, errors


def print_summary(rows: list[dict]) -> None:
    command_counts = Counter(row["expected"]["primary_command"] for row in rows)
    category_counts = Counter(row["metadata"]["category"] for row in rows)
    tag_counts = Counter(tag for row in rows for tag in row["tags"])

    print(f"rows: {len(rows)}")
    print("primary_commands:")
    for command, count in sorted(command_counts.items()):
        print(f"  - {command}: {count}")
    print("categories:")
    for category, count in sorted(category_counts.items()):
        print(f"  - {category}: {count}")
    print("top_tags:")
    for tag, count in sorted(tag_counts.items()):
        print(f"  - {tag}: {count}")


def main() -> int:
    parser = argparse.ArgumentParser(description="Validate iva-logtracer evaluation dataset schema.")
    parser.add_argument(
        "dataset",
        nargs="?",
        default="assets/eval-dataset.jsonl",
        help="Path to the JSONL dataset. Defaults to assets/eval-dataset.jsonl",
    )
    args = parser.parse_args()

    dataset_path = Path(args.dataset)
    if not dataset_path.is_absolute():
        dataset_path = Path(__file__).resolve().parent.parent / dataset_path

    if not dataset_path.exists():
        print(f"error: dataset not found: {dataset_path}", file=sys.stderr)
        return 1

    rows, errors = parse_dataset(dataset_path)
    if errors:
        for error in errors:
            print(f"error: {error}", file=sys.stderr)
        return 1

    print_summary(rows)
    print("PASS: dataset schema is valid.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
