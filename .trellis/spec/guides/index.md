# Thinking Guides

Use these guides when a change spans more than one local surface or repeats a pattern.

| Guide | Purpose |
|---|---|
| [Code Reuse Thinking Guide](./code-reuse-thinking-guide.md) | Search before creating new helpers, components, drivers, or constants. |
| [Cross-Layer Thinking Guide](./cross-layer-thinking-guide.md) | Map data flow before changing API, backend state, dashboard UI, or agent runtime contracts. |

## Pikiclaw Triggers

Read the cross-layer guide when work touches three or more of:

- Dashboard React UI.
- Dashboard Hono route.
- Agent/session runtime.
- MCP bridge/tool definitions.
- Local config or task storage.
- Tests.

Read the reuse guide when adding:

- A new dashboard component.
- A new capability flag or router.
- A new agent driver helper.
- A new catalog item shape.
- A new local workflow command.
