# Architecture Spec

## Layering

Respect the downward dependency direction documented in `AGENTS.md` and `CONTRIBUTING.md`:

```text
cli/ -> dashboard/ -> channels/* -> bot/ -> agent/ -> catalog/, core/
```

Interpretation:

- `core/` contains infrastructure and zero business logic.
- `catalog/` contains data-only extension/catalog manifests.
- `agent/` owns driver registry, sessions, streaming, skills, MCP, CLI detection, auth, and agent-facing capabilities.
- `bot/` owns channel-agnostic orchestration, human-loop behavior, and shared run state.
- `channels/*/` are physically isolated IM transports.
- `dashboard/` owns Hono routes, runtime wiring, and React dashboard APIs.
- `cli/` is the entry surface.

## Boundary Rules

- Do not make channels know about each other.
- Do not put dashboard-only state into low-level agent driver contracts unless it is actually a runtime capability.
- Do not put product workflow policy into generic `core/` helpers.
- Keep catalog files declarative; behavior belongs in runtime modules or dashboard routes.
- When adding a new driver, start from `src/agent/driver.ts` and a nearby driver in `src/agent/drivers/`.
- When adding MCP behavior, distinguish session-scoped MCP bridge logic from catalog/extension CRUD.

## Local Runtime State

- Persistent user config is under `~/.pikiclaw/setting.json`.
- Dev logs are under `~/.pikiclaw/dev/dev.log`.
- Synced Pro/Jira tasks are under `~/.pikiclaw/pro/tasks.json`.
- Project skills live under `.pikiclaw/skills/<name>/SKILL.md`.
- Runtime investigation should check live files and APIs, not stale process assumptions.

## Service Verification

For local dashboard/service questions, verify the actual listener and APIs:

```bash
lsof -nP -iTCP:3939 -sTCP:LISTEN
```

Useful local endpoints:

- `http://localhost:3939/api/state`
- `http://localhost:3939/api/agents`
- `http://localhost:3939/api/sessions`

If `curl` is not available, use Node `fetch`.

## WIP And Repo Safety

- Expect this repo to have local WIP.
- Never revert unrelated user changes.
- Before editing, confirm the target repo is `pikiclaw`; similar dashboard code exists elsewhere.
- Keep edits scoped to the requested surface.
- Do not "clean up" production/self-bootstrap processes when the task concerns dev mode only.
