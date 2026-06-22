# IVAS-7167 Kafka Producer Failover Investigation

Date: 2026-06-22
Workspace inspected: `/Users/michael.yang/Codes/Personal/pikiclaw`
Ticket: IVAS-7167, "[IVAR] Support Kafka producer failover for IVAR message and conversation events"

## Ticket Boundary

Confirmed facts:

- The ticket asks for producer-side failover/recovery for IVAR history events on Kafka topics `iva.messages` and `iva.conversations`.
- Required records include `USER`, `ASSISTANT`, and `SYSTEM` message records, plus conversation lifecycle/update records where applicable.
- Kafka keys for these history records are `conversationId`.
- The implementation target named by the Jira description is `assistant-runtime`, not Pikiclaw.
- The current Pikiclaw repo has no Kafka producer implementation for `iva.messages` or `iva.conversations`; a focused search for `kafka`, `iva.messages`, `iva.conversations`, `producer.send`, `bootstrap.servers`, and `bootstrapServers` under Pikiclaw returned no matching producer path.
- Pikiclaw currently has substantial unrelated macOS/Jira WIP in the worktree. This investigation did not edit those files.

In-scope runtime paths from source evidence:

- Classic `assistant-runtime` publishes history to Kafka through `src/kafka/KafkaClient.ts` and `src/history/HistoryPublishers.ts`.
- `assistant-runtime-next-gen` has its own Kafka history path in `src/main/kotlin/com/ringcentral/ivar/history/KafkaHistoryPublisher.kt`.
- AIR-on-Nova should not be excluded without an explicit owner decision because the NG history publisher emits `USER`, `ASSISTANT`, `SYSTEM`, and conversation update records from runtime history commands.

Out of scope unless separately confirmed:

- Downstream consumer changes.
- Direct `rcnova` history semantics.
- Chat and system-task validation, unless product owners confirm they must share the same producer-side contract.

## Implementation Seam

Classic `assistant-runtime`:

- `src/config/Config.ts:11-16` defines only `bootstrapServers`, `retries`, `messageTopic`, and `conversationTopic` for Kafka. There is no explicit fallback bootstrap list, fail-hard mode, or durable outbox setting.
- `src/kafka/KafkaClient.ts:30-37` constructs a KafkaJS producer from `config.bootstrapServers.split(",")` with configured retries.
- `src/kafka/KafkaClient.ts:47-64` publishes message and conversation update records keyed by `conversationId`.
- `src/kafka/KafkaClient.ts:74-83` logs and increments a not-connected metric, then returns without surfacing or buffering the event.
- `src/kafka/KafkaClient.ts:86-93` catches `producer.send` failure, logs it, increments failure metrics, then returns. This is a confirmed best-effort/drop-on-failure behavior.
- `src/history/HistoryPublishers.ts:18-21` and `src/history/HistoryPublishers.ts:42-45` call Kafka publishing asynchronously and only log rejected promises.

`assistant-runtime-next-gen`:

- `src/main/kotlin/com/ringcentral/ivar/config/IvarProperties.kt:68-76` defines `KafkaHistoryProperties` with `enabled`, `bootstrapServers`, topics, `compressionType`, `retries`, `clientId`, and `failOpen`. It does not define history-specific fallback brokers.
- `src/main/kotlin/com/ringcentral/ivar/history/KafkaHistoryPublisher.kt:43-74` builds an Apache Kafka producer with `acks=all`, `retries`, and the configured `bootstrapServers`.
- `src/main/kotlin/com/ringcentral/ivar/history/KafkaHistoryPublisher.kt:104-120` sends synchronously, increments success/failed metrics, and swallows failures when `failOpen=true`.
- `src/main/resources/application.yaml:143-153` and `kustomize/base/configs/application.yaml:148-158` configure history Kafka as a single bootstrap path.
- Environment overlays such as `kustomize/lab/fra52-c01-kbm10/iva-stage/configs/application-stage.yaml:10-17` and `kustomize/prod/eug14-c01-kbm10/iva-us-west-01/configs/application-us-west-01.yaml:9-18` define primary and fallback brokers for the OTel Kafka exporter, but that is separate from `ivar.history.kafka` and does not protect history events.

## Change Plan

Smallest safe code change cannot be made in Pikiclaw because the ticket's producer implementation is not in this repository and the current sandbox only allows writes under `/Users/michael.yang/Codes/Personal/pikiclaw`.

Recommended implementation in the correct repo:

1. In classic `assistant-runtime`, add an explicit producer failover contract around `KafkaClientImpl`:
   - Configuration: primary bootstrap servers, optional fallback bootstrap servers or service-discovery endpoint, retry timeout, fail-open/fail-hard behavior.
   - Send behavior: if primary connect/send fails after bounded retry, recreate/connect a fallback producer and send the same record.
   - Visibility: emit metrics for `success`, `primary_failed`, `fallback_success`, `fallback_failed`, and `dropped` or `failed_hard`.
   - Tests: producer reconnect/fallback success, fallback failure, not-connected behavior, and `conversationId` key preservation.
