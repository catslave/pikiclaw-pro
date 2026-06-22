# Mac native message thinking lifecycle

## Goal

Make the assistant message card match the native chat lifecycle:

- While a message is still running, show one `Thinking` area that contains both thinking text and tool-call activity.
- After the message finishes, hide `Thinking` and tool-call details from the main card.
- Keep the final response visible after completion.
- Show message duration/status in the assistant-card header area instead of leaving process blocks below the final answer.

## Non-goals

- Changing transcript parsing semantics.
- Removing stored tool/thinking lines from raw run transcripts.
- Reworking saved output cards or right-side inspectors.

## Validation

- Unit coverage for completed cards hiding activity panels.
- Unit coverage for running cards grouping tool calls inside the Thinking activity.
- Focused macOS package tests/build.
