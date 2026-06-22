# Mac native dock route switch responsiveness

## Goal

Clicking the macOS native left dock route buttons should feel immediate. The selected dock tile should update right away, and switching pages should not wait several seconds for heavy content rebuilds or inherited hover animations.

## Requirements

- Keep the existing left dock visual design and hover effect.
- Make dock selection feedback independent from slow page content construction.
- Avoid implicit full-page animation during route replacement.
- Keep route behavior unchanged for Chat, Project, Jira, Terminal, Agent Studio, Mission Control, and Voice.
- Add narrow tests for route-selection state where practical.
- Verify with focused macOS tests and a product build.