2. In `assistant-runtime-next-gen`, apply the same contract to `KafkaHistoryPublisher` / `ApacheKafkaHistoryProducer` or share the approved infrastructure pattern:
   - Add history-specific fallback brokers or confirm the existing bootstrap string already comes from platform-level failover.
   - Preserve `acks=all`, `conversationId` keys, topics, and existing metrics.
   - Decide whether `failOpen=true` is acceptable for required persistence. If persistence is mandatory, fail-open alone does not satisfy IVAS-7167.
3. Decide duplicate and ordering contract before release:
   - If producer retry/fallback can duplicate records, downstream must reconcile by message metadata such as `messageId`, `conversationId`, timestamp, and role.
   - Per-conversation ordering can be preserved only as far as keyed writes to a single resolved cluster/partition are preserved; cross-cluster fallback should be treated as at-least-once unless an outbox or transactional mechanism is added.

## Validation

Commands run:

- `python3 ./.trellis/scripts/get_context.py --mode packages`
  - Result: single-repo project, no packages configured.
- `python3 ./.trellis/scripts/task.py current --source`
  - Result: no active Trellis task.
- `git status --short --untracked-files=all`
  - Result: existing unrelated macOS/Jira WIP is present in Pikiclaw.
- In Pikiclaw source, excluding generated report output: `rg -n --glob '!output/**' "kafka|Kafka|iva\\.messages|iva\\.conversations|producer\\.send|bootstrap\\.servers|bootstrapServers" .`
  - Result: no Kafka history producer path in this repo.
- In classic `assistant-runtime`: `rg -n "kafka|Kafka|iva\\.messages|iva\\.conversations|producer\\.send|bootstrap\\.servers|bootstrapServers|KafkaProducer|producer" src config kustomize package.json`
  - Result: confirmed KafkaJS producer, topics, config, tests, and Strimzi topic definitions.
- In `assistant-runtime-next-gen`: `rg -n "kafka|Kafka|iva\\.messages|iva\\.conversations|producer\\.send|bootstrap\\.servers|bootstrapServers|KafkaProducer|producer" src kustomize docs build.gradle`
  - Result: confirmed Kotlin/Apache Kafka history publisher, topics, metrics, and OTel-only fallback broker config.

Candidate focused tests after code changes in the correct repo:

- Classic `assistant-runtime`: `npm test -- KafkaClient.test.ts HistoryPublishers.test.ts`
- Classic `assistant-runtime`: add a unit test where the primary mock producer fails and fallback mock producer receives both `iva.messages` and `iva.conversations` records with unchanged `conversationId` keys.
- `assistant-runtime-next-gen`: `./gradlew test --tests com.ringcentral.ivar.history.KafkaHistoryPublisherTest --tests com.ringcentral.ivar.config.IvarPropertiesIntegrationTest`
- Operational validation: run one new and one ongoing `rciva` session before, during, and after Kafka failover; verify producer logs/metrics plus downstream read-model records for `USER`, `ASSISTANT`, `SYSTEM`, and conversation update events.

## Jira Update

Paste-ready comment:

```
IVAS-7167 investigation update:

Confirmed the Jira implementation target is assistant-runtime producer-side history publishing, not Pikiclaw. In the current Pikiclaw workspace there is no Kafka producer path for iva.messages or iva.conversations, so no safe Pikiclaw code change was made.

Source findings:
- Classic assistant-runtime publishes message/conversation history through src/kafka/KafkaClient.ts and src/history/HistoryPublishers.ts. Message and conversation update records are keyed by conversationId. Current behavior logs and metrics producer connect/send failures, then returns without buffering or retry recovery beyond KafkaJS producer retries.
- assistant-runtime-next-gen has src/main/kotlin/com/ringcentral/ivar/history/KafkaHistoryPublisher.kt. It emits USER, ASSISTANT, SYSTEM, and conversation update records, uses a single history Kafka bootstrap path, acks=all, retries=3 by default, and failOpen=true swallows producer failures after logging/metrics.
- NG environment overlays currently show primary/fallback broker config for OTel Kafka export, but that is separate from ivar.history.kafka and does not prove history-event failover.

Recommended implementation boundary:
- Implement producer failover/recovery in assistant-runtime and confirm whether assistant-runtime-next-gen / AIR-on-Nova is included in the same patch or a separate follow-up.
- Define at-least-once versus exactly-once expectations, duplicate tolerance, ordering expectations, timeout/fail-open behavior, and downstream idempotency before release sign-off.
- Validate persistence, not only session continuity, by checking producer metrics/logs and downstream records before/during/after the failover window.
```

## Durable Outputs

- This investigation artifact: `output/reports/ivas-7167-kafka-producer-failover-investigation.md`
- Preferred Obsidian destination, if filesystem permissions allow later: `/Users/michael.yang/Documents/Obsidian Vault/repo/AIR/assistant-runtime/ivas-7167-kafka-producer-failover-investigation.md`
