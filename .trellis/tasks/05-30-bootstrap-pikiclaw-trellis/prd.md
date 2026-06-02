# Bootstrap Pikiclaw Trellis Memory

## Goal

Add a local `.trellis/` workspace to `pikiclaw` so future AI sessions can preserve and reload the product principles, architecture boundaries, and recurring workflow decisions that guide daily product optimization.

## Why Now

Pikiclaw is being continuously refined across Dashboard, Pro/Jira, Todo, Agents, Extensions, Skills, MCP, local models, and agent runtime behavior. Many decisions are not one-off code facts; they are product taste and architecture memory. Trellis should make those decisions durable.

## Scope

- Add Trellis scripts and lightweight workflow guidance.
- Add Pikiclaw-specific specs for product identity, architecture, dashboard UX, agent runtime, skills/extensions, Pro workflow, and quality.
- Create this bootstrap task as the first durable task record.
- Keep this setup separate from unrelated existing working-tree changes.

## Non-Goals

- Do not refactor Pikiclaw product code.
- Do not resolve current unrelated WIP.
- Do not turn Trellis into a replacement for Pikiclaw Pro/Jira/Todo task management.
- Do not require every tiny future edit to have a Trellis task.

## Success Criteria

- `python3 ./.trellis/scripts/get_context.py --mode packages` lists Pikiclaw spec layers.
- `python3 ./.trellis/scripts/task.py current --source` can show the active bootstrap task after start.
- Future agents can quickly discover where to write stable product/architecture decisions.
- The specs capture current known principles from `AGENTS.md`, `CONTRIBUTING.md`, and prior Pikiclaw work.

## Initial Spec Map

- `.trellis/spec/product/index.md`
- `.trellis/spec/architecture/index.md`
- `.trellis/spec/dashboard/index.md`
- `.trellis/spec/agent/index.md`
- `.trellis/spec/skills/index.md`
- `.trellis/spec/pro-workflow/index.md`
- `.trellis/spec/quality/index.md`
- `.trellis/spec/guides/index.md`
