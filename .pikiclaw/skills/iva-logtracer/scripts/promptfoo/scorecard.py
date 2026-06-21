#!/usr/bin/env python3

from __future__ import annotations

import argparse
import json
from collections import Counter, defaultdict
from pathlib import Path


def _skill_root() -> Path:
    return Path(__file__).resolve().parents[2]


def _load_dataset(dataset_path: Path) -> list[dict]:
    rows: list[dict] = []
    for raw_line in dataset_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line:
            continue
        rows.append(json.loads(line))
    return rows


def _read_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def _load_results(json_path: Path, dataset_rows: list[dict]) -> list[dict]:
    payload = _read_json(json_path)
    results = payload.get("results", {})
    result_rows = results.get("results")

    if isinstance(result_rows, list):
        resolved: list[dict] = []
        for idx, dataset_row in enumerate(dataset_rows):
            row = result_rows[idx] if idx < len(result_rows) else {}
            metadata = dataset_row.get("metadata", {})
            tags = dataset_row.get("tags", [])
            grading = row.get("gradingResult") or {}
            test_case = row.get("testCase") or {}

            success = row.get("success")
            if success is None:
                success = grading.get("pass")
            if success is None:
                success = False

            score = row.get("score")
            if score is None:
                score = grading.get("score")
            if score is None:
                score = 1.0 if success else 0.0

            named_scores = row.get("namedScores") or grading.get("namedScores") or {}
            reason = (
                grading.get("reason")
                or row.get("error")
                or row.get("failureReason")
                or "no failure reason provided"
            )
            test_description = test_case.get("description") or dataset_row.get("id")

            resolved.append(
                {
                    "id": dataset_row["id"],
                    "description": test_description,
                    "category": metadata.get("category", "unknown"),
                    "tags": tags,
                    "success": bool(success),
                    "score": float(score),
                    "named_scores": named_scores,
                    "reason": reason,
                }
            )
        return resolved

    outputs = results.get("outputs", [])
    tests = results.get("tests", [])

    resolved: list[dict] = []
    for idx, row in enumerate(dataset_rows):
        output_item = outputs[idx] if idx < len(outputs) else {}
        test_item = tests[idx] if idx < len(tests) else {}
        metadata = row.get("metadata", {})
        tags = row.get("tags", [])

        success = output_item.get("pass")
        if success is None:
            success = output_item.get("success")
        if success is None:
            success = False

        score = output_item.get("score")
        if score is None:
            score = 1.0 if success else 0.0

        named_scores = output_item.get("namedScores") or output_item.get("named_scores") or {}
        reason = output_item.get("reason") or output_item.get("error") or ""
        test_description = test_item.get("description") or row.get("id")

        resolved.append(
            {
                "id": row["id"],
                "description": test_description,
                "category": metadata.get("category", "unknown"),
                "tags": tags,
                "success": bool(success),
                "score": float(score),
                "named_scores": named_scores,
                "reason": reason,
            }
        )
    return resolved


def _percent(numerator: int, denominator: int) -> str:
    if denominator == 0:
        return "0.0%"
    return f"{(numerator / denominator) * 100:.1f}%"


def build_scorecard(results: list[dict]) -> str:
    total = len(results)
    passed = sum(1 for row in results if row["success"])
    failed_rows = [row for row in results if not row["success"]]

    by_category: dict[str, list[dict]] = defaultdict(list)
    by_tag: dict[str, list[dict]] = defaultdict(list)
    named_score_totals: dict[str, Counter] = defaultdict(Counter)

    for row in results:
        by_category[row["category"]].append(row)
        for tag in row["tags"]:
            by_tag[tag].append(row)
        for name, value in row["named_scores"].items():
            named_score_totals[name]["count"] += 1
            named_score_totals[name]["sum"] += float(value)

    lines: list[str] = []
    lines.append("# IVA Logtracer Eval Scorecard")
    lines.append("")
    lines.append(f"- Total cases: {total}")
    lines.append(f"- Passed: {passed}")
    lines.append(f"- Failed: {total - passed}")
    lines.append(f"- Pass rate: {_percent(passed, total)}")
    lines.append("")

    lines.append("## By Category")
    lines.append("")
    lines.append("| Category | Passed | Total | Pass rate |")
    lines.append("|---|---:|---:|---:|")
    for category in sorted(by_category):
        rows = by_category[category]
        ok = sum(1 for row in rows if row["success"])
        lines.append(f"| {category} | {ok} | {len(rows)} | {_percent(ok, len(rows))} |")
    lines.append("")

    lines.append("## By Tag")
    lines.append("")
    lines.append("| Tag | Passed | Total | Pass rate |")
    lines.append("|---|---:|---:|---:|")
    for tag in sorted(by_tag):
        rows = by_tag[tag]
        ok = sum(1 for row in rows if row["success"])
        lines.append(f"| {tag} | {ok} | {len(rows)} | {_percent(ok, len(rows))} |")
    lines.append("")

    if named_score_totals:
        lines.append("## Named Scores")
        lines.append("")
        lines.append("| Dimension | Average | Samples |")
        lines.append("|---|---:|---:|")
        for name in sorted(named_score_totals):
            counter = named_score_totals[name]
            average = counter["sum"] / counter["count"] if counter["count"] else 0.0
            lines.append(f"| {name} | {average:.3f} | {int(counter['count'])} |")
        lines.append("")

    lines.append("## Failures")
    lines.append("")
    if not failed_rows:
        lines.append("- None")
    else:
        for row in failed_rows:
            reason = row["reason"] or "no failure reason provided"
            lines.append(f"- `{row['id']}` [{row['category']}] {reason}")
    lines.append("")

    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser(description="Summarize promptfoo results for iva-logtracer evals.")
    parser.add_argument("results_json", help="Path to promptfoo JSON results.")
    parser.add_argument(
        "--dataset",
        default="assets/eval-dataset.jsonl",
        help="Path to the canonical dataset relative to the skill root or absolute.",
    )
    parser.add_argument("--output", "-o", help="Optional markdown output path.")
    args = parser.parse_args()

    skill_root = _skill_root()
    dataset_path = Path(args.dataset)
    if not dataset_path.is_absolute():
        dataset_path = (skill_root / dataset_path).resolve()

    results_path = Path(args.results_json).expanduser().resolve()
    dataset_rows = _load_dataset(dataset_path)
    resolved = _load_results(results_path, dataset_rows)
    scorecard = build_scorecard(resolved)

    if args.output:
        output_path = Path(args.output).expanduser().resolve()
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(scorecard + "\n", encoding="utf-8")
    else:
        print(scorecard)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
