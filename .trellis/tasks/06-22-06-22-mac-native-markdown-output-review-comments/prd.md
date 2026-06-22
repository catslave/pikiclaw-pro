# Mac native markdown output review comments

## Goal

Make macOS native chat output reviewable in place.

## Requirements

- Render assistant output as markdown instead of raw plain text.
- Allow selecting text in an assistant output and turning that selection into a staged review comment.
- Allow multiple staged comments to be reviewed together and sent back into the same chat.
- Keep the first version local to the current chat surface and avoid adding new persistence models.

## Verification

- Unit coverage for markdown conversion and review comment prompt composition.
- `PikiclawMac` builds successfully.
