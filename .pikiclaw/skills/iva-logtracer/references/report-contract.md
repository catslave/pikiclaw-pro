# Diagnostic Report Contract

Use this reference when the default deliverable is `iva-logtracer report`.

## Default Deliverable

Unless the user explicitly asks for raw logs, a single narrow fact, or a specialized audit, the default output is the diagnostic report.

Use it to answer:

- what happened in this session
- whether the user likely felt delay or silence
- which turn is worst
- which layer is the strongest candidate owner
- what should be investigated next

## Top-Level Reading Order

Treat the report as a staged handoff, not a log dump.

Read in this order:

1. `Action Summary`
2. `Final Verdict`
3. `Session Scorecard`
4. `Turn Summary Matrix`
5. `Expanded Timelines`
6. deep sections only if the earlier sections leave ambiguity

## Section Contract

### Action Summary

This is the first-screen decision panel.

It should answer:

- `Customer impact`
- `Worst turn`
- `Strongest claim`
- `Likely owner`
- `Attribution confidence`
- `Owner note`
- `Next action`

Use this section to distinguish:

- real user-facing silence after filler
- long internal spans that were covered by filler playback

### Final Verdict

Use a one-line overall diagnosis.

Keep it cautious when coverage is incomplete. Do not over-claim root cause here.

### Session Scorecard

This is the compact session-level summary.

Key fields:

- `Verdict`
  - `audible_delay_detected`
  - `long_but_covered`
  - `healthy`
  - or a stable fallback outcome category
- `User-perceived slow?`
- `Primary bottleneck`
- `Likely owner`
- `Attribution confidence`

Use `Likely owner`, not a hard owner assignment, when the trace is incomplete or the owner path lacks direct component coverage.

### Turn Summary Matrix

Use this as the scan surface for per-turn anomalies.

Prioritize these columns:

- `User->Filler Audible`
- `User->Agent Audible`
- `Filler End->Agent Audible`
- `STT Lag`
- `Runtime->Filler`
- `Tool`
- `LLM`
- `Bottleneck`
- `Markers`

Interpretation rule:

- `Filler End->Agent Audible` is the closest proxy for user-heard silence after filler ends.
- A long `Tool` or `LLM` span is not enough to call user impact unless that gap stays large after filler playback.

### Expanded Timelines

Expand only flagged turns.

Use this section to explain the strongest claim from `Action Summary`.

Preferred labels:

- `user speak end -> filler audible`
- `user speak end -> agent audible`
- `filler audio end -> agent audible`

### Evidence / Blind Spots

Use this section to make evidence quality explicit.

Keep the evidence vocabulary stable:

- `observed`
- `derived`
- `derived/proxy`
- `blind`

If an important owner path is missing coverage, state it here and lower attribution confidence upstream.

## Attribution Rules

Use these heuristics consistently:

- `Likely owner` is the best current candidate, not a proof of fault.
- `Attribution confidence` should drop when direct coverage for the owner path is missing.
- Missing `gmg` and `aig` coverage should prevent high-confidence `GMG/LLM` attribution.
- Direct top-tool timing can justify high-confidence `Tooling` attribution even when other components are missing.

## Manual Summary Expectations

If you are not pasting the full report, still preserve the contract:

1. Start with the `Action Summary` fields in prose or bullets.
2. Include the strongest turn and the key latency numbers.
3. State missing coverage explicitly when it affects the diagnosis.
4. End with the concrete next action.
