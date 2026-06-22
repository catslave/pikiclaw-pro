---
name: code-review
description: Deep second-layer code review for current diffs, pull requests, merge requests, or pasted patches. Use when the user asks to review code beyond syntax and obvious bugs, especially to find changes that can run now but may create future pits: hidden side effects, compatibility breaks, boundary cases, performance risks, security risks, misleading naming, missing tests, or maintenance cost.
---

# Code Review

Review the current diff as a second-layer reviewer. Do not stop at “does it compile” or “is there an obvious bug.” Look for places that can run today but may become a pit later.

Use this review prompt as the core instruction:

> Please review the current diff. Do not only check syntax and obvious bugs. Focus on hidden side effects, compatibility breaks, boundary cases, performance risks, security risks, misleading names, insufficient tests, and future maintenance cost. Sort findings by severity.

## Review Workflow

1. Inspect the diff and the surrounding code needed to understand behavior.
2. Identify risks that are easy to miss because the happy path still works.
3. Ask whether the change may break old logic, skip boundary cases, or mislead future maintainers.
4. Check whether tests cover only the smoothest path instead of the risky paths.
5. Report findings first, ordered by severity.

## Focus Areas

- Hidden side effects: state, lifecycle, persistence, caching, retries, concurrency, or cleanup behavior changed indirectly.
- Compatibility breaks: existing APIs, data formats, saved state, migrations, config, feature flags, or old clients may no longer work.
- Boundary cases: empty input, missing files, stale sessions, duplicate items, interrupted runs, partial failures, timeouts, or permissions.
- Performance risks: repeated scans, unbounded loops, expensive work in render paths, large diffs, excessive I/O, or unnecessary rebuilds.
- Security risks: credential exposure, path traversal, unsafe shell invocation, permission bypass, weak trust boundaries, or unreviewed external input.
- Naming and maintainability: names imply the wrong scope, hide important constraints, or make future callers use the code incorrectly.
- Test gaps: tests prove the easiest path but miss regression, failure, downgrade, migration, or cross-agent behavior.

## Output Format

Lead with findings. Use this shape:

```text
Findings
- [P1] Title
  File: path:line
  Risk: what can break or become a future pit
  Why it matters: concrete scenario
  Suggested fix: smallest useful correction

Open questions
- ...

Residual risk / test gaps
- ...
```

If there are no findings, say that clearly and still mention the most important remaining test gap or residual risk.
