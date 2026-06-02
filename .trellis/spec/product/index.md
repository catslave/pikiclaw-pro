# Product Spec

## North Star

Pikiclaw is a layered, open Agent orchestrator. It is not primarily an IM bridge, a Jira board, or a chat wrapper. IM channels, the Web Dashboard, Jira dashboards, Todo capture, Skills, MCP, and local model controls are terminals and surfaces around the same product: one operator steering many agent sessions from one cockpit.

## Product Identity

- Lead with the layered framing from `AGENTS.md`: Terminal -> Agent -> Model -> Tool.
- Treat the Web Dashboard as a normal runtime surface, not a setup helper.
- Preserve the self-bootstrap story: pikiclaw is used to build pikiclaw.
- Design for one creator managing many parallel agent streams, not for a single linear chat only.

## Conversation-First Workspace

- The main workspace should stay clean and chat-centered.
- Auxiliary controls should help the current conversation, not compete with it.
- Prefer compact menus, drawers, shelves, or contextual controls over always-visible management chrome.
- Outputs should be easy to open from the chat context: rendered markdown, files, previews, side chat, and review comments should feel attached to the active session.
- If a feature creates a persistent panel, ask whether it is truly a core workspace surface or just an attention/status entry point.

## Dashboard Mental Model

- Workspace is for active conversation and agent steering.
- Dashboard/Pro is for task tracking, status, source-specific views, and workbench entry points.
- A Jira task, Todo item, or manual task is input/context for agent work; it should not replace the chat as the core working object.
- Task detail should expose status, outputs, and stage progress while keeping the primary action path conversational.

## Product Taste

- Prefer quiet, utilitarian, dense-but-readable operational UI.
- Avoid adding panels simply because there is space.
- Preserve scanning and repeated action over decorative composition.
- A "hidden" state should feel hidden; if a rail remains visible, call it collapsed and design it intentionally.
- User-visible text should be direct and product-native, not explaining the UI to the user.

## Product Memory Rules

- When a product decision is likely to recur, capture it here or in a surface-specific spec.
- When the output is a durable analysis, save it to Obsidian under `/Users/michael.yang/Documents/Obsidian Vault/repo/Personal/pikiclaw/`.
- Keep Trellis task notes focused on implementation memory; keep polished reports and repo analyses in Obsidian.
