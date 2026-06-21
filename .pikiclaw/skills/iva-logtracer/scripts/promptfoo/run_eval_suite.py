#!/usr/bin/env python3

from __future__ import annotations

import argparse
import datetime as dt
import importlib.util
import json
import os
import subprocess
import sys
from pathlib import Path


APP_NAME = "iva-logtracer"
PROVIDER_CONFIGS = {
    "openai": {
        "config_relpath": "assets/promptfoo/promptfooconfig.yaml",
        "required_env": "OPENAI_API_KEY",
    },
    "minimax": {
        "config_relpath": "assets/promptfoo/promptfooconfig.minimax.yaml",
        "required_env": "MINIMAX_API_KEY",
        "fallback_env": "OPENAI_API_KEY",
    },
}


def _xdg_dir(env_var: str, fallback_suffix: str) -> Path:
    override = os.getenv(env_var)
    if override:
        return Path(override).expanduser().resolve()
    return (Path.home() / fallback_suffix).resolve()


def _cache_root() -> Path:
    return _xdg_dir("XDG_CACHE_HOME", ".cache") / APP_NAME / "skill-evals"


def _config_root() -> Path:
    return _xdg_dir("XDG_CONFIG_HOME", ".config") / APP_NAME


def _skill_root() -> Path:
    return Path(__file__).resolve().parents[2]


def _timestamp() -> str:
    return dt.datetime.now().strftime("%Y%m%d-%H%M%S")


def _run(cmd: list[str], cwd: Path) -> None:
    subprocess.run(cmd, cwd=cwd, check=True)


