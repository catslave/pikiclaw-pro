# Pro And Task Workflow Spec

## Product Role

Pro/Jira/Todo surfaces exist to manage work context and status. They should feed the agent conversation, not replace it.

## Jira And Task Flow

Current important seams:

- `dashboard/src/pages/jira/JiraTab.tsx` starts Analyze/Clarify-style actions.
- `src/dashboard/routes/pro.ts` owns Pro task routes and workbench entry points.
- `src/pro/tasks.ts` owns task stage runs and local task storage.
- `dashboard/src/pages/sessions/SessionWorkspace.tsx` is the likely seam for task-focused workspace routing.

The Clarify/refinement path is:

```text
JiraTab Analyze button
-> startStatusChat(...) / startStage(...)
-> api.startProTaskStage(...)
-> POST /api/pro/tasks/:taskId/stage-runs
-> queueDashboardSessionTask(...)
-> addStageRun(...) in src/pro/tasks.ts
```

## Task Experience Principles

- A task card should stay clean: status, goal, latest progress, outputs, and next action.
- The primary working area should remain chat-oriented.
- Stage outputs should be easy to review as rendered markdown or files.
- Remote-change notes should be append-only when syncing external sources like Jira.
- The user may create non-Jira sources later; avoid naming/product choices that lock Dashboard to Jira only.

## Todo

- Todo is capture-oriented and should be lightweight.
- Quick add matters more than a heavy list-first workflow.
- Attachments/images should be supported when the task naturally includes visual context.

## Verification

For Pro/Jira task work, verify:

- Local storage shape under `~/.pikiclaw/pro/tasks.json` when relevant.
- API route behavior.
- UI entry point from the Dashboard.
- Stage run status and output rendering.
