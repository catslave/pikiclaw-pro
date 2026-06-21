---
label: IVA Log Tracer
name: iva-logtracer
description: Use when tracing an IVA or Nova `sessionId`, `conversationId`, saved trace directory, or IVA/Nova log lookup/statistics request by explicit log fields such as `conversationId`, `sessionId`, `traceId`, `requestId`, or `taskId`; investigating filler-to-agent silence, turn latency, KB or generic tool usage, or a broad symptom that first needs session discovery from a time window before trace analysis. Do not use for non-IVA generic Kibana-only log searches; route those to `kibana`.
category: observability
tags: [iva, nova, logtrace, kibana, logs, trace, conversationId, sessionId, traceId, requestId, taskId, lab, production, 查日志, 日志, 追踪]
---

# IVA Log Tracer

Trace IVA or Nova sessions and inspect IVA/Nova logs with the `iva-logtracer` and `kibana-query` CLIs without skipping routing, artifact verification, or output contract checks. Treat the web app as optional UI, not as a required dependency for the skill workflow.

Install once on a new machine with:

```bash
bash packages/iva-logtracer/install.sh
```

From a local `share-libs` checkout this installs the CLI in editable mode, so the installed command follows the current clone. Use `--release-cli` when you need to validate the packaged install path instead.

Manual fallback:

```bash
uv tool install --force --editable /path/to/share-libs/packages/iva-logtracer
uv tool install git+ssh://git@git.ringcentral.com/iva/iva-share-tool-libs.git#subdirectory=packages/iva-logtracer
npx skills add /path/to/share-libs --skill iva-logtracer -g -y
iva-logtracer init
iva-logtracer doctor
```

## References

- Read `references/routing-matrix.md` first when the request shape is unclear.
- Read `references/commands.md` for supported commands and argument patterns.
- Read `references/report-contract.md` when the user expects a diagnostic report or you need the default output shape.
- Read `references/id-correlation.md` when you need to map IDs across components.
- Read `references/kibana-query-bridge.md` when the task needs **`kibana-query`** but credentials and **`KIBANA_INDEX`** must stay in **`~/.config/iva-logtracer`** (no duplicate `~/.config/kibana-query` config for IVA).
- Read `references/output-files.md` before interpreting saved trace output.
- Read `references/debugging-playbooks.md` when the user is asking for root cause analysis instead of a raw trace.
- Read `references/evaluation-cases.md` when validating trigger boundaries or checking that the workflow still routes correctly.
- Read `references/iva-project-query-scenarios.md` when you need realistic IVA or Nova investigation scenarios to validate whether the skill covers the main runtime paths and boundary cases.
- Read `references/eval-iteration-loop.md` when turning new failures into regression cases or running the skill-improvement loop.
- Reuse `assets/eval-dataset.jsonl` as the canonical evaluation dataset for routing, boundary, and output-contract regressions.
- Read `assets/session-summary-template.md` before delivering a trace summary.

## Workflow

1. Route the request before running anything.
   - Classify the input as `sessionId`, `conversationId`, saved trace directory, explicit log-field lookup, log statistics/classification, turn-level sequencing question, KB audit, generic tool audit, or broad debugging symptom.
   - Use `references/routing-matrix.md` as the source of truth for command selection.
   - When a request names the runtime log component, map production IVAR / IVAR-NG logs to `*:*-logs-air_ivar-*`; outside production, use `*:*-logs-air_assistant_runtime-*` for old IVAR / `assistant-runtime` per `references/id-correlation.md`.
   - Default the environment to `lab` for IVA/Nova log lookup and statistics requests unless the user explicitly names another environment.
   - Default a bare ID to `conversationId` when no field is named. Do not infer `traceId` from the value length, hex shape, UUID shape, or OpenTelemetry-looking format.
   - Treat `traceId`, `trace_id`, `trace-id`, `requestId`, `taskId`, and other non-session log fields as explicit fields only when the user names the field or says the field in natural language.
   - Use `kibana-query` with `--env-file ~/.config/iva-logtracer/.env.{lab|production|stage}` for explicit log-field lookup or statistics/classification. If the selected env file is missing but `~/.config/iva-logtracer/.env` exists, use that common env file together with the explicit `--env` value. Keep IVA/Nova Kibana settings under `~/.config/iva-logtracer` per `references/kibana-query-bridge.md`.
   - Route non-IVA generic Kibana-only requests to `kibana`.
   - Use `iva-logtracer discover` first when the user gives only a broad symptom or time window and does not provide a stable ID or saved trace directory.
   - When a broad-symptom request already frames a KB or tool suspicion, preserve that narrower audit as the planned follow-up after discovery instead of collapsing to the default report path.
   - Use `iva-logtracer trace` for `sessionId` or `conversationId` only. If `iva-logtracer trace` rejects a bare ID as an unknown format, report the field ambiguity and ask for or try an explicit field; do not silently reinterpret the ID as a trace ID by shape.
   - Do not jump straight to `iva-logtracer turn` when the user provides only a stable ID; `turn` starts from an existing saved trace directory.
   - Use `iva-logtracer turn` only for a saved trace directory when chronology or per-turn sequencing is the main question.
   - Use `iva-logtracer audit kb` for KB-usage or KB-backed wrong-answer questions.
   - Use `iva-logtracer audit tools` for generic turn-level tool usage or tool/answer contradiction checks, and let explicit tool-lifecycle or compare-tool-vs-reply intent win over KB wording when both appear.
   - Keep plain KB-adoption questions such as `知识库是不是调到了但答案没采用` on the `audit kb` path unless the user explicitly shifts to tool lifecycle, completion state, or whether a successful tool call was contradicted by the final answer.
   - Default to `iva-logtracer report` after `trace --save-json` unless the user explicitly wants raw logs, one narrow fact, or a specialized audit.
