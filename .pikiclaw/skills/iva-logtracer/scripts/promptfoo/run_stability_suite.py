#!/usr/bin/env python3

from __future__ import annotations

import argparse
import datetime as dt
import importlib.util
import json
import subprocess
import sys
from collections import Counter, defaultdict
from pathlib import Path


APP_NAME = "iva-logtracer"


def _skill_root() -> Path:
    return Path(__file__).resolve().parents[2]


def _cache_root() -> Path:
    return (Path.home() / ".cache" / APP_NAME / "stability-evals").resolve()


def _timestamp() -> str:
    return dt.datetime.now().strftime("%Y%m%d-%H%M%S")


def _load_symbol(path: Path, symbol_name: str):
    spec = importlib.util.spec_from_file_location(path.stem, path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"unable to import {symbol_name} from {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return getattr(module, symbol_name)


def _percent(numerator: int | float, denominator: int | float) -> str:
    if not denominator:
        return "0.0%"
    return f"{(numerator / denominator) * 100:.1f}%"


def _run_once(run_eval_script: Path, provider: str, run_dir: Path, no_cache: bool) -> tuple[int, Path]:
    cmd = [
        sys.executable,
        str(run_eval_script),
        "--provider",
        provider,
        "--output-dir",
        str(run_dir),
    ]
    if no_cache:
        cmd.append("--no-cache")

    result = subprocess.run(cmd, cwd=_skill_root(), check=False)
    return result.returncode, run_dir / "results.json"


def _build_stability_markdown(provider: str, runs: list[dict]) -> str:
    total_runs = len(runs)
    dataset_runs = sum(len(run["results"]) for run in runs)
    passed_datasets = sum(1 for run in runs for row in run["results"] if row["success"])
    full_pass_runs = sum(1 for run in runs if run["passed"] == run["total"])

    case_rows: dict[str, dict] = {}
    named_score_totals: dict[str, Counter] = defaultdict(Counter)

    for run in runs:
        for row in run["results"]:
            current = case_rows.setdefault(
                row["id"],
                {
                    "id": row["id"],
                    "category": row["category"],
                    "tags": row["tags"],
                    "pass_count": 0,
                    "run_count": 0,
                    "failures": [],
                },
            )
            current["run_count"] += 1
            if row["success"]:
                current["pass_count"] += 1
            else:
                current["failures"].append({"run": run["run_index"], "reason": row["reason"]})
            for name, value in row["named_scores"].items():
                named_score_totals[name]["count"] += 1
                named_score_totals[name]["sum"] += float(value)

    flaky_cases = [
        row for row in case_rows.values() if 0 < row["pass_count"] < row["run_count"]
    ]
    consistently_failing = [
        row for row in case_rows.values() if row["pass_count"] == 0
    ]

    lines: list[str] = []
    lines.append("# IVA Logtracer Stability Scorecard")
    lines.append("")
    lines.append(f"- Provider: `{provider}`")
    lines.append(f"- Runs: {total_runs}")
    lines.append(f"- Dataset cases per run: {runs[0]['total'] if runs else 0}")
    lines.append(f"- Total case evaluations: {dataset_runs}")
    lines.append(f"- Overall pass rate: {_percent(passed_datasets, dataset_runs)}")
    lines.append(f"- Full-pass runs: {full_pass_runs}/{total_runs}")
    lines.append(f"- Flaky cases: {len(flaky_cases)}")
    lines.append(f"- Consistently failing cases: {len(consistently_failing)}")
    lines.append("")

    lines.append("## Run Summary")
    lines.append("")
    lines.append("| Run | Passed | Total | Pass rate | Output dir |")
    lines.append("|---|---:|---:|---:|---|")
    for run in runs:
        lines.append(
            f"| {run['run_index']} | {run['passed']} | {run['total']} | {_percent(run['passed'], run['total'])} | `{run['output_dir']}` |"
        )
    lines.append("")

    lines.append("## Case Stability")
    lines.append("")
    lines.append("| Dataset | Category | Passed | Runs | Stability |")
    lines.append("|---|---|---:|---:|---:|")
    for row in sorted(case_rows.values(), key=lambda item: item["id"]):
        lines.append(
            f"| {row['id']} | {row['category']} | {row['pass_count']} | {row['run_count']} | {_percent(row['pass_count'], row['run_count'])} |"
        )
    lines.append("")

    if named_score_totals:
        lines.append("## Named Score Stability")
        lines.append("")
        lines.append("| Dimension | Average | Samples |")
        lines.append("|---|---:|---:|")
        for name in sorted(named_score_totals):
            counter = named_score_totals[name]
            average = counter["sum"] / counter["count"] if counter["count"] else 0.0
            lines.append(f"| {name} | {average:.3f} | {int(counter['count'])} |")
        lines.append("")

    lines.append("## Flaky Cases")
    lines.append("")
    if not flaky_cases:
        lines.append("- None")
    else:
        for row in sorted(flaky_cases, key=lambda item: item["id"]):
            failure_text = "; ".join(
                f"run {failure['run']}: {failure['reason']}"
                for failure in row["failures"]
            )
            lines.append(f"- `{row['id']}` [{row['category']}] {failure_text}")
    lines.append("")

    lines.append("## Consistently Failing Cases")
    lines.append("")
    if not consistently_failing:
        lines.append("- None")
    else:
        for row in sorted(consistently_failing, key=lambda item: item["id"]):
            failure_text = "; ".join(
                f"run {failure['run']}: {failure['reason']}"
                for failure in row["failures"]
            )
            lines.append(f"- `{row['id']}` [{row['category']}] {failure_text}")
    lines.append("")

    return "\n".join(lines) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser(description="Run repeated iva-logtracer evals and summarize stability.")
    parser.add_argument("--provider", choices=["openai", "minimax"], default="minimax")
    parser.add_argument("--runs", type=int, default=3, help="Number of repeated eval runs. Defaults to 3.")
    parser.add_argument("--no-cache", action="store_true", help="Pass --no-cache through to each eval run.")
    parser.add_argument("--output-dir", help="Optional explicit stability output directory.")
    args = parser.parse_args()

    if args.runs < 1:
        raise SystemExit("error: --runs must be >= 1")

    skill_root = _skill_root()
    run_eval_script = skill_root / "scripts/promptfoo/run_eval_suite.py"
    scorecard_script = skill_root / "scripts/promptfoo/scorecard.py"
    scorecard_module = _load_symbol(scorecard_script, "_load_results")
    load_dataset = _load_symbol(scorecard_script, "_load_dataset")

    output_dir = (
        Path(args.output_dir).expanduser().resolve()
        if args.output_dir
        else _cache_root() / args.provider / _timestamp()
    )
    output_dir.mkdir(parents=True, exist_ok=True)

    dataset_rows = load_dataset(skill_root / "assets/eval-dataset.jsonl")
    runs: list[dict] = []

    for run_index in range(1, args.runs + 1):
        run_dir = output_dir / f"run-{run_index:02d}"
        run_dir.mkdir(parents=True, exist_ok=True)
        print(f"[stability] starting run {run_index}/{args.runs}: {run_dir}")
        return_code, results_json = _run_once(run_eval_script, args.provider, run_dir, args.no_cache)
        if not results_json.exists():
            raise RuntimeError(f"run {run_index} did not produce results.json (exit={return_code})")

        resolved = scorecard_module(results_json, dataset_rows)
        passed = sum(1 for row in resolved if row["success"])
        run_record = {
            "run_index": run_index,
            "return_code": return_code,
            "output_dir": str(run_dir),
            "results_json": str(results_json),
            "passed": passed,
            "total": len(resolved),
            "results": resolved,
        }
        runs.append(run_record)
        print(f"[stability] run {run_index} pass rate: {passed}/{len(resolved)}")

    stability_summary = {
        "provider": args.provider,
        "runs": args.runs,
        "output_dir": str(output_dir),
        "run_summaries": [
            {
                "run_index": run["run_index"],
                "return_code": run["return_code"],
                "output_dir": run["output_dir"],
                "results_json": run["results_json"],
                "passed": run["passed"],
                "total": run["total"],
            }
            for run in runs
        ],
    }

    summary_json = output_dir / "stability-summary.json"
    summary_md = output_dir / "stability-scorecard.md"
    summary_json.write_text(json.dumps(stability_summary, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    summary_md.write_text(_build_stability_markdown(args.provider, runs), encoding="utf-8")

    print(f"stability_summary={summary_json}")
    print(f"stability_scorecard={summary_md}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
