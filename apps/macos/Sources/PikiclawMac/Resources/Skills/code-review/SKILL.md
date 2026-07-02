---
name: code-review
description: Understand and review current diffs, pull requests, merge requests, or pasted patches. Use when the user asks to review code or an MR/PR, especially when the agent should first collect MR/Jira/background context, explain what the change is trying to do and how the repo should support it, then perform a deep second-layer review for hidden side effects, compatibility breaks, boundary cases, performance risks, security risks, overthinking or overdesign, misplaced responsibilities, misleading naming, or maintenance cost.
mcp_requires:
  - gitlab
  - atlassian
---

# Code Review

First understand the MR, then review it as a second-layer reviewer. Do not jump straight to bug hunting before establishing the background and intent.

When an MR/PR URL, Jira ticket, issue link, branch, or diff context is available, collect and use it. Look for:

- MR/PR title, description, discussion, linked issues, and acceptance notes.
- Jira ticket title, description, comments, status, expected behavior, and business/user impact.
- Repo-local context: existing flows, related modules, previous patterns, tests, config, migrations, and compatibility constraints.

Use configured MCP tools before browser or token-based web fallbacks:

- Use GitLab MCP for MR metadata, description, commits, discussions, and diff refs when a GitLab MR URL or MR id is provided.
- Use Atlassian/Jira MCP for linked Jira ticket details when an issue key is present in the MR, branch, commits, title, or user prompt.
- If a required MCP server or tool is unavailable, say which source could not be fetched and continue from local git diff/repo context. Do not try to scrape private web pages as the primary path.

If the background source is unavailable, say what could not be fetched and continue from the diff and repo context. Do not invent missing product intent.

## Step 1: Understand the MR

Before the review findings, produce a concise understanding section:

1. Background: what problem or requirement this MR appears to address, using MR/Jira/repo evidence when available.
2. Desired repo support: what this repository needs to change or support for that requirement to work correctly.
3. MR summary: what the MR actually changes.
4. Implementation approach: the apparent design/flow, including why the main files were changed.
5. Key changed areas: important files/modules and their roles in the MR.

Keep this section explanatory, not judgmental. Its purpose is to help the user understand the MR before reading findings.

## Step 2: Review the MR

Review the current diff as a second-layer reviewer. Do not stop at “does it compile” or “is there an obvious bug.” Look for places that can run today but may become a pit later. Also check whether the MR is overthinking the problem, overdesigning abstractions, or placing logic in the wrong layer/module even if the feature works.

Use this review prompt as the core instruction:

> Please review the current diff. Do not only check syntax and obvious bugs. Focus on hidden side effects, compatibility breaks, boundary cases, performance risks, security risks, overthinking or overdesign, misplaced responsibilities, misleading names, and future maintenance cost. Sort findings by severity. Do not report test coverage as a standalone issue; mention validation only when it directly supports a concrete behavioral risk.

## Review Workflow

1. Collect MR/Jira/background context when links or identifiers are available.
2. Inspect the diff and the surrounding code needed to understand behavior.
3. Explain the MR background, desired repo support, actual changes, implementation approach, and key files.
4. Identify risks that are easy to miss because the happy path still works.
5. Ask whether the change may break old logic, skip boundary cases, overcomplicate the design, put responsibilities in the wrong place, or mislead future maintainers.
6. Ignore pure test coverage gaps as review findings; mention tests only as supporting evidence for a concrete risk.
7. Report findings ordered by severity.

## Focus Areas

- Hidden side effects: state, lifecycle, persistence, caching, retries, concurrency, or cleanup behavior changed indirectly.
- Compatibility breaks: existing APIs, data formats, saved state, migrations, config, feature flags, or old clients may no longer work.
- Boundary cases: empty input, missing files, stale sessions, duplicate items, interrupted runs, partial failures, timeouts, or permissions.
- Performance risks: repeated scans, unbounded loops, expensive work in render paths, large diffs, excessive I/O, or unnecessary rebuilds.
- Security risks: credential exposure, path traversal, unsafe shell invocation, permission bypass, weak trust boundaries, or unreviewed external input.
- Overthinking and overdesign: unnecessary abstractions, new frameworks, broad mechanisms, generic infrastructure, or speculative flexibility when a smaller local change would satisfy the requirement.
- Responsibility boundaries: logic placed in the wrong module/layer, domain decisions hidden in transport/UI/config glue, duplicated ownership, or changes that blur existing architecture boundaries.
- Naming and maintainability: names imply the wrong scope, hide important constraints, or make future callers use the code incorrectly.

Do not make test coverage a primary review category. A missing test is only worth mentioning when it is tied to a specific behavior that appears risky or broken.

## Output Format

Lead with MR understanding, then findings. Use this shape:

```text
MR Understanding
- Background: ...
- Desired repo support: ...
- What changed: ...
- Implementation approach: ...
- Key files:
  - path: why it changed

Findings
- [P1] Title
  File: path:line
  Risk: what can break or become a future pit
  Why it matters: concrete scenario
  Suggested fix: smallest useful correction

Open questions
- ...

Residual risk
- ...
```

If there are no findings, say that clearly and mention only meaningful residual risk. Do not add a test-gap section by default.
