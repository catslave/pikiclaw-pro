# Skills And Extensions Spec

## Project Skills

Project-local skills live under:

```text
.pikiclaw/skills/<name>/SKILL.md
```

`listSkills()` discovers project skills. A project skill is not "done" only because a file exists; verify where the user expects to see it.

## Catalog Visibility

- `src/dashboard/routes/extensions.ts` is the backend source of truth for Extensions and Skills catalog items.
- Local-only skills may need synthetic catalog rows so the global Skills page can show a card.
- If the user says a skill is not visible, treat it as a scope/cache/rendering issue until verified in the UI.
- Prompt editing should update the real `SKILL.md` when the UI claims to edit a local skill prompt.

## Workflow Skills

Platform skills are often better modeled as backend-owned workflows than arbitrary shell prompts.

Examples of the preferred shape:

- Resolve and run a trusted local CLI in a typed backend module.
- Intercept a slash command before generic agent submission when deterministic workflow behavior is required.
- Return controlled progress, failure, and artifact information to the active session.

## Output Artifacts

- Pikiclaw already supports structured message blocks and Mermaid rendering.
- Editable visual or document artifacts should be treated as artifacts attached to the conversation, not static screenshots.
- Review/comment flows should return feedback to the active session so the agent can continue the work.
