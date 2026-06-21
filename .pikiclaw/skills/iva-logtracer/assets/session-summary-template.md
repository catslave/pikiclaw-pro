# IVA Diagnostic Document

## Request

- User goal:
- Input type: `sessionId` | `conversationId` | saved trace directory
- Input value:
- Environment:
- Time range:
- Output mode: `diagnostic report` | `specialized audit` | `manual summary`

## Commands Run

```bash
# List the exact commands that were executed
```

## Trace Output

- Output directory:
- Files inspected:

## Action Summary

- Customer impact:
- Worst turn:
- Strongest claim:
- Likely owner:
- Attribution confidence:
- Owner note:
- Next action:

## Final Verdict

- One-line verdict:

## Diagnostic Snapshot

- Diagnostic status:
- Session shape:
- Trace completeness:
- User turns observed:
- Tool calls observed:
- Contradiction signals:
- Error anomalies:
- Key facts:
- High-signal observations:

## Session Scorecard

- Verdict:
- User-perceived slow?:
- Primary bottleneck:
- Likely owner:
- Attribution confidence:
- Primary turn:
- Flagged turns:
- Audible slow turns:

## Turn Summary Matrix

- Turn 1:
- Turn 2:
- Turn N:

For each important turn, include:

- User utterance
- Final AI answer
- `User->Filler Audible`
- `User->Agent Audible`
- `Filler End->Agent Audible`
- `STT Lag`
- `Runtime->Filler`
- `Tool`
- `LLM`
- Bottleneck
- Markers

## Expanded Timelines

- Turn 1:
- Turn 2:
- Turn N:

Prefer these labels:

- `user speak end -> filler audible`
- `user speak end -> agent audible`
- `filler audio end -> agent audible`

## Evidence / Blind Spots

- Observed evidence:
- Derived or proxy evidence:
- Blind spots:

## Basic Judgment

- Outcome category:
- Severity:
- Owner:
- Confidence:
- Customer impact:
- Actionable now:
- Reported symptom:
- Assessment:

## AI Diagnosis Report

- Summary:
- Evidence:
- Gaps:
- Recommended next actions:

## Component Coverage

- Trace completeness:
- Present components:
- Missing components:
- Component log counts:

## Nova / Start Conversation

- Nova path: `yes | no | unknown`
- Start-conversation request ID:
- Start-conversation status: `success | failed | not_observed`
- Start-conversation timing:
- Conversation ID:
- Assistant ID:
- gRPC address:

## Session Outcome

- End reason:
- End timestamp:
- Close event:

## Assistant Configuration

- Configuration source: `agent_service | nca | assistant_runtime | unknown`
- Assistant / external assistant ID:
- Solution / group tag:
- Voice / languages:
- Website:
- Tools:
- Enabled skills:
- Feature flags:
- NCA flag evaluations:

## Correlation IDs

- Session / conversation / account:
- Start-conversation request ID:
- SRS / SGS session IDs:
- Speech recognition / generation request IDs:
- Init / greeting completion IDs:

## Key Timeline

- start-conversation requested:
- start-conversation completed:
- turn boundaries:
- last audio / disconnect / end event:

## Speech Linkage

- SRS linked:
- SGS linked:
- SRS disconnect / teardown:
- SGS disconnect / interruption:
- Speech latency summary:

## Findings

- Key timeline:
- First confirmed failure or anomaly:
- Affected components:
- Evidence:
- Confidence: `confirmed | likely | unknown`

## Gaps

- Missing inputs:
- Ambiguities:
- What was not verified:

## Next Actions

- Recommended follow-up:
