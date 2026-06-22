# Mac native agent dock activity counts

## Goal

The macOS native left dock should show a numeric activity badge on each agent tile. The number should represent the amount of work currently needing awareness for that agent.

## Requirements

- Count live agent runs: queued, starting, running, waiting for user, and cancelling.
- Count completed unread runs: completed with `readAt == nil`.
- Prefer the numeric badge over the previous running dot on agent tiles.
- Keep health/config dots only when there is no activity count to show.
- Keep existing dock layout and hover behavior.
- Add focused tests for the count helper.
