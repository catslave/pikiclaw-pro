# Mac Native Composer Reference Chips

## Goal

Make pasted or typed file paths and URLs in the macOS chat composer render as compact reference chips instead of long inline text.

## Requirements

- Detect file paths and web URLs pasted into the composer.
- Detect a file path or web URL once the user types it and separates it with whitespace or a newline.
- Render detected references as removable chips above the text input.
- Keep the user able to continue typing normal prose after the chip is created.
- When sending, expand chips back into the prompt so agents receive the original path or URL.
- Preserve existing image attachment behavior.

## Non-Goals

- Do not implement rich inline attributed text editing in the NSTextView.
- Do not fetch web page titles or file metadata over the network.
- Do not persist composer chips beyond the current draft.

## Validation

- Add focused Swift tests for path/URL extraction and prompt expansion.
- Run the narrow macOS test target that covers the new helpers.
- Run `swift build --package-path apps/macos --product PikiclawMac`.
