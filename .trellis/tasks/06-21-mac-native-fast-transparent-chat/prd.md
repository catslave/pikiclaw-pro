# Mac Native Fast Transparent Chat

## Goal

Make the macOS native chat path feel immediate and trustworthy when the user creates a chat directly or chooses an agent launcher. Starting a chat should hand off to the selected agent CLI quickly, show what is happening, and avoid avoidable UI or storage work while output is streaming.

## Why Now

The native client is becoming the primary working surface for Pikiclaw. The user may run multiple chats in parallel, so the chat hot path must not amplify latency with repeated full-state reloads, blocking CLI setup, or opaque waiting states.

## Scope

- Mac native chat creation and agent-launch start path.
- Agent CLI event handling from launch through streaming completion.
- Lightweight transparency for launch/stream phases, especially when the agent has not produced output yet.
- Focused tests that protect low-latency state updates and visible launch state.

## Non-Goals

- Do not redesign the full chat UI.
- Do not refactor unrelated Jira, voice, or dashboard flows.
- Do not change agent CLI semantics beyond what is needed for faster native handoff.
- Do not mix unrelated dirty worktree changes into this task.

## Success Criteria

- Starting a chat avoids full snapshot reloads for every agent output event.
- The UI state reflects run creation and streaming progress from the in-memory snapshot without waiting on a full store reload.
- Agent launch remains visible before the first content event, so the user can tell whether the CLI is resolving, running, streaming, or failed.
- Focused macOS tests cover the optimized event path.
- If unrelated WIP prevents full test execution, document the exact blocker and keep this task's changes isolated.
