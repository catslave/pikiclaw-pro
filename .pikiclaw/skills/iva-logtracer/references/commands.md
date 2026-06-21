# Commands

Use the installed `iva-logtracer` CLI only. Do not depend on `CP_TOOLS_HOME`, `apps/iva_logtracer/runners`, or direct `scripts/*.py` paths.

## Installation

Preferred bootstrap from a `share-libs` checkout:

```bash
bash packages/iva-logtracer/install.sh
```

This default local-checkout flow installs the CLI in editable mode so the installed command tracks the current clone.

Use release mode when you need to validate the packaged install instead of local source:

```bash
bash packages/iva-logtracer/install.sh --release-cli
```

Manual install or refresh:

```bash
uv tool install --force --editable /path/to/share-libs/packages/iva-logtracer
uv tool install --force git+ssh://git@git.ringcentral.com/iva/iva-share-tool-libs.git#subdirectory=packages/iva-logtracer
npx skills add /path/to/share-libs --skill iva-logtracer -g -y
```

## Session Discovery

Use `iva-logtracer discover` when the user does not provide a stable `sessionId`, `conversationId`, or saved trace directory and first needs candidate sessions from a time window or search filter.

```bash
iva-logtracer discover \
  --env production \
  --last 4h \
  --field sessionId \
  --value s-abc123

iva-logtracer discover \
  --env production \
  --last 2h \
  --query 'message:"bot not responding"'
```

## Primary Trace Command

Use `iva-logtracer trace` for any request that starts from `sessionId` or `conversationId`.

```bash
iva-logtracer trace s-abc123xyz --env production
iva-logtracer trace s-abc123xyz --env production --last 48h
iva-logtracer trace s-abc123xyz --env production --loaders assistant_runtime nca aig
iva-logtracer trace 123e4567-e89b-12d3-a456-426614174000 --env production
iva-logtracer trace s-abc123xyz --env production --save-json
```

## IVA/Nova Log Lookup and Statistics

Use `kibana-query` with the IVA logtracer env file when the request asks for IVA/Nova log lookup or statistics by an explicit log field. Default the environment to `lab` unless the user names another environment. Do not decide that a value is a trace ID from length or shape alone.

```bash
kibana-query search \
  'trace_id:"4a0031017ceb19eab6d3a39468a20000"' \
  --env-file ~/.config/iva-logtracer/.env.lab \
  --last 24h \
  --format json

kibana-query search \
  'conversationId:"123e4567-e89b-12d3-a456-426614174000" AND level:ERROR' \
  --env-file ~/.config/iva-logtracer/.env.lab \
  --last 24h \
  --size 200 \
  --format table

kibana-query agg \
  --preset top_terms \
  --field kubernetes.container.name \
  --query 'conversationId:"123e4567-e89b-12d3-a456-426614174000"' \
  --env-file ~/.config/iva-logtracer/.env.lab \
  --last 24h \
  --limit 20 \
  --format json
```

## Doctor

Use `iva-logtracer doctor` only as a fallback diagnostic command. It is not a default preflight step for normal `discover`, `trace`, `report`, or audit workflows.

Reach for it when you need to answer questions like:

- is the environment file loading correctly
- are Kibana credentials or connectivity broken
- does this environment have queryable indices for `assistant_runtime`, `nca`, `aig`, `gmg`, or CPRC
- is a missing component in the trace likely an environment/index problem rather than just a trace-level gap

```bash
iva-logtracer doctor --env production
iva-logtracer doctor --env production --components --format json
```

## Turn Analysis

Use `iva-logtracer turn` only after `iva-logtracer trace --save-json` has created a saved session output directory with `*_trace.json` files.

```bash
iva-logtracer trace s-xxx --env production --save-json
iva-logtracer turn ~/.cache/iva-logtracer/output/iva_session/20260411_s-xxx-yyy/
iva-logtracer turn ~/.cache/iva-logtracer/output/iva_session/20260411_s-xxx-yyy/ --html
iva-logtracer turn ~/.cache/iva-logtracer/output/iva_session/20260411_s-xxx-yyy/ --format markdown
```

## KB Audit

Use `iva-logtracer audit kb` when you need a deterministic answer to "did AIR call KB, what did KB return, and did the final answer contradict it?"

```bash
iva-logtracer audit kb \
  ~/.cache/iva-logtracer/output/iva_session/20260323_s-xxx-yyy/
```

## Generic Tool Audit

Use `iva-logtracer audit tools` when you need a turn-level summary of generic server/client tool calls across one or more saved trace directories, including heuristic contradiction checks between tool results and the final answer. The trace directories must include `*_trace.json`, so run `iva-logtracer trace --save-json` first.

