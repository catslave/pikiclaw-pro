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

- Use the user's personal Jira read token via the local `RC_JIRA_READ_TOKEN` environment variable.
- Do not store raw Jira token values in this skill, source files, tests, logs, or committed artifacts.
- If the synced issues show assignee `AI Service`, treat it as an identity/configuration bug and verify the JQL is not using `currentUser()`.
