# Dashboard Spec

## Primary Surfaces

- `dashboard/src/pages/sessions/SessionWorkspace.tsx` is the main workspace layout-control surface.
- `dashboard/src/pages/sessions/SessionPanel.tsx`, `TurnView.tsx`, `AssistantContent.tsx`, `InputComposer.tsx`, and `ContextShelf.tsx` are common seams for chat rendering and interaction polish.
- `dashboard/src/components/Sidebar.tsx` controls global navigation, but many workspace hide/collapse issues are owned by `SessionWorkspace.tsx`.
- `dashboard/src/i18n.ts` should be updated for new visible copy.
- Backend route seams are usually under `src/dashboard/routes/*.ts`.

## Workspace Layout

- Keep the chat canvas conversation-first.
- Layout controls, side chat, archive, and view-mode affordances should not consume the primary chat area unnecessarily.
- If a side panel is open without an active item, represent that state explicitly instead of overloading the active item id.
- Text and buttons must fit at narrow widths; use compact controls, icons, menus, and container-aware layouts rather than widening panels by default.
- Do not nest UI cards inside cards; use cards for repeated items, modals, or genuinely framed tools.

## Side Chat And Outputs

- Side chat should reopen quickly by warming session/message caches before mounting when possible.
- Duplicate image blocks can arise when agent drivers provide both `local_images` and `images`; prefer upstream dedupe plus UI fallback.
- Output previews should be discoverable from the active conversation without turning the workspace into a file manager.
- For review loops, prefer native Files-panel/review flow that can submit comments back to the active session.

## Visual Verification

Dashboard UI changes should be verified in the running product when practical:

1. Build or type-check the touched surface.
2. Ensure the dev service is listening on `3939`.
3. Open the relevant route, usually `http://localhost:3939`.
4. Check desktop and narrow viewport behavior for overflow, hidden rails, and unreadable text.

## Known Product Preferences

- The user prefers clean workspace focus over extra always-visible panels.
- Hidden sidebars should not leave awkward residual gutters.
- Compact/in-place controls are usually better than new visible management chrome.
- For operational tools, prefer restrained, scannable UI over marketing-style visual treatment.
