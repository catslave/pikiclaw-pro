#!/usr/bin/env python3

from __future__ import annotations

import json
from pathlib import Path


def _skill_root() -> Path:
    return Path(__file__).resolve().parents[2]


def _load_rows(dataset_path: Path) -> list[dict]:
    rows: list[dict] = []
    for raw_line in dataset_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line:
            continue
        rows.append(json.loads(line))
    return rows


def create_tests(config: dict | None = None) -> list[dict]:
    config = config or {}
    skill_root = _skill_root()
    dataset_value = config.get("dataset", "assets/eval-dataset.jsonl")
    dataset_path = Path(dataset_value)
    if not dataset_path.is_absolute():
        dataset_path = (skill_root / dataset_path).resolve()

    tests: list[dict] = []
    for row in _load_rows(dataset_path):
        tests.append(
            {
                "description": row["id"],
                "vars": {
                    "user_request": row["input"]["prompt"],
                    "request_shape": row["input"].get("request_shape", ""),
                    "artifacts_provided": ", ".join(row["input"].get("artifacts_provided", [])) or "none",
                    "environment_hint": row["input"].get("environment_hint", ""),
                    "language": row["input"].get("language", ""),
                    "expected": row["expected"],
                    "metadata": row["metadata"],
                    "dataset_id": row["id"],
                },
                "metadata": {
                    "dataset_id": row["id"],
                    "category": row["metadata"]["category"],
                    "runtime_path": row["metadata"]["runtime_path"],
                    "coverage_expectation": row["metadata"]["coverage_expectation"],
                },
                "tags": row["tags"],
            }
        )
    return tests
