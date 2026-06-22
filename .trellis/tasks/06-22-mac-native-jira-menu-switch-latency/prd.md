# Mac Native Jira Menu Switch Latency

## Goal

Make the Jira menu switch feel as immediate as the Project, Chat, and agent menus. Opening Jira should not block on expensive ticket evidence scans or Jira write-back configuration checks.

## Scope

- macOS native Work Items / Jira surface.
- Keep the approved Jira list/detail workbench behavior.
- Defer or cache derived Jira evidence and write-back readiness work so route changes can paint quickly.

## Non-goals

- No Jira sync behavior changes.
- No redesign of the Jira workbench.
- No new tests during the current rapid UI iteration unless a data-contract issue requires one.

## Acceptance

- Clicking the Jira menu renders the Jira surface without waiting for all output evidence summaries.
- Jira ticket evidence counters/signals can fill from a cache/background pass.
- Jira write-back readiness is not recomputed directly in the SwiftUI body.
- The macOS native build succeeds.
