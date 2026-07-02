# Fix Global Code Review Skill Routing

## Problem

`code-review` is intended to be a Pikiclaw-level skill usable from any supported agent. When the skill is installed globally and invoked explicitly from Pikiclaw, the prompt can still reach the downstream agent as a raw slash command or as a path to a missing project-local `SKILL.md`. Codex can then interpret the request using its own local review/mycr behavior instead of Pikiclaw's shared skill.

## Requirements

- Explicit skill invocation must be resolved by Pikiclaw before the prompt is forwarded to an agent.
- Global-only skills must expand to their actual `~/.pikiclaw/skills/<name>/SKILL.md` path.
- Dashboard skill resolution must accept the `/sk_<slug>` form used by menus and native surfaces, including names such as `code-review` that normalize to `sk_code_review`.
- macOS native skill launch must resolve `/sk_code_review` before reaching the selected agent, including start-chat and follow-up send paths.
- macOS native slash search must keep `/sk_code_review` discoverable without matching unrelated portable skills through agent availability text such as `Codex`.
- Project-local skill files must continue to take precedence over global skills with the same name.

## Verification

- Add focused unit coverage for global-only skill prompt resolution.
- Add focused unit coverage for Dashboard `/sk_code_review` resolution before agent launch.
- Add focused native coverage for `/sk_code_review` prompt expansion and composer slash filtering.
