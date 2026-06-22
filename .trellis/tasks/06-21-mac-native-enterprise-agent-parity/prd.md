# Mac Native Enterprise Agent Parity

## Goal

Move Pikiclaw Pro's macOS native client toward an enterprise agent workbench comparable to Codex, Claude Code, and Gemini Enterprise. The native app should make agent fleet readiness, governed generated UI, handoffs, evidence, and next actions visible and actionable without forcing the user back into plain text replies.

## Scope

- macOS native surfaces under `apps/macos`.
- Enterprise alignment views that compare Codex, Claude, and Gemini-style capabilities.
- Generated UI flows for continuation, confirmation, choice, small forms, evidence cards, and mission attention.
- Agent handoff, audit, and evidence surfaces that preserve provenance and next-action clarity.
- Focused tests for every behavioral increment, plus broader macOS validation when practical.

## Non-Goals

- Do not redesign the dashboard/web app as part of this task.
- Do not rewrite agent drivers or CLI semantics unless a parity requirement needs a narrow contract change.
- Do not mix unrelated Jira, voice, startup-performance, or layout WIP into this task.
- Do not treat decorative UI polish as parity unless it improves a concrete enterprise workflow.

## User-Facing Behavior

- Agent output can become generated UI: buttons, choices, forms, confirmations, cards, and mission-level next-action rows.
- Required generated-form inputs are visibly gated before submission.
- Mission Control should show why generated UI or handoff work needs attention, where it came from, and what action continues it.
- Enterprise alignment should keep Codex, Claude, and Gemini responsibilities distinct while showing gaps and the next governed action.

## Verification

- Run focused macOS tests for the touched behavior.
- Run `swift test --package-path apps/macos` when the change touches shared native model or generated UI paths.
- Run `swift build --package-path apps/macos --product PikiclawMac` after user-facing native changes.
- Run `git diff --check` before handing back.
- Record verified batches in the Obsidian goal note under `/Users/michael.yang/Documents/Obsidian Vault/repo/Personal/pikiclaw/`.
