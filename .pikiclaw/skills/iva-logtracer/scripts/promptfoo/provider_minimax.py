#!/usr/bin/env python3

from __future__ import annotations

import json
import os
import re
import time
import urllib.error
import urllib.request


FINAL_START = "FINAL_ROUTE_START"
FINAL_END = "FINAL_ROUTE_END"
ROUTE_FIELDS = [
    "skill_should_trigger",
    "primary_command",
    "follow_up_commands",
    "output_mode",
    "boundary_behavior",
]
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
FIELD_ALTERNATION = "|".join(re.escape(field) for field in ROUTE_FIELDS)


def _normalize_token(value: object) -> str:
    if value is None:
        return ""
    return re.sub(r"[^a-z0-9_]+", "_", str(value).strip().lower().replace("-", "_")).strip("_")


def _searchable_text(value: object) -> str:
    if value is None:
        return ""
    return str(value).strip().lower().replace("-", "_").replace(" ", "_")


def _extract_blocks(text: str) -> list[str]:
    return [
        match.group(1).strip()
        for match in re.finditer(
            rf"{re.escape(FINAL_START)}\s*(.*?)\s*{re.escape(FINAL_END)}",
            text,
            flags=re.IGNORECASE | re.DOTALL,
        )
    ]


def _extract_field_values(text: str, field: str) -> list[str]:
    values = [
        match.group(1).strip()
        for match in re.finditer(rf"(?im)^\s*(?:[-*]\s*)?{re.escape(field)}\s*(?:=|:)\s*(.+?)\s*$", text)
    ]
    values.extend(
        match.group(1).strip()
        for match in re.finditer(
            rf"(?is){re.escape(field)}\s*(?:=|:)\s*(.*?)(?=(?:[,;\n]\s*(?:{FIELD_ALTERNATION})\s*(?:=|:))|$)",
            text,
        )
    )
    return values


def _extract_enum(raw: str, allowed: list[str]) -> str | None:
    normalized = _normalize_token(raw)
    searchable = _searchable_text(raw)
    for value in allowed:
        if normalized == value:
            return value
    for value in sorted(allowed, key=len, reverse=True):
        if re.search(rf"(?<![a-z0-9]){re.escape(value)}(?![a-z0-9])", searchable):
            return value
    return None


def _extract_bool(raw: str) -> str | None:
    normalized = _normalize_token(raw)
    if normalized.startswith("true"):
        return "true"
    if normalized.startswith("false"):
        return "false"
    return None


def _extract_follow_up(raw: str) -> str | None:
    normalized = _normalize_token(raw)
    searchable = _searchable_text(raw)
    if not normalized or normalized in {"none", "null"}:
        return "none"

    tokens: list[str] = []
    for value in FOLLOW_UP_COMMANDS:
        if re.search(rf"(?<![a-z0-9]){re.escape(value)}(?![a-z0-9])", searchable):
            tokens.append(value)
    if not tokens:
        return None
    ordered = [value for value in FOLLOW_UP_COMMANDS if value in tokens]
    return ",".join(ordered)


def _sanitize_route_output(text: str) -> str:
    candidates = _extract_blocks(text)
    if not candidates:
        candidates = [text]

    for candidate in reversed(candidates):
        route: dict[str, str] = {}
        for field in ROUTE_FIELDS:
            values = _extract_field_values(candidate, field)
            if not values:
                continue
            raw_value = values[-1]
            if field == "skill_should_trigger":
                value = _extract_bool(raw_value)
            elif field == "primary_command":
                value = _extract_enum(raw_value, PRIMARY_COMMANDS)
            elif field == "follow_up_commands":
                value = _extract_follow_up(raw_value)
            elif field == "output_mode":
                value = _extract_enum(raw_value, OUTPUT_MODES)
            else:
                value = _extract_enum(raw_value, BOUNDARY_BEHAVIORS)
            if value:
                route[field] = value

        if "skill_should_trigger" not in route and "primary_command" in route:
            route["skill_should_trigger"] = (
                "false" if route["primary_command"] in {"route_to_kibana", "do_not_trigger"} else "true"
            )

        if len(route) == len(ROUTE_FIELDS):
            lines = [f"{field}={route[field]}" for field in ROUTE_FIELDS]
            return "\n".join(lines)

    return ""


def call_api(prompt: str, options: dict, context: dict) -> dict:
    config = options.get("config", {})
    api_key = os.getenv(config.get("api_key_env", "MINIMAX_API_KEY")) or os.getenv("OPENAI_API_KEY")
    if not api_key:
        return {"output": "", "error": "missing MINIMAX_API_KEY or OPENAI_API_KEY"}

    api_base_url = config.get("api_base_url", "https://api.minimaxi.com/v1").rstrip("/")
    model = config.get("model", "MiniMax-M2.7")
    temperature = float(config.get("temperature", 0.1))
    max_tokens = int(config.get("max_tokens", 900))
    timeout = float(config.get("timeout_seconds", 60))

    payload = {
        "model": model,
        "messages": [
            {
                "role": "system",
                "content": (
                    "You are a deterministic routing classifier. "
                    "Keep internal reasoning brief. Output only the FINAL_ROUTE block."
                ),
            },
            {"role": "user", "content": prompt},
        ],
        "temperature": temperature,
        "max_tokens": max_tokens,
        "n": 1,
        "reasoning_split": True,
    }

    request = urllib.request.Request(
        url=f"{api_base_url}/chat/completions",
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )

    start = time.time()
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            raw = response.read().decode("utf-8")
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        return {"output": "", "error": f"MiniMax HTTP {exc.code}: {body}"}
    except Exception as exc:
        return {"output": "", "error": f"MiniMax request failed: {exc}"}

    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        return {"output": raw[:2000], "error": f"MiniMax response was not JSON: {exc}"}

    choices = data.get("choices") or []
    if not choices:
        return {"output": raw[:2000], "error": "MiniMax response contained no choices"}

    message = choices[0].get("message") or {}
    content = message.get("content") or ""
    if isinstance(content, list):
        content = "".join(part.get("text", "") if isinstance(part, dict) else str(part) for part in content)
    content = _sanitize_route_output(content)

    reasoning_details = message.get("reasoning_details") or []
    reasoning_text = "\n".join(
        detail.get("text", "") for detail in reasoning_details if isinstance(detail, dict) and detail.get("text")
    )
    if not content and reasoning_text:
        content = _sanitize_route_output(reasoning_text)

    usage = data.get("usage") or {}

    return {
        "output": content,
        "tokenUsage": {
            "total": usage.get("total_tokens", 0),
            "prompt": usage.get("prompt_tokens", 0),
            "completion": usage.get("completion_tokens", 0),
        },
        "latencyMs": int((time.time() - start) * 1000),
        "metadata": {
            "reasoning_details": reasoning_details,
            "finish_reason": choices[0].get("finish_reason"),
            "model": data.get("model", model),
        },
    }
