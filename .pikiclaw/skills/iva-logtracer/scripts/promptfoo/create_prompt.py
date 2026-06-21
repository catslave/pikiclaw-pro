#!/usr/bin/env python3

from __future__ import annotations

from pathlib import Path


def _skill_root() -> Path:
    return Path(__file__).resolve().parents[2]


def _read(relative_path: str) -> str:
    return (_skill_root() / relative_path).read_text(encoding="utf-8").strip()


def create_prompt(context: dict) -> str:
    vars_ = context["vars"]
    skill_md = _read("SKILL.md")
    routing_matrix = _read("references/routing-matrix.md")
    report_contract = _read("references/report-contract.md")

    return f"""You are evaluating whether the iva-logtracer skill would route a request correctly.

Use only the skill materials below. Do not invent capabilities. If evidence is missing, choose the most conservative routing and boundary behavior supported by the skill.

Return only valid JSON with this exact shape:
{{
  "skill_should_trigger": true,
  "primary_command": "discover|trace|turn|report|audit_kb|audit_tools|route_to_kibana|do_not_trigger",
  "follow_up_commands": ["trace", "report"],
  "output_mode": "discovery_summary|trace_summary|diagnostic_report|turn_analysis|kb_audit|tool_audit|manual_summary|no_skill",
  "boundary_behavior": "stay_within_iva_trace|route_to_adjacent_skill|stop_on_missing_artifacts|stop_at_iva_boundary|justify_route_choice",
  "required_checks": ["short_snake_case_checks"],
  "rationale": "1-3 sentences"
}}

Skill material: SKILL.md
---
{skill_md}
---

Skill material: routing-matrix.md
---
{routing_matrix}
---

Skill material: report-contract.md
---
{report_contract}
---

User request:
{vars_["user_request"]}
"""
