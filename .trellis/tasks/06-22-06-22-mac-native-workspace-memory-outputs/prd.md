# Mac native workspace memory outputs

## Goal

Make macOS native chat outputs easier to distinguish:

- Task output stays attached to the current chat/run as an artifact.
- Reusable workspace memory is shown as workspace-scoped knowledge and can be opened from a chat window title bar.

## Requirements

- Reuse existing `Artifact` and `KnowledgeCard` data instead of adding a new storage model.
- Show a `Memory` label on chat output artifacts that have been captured as reusable workspace memory.
- Add a compact title-bar entry in chat windows to view current workspace memory cards.
- Keep the first version read-only and focused on visibility.

## Verification

- Focused macOS unit tests cover workspace memory filtering and artifact-to-memory labeling.
- `PikiclawMac` builds successfully.
