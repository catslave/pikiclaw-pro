# Mac Native Temporary Multi-Chat Panes

## Goal

Let the macOS client open multiple active chats side by side as a temporary window layout. This is separate from nesting a chat as a side chat.

## Requirements

- Dragging a chat from the left chat list into the main chat workspace opens it beside the current chat.
- Repeating the same drag focuses or keeps the existing pane instead of duplicating it.
- Closing a pane removes only that temporary pane; it does not stop, delete, detach, or re-parent the chat.
- When only one pane remains, the layout behaves like the normal single-chat workspace.
- Existing drag-to-nest behavior on chat rows remains the semantic parent/side-chat action.

## Non-Goals

- Do not persist temporary pane layout across app launches.
- Do not change the stored parent/side-chat data model.
- Do not redesign unrelated chat, Jira, or Mission Control surfaces.

## Validation

- Add focused Swift tests for temporary pane selection, duplicate prevention, close behavior, and preservation of existing side-chat selection.
- Run the narrow macOS test target that covers the new logic.
