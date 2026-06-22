# Mac Native Chat Output Cards

## Goal

Make captured outputs visible from the chat transcript itself. When a run produces one or more `Artifact` outputs, the chat should show compact output cards near the assistant result so the user can see that durable output exists without hunting through Work Items.

## Scope

- macOS native chat transcript and multi-chat workspace.
- Reuse existing `Artifact` data and output review UI.
- Clicking an output card opens that output in a right-side review pane.

## Non-goals

- No new persistence model for message attachments.
- No web/dashboard changes.
- No new tests during the current rapid UI iteration unless a compile-time or data-contract issue requires it.

## Acceptance

- Outputs linked to the current run render as clear cards in the chat.
- Clicking a card opens a right-side pane with the selected output content and actions.
- The normal macOS native build succeeds.
