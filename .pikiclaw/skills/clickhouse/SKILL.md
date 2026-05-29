---
label: ClickHouse Query
description: Query the configured ClickHouse MCP server with SQL.
mcp_requires:
  - clickhouse-lab
---

# ClickHouse Query

Use this skill when the user invokes `/clickhouse` with a SQL query or asks to inspect ClickHouse data.

## MCP Target

- Default MCP server: `clickhouse-lab`
- Default database: `gen_eva_trace_v2`
- Main table: `gen_eva_trace_v2.otel_traces_main`
- Config file: `.pikiclaw/skills/clickhouse/config.json`
- Available MCP tools should include `list_databases`, `list_tables`, and `run_query`.

## Workflow

1. Treat the slash command arguments as the requested SQL or ClickHouse task.
2. Read `.pikiclaw/skills/clickhouse/config.json` first and use its defaults. Do not discover schemas unless the query truly needs unknown columns.
3. Use the ClickHouse MCP tools directly. Prefer `run_query` for SQL. Avoid `list_tables`, `list_databases`, and `DESCRIBE` for normal trace lookups because they can be slow.
4. Do not use shell commands, `curl`, local scripts, or direct HTTP queries unless the ClickHouse MCP server is unavailable or times out. If fallback is needed, say so explicitly in the final answer.
5. If the SQL omits a database for the trace table, use `gen_eva_trace_v2.otel_traces_main`.
6. Keep result previews compact. For large result sets, summarize and ask whether to broaden the query.
7. If the user asks for stage data, say that `clickhouse-stage` must be enabled in Extensions > MCP and the current agent session may need to be restarted to pick it up.

## ID Lookup Rules

Most slash command arguments are either a `ConversationId` or a `TraceId`.

- `TraceId` is the `ConversationId` with hyphens removed.
- If the input contains hyphens, treat it as a `ConversationId`, derive `traceId = replaceAll(input, '-', '')`, and query `TraceId` first.
- If the input is a 32-character hex string, treat it as a `TraceId`.
- Prefer `TraceId = '<normalizedTraceId>'` for the first query. It is usually the fastest lookup.
- Only fall back to `ConversationId = '<input>'` or `replaceAll(ConversationId, '-', '') = '<traceId>'` if the `TraceId` query returns no rows and the user needs the fallback.

For a bare ID, use this preview query shape:

```sql
SELECT
  Timestamp,
  TraceId,
  ConversationId,
  SessionId,
  SpanId,
  ParentSpanId,
  ServiceName,
  SpanName,
  Duration,
  StatusCode,
  StatusMessage
FROM gen_eva_trace_v2.otel_traces_main
WHERE TraceId = '<normalized_trace_id>'
ORDER BY Timestamp ASC
LIMIT 20
```

For a quick trace summary, use:

```sql
SELECT
  count() AS spans,
  min(Timestamp) AS first_ts,
  max(Timestamp) AS last_ts,
  countIf(StatusCode = 'Error') AS error_spans,
  groupUniqArray(ServiceName) AS services
FROM gen_eva_trace_v2.otel_traces_main
WHERE TraceId = '<normalized_trace_id>'
```

For slow spans, use:

```sql
SELECT
  Timestamp,
  ServiceName,
  SpanName,
  SpanId,
  ParentSpanId,
  round(Duration / 1000000, 2) AS duration_ms,
  StatusCode,
  StatusMessage
FROM gen_eva_trace_v2.otel_traces_main
WHERE TraceId = '<normalized_trace_id>'
ORDER BY Duration DESC
LIMIT 10
```

## Analysis Output

For trace or conversation lookups, do not stop at a raw summary. Return a concise investigation-style answer with these sections:

1. `Lookup`
   - State the normalized `TraceId`.
   - If available, state the `ConversationId` and `SessionId`.
   - State whether the lookup used MCP directly or an HTTP fallback after MCP timeout.
2. `Summary`
   - Include span count, time range, error span count, and involved services.
3. `Analysis`
   - Interpret the trace shape in plain engineering terms.
   - Identify the likely main path from parent/child spans when visible.
   - Mention whether the trace appears successful, partially missing, or failed.
4. `Slow Spans`
   - List the top slow spans with service, span name, duration in ms, status, and why each matters.
   - Highlight spans above `analysisOutput.highlightThresholdMs` from config.
5. `Risk Or Anomaly`
   - Call out `StatusCode = Error`, unusually long spans, empty `ConversationId`/`SessionId` on important spans, repeated turns/sessions, or `StatusCode = Unset` on long spans.
   - If no clear issue is visible, say that explicitly.
6. `Next Steps`
   - Suggest one or two concrete follow-up queries or logs to inspect.
   - Keep suggestions tied to the actual services/spans in the result.

For the common IVAR/Nova trace table, useful interpretation rules:

- `CONVERSATION` is usually the root span.
- `SESSION`, `TURN`, `CONVERSATION_EVENT`, `WORKFLOW`, `LLM`, and `AI_Chat` explain the NCA/runtime/model path.
- `ChatFlow`, `FlowExecution`, and `NodeExecution` usually point to WBB workflow execution.
- `Duration` is nanoseconds in the table; convert to milliseconds with `round(Duration / 1000000, 2)`.
- `StatusCode = Unset` is not necessarily a failure, but a long `Unset` span should be mentioned as an observability gap or potential workflow wait.

## Safety

- Default to read-only queries.
- Do not run `INSERT`, `ALTER`, `DROP`, `TRUNCATE`, `DELETE`, `OPTIMIZE`, or other mutating statements unless the user explicitly asks and confirms the target environment.
- If a query may scan a large time range, add a reasonable `LIMIT` or ask for a tighter filter.
