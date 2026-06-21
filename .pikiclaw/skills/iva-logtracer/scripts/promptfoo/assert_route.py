#!/usr/bin/env python3

from __future__ import annotations

import json


def _normalize_string(value: object) -> str:
    if value is None:
        return ""
    return str(value).strip().lower().replace("-", "_").replace(" ", "_")


def _normalize_list(value: object) -> list[str]:
    if not isinstance(value, list):
        return []
    return sorted(_normalize_string(item) for item in value if _normalize_string(item))


def _extract_json_object(text: str) -> dict | None:
    text = text.strip()
    if not text:
        return None

    try:
        parsed = json.loads(text)
        if isinstance(parsed, dict):
            return parsed
    except json.JSONDecodeError:
        pass

    fence_start = text.find("```json")
    if fence_start != -1:
        fence_start = text.find("{", fence_start)
        if fence_start != -1:
            candidate = _extract_balanced_object(text, fence_start)
            if candidate is not None:
                return candidate

    for idx, char in enumerate(text):
        if char != "{":
            continue
        candidate = _extract_balanced_object(text, idx)
        if candidate is not None:
            return candidate
    return None


def _extract_balanced_object(text: str, start_index: int) -> dict | None:
    depth = 0
    in_string = False
    escape = False

    for idx in range(start_index, len(text)):
        char = text[idx]
        if in_string:
            if escape:
                escape = False
            elif char == "\\":
                escape = True
            elif char == '"':
                in_string = False
            continue

        if char == '"':
            in_string = True
        elif char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
            if depth == 0:
                snippet = text[start_index : idx + 1]
                try:
                    parsed = json.loads(snippet)
                except json.JSONDecodeError:
                    return None
                if isinstance(parsed, dict):
                    return parsed
                return None
    return None


def check_route(output: str, context: dict) -> dict:
    actual = _extract_json_object(output)
    if actual is None:
        return {
            "pass": False,
            "score": 0,
            "reason": "output did not contain a valid JSON object",
        }

    expected = context["vars"]["expected"]

    dimensions: list[tuple[str, bool, str]] = []

    trigger_ok = actual.get("skill_should_trigger") == expected["skill_should_trigger"]
    dimensions.append(
        (
            "trigger_correct",
            trigger_ok,
            f"expected skill_should_trigger={expected['skill_should_trigger']}, got {actual.get('skill_should_trigger')}",
        )
    )

    primary_ok = _normalize_string(actual.get("primary_command")) == _normalize_string(expected["primary_command"])
    dimensions.append(
        (
            "primary_command_correct",
            primary_ok,
            f"expected primary_command={expected['primary_command']}, got {actual.get('primary_command')}",
        )
    )

    follow_up_ok = _normalize_list(actual.get("follow_up_commands")) == _normalize_list(expected["follow_up_commands"])
    dimensions.append(
        (
            "follow_up_correct",
            follow_up_ok,
            f"expected follow_up_commands={expected['follow_up_commands']}, got {actual.get('follow_up_commands')}",
        )
    )

    output_mode_ok = _normalize_string(actual.get("output_mode")) == _normalize_string(expected["output_mode"])
    dimensions.append(
        (
            "output_contract_correct",
            output_mode_ok,
            f"expected output_mode={expected['output_mode']}, got {actual.get('output_mode')}",
        )
    )

    boundary_ok = _normalize_string(actual.get("boundary_behavior")) == _normalize_string(expected["boundary_behavior"])
    dimensions.append(
        (
            "boundary_correct",
            boundary_ok,
            f"expected boundary_behavior={expected['boundary_behavior']}, got {actual.get('boundary_behavior')}",
        )
    )

    actual_checks = set(_normalize_list(actual.get("required_checks")))
    expected_checks = set(_normalize_list(expected["required_checks"]))
    checks_ok = expected_checks.issubset(actual_checks)
    dimensions.append(
        (
            "artifact_discipline_correct",
            checks_ok,
            f"expected required_checks to include {sorted(expected_checks)}, got {sorted(actual_checks)}",
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
