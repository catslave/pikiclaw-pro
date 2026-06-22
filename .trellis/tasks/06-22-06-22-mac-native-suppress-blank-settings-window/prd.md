# Mac native suppress restored blank settings window

## Goal

After `build-app.sh --install --open`, Pikiclaw should open the main native window only. A blank macOS "Pikiclaw Settings" window should not be restored or opened as a side effect of rebuild/startup.

## Requirements

- Keep the in-app Settings route available from the menu and dock/system surfaces.
- Do not expose the empty SwiftUI Settings placeholder as a user-facing window.
- Close any restored blank settings window on launch/reopen.
- Preserve main window creation and deep-link behavior.
- Verify with a focused macOS test and product build.
