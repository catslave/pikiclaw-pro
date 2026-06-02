# Cross-Layer Thinking Guide

## Map The Flow

For cross-surface work, write the actual flow before coding:

```text
User action -> Dashboard component -> API route -> runtime/storage -> response/event -> UI render
```

For agent work:

```text
User/session config -> driver capability -> stream spawn -> MCP bridge/tools -> event blocks -> dashboard render
```

## Boundary Questions

- Which layer owns the source of truth?
- Is this product state, runtime state, local config, or UI-only state?
- Does the dashboard need a new API contract or only a rendering change?
- Does this belong in a driver, shared agent runtime, MCP bridge, or dashboard?
- What should happen for agents that do not support this capability?

## Verification Questions

- Can stale local state make the UI look right while runtime is wrong?
- Does the feature survive refresh/reopen?
- Does the API return the same shape that the frontend expects?
- Do tests cover both support and unsupported cases?
- Did we verify the running dashboard when the change is visual?
