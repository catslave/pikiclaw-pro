# Code Reuse Thinking Guide

## Search First

Before adding a new helper, route, component, capability type, or config field, search for similar names and behavior.

Useful searches:

```bash
rg "similarName|similarConcept" src dashboard test
rg "Capability|capability|driver|route|stage" src dashboard test
```

## Reuse Heuristics

Reuse or extend when:

- A nearby component already owns the same state.
- The behavior is another agent-driver variant of an existing contract.
- A route shape already exists under `src/dashboard/routes/`.
- The dashboard already has a generic primitive or modal.

Avoid abstraction when:

- The behavior is still exploratory.
- The shared helper would hide product meaning.
- The duplication is only a one-off visual detail.

## Pikiclaw-Specific Reminders

- `SessionWorkspace.tsx` already owns many workspace layout concerns.
- `src/dashboard/routes/extensions.ts` is the source of truth for extension/skill catalog behavior.
- `src/agent/driver.ts` and existing drivers should guide new driver behavior.
- `src/agent/mcp/bridge.ts` is the per-stream MCP injection surface; avoid duplicating that logic in drivers.
