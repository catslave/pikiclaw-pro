#!/usr/bin/env python3

from __future__ import annotations

import re


FINAL_START = "FINAL_ROUTE_START"
FINAL_END = "FINAL_ROUTE_END"
PRIMARY_COMMANDS = [
    "discover",
    "trace",
    "turn",
    "audit_kb",
    "audit_tools",
    "route_to_kibana",
    "do_not_trigger",
]
FOLLOW_UP_COMMANDS = ["trace", "report", "audit_kb", "audit_tools", "turn"]
OUTPUT_MODES = [
    "discovery_summary",
    "diagnostic_report",
    "turn_analysis",
    "kb_audit",
    "tool_audit",
    "manual_summary",
    "no_skill",
]
BOUNDARY_BEHAVIORS = [
    "stay_within_iva_trace",
    "route_to_adjacent_skill",
    "stop_on_missing_artifacts",
    "stop_at_iva_boundary",
    "justify_route_choice",
]
FIELD_ALTERNATION = "|".join(re.escape(field) for field in ["skill_should_trigger", "primary_command", "follow_up_commands", "output_mode", "boundary_behavior"])


def _normalize_string(value: object) -> str:
    if value is None:
        return ""
    return re.sub(r"[^a-z0-9_]+", "_", str(value).strip().lower().replace("-", "_")).strip("_")


def _searchable_text(value: object) -> str:
    if value is None:
        return ""
    return str(value).strip().lower().replace("-", "_").replace(" ", "_")


def _normalize_list(value: object) -> list[str]:
    if not isinstance(value, list):
        return []
    return sorted(_normalize_string(item) for item in value if _normalize_string(item))


def _parse_bool(value: str) -> bool | None:
    value = _normalize_string(value)
    if value.startswith("true"):
        return True
    if value.startswith("false"):
        return False
    return None


def _extract_blocks(text: str) -> list[str]:
    return [
        match.group(1).strip()
        for match in re.finditer(
            rf"{re.escape(FINAL_START)}\s*(.*?)\s*{re.escape(FINAL_END)}",
            text,
            flags=re.IGNORECASE | re.DOTALL,
        )
    ]


def _extract_field(text: str, field: str) -> str | None:
    matches = re.findall(rf"(?im)^\s*(?:[-*]\s*)?{re.escape(field)}\s*(?:=|:)\s*(.+?)\s*$", text)
    matches.extend(
        re.findall(
            rf"(?is){re.escape(field)}\s*(?:=|:)\s*(.*?)(?=(?:[,;\n]\s*(?:{FIELD_ALTERNATION})\s*(?:=|:))|$)",
            text,
        )
    )
    if not matches:
        return None
    return matches[-1].strip()


def _extract_enum(raw: str | None, allowed: list[str]) -> str:
    normalized = _normalize_string(raw)
    searchable = _searchable_text(raw)
    for value in allowed:
        if normalized == value:
            return value
    for value in sorted(allowed, key=len, reverse=True):
        if re.search(rf"(?<![a-z0-9]){re.escape(value)}(?![a-z0-9])", searchable):
            return value
    return ""


def _extract_candidate_output(output: str) -> str:
    blocks = _extract_blocks(output)
    return blocks[-1] if blocks else output


def _parse_follow_up(value: str | None) -> list[str]:
    if value is None:
        return []
    normalized = _normalize_string(value)
    searchable = _searchable_text(value)
    if normalized in {"", "none", "null"}:
        return []
    values = []
    for command in FOLLOW_UP_COMMANDS:
        if re.search(rf"(?<![a-z0-9]){re.escape(command)}(?![a-z0-9])", searchable):
            values.append(command)
    return sorted(values)


def check_route(output: str, context: dict) -> dict:
    expected = context["vars"]["expected"]
    candidate_output = _extract_candidate_output(output)

    actual_trigger_raw = _extract_field(candidate_output, "skill_should_trigger")
    actual_primary_raw = _extract_field(candidate_output, "primary_command")
    actual_follow_up_raw = _extract_field(candidate_output, "follow_up_commands")
    actual_output_mode_raw = _extract_field(candidate_output, "output_mode")
    actual_boundary_raw = _extract_field(candidate_output, "boundary_behavior")

    actual_trigger = _parse_bool(actual_trigger_raw or "")
    actual_primary = _extract_enum(actual_primary_raw, PRIMARY_COMMANDS)
    actual_output_mode = _extract_enum(actual_output_mode_raw, OUTPUT_MODES)
    actual_boundary = _extract_enum(actual_boundary_raw, BOUNDARY_BEHAVIORS)
    if actual_trigger is None and actual_primary:
        actual_trigger = actual_primary not in {"route_to_kibana", "do_not_trigger"}
        actual_trigger_raw = actual_trigger_raw or str(actual_trigger).lower()

    dimensions: list[tuple[str, bool, str]] = []

    trigger_ok = actual_trigger == expected["skill_should_trigger"]
    dimensions.append(
        (
            "trigger_correct",
            trigger_ok,
            f"expected skill_should_trigger={expected['skill_should_trigger']}, got {actual_trigger_raw}",
        )
    )

    primary_ok = _normalize_string(actual_primary) == _normalize_string(expected["primary_command"])
    dimensions.append(
        (
            "primary_command_correct",
            primary_ok,
            f"expected primary_command={expected['primary_command']}, got {actual_primary_raw}",
        )
    )

    follow_up_ok = _parse_follow_up(actual_follow_up_raw) == _normalize_list(expected["follow_up_commands"])
    dimensions.append(
        (
            "follow_up_correct",
            follow_up_ok,
            f"expected follow_up_commands={expected['follow_up_commands']}, got {actual_follow_up_raw}",
        )
    )

    output_mode_ok = _normalize_string(actual_output_mode) == _normalize_string(expected["output_mode"])
    dimensions.append(
        (
            "output_contract_correct",
            output_mode_ok,
            f"expected output_mode={expected['output_mode']}, got {actual_output_mode_raw}",
        )
    )

    boundary_ok = _normalize_string(actual_boundary) == _normalize_string(expected["boundary_behavior"])
    dimensions.append(
        (
            "boundary_correct",
            boundary_ok,
            f"expected boundary_behavior={expected['boundary_behavior']}, got {actual_boundary_raw}",
        )
    )

    passed = [name for name, ok, _ in dimensions if ok]
    failed = [f"{name}: {reason}" for name, ok, reason in dimensions if not ok]
    score = len(passed) / len(dimensions)

    return {
        "pass": not failed,
        "score": score,
        "reason": "all routing checks passed" if not failed else " | ".join(failed),
        "namedScores": {name: 1 if ok else 0 for name, ok, _ in dimensions},
    }
