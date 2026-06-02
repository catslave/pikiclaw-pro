# Quality Spec

## Minimal Change Principle

- Prefer narrow, low-risk changes.
- Avoid unrelated refactors and formatting churn.
- Preserve existing local WIP, even when it is in files near the target.
- If similar repos exist, verify that the target is actually `pikiclaw` before editing.

## Verification Matrix

Choose verification by touched surface:

| Surface | Verification |
|---|---|
| TypeScript/runtime | `npm run build` |
| Unit logic | `npm test` or focused `npx vitest run test/<file>.unit.test.ts` |
| Dashboard visual/interaction | running dashboard at `http://localhost:3939` |
| Local service state | listener + API checks, not pid file only |
| Agent install/health | rerun the exact install/health endpoint or flow |
| Jira/Pro sync | verify local task state and dashboard rendering |

## Local Dev Service

`npm run dev` starts dev mode and logs to `~/.pikiclaw/dev/dev.log`. It may auto-detach when invoked without a TTY. If validation interrupts the service, restart it and verify the dashboard listens before reporting UI work complete.

## Reporting Back

A useful final report includes:

- What changed.
- Which files/surfaces were touched.
- What was verified.
- Any residual risk or follow-up.
- Obsidian path when a durable analysis/report was produced.

## Durable Output Routing

- Repo analysis belongs under `/Users/michael.yang/Documents/Obsidian Vault/repo/Personal/pikiclaw/`.
- Wiki/article interpretation belongs under the Obsidian `/wiki` area.
- Trellis is for task/spec memory that future agents should load while working in this repo.
