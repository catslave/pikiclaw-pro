# IVA Project Query Scenarios

Use these six scenarios to validate whether `iva-logtracer` handles realistic IVA or Nova log-investigation requests across the main runtime paths, not just toy prompts.

Each scenario is grounded in the current IVA and AIR-on-Nova architecture shape:

- `assistant-runtime` owns session entry, turn orchestration, and realtime adaptation.
- `agent-service` owns tool planning and orchestration.
- `NCA` is the Nova runtime center for AIR-on-Nova flows.
- `AIG` and `GMG` sit on the tool and model execution side of Nova.
- `CPRC` services appear in speech-related traces through `cprc_srs` and `cprc_sgs`.
- Domain services such as `calendar-service` may sit downstream of IVA trace coverage and should be treated as a boundary case instead of silently over-claiming.

## Scenario 1: Voice Session Has Silence After Filler

- Architecture path:
  `TEL / voice client -> assistant-runtime -> cprc_srs / cprc_sgs -> agent-service`
- Example prompt:
  `trace 这个 sessionId s-voice-001，看 filler 结束后为什么用户还等了 6 秒才听到回复`
- Expected route:
  `trace --env production --save-json`, then default `report`
- Evidence focus:
  `Action Summary`, `Turn Summary Matrix`, and the `Filler End->Agent Audible` column
- What success looks like:
  the skill distinguishes real user-heard silence after filler from internal latency that was still masked by filler playback
- Skill fitness:
  `strong`

## Scenario 2: AIR-on-Nova Start-Conversation Or Config Bootstrap Looks Wrong

- Architecture path:
  `assistant-runtime -> NCA start-conversation -> agent-service /nova-assistant -> AIR config source`
- Example prompt:
  `这个 AIR-on-Nova sessionId s-nova-boot-002 为什么进了 Nova 之后拿到的 assistant 配置不对`
- Expected route:
  `trace --env production --save-json --loaders assistant_runtime nca agent_service`, then `report`
- Evidence focus:
  `start-conversation`, assistant configuration, correlation IDs, and coverage for the AIR-side config-provider path
- What success looks like:
  the skill can summarize whether the failure is likely before `NCA chat`, during config fetch, or in a missing-coverage zone
- Skill fitness:
  `strong`

## Scenario 3: KB Was Probably Called But The Final Answer Still Looks Wrong

- Architecture path:
  `assistant-runtime -> agent-service -> KB-backed tool path`
- Example prompt:
  `这个 conversationId c-kb-003 有没有调用知识库，最终答案是不是忽略了 KB 返回`
- Expected route:
  `trace --env production --save-json`, then `audit kb`
- Evidence focus:
  KB tool invocation, KB return shape, contradiction between retrieved evidence and final answer
- What success looks like:
  the skill reports whether KB was not called, called with a poor query, returned no useful result, or was called successfully but ignored during response synthesis
- Skill fitness:
  `strong`

## Scenario 4: Tool Call Looks Successful But The Spoken Or Final Answer Contradicts It

- Architecture path:
  `assistant-runtime -> agent-service -> AIG or generic tool execution`
- Example prompt:
  `比较这个 trace dir 里的工具调用和最终回复，看看是不是目录查到了人但机器人还说没找到`
- Expected route:
  `audit tools` against a saved trace directory, or `trace --save-json` first if only an ID is provided
- Evidence focus:
  tool lifecycle, observed components, completion state, contradiction findings
- What success looks like:
  the skill identifies cases such as `invoked_and_completed` plus a contradictory final answer, instead of flattening everything into a broad latency report
- Skill fitness:
  `strong`

## Scenario 5: Production Incident Report Has No Stable ID Yet

- Architecture path:
  unknown at first; resolve candidate sessions before tracing
- Example prompt:
  `production 今天 14:00 到 14:20 有用户投诉 IVA 不回复，先帮我定位最可疑的 session`
- Expected route:
  `discover`, then `trace --save-json`, then `report` for the chosen candidate
- Evidence focus:
  time-window narrowing, candidate session or conversation IDs, then normal trace artifacts
- What success looks like:
  the skill does not guess a session ID or jump straight to `report`; it uses discovery as the first stage and makes the handoff explicit
- Skill fitness:
  `strong`

## Scenario 6: Booking Failure Crosses Into Calendar-Service Ownership

- Architecture path:
  `assistant-runtime -> agent-service -> calendar-service`
- Example prompt:
  `这个 sessionId s-booking-006 预约失败了，帮我判断问题是在 IVA 工具调用之前，还是已经进入 calendar-service 之后`
- Expected route:
  `trace --env production --save-json`, then either `audit tools` or `report`
- Evidence focus:
  whether IVA reached a tool call, whether the tool completed, and whether the trace proves only the IVA-side boundary or the full downstream failure
- What success looks like:
  the skill cleanly separates `IVA-side confirmed`, `downstream likely`, and `needs Kibana or service-specific logs` instead of pretending it can prove calendar-service internals from IVA traces alone
- Skill fitness:
  `partial but correct`

## Validation Checklist

For these six scenarios, treat the skill as healthy only if it does all of the following:

- chooses `discover` for symptom-first incidents with no stable trace target
- chooses `report` for default diagnostic investigations after `trace --save-json`
- chooses `audit kb` for KB contradiction questions
- chooses `audit tools` for tool lifecycle or contradiction questions
- cites missing coverage when AIR-on-Nova, `GMG`, `AIG`, or downstream services are not directly proven by the trace
- stops at the IVA boundary when the request really needs generic logs from downstream services such as `calendar-service`
