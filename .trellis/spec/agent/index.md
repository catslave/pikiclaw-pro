# Agent Runtime Spec

## Driver Model

Pikiclaw wraps official agent CLIs and ACP-compatible agents through a driver registry. The key contract is `src/agent/driver.ts`; concrete drivers live in `src/agent/drivers/`.

Driver work should preserve:

- Official upstream CLI behavior where possible.
- Agent-specific capabilities and limitations.
- Auth/environment bridging from user config and profiles.
- Session-scoped MCP injection through the shared bridge.

## Sessions And Streaming

- `src/agent/session.ts` owns session workspace CRUD and classification.
- `src/agent/stream.ts` owns CLI spawn and stream orchestration.
- `src/bot/bot.ts` owns shared runtime state and `runStream()`.
- `src/bot/human-loop.ts` is the shared state machine for Codex user-input and `im_ask_user`.
- For macOS native chat, keep the agent CLI hot path low latency: publish run state/output into the in-memory snapshot as events arrive, persist durably in the background path, and avoid full store reloads for every token or status event.
- Do not block a new native chat lane on synchronous branch refresh or another unrelated active run; the UI may warn about active work, but separate chat lanes should be able to start.

## Capability Design

- Prefer explicit capability modeling over scattered driver-specific conditionals.
- When adding an agent capability, verify whether it belongs in the driver, a shared agent capability layer, the MCP bridge, or dashboard presentation.
- Do not assume every agent supports Codex-native concepts such as plan/goal; expose support only when the driver can actually map it.
- Repair/install flows should stay in the current Agent UI when possible, not redirect users into unrelated workspace chats.

## MCP And Tooling

- `src/agent/mcp/bridge.ts` injects session-scoped MCP tools per stream.
- `src/agent/mcp/extensions.ts` merges global and workspace MCP config and resolves OAuth bearers.
- `src/agent/mcp/tools/*` contains tool definitions and handlers.
- Keep MCP catalog/config concerns separate from per-session bridge runtime.

## Install And Health Checks

When agent install or health fails:

- Check package mapping and CLI detection first.
- Check auth/environment bridging for child processes.
- Check PATH and app-bundled-vs-nvm CLI differences.
- Rerun the specific install/health path after a fix.
- Surface controlled failures immediately in the UI instead of silently falling through to generic chat behavior.
