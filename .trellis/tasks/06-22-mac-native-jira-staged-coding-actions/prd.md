# Mac native Jira staged coding actions

## Goal

Make Jira task chat next actions stage-aware:

- Show `Coding` only after the task chat has a clear actionable output or plan.
- Clicking `Coding` starts a follow-up run for the selected ticket instead of only filling the input.
- Use workspace-level workflow configuration for branch naming and action prompts; do not hardcode one branch convention for all repos.
- After coding-like output appears, show `Review` as the next action.
- Keep existing generic follow-up action generation available internally, but do not surface unrelated next-action chips in the main task chat row.

## Non-goals

- Full Settings UI for editing every prompt.
- Creating branches from a dedicated modal.
- Jira write-back automation changes.

## Validation

- Unit coverage for workspace-configured Coding prompt generation.
- Unit coverage for Review stage detection after coding output.
- Focused macOS build/install verification.
