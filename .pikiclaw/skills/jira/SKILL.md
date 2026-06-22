---
name: jira
description: Use when working on Pikiclaw Jira sync, Jira queue, or macOS native Jira ticket intake.
---

# Jira Sync

Use this skill when working on Pikiclaw Jira sync, Jira queue, or macOS native Jira ticket intake.

## Identity

- The default Jira assignee for this workspace is `Michael Yang`.
- Do not rely on Jira `currentUser()` for Pikiclaw native sync because the MCP read-token path can resolve `currentUser()` as the service account, such as `AI Service`.
- Query Michael's tickets explicitly with:

```jql
assignee = "Michael Yang" AND sprint in openSprints() AND status NOT IN (Closed, Cancelled) ORDER BY updated DESC
```

- Fallback query when open-sprint filtering returns zero or is unsupported:

```jql
assignee = "Michael Yang" AND status NOT IN (Closed, Cancelled) ORDER BY updated DESC
```

## Token Handling

- Native sync reads Michael's permanent Jira read token from `.pikiclaw/local/jira.env`; shell or session environment only fill missing values.
- Keep the raw `RC_JIRA_READ_TOKEN` value in `.pikiclaw/local/jira.env`, not in committed skill files.
- Keep `.pikiclaw/local/jira.env` out of git. It can still set `RC_CONFLUENCE_READ_TOKEN`, `PIKICLAW_JIRA_MCP_SERVICE_URL`, or temporary overrides for local experiments.
- To point native sync at a different private file, set `PIKICLAW_JIRA_ENV_FILE=.pikiclaw/local/jira.env` in this skill.
- If the synced issues show assignee `AI Service`, treat it as an identity/configuration bug and verify the JQL is not using `currentUser()`.
