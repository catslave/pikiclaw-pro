# Pikiclaw Trellis Workflow

## Core Principles

1. **Product memory before process** - Trellis exists to preserve product taste, architecture boundaries, and decisions across sessions.
2. **Small fixes stay light** - trivial Q&A or one-file fixes can be done directly after reading the relevant specs.
3. **Long work gets a task** - anything that continues across days, spans product surfaces, or changes architecture should get a Trellis task.
4. **Specs are living rules** - when a task reveals a stable principle, update `.trellis/spec/` before calling it done.
5. **Pikiclaw remains conversation-first** - task management supports the chat-centered workspace; it should not replace the product's own Pro/Jira/Todo workflow.

## Quick Commands

```bash
python3 ./.trellis/scripts/get_context.py --mode packages
python3 ./.trellis/scripts/task.py list
python3 ./.trellis/scripts/task.py current --source
python3 ./.trellis/scripts/task.py create "<title>" --slug <slug>
python3 ./.trellis/scripts/task.py start <task-dir-or-name>
python3 ./.trellis/scripts/task.py finish
python3 ./.trellis/scripts/task.py archive <task-dir-or-name>
```

## When To Create A Task

Create a task for:

- Product UX direction that may continue across multiple sessions.
- Dashboard, Pro, Jira, Todo, Files, Agent, Extensions, Skills, MCP, local model, or capability-routing work.
- Any change that spans backend routes, dashboard UI, agent runtime, and tests.
- Research or design conclusions that should become reusable product memory.

Skip a task for:

- Pure explanation or repo lookup.
- Tiny copy/text edits.
- One-off validation commands with no file changes.
- Urgent debug checks where the durable output belongs in Obsidian instead.

## Phase Index

```
Phase 1: Plan    -> capture goal, constraints, likely files, and acceptance criteria
Phase 2: Execute -> implement narrowly and verify against the right surfaces
Phase 3: Finish  -> update spec, record outcome, and leave the next session with a clear trail
```

[workflow-state:no_task]
No active Trellis task. For explanation or very small edits, answer directly after reading the relevant spec. For implementation, cross-surface UX, product direction, or multi-day work, create a task first with `python3 ./.trellis/scripts/task.py create "<title>" --slug <slug>`.
[/workflow-state:no_task]

[workflow-state:planning]
Planning task active. Keep `prd.md` short and concrete: goal, scope, non-goals, user-facing behavior, touched surfaces, verification. Add research notes under `research/` only when they will help future sessions. Then run `task.py start <task>`.
[/workflow-state:planning]

[workflow-state:in_progress]
Implementation task active. Read the task PRD and relevant `.trellis/spec/` files before editing. Keep changes small, preserve user WIP, verify with build/tests/browser checks appropriate to the surface, then update spec when the task teaches a reusable rule.
[/workflow-state:in_progress]

[workflow-state:completed]
Task complete or archived. Prefer a concise summary plus changed files, validation, and any spec updates.
[/workflow-state:completed]

## Phase 1: Plan

#### 1.0 Create task

Use this for long-running product work:

```bash
python3 ./.trellis/scripts/task.py create "<task title>" --slug <slug>
```

The initial `prd.md` should answer:

- What user/product problem are we solving?
- Which surfaces are in scope?
- Which surfaces are explicitly out of scope?
- What must be true before we call it done?

#### 1.1 Research

Research should be written under the task's `research/` directory when it will matter later. Do not leave important comparisons or product decisions only in chat.

#### 1.2 Start task

When the PRD is clear enough:

```bash
python3 ./.trellis/scripts/task.py start <task-dir-or-name>
```

## Phase 2: Execute

#### 2.1 Load context

Read:

- The task `prd.md`.
- `.trellis/spec/product/index.md`.
- Any surface-specific specs relevant to the change.
- Existing repo instructions such as `AGENTS.md` and `CONTRIBUTING.md` when architecture or verification matters.

#### 2.2 Implement

Apply the smallest change that preserves the product direction. Avoid unrelated refactors and avoid touching user WIP that is outside the task.

#### 2.3 Verify

Choose verification by risk:

- Type/build: `npm run build`.
- Unit tests: `npm test` or a focused `npx vitest run test/<file>.unit.test.ts`.
- Dashboard UI: restart/verify local dev service and inspect `http://localhost:3939`.
- Runtime/service work: check the live listener and relevant APIs rather than trusting stale pid files.

## Phase 3: Finish

#### 3.1 Update spec

If the task produced a stable rule, add it to `.trellis/spec/`.

#### 3.2 Record outcome

Keep task notes concise: changed surfaces, validation, known follow-ups, and links to Obsidian outputs when a user-facing analysis was produced.

#### 3.3 Archive when done

Only archive after the work is actually done:

```bash
python3 ./.trellis/scripts/task.py finish
python3 ./.trellis/scripts/task.py archive <task-dir-or-name>
```
