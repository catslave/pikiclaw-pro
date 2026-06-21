# Eval Iteration Loop

Use this reference when the goal is not just to fix one `iva-logtracer` failure, but to improve the skill without regressing older routes or boundary behavior.

## Canonical Dataset

The canonical dataset lives at:

```text
assets/eval-dataset.jsonl
```

Each JSONL row follows a Braintrust-style shape so it can stay tool-agnostic:

- `input`: the user request or task shape
- `expected`: the expected routing and boundary behavior
- `metadata`: category, runtime path, evidence focus, and other filters
- `tags`: flat labels for slicing the dataset

## Local Loop

1. Reproduce or describe the failure.
2. Decide which failure class it belongs to:
   - trigger drift
   - route drift
   - artifact discipline failure
   - boundary over-claim
   - output-contract drift
3. Add or update one dataset row in `assets/eval-dataset.jsonl`.
4. Run the fast local validation gate:

```bash
python3 scripts/promptfoo/run_eval_suite.py --validate-only
```

5. Run the promptfoo suite when you want executable model-based regression checks:

```bash
python3 scripts/promptfoo/run_eval_suite.py --provider openai
python3 scripts/promptfoo/run_eval_suite.py --provider minimax
```

6. Run the stability suite when a single green run is not enough and you want to check for drift or flaky routing:

```bash
python3 scripts/promptfoo/run_stability_suite.py --provider minimax --runs 3 --no-cache
```

6. Make the smallest skill change that should fix the case.
7. Re-run the full dataset manually or with external tooling.
8. If the new case passes but an older case regresses, revert the overfit and fix the routing rule instead of patching prose blindly.

## What To Score

Track these dimensions for every dataset row:

- `trigger_correct`: should the skill activate at all
- `primary_command_correct`: which command family should be chosen first
- `follow_up_correct`: whether later steps such as `report` or `audit kb` are correct
- `artifact_discipline_correct`: whether the skill checked for `summary.json`, `combine.log`, or `*_trace.json` when required
- `boundary_correct`: whether the skill stopped at the IVA trace boundary instead of over-claiming downstream ownership
- `output_contract_correct`: whether the response shape matches the selected mode

## Promotion Rules

Promote a case into the dataset when any of the following is true:

- the skill took the wrong command path
- the skill should not have triggered but did
- the skill skipped a required artifact check
- the skill over-claimed root cause beyond the trace coverage
- the failure came from a real IVA or Nova incident and could happen again

Do not add near-duplicates unless they exercise a distinct runtime path, boundary, or failure mode.

## Dataset Growth Rules

- Keep one row per distinct routing or boundary lesson.
- Prefer production-like language over synthetic toy prompts.
- Keep `expected` strict enough to catch regressions, but avoid overfitting to exact wording.
- Tag cases with runtime shape such as `voice`, `air-on-nova`, `kb`, `tools`, `discover`, or `boundary`.
- When a case comes from a real incident, record the incident shape in metadata without pasting raw logs into the dataset.

## External Tool Mapping

This dataset is intentionally easy to map into common eval tools:

- Promptfoo: map `input.prompt` to vars, `expected` fields to assertions or review rubric inputs
- Braintrust: use the row as-is because it already follows `input` / `expected` / `metadata` / `tags`
- LangSmith or other trace-based platforms: import the row set as a curated regression dataset and attach scorers later

The repo now includes a minimal Promptfoo suite at:

```text
assets/promptfoo/promptfooconfig.yaml
```

An alternate MiniMax OpenAI-compatible config also lives at:

```text
assets/promptfoo/promptfooconfig.minimax.yaml
```

It uses:

- a Python test generator to load `assets/eval-dataset.jsonl`
- a Python prompt builder that emits a narrow final-route contract plus structured request context
- a Python assertion that scores routing and boundary correctness
- a custom MiniMax provider that normalizes the final routing block before scoring
- a local runner that writes timestamped results under the XDG cache directory
- a scorecard summarizer that groups pass rates by category and tag

MiniMax prompt/provider notes:

- the provider expects a final block delimited by `FINAL_ROUTE_START` / `FINAL_ROUTE_END`
- `artifacts_provided` should be passed into prompt vars as a single string, not a list, so Promptfoo does not expand one dataset row into multiple cases
- `stop_on_missing_artifacts` should only be used for saved-trace workflows that lack explicit `trace_json` evidence; stable-ID trace requests should still route through `trace`

## Runner Outputs

The runner writes outputs under:

```text
~/.cache/iva-logtracer/skill-evals/<provider>/<timestamp>/
```

Expected files:

- `results.json`
- `results.jsonl`
- `scorecard.md`

Use `scorecard.md` as the stable human-readable regression snapshot.

The stability runner writes under:

```text
~/.cache/iva-logtracer/stability-evals/<provider>/<timestamp>/
```

Expected files:

- `stability-summary.json`
- `stability-scorecard.md`
- `run-01/`, `run-02/`, ... nested eval outputs

`--validate-only` does not require any model API key and does not write a scorecard. It is meant to catch broken dataset/schema, prompt builder, test generator, or scorer wiring before spending model calls.

Provider auth rules:

- `--provider openai` requires `OPENAI_API_KEY`
- `--provider minimax` prefers `MINIMAX_API_KEY`
- `--provider minimax` also accepts a MiniMax key exposed through `OPENAI_API_KEY` for OpenAI-compatible setups
- The runner also loads `~/.config/iva-logtracer/promptfoo.env` when present, so local provider keys can live outside the repo

Provider role:

- `openai` is the strict gate for structured-output and artifact-discipline regressions
- `minimax` is the reference gate for routing quality and boundary choices; do not treat it as the source of truth for strict `required_checks` naming

## Minimal Release Gate

Treat `iva-logtracer` as safe to ship only if:

- all `should-trigger` rows still choose the expected command family
- all `should-not-trigger` rows stay out of the skill
- all boundary rows still stop at the IVA trace boundary or ask for adjacent evidence
- no row requiring `*_trace.json` silently proceeds without it