def _load_symbol(module_path: Path, symbol_name: str):
    spec = importlib.util.spec_from_file_location(module_path.stem, module_path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"failed to load module: {module_path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    try:
        return getattr(module, symbol_name)
    except AttributeError as exc:
        raise RuntimeError(f"symbol not found: {symbol_name} in {module_path}") from exc


def _smoke_check_prompt_components(skill_root: Path, provider: str) -> None:
    dataset_path = skill_root / "assets/eval-dataset.jsonl"
    dataset_rows = [
        json.loads(line)
        for line in dataset_path.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    if not dataset_rows:
        raise RuntimeError(f"dataset is empty: {dataset_path}")

    create_tests = _load_symbol(skill_root / "scripts/promptfoo/generate_tests.py", "create_tests")
    prompt_builder = "create_prompt.py" if provider == "openai" else "create_prompt_minimax.py"
    create_prompt = _load_symbol(skill_root / f"scripts/promptfoo/{prompt_builder}", "create_prompt")
    scorer_name = "assert_route.py" if provider == "openai" else "assert_route_minimax.py"
    check_route = _load_symbol(skill_root / f"scripts/promptfoo/{scorer_name}", "check_route")

    tests = create_tests({"dataset": "assets/eval-dataset.jsonl"})
    if not tests:
        raise RuntimeError("promptfoo test generator returned no tests")

    first_test = tests[0]
    prompt = create_prompt({"vars": first_test["vars"]})
    if not isinstance(prompt, str) or not prompt.strip():
        raise RuntimeError("prompt builder returned an empty prompt")

    expected = first_test["vars"]["expected"]
    if provider == "openai":
        synthetic_output = json.dumps(
            {
                "skill_should_trigger": expected["skill_should_trigger"],
                "primary_command": expected["primary_command"],
                "follow_up_commands": expected["follow_up_commands"],
                "output_mode": expected["output_mode"],
                "boundary_behavior": expected["boundary_behavior"],
                "required_checks": expected["required_checks"],
                "rationale": "validate-only smoke check",
            }
        )
    else:
        follow_up = ",".join(expected["follow_up_commands"]) if expected["follow_up_commands"] else "none"
        synthetic_output = "\n".join(
            [
                f"skill_should_trigger={str(expected['skill_should_trigger']).lower()}",
                f"primary_command={expected['primary_command']}",
                f"follow_up_commands={follow_up}",
                f"output_mode={expected['output_mode']}",
                f"boundary_behavior={expected['boundary_behavior']}",
            ]
        )
    assertion = check_route(synthetic_output, {"vars": first_test["vars"]})
    if not assertion.get("pass"):
        raise RuntimeError(f"scorer smoke check failed: {assertion.get('reason', 'unknown failure')}")


def _provider_settings(provider: str) -> dict[str, str]:
    try:
        return PROVIDER_CONFIGS[provider]
    except KeyError as exc:
        valid = ", ".join(sorted(PROVIDER_CONFIGS))
        raise RuntimeError(f"unsupported provider: {provider}. valid providers: {valid}") from exc


def _load_env_file(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    if not path.exists():
        return values

    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[7:].strip()
        if "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key:
            values[key] = value
    return values


def _prepare_provider_env(provider: str) -> dict[str, str]:
    settings = _provider_settings(provider)
    env = _load_env_file(_config_root() / "promptfoo.env")
    env.update(os.environ)

    required_env = settings["required_env"]
    fallback_env = settings.get("fallback_env")

    if required_env in env:
        return env

    if fallback_env and fallback_env in env:
        env[required_env] = env[fallback_env]
        return env

    expected = required_env if not fallback_env else f"{required_env} (or fallback {fallback_env})"
    raise RuntimeError(f"{expected} is required to run the {provider} promptfoo suite")


def main() -> int:
    parser = argparse.ArgumentParser(description="Run the iva-logtracer promptfoo eval suite.")
    parser.add_argument("--output-dir", help="Optional explicit output directory.")
    parser.add_argument("--no-cache", action="store_true", help="Pass --no-cache to promptfoo.")
    parser.add_argument(
        "--provider",
        choices=sorted(PROVIDER_CONFIGS),
        default="openai",
        help="Model provider for promptfoo evals. Defaults to openai.",
    )
    parser.add_argument(
        "--validate-only",
        action="store_true",
        help="Run dataset and prompt-component validation only; skip the model eval and scorecard generation.",
    )
    args = parser.parse_args()

    skill_root = _skill_root()
    provider = args.provider
    config_path = skill_root / _provider_settings(provider)["config_relpath"]
    validate_script = skill_root / "scripts/validate_eval_dataset.py"
    scorecard_script = skill_root / "scripts/promptfoo/scorecard.py"

    _run([sys.executable, str(validate_script)], cwd=skill_root)
    _smoke_check_prompt_components(skill_root, provider)

    if args.validate_only:
        print("PASS: local eval scaffolding is valid.")
        return 0

    try:
        promptfoo_env = _prepare_provider_env(provider)
    except RuntimeError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1

    output_dir = (
        Path(args.output_dir).expanduser().resolve()
        if args.output_dir
        else _cache_root() / provider / _timestamp()
    )
    output_dir.mkdir(parents=True, exist_ok=True)

    results_json = output_dir / "results.json"
    results_jsonl = output_dir / "results.jsonl"
    scorecard_md = output_dir / "scorecard.md"

    promptfoo_cmd = [
        "npx",
        "--yes",
        "promptfoo@latest",
        "eval",
        "-c",
        str(config_path),
        "--output",
        str(results_json),
        "--output",
        str(results_jsonl),
    ]
    if args.no_cache:
        promptfoo_cmd.append("--no-cache")

    eval_result = subprocess.run(promptfoo_cmd, cwd=skill_root, check=False, env=promptfoo_env)
    if results_json.exists():
        _run([sys.executable, str(scorecard_script), str(results_json), "--output", str(scorecard_md)], cwd=skill_root)
    elif eval_result.returncode == 0:
        raise RuntimeError(f"promptfoo exited successfully but did not write results: {results_json}")

    print(f"provider={provider}")
    print(f"results_json={results_json}")
    print(f"results_jsonl={results_jsonl}")
    if scorecard_md.exists():
        print(f"scorecard={scorecard_md}")

    return eval_result.returncode


if __name__ == "__main__":
    raise SystemExit(main())