```bash
iva-logtracer trace s-xxx --env production --save-json
iva-logtracer audit tools \
  ~/.cache/iva-logtracer/output/iva_session/20260323_s-xxx-yyy/

iva-logtracer audit tools \
  ~/.cache/iva-logtracer/output/iva_session/20260323_s-xxx-yyy/ \
  ~/.cache/iva-logtracer/output/iva_session/20260323_s-yyy-zzz/ \
  --format json
```

## Diagnostic Report

Use `iva-logtracer report` as the default output path for trace investigations. The report now starts with an `Action Summary`, then a `Final Verdict`, `Session Scorecard`, `Turn Summary Matrix`, and `Expanded Timelines` before the deeper evidence sections. Read `references/report-contract.md` for the expected section meanings and attribution rules. The trace directories must include `*_trace.json`, so run `iva-logtracer trace --save-json` first.

```bash
iva-logtracer trace s-xxx --env production --save-json
iva-logtracer report \
  ~/.cache/iva-logtracer/output/iva_session/20260323_s-xxx-yyy/

iva-logtracer report \
  ~/.cache/iva-logtracer/output/iva_session/20260323_s-xxx-yyy/ \
  --reported-symptom "AIR answered wrong" \
  --lang zh \
  --format json \
  --output /tmp/iva-diagnostic.json
```

## Command Selection

- Start with `iva-logtracer discover` when the user gives only a broad symptom, time window, or weak search clue and you need candidate sessions before tracing.
- Start with `iva-logtracer trace` for session correlation, component coverage, and initial debugging.
- Start with `kibana-query search` or `kibana-query agg` for explicit IVA/Nova log lookup or statistics by fields such as `trace_id`, `requestId`, or `taskId`.
- Run `iva-logtracer init` once on a new machine to create config and cache roots.
- Run `iva-logtracer doctor` only when installation, env loading, credentials, component index availability, or output paths are unclear.
- Do not run `iva-logtracer doctor` as a routine preflight before `discover` or `trace`.
- Add `--last` when the user gives a time window or the default range risks missing the event.
- Add `--loaders` when the user only cares about specific components such as `aig`, `gmg`, or `cprc_srs`.
- Add `--save-json` when the trace output may need turn analysis, tool auditing, or deeper offline review.
- Use `iva-logtracer report` by default when the expected output is a standard investigation document.
- Add `--reported-symptom` when the user gave a complaint such as "AIR answered wrong" so the report can explicitly map symptom to evidence.
- Add `--lang zh|en` when you want the markdown report localized for humans. Keep `json` output for stable machine-readable fields.
- The diagnostic document should include final verdict, diagnostic snapshot, basic judgment, AI diagnosis report, component coverage, Nova/start-conversation, assistant configuration, correlation IDs, speech linkage, turn diagnostics, and recommended next actions whenever the logs contain those signals.
- Use `iva-logtracer turn` only when the user asks for turn-level analysis or timeline output, and only after `--save-json`.
- Use `iva-logtracer audit tools` when the user wants a normalized view of tool usage across client/server tools or across multiple sampled traces.
- Use `iva-logtracer audit kb` when the bug report is specifically about KB usage or KB-backed wrong answers.
- Keep a bare ID on the default `conversationId` path unless the user explicitly names another field. Never infer `trace_id` from 32-character hex shape.

## Common Command Patterns

### Trace a problematic session

```bash
iva-logtracer trace s-problematic-session --env production
```

### Discover candidates before tracing

```bash
iva-logtracer discover \
  --env production \
  --last 2h \
  --query 'message:"IVA not responding"'
```

### Check likely errors in trace output

```bash
grep -i "error\\|exception\\|timeout" ~/.cache/iva-logtracer/output/iva_session/*/combine.log
grep -i "timeout\\|failed" ~/.cache/iva-logtracer/output/iva_session/*/nca_message.log
```

### Focus on LLM-related services

```bash
iva-logtracer trace s-xxx --env production --loaders aig gmg
grep -i "error\\|timeout" ~/.cache/iva-logtracer/output/iva_session/*/gmg_message.log
```

### Focus on speech services

```bash
iva-logtracer trace s-xxx --env production --loaders assistant_runtime cprc_srs cprc_sgs
grep -i "error\\|confidence" ~/.cache/iva-logtracer/output/iva_session/*/cprc_srs_message.log
```

## Prerequisites

Run `iva-logtracer init` first on a new machine. By default, the CLI expects credentials in:

- `~/.config/iva-logtracer/.env`
- `~/.config/iva-logtracer/.env.{env}`

Override with `IVA_LOGTRACER_ENV_FILE` when needed.

- `KIBANA_URL`
- `KIBANA_USERNAME`
- `KIBANA_PASSWORD`

Supported environments:

- `.env.lab`
- `.env.production`
