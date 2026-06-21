# Routing Matrix

Use this reference before running any command when the request shape is not obvious.

## Command Selection

| Request shape | Primary command | Required input | Required artifacts before next step | Default deliverable | Notes |
|---|---|---|---|---|---|
| Broad symptom with only a time window, tenant hint, or complaint | `iva-logtracer discover` | `--env` plus `--last` or `--start/--end`, and either `--query` or `--field/--value` | Discovery output with candidate session or conversation IDs | Discovery summary plus next trace target | Use this first when the user does not provide a stable ID or saved trace directory. If the request already signals KB or tool suspicion, preserve that as the planned follow-up instead of defaulting to a generic report. |
| Stable `sessionId` or `conversationId` | `iva-logtracer trace` | ID plus `--env` | Saved trace directory with `summary.json` and `combine.log`; add `--save-json` if report, turn, or audit follows | Trace summary or follow-up report/audit | Use `--loaders` only when the user wants a narrow component slice. Do not jump straight to `turn`; a stable ID still starts with `trace`. |
| IVA/Nova log lookup by explicit non-session field, such as `traceId`, `trace_id`, `requestId`, or `taskId` | `kibana-query search` with `--env-file ~/.config/iva-logtracer/.env.{env}` | Explicit field name, value, environment defaulting to `lab`, and `--last` | Search output | Log lookup summary | Do not infer the field from ID shape. A 32-character hex-looking value is not automatically a trace ID. |
| IVA/Nova log statistics or classification by explicit filter | `kibana-query agg` with `--env-file ~/.config/iva-logtracer/.env.{env}` | Query/filter, grouping field, environment defaulting to `lab`, and `--last` | Aggregation output | Bucket/category summary plus notable clusters | Use this when the user asks to count, classify, group, or summarize log categories for an environment. |
| Saved trace directory, default investigation | `iva-logtracer report` | Trace directory with `*_trace.json` | `summary.json`, `combine.log`, and `*_trace.json` confirmed | Diagnostic report | This is the default after `trace --save-json`. |
| Saved trace directory, chronology or turn sequencing question | `iva-logtracer turn` | Trace directory with `*_trace.json` | `*_trace.json` confirmed | Turn analysis | Use only when the user asks for per-turn timing, timeline, or sequencing details. If `*_trace.json` is already present, stay on the normal saved-trace path instead of reporting missing artifacts. |
| Saved trace directory, KB usage or KB-backed wrong answer | `iva-logtracer audit kb` | Trace directory | Trace directory exists and contains enough saved trace output for the audit | KB audit summary | Use when the question is "did KB get called, what came back, and did the answer contradict it?" and there is no stronger tool-lifecycle comparison signal. Phrases like `知识库是不是调到了` still belong here unless the request explicitly shifts to tool lifecycle, completion, or successful-return state. |
| One or more saved trace directories, generic tool lifecycle or contradiction question | `iva-logtracer audit tools` | One or more trace directories with `*_trace.json` | `*_trace.json` confirmed for each trace dir | Tool audit summary | Use when comparing tool calls, missing completions, or result/answer contradictions. Explicit tool-call or compare-tool-vs-reply intent wins over KB wording, but plain KB-adoption questions stay in `audit kb`. |
| Generic Kibana search with no trace workflow | Route to `kibana` | Kibana query intent | None | Kibana result | Do not force `iva-logtracer` into generic log search. |

## Follow-Up Rules

- Bare IDs without a named field default to `conversationId` in `lab`. If this path fails with an unknown ID format, report the ambiguity and ask for or try an explicit field such as `traceId=...`; do not reclassify the ID by length or hex shape.
- `discover -> trace -> report` for the default symptom-first path with no narrower audit intent.
- `discover -> trace -> audit kb` when the broad symptom already frames a KB contradiction or ignored retrieval result.
- `discover -> trace -> audit tools` when the broad symptom already frames a tool lifecycle or tool/reply contradiction.
- Keep `doctor --components` out of the default follow-up chain. Use it only as a fallback diagnostic when env setup, credentials, index availability, or component coverage are in doubt.
- `trace --save-json -> turn` only when per-turn sequencing still matters.
- `trace --save-json -> audit kb` for KB-specific questions without a stronger tool-lifecycle signal.
- `trace --save-json -> audit tools` for generic tool lifecycle or contradiction checks, including KB-backed tools when the question is about invocation, completion, or successful-return state.
- `trace --save-json -> report` stays `report` only; do not silently add `turn` unless the user explicitly asks for timeline or per-turn sequencing.

## Stop Conditions

- Stop and ask for environment only when `lab` vs `production` changes the result materially.
- Stop and ask for a narrower time window only when discovery would otherwise be too broad to be reliable.
- Stop and ask for the field name when the user supplies an ID-like value that is not accepted as `sessionId` or `conversationId` and the request does not explicitly name `traceId`, `trace_id`, `requestId`, `taskId`, or another log field.
- Stop and report incomplete evidence when the trace directory exists but lacks `*_trace.json` for a requested report, turn analysis, KB audit, or tool audit.
- For saved-trace workflows, missing `*_trace.json` overrides the normal IVA-trace boundary and forces `stop_on_missing_artifacts`.
- Stop and consider `doctor --components` only when the problem is plausibly environment-level rather than trace-level, for example missing credentials, suspiciously empty component coverage, or unknown index availability.