2. Resolve execution scope.
   - Confirm `lab` vs `production` when the target environment is materially ambiguous.
   - Confirm a time window only when the user gave a broad symptom without a stable ID or saved trace directory.
   - Prefer an installed `iva-logtracer` CLI.
   - Treat `iva-logtracer doctor` as fallback-only. Do not run it as a default preflight before `discover` or `trace`.
   - Run `iva-logtracer doctor --components` only when env loading, credentials, cache/output roots, component index availability, or component coverage are themselves in question.
3. Run the trace or analyzer with explicit inputs.
   - Use `iva-logtracer discover` to narrow from time-window symptoms to candidate session IDs, then continue with `trace`.
   - Use `iva-logtracer turn` only after a saved trace directory exists.
   - Add `--save-json` whenever you will run turn analysis, `iva-logtracer audit tools`, `iva-logtracer audit kb`, or `iva-logtracer report`.
   - Add `--reported-symptom` when you produce a diagnostic report from a user complaint.
   - Prefer explicit `--env`, `--last`, `--loaders`, `--save-json`, and `--lang` flags over implied defaults.
4. Verify artifacts before forming conclusions.
   - Confirm the output directory exists and contains the files required by the selected workflow.
   - Inspect `summary.json`, `combine.log`, and the relevant `{component}_message.log` files before concluding anything.
   - Confirm `*_trace.json` exists before running `turn`, `audit tools`, `audit kb`, or `report`.
   - Confirm the saved trace directory exists before running `audit kb`.
   - Treat missing `*_trace.json` as a hard stop for saved-trace reports or audits; do not stay on the normal IVA-trace path when the artifacts are incomplete.
   - If the saved trace directory already includes `*_trace.json`, do not claim missing artifacts for turn analysis.
   - Escalate from the default report to turn analysis only when chronology or event sequencing still matters after reading the saved trace.
5. Deliver the right output contract.
   - For the default path, follow `references/report-contract.md` and treat the diagnostic document as the main deliverable.
   - For manual summaries, reuse `assets/session-summary-template.md` instead of improvising the report shape.
   - State the environment, input artifact, commands run, output directory, key findings, confidence level, and unresolved gaps.
   - Match the response shape to the selected mode: discovery summary, diagnostic report, turn analysis, KB audit, tool audit, or manual summary.

## Constraints

- Do not guess the environment when the wrong target would change the result materially.
- Do not claim cross-component correlation without confirming the IDs in output files.
- Do not skip `discover` when the user only supplied a time window or broad symptom with no stable trace target.
- Do not run `iva-logtracer turn` against a guessed or nonexistent session directory.
- Do not rerun `trace` if the user already supplied a valid saved trace directory unless the existing artifacts are incomplete for the requested workflow.
- Do not insert `iva-logtracer doctor` ahead of a normal `discover` or `trace` path unless the request is specifically about installation, credentials, index availability, or missing component coverage.
- Do not dump raw logs when a concise summary answers the request.
- Do not treat non-IVA generic log search as an `iva-logtracer` task when `kibana` is the better fit.
- Do not assume trace IDs are 32-character hex strings. Trace IDs can vary by source, and a 32-character value can still be a different business identifier.
- Do not classify a bare ID as `traceId` by length or shape. Use `conversationId` by default unless the field is explicit.
- When using `kibana-query` from this workflow, do **not** rely on `~/.config/kibana-query` for IVA lab/prod; use **`--env-file`** pointing at **`~/.config/iva-logtracer`** (see `references/kibana-query-bridge.md`).
- Do not deliver a free-form chat summary when a diagnostic document is expected.
- Do not present inferred root causes as confirmed facts; label them as `confirmed`, `likely`, or `unknown`.

## Validation

- Confirm the command completed successfully.
- Confirm the output directory or files referenced in the response actually exist.
- Confirm any stated error, timeout, retry, or latency issue is backed by trace output.
- Confirm the diagnostic document follows `references/report-contract.md`, including `Action Summary` before the deeper sections when the default report path is used.
- Confirm the selected command path matches one of the cases in `references/routing-matrix.md`.
- Confirm field selection is explicit for `traceId`/`trace_id`, `requestId`, `taskId`, and similar non-session log fields.
- State clearly when the trace is incomplete because inputs, environment, or time range were missing.
