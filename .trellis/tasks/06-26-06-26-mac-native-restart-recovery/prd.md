# Mac native restart recovery

## Problem

After restarting the macOS native app, Pikiclaw currently defaults into the hardcoded native v2 work item and can show an old stale run. This makes restart feel like a dead state instead of continuing interrupted work.

## Scope

- Recover every persisted interrupted run on launch.
- Keep the visible startup window focused on the user's last workspace route when possible, or a new chat launcher fallback.
- Avoid focusing an old stale run only because a seeded work item has `currentRunId`.
- Add focused Swift tests for the recovery and startup selection rules.

## Non-goals

- Rebuild the whole native navigation model.
- Add a full recovery center UI.
- Change dashboard/web behavior.
- Change agent protocol behavior beyond native launch recovery.

## Done

- Persisted active execution runs are relaunched after app startup instead of being immediately marked stale.
- Startup no longer hardcodes the native v2 work item as the visible chat target.
- Existing `currentRunId`-based work item recovery still works when the user explicitly selects a work item.
- Focused tests cover interrupted-run launch recovery and default startup chat selection.
