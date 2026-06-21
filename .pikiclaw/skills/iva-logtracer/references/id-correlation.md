# ID Correlation

Use this reference when moving from one service's logs to another.

## Component Map

| Component | Description | Key Fields |
|---|---|---|
| `assistant_runtime` | Legacy IVAR conversation handler and session entry point | `sessionId`, `conversationId`, `turnId` |
| `assistant_runtime_ng` | IVAR-NG runtime conversation handler and session entry point | `sessionId`, `conversationId`, `taskId`, `requestId` |
| `agent_service` | AI agent orchestration and execution | `conversationId`, `turnId` |
| `nca` | Nova Conversation Adapter | `request_id`, `conversationId` |
| `aig` | AI Gateway | `request_id` |
| `gmg` | Generative Model Gateway | `log_context_RCRequestId` |
| `agw` | Platform Agent Gateway | `request_id` |
| `cprc_srs` | Speech recognition service | `srs_session_id` |
| `cprc_sgs` | Speech generation service | `sgs_session_id` |

## Flow

```text
sessionId (s-xxx)
    |
    +--> assistant_runtime / assistant_runtime_ng
    |      |
    |      +--> conversationId (UUID) ----------------------+
    |      |                                                |
    |      +--> srs_session_id --> cprc_srs                |
    |      |                                                |
    |      +--> sgs_session_id --> cprc_sgs                |
    |                                                       |
    +-------------------------------------------------------+
                                                            |
conversationId <--------------------------------------------+
    |
    +--> agent_service (conversationId, turnId)
    |
    +--> nca (conversationId, request_id)
           |
           +--> aig (request_id)
           |
           +--> gmg (log_context_RCRequestId from request_id)
           |
           +--> agw (request_id)
```

## Index Patterns

| Component | Index Pattern |
|---|---|
| `assistant_runtime` | production: `*:*-logs-air_ivar-*`; non-production: `*:*-logs-air_assistant_runtime-*` |
| `assistant_runtime_ng` | production: `*:*-logs-air_ivar-*`; non-production: `*:*-logs-air_assistant_runtime-*` |
| `agent_service` | `*:*-logs-air_agent_service-*` |
| `nca` | `*:*-logs-nca-*` |
| `aig` | `*:*-logs-air_ai_gateway-*` |
| `gmg` | `*:*-logs-air_gmg-*` |
| `agw` | `*:*-logs-agw-*` |
| `cprc_srs` | `*:*-logs-cprc*` with `srs_session_id` filtering |
| `cprc_sgs` | `*:*-logs-cprc*` with `sgs_session_id` filtering |
