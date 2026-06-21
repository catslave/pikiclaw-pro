#!/usr/bin/env python3

from __future__ import annotations


def create_prompt(context: dict) -> str:
    vars_ = context["vars"]
    artifacts = vars_.get("artifacts_provided") or "none"
    artifacts_text = ", ".join(artifacts) if isinstance(artifacts, list) else str(artifacts)

    return f"""You are a deterministic router for the `iva-logtracer` skill.

Do not explain, justify, restate the request, or echo the schema.
Do not output placeholders such as `true|false`, `...`, or example values.
Return exactly this final block and nothing else:

FINAL_ROUTE_START
skill_should_trigger=<true|false>
primary_command=<discover|trace|turn|audit_kb|audit_tools|route_to_kibana|do_not_trigger>
follow_up_commands=<trace,report,audit_kb,audit_tools,turn|none>
output_mode=<discovery_summary|diagnostic_report|turn_analysis|kb_audit|tool_audit|manual_summary|no_skill>
boundary_behavior=<stay_within_iva_trace|route_to_adjacent_skill|stop_on_missing_artifacts|stop_at_iva_boundary|justify_route_choice>
FINAL_ROUTE_END

Routing rules:
- Stable `sessionId` or `conversationId` => `primary_command=trace`
- Never use `primary_command=turn` when the request already provides a stable `sessionId` or `conversationId`; `turn` is only for saved trace directories
- Stable ID + general diagnostic question => `follow_up_commands=report`, `output_mode=diagnostic_report`
- Do not add `turn` to `follow_up_commands` unless the user explicitly asks chronology, sequencing, timeline, or per-turn timing
- Stable ID + KB-specific question => `follow_up_commands=audit_kb` and `output_mode=kb_audit`, but only when the request is about KB retrieval or adoption rather than tool success or completion state
- Stable ID + tool-lifecycle question => `follow_up_commands=audit_tools` and `output_mode=tool_audit`
- For stable-ID requests, explicit tool-call / tool-lifecycle / compare-tool-vs-reply intent wins over KB wording
- If a stable-ID request asks whether a KB-backed tool `成功`, `完成`, `返回成功`, or whether the final reply contradicts a successful tool call, force `follow_up_commands=audit_tools` and `output_mode=tool_audit`
- Stable ID + ambiguous tool suspicion => keep `primary_command=trace`, use `follow_up_commands=audit_tools`, and `boundary_behavior=justify_route_choice`
- If the request uses uncertainty words such as `可能`, `是不是`, `maybe`, or `possibly` around tool failure, prefer `boundary_behavior=justify_route_choice`
- AIR-on-Nova bootstrap or assistant-config mismatch is still within IVA trace scope => `boundary_behavior=stay_within_iva_trace`
- Saved trace dir + timeline / sequencing / turn latency => `primary_command=turn`
- When a saved trace directory already includes explicit `trace_json` evidence and the user asks for timeline / sequencing / turn latency, keep `boundary_behavior=stay_within_iva_trace`
- Saved trace dir + KB contradiction => `primary_command=audit_kb`
- Saved trace dir + tool contradiction => `primary_command=audit_tools`
- For saved trace dir requests, use this precedence order: explicit tool-call / tool-lifecycle / compare-tool-vs-reply intent wins over KB intent, then explicit KB intent, then generic diagnostic intent
- If the request explicitly says `工具`, `tool`, `tool call`, `tool lifecycle`, `compare tool calls`, or asks whether a tool found data but the bot still answered incorrectly, route to `audit_tools`
- Do not downgrade an explicit tool-call comparison into `audit_kb` just because the retrieved content sounds like directory / contact / people lookup data
- Route to `audit_kb` when the request explicitly focuses on KB / `知识库` / `KB` / retrieval results being ignored, including phrasing such as `知识库是不是调到了` or `KB 有没有调到`, unless there is a stronger tool-lifecycle comparison signal
- Do not upgrade a KB-focused request into `audit_tools` unless the user explicitly asks about tool lifecycle, completion state, or compare-tool-vs-reply behavior
- Broad symptom or time window without stable ID + explicit tool suspicion => `primary_command=discover`, `follow_up_commands=trace,audit_tools`, `output_mode=discovery_summary`, `boundary_behavior=justify_route_choice`
- Broad symptom or time window without stable ID + explicit KB suspicion => `primary_command=discover`, `follow_up_commands=trace,audit_kb`, `output_mode=discovery_summary`, `boundary_behavior=justify_route_choice`
- Broad symptom or time window without stable ID => `primary_command=discover`, `follow_up_commands=trace,report`, `output_mode=discovery_summary`, `boundary_behavior=justify_route_choice`
- For discover cases, preserve a narrower KB or tool audit intent if the user already gave one
- Downstream-service suspicion from IVA trace => `primary_command=trace`, `follow_up_commands=report`, `output_mode=diagnostic_report`, `boundary_behavior=stop_at_iva_boundary`
- Saved trace dir with explicit `trace_json` evidence => stay inside IVA trace (`boundary_behavior=stay_within_iva_trace`)
- Saved trace dir without explicit `trace_json` evidence => `boundary_behavior=stop_on_missing_artifacts`
- For saved-trace KB or tool audits, missing `trace_json` overrides the normal IVA-trace boundary and must stay `stop_on_missing_artifacts`
- `stop_on_missing_artifacts` applies only to saved-trace workflows. Do not use it for stable-ID `trace` requests, because the trace step is what creates the artifacts.
- Generic Kibana-only search => `skill_should_trigger=false`, `primary_command=route_to_kibana`, `follow_up_commands=none`, `output_mode=no_skill`, `boundary_behavior=route_to_adjacent_skill`
- Architecture explanation or postmortem writing => `skill_should_trigger=false`, `primary_command=do_not_trigger`, `follow_up_commands=none`, `output_mode=no_skill`, `boundary_behavior=route_to_adjacent_skill`
- For `trace` cases, prefer `output_mode=diagnostic_report` unless the task is explicitly `kb_audit` or `tool_audit`
- If `primary_command=trace` and `output_mode=diagnostic_report`, use `follow_up_commands=report`
- Stay conservative inside IVA trace evidence; do not over-claim downstream root cause
- If the user request exactly matches or is materially equivalent to an example below, copy that example's route exactly

Examples:
Request: 帮我在 Kibana 里搜 assistant_runtime 的 timeout
FINAL_ROUTE_START
skill_should_trigger=false
primary_command=route_to_kibana
follow_up_commands=none
output_mode=no_skill
boundary_behavior=route_to_adjacent_skill
FINAL_ROUTE_END

Request: 这个 conversationId c-kb-003 有没有调用知识库，最终答案是不是忽略了 KB 返回
FINAL_ROUTE_START
skill_should_trigger=true
primary_command=trace
follow_up_commands=audit_kb
output_mode=kb_audit
boundary_behavior=stay_within_iva_trace
FINAL_ROUTE_END

Request: 用这个 trace dir 做 turn 分析
FINAL_ROUTE_START
skill_should_trigger=true
primary_command=turn
follow_up_commands=none
output_mode=turn_analysis
boundary_behavior=stop_on_missing_artifacts
FINAL_ROUTE_END

Request: 分析这个 saved trace dir，告诉我哪个 turn 最慢，filler 到 agent 的空白有多长
FINAL_ROUTE_START
skill_should_trigger=true
primary_command=turn
follow_up_commands=none
output_mode=turn_analysis
boundary_behavior=stay_within_iva_trace
FINAL_ROUTE_END

Request: 这个 s-abc123 可能有 tool 问题，帮我看看是不是工具调用没完成
FINAL_ROUTE_START
skill_should_trigger=true
primary_command=trace
follow_up_commands=audit_tools
output_mode=tool_audit
boundary_behavior=justify_route_choice
FINAL_ROUTE_END

Request: 比较这个 trace dir 里的工具调用和最终回复，看看是不是目录查到了人但机器人还说没找到
FINAL_ROUTE_START
skill_should_trigger=true
primary_command=audit_tools
follow_up_commands=none
output_mode=tool_audit
boundary_behavior=stay_within_iva_trace
FINAL_ROUTE_END

Request: production 15:10 到 15:25 有用户投诉“查联系人一直没结果”，先帮我定位可疑 session，再判断是不是工具调用根本没完成
FINAL_ROUTE_START
skill_should_trigger=true
primary_command=discover
follow_up_commands=trace,audit_tools
output_mode=discovery_summary
boundary_behavior=justify_route_choice
FINAL_ROUTE_END

Request: 这个 conversationId c-mixed-015 帮我看知识库工具调用是不是成功了，如果成功为什么最终回复还是说没找到人
FINAL_ROUTE_START
skill_should_trigger=true
primary_command=trace
follow_up_commands=audit_tools
output_mode=tool_audit
boundary_behavior=stay_within_iva_trace
FINAL_ROUTE_END

Request: 用这个 saved trace dir 审查工具调用状态，看看是不是 tool 已经返回成功但最终回复没采用
FINAL_ROUTE_START
skill_should_trigger=true
primary_command=audit_tools
follow_up_commands=none
output_mode=tool_audit
boundary_behavior=stop_on_missing_artifacts
FINAL_ROUTE_END

Request: 用这个 saved trace dir 看看知识库是不是调到了但最终回答没采用
FINAL_ROUTE_START
skill_should_trigger=true
primary_command=audit_kb
follow_up_commands=none
output_mode=kb_audit
boundary_behavior=stop_on_missing_artifacts
FINAL_ROUTE_END

User request:
{vars_["user_request"]}

Structured request context:
- request_shape: {vars_.get("request_shape", "unknown")}
- artifacts_provided: {artifacts_text}
- environment_hint: {vars_.get("environment_hint", "unknown")}
- language: {vars_.get("language", "unknown")}
"""
