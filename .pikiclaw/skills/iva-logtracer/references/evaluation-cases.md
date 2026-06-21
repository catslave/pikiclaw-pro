# Evaluation Cases

Use these cases to validate both trigger boundaries and task-success behavior after editing the skill.

## Should Trigger

### 1. Session trace for silence after filler

- Prompt: `trace 这个 sessionId s-abc123，看 filler 结束后为什么有 silence`
- Expected route: `trace --save-json` then `report` by default
- Must not do: jump straight to generic Kibana search

### 2. Saved trace directory, turn sequencing question

- Prompt: `分析这个 saved trace dir，告诉我哪个 turn 最慢，filler 到 agent 的空白有多长`
- Expected route: `turn`
- Must not do: rerun `trace` if the directory is valid

### 3. KB contradiction check

- Prompt: `这个 conversationId 的 KB 有没有被调用，最终答案有没有和 KB 结果矛盾`
- Expected route: `trace --save-json` then `audit kb`
- Must not do: answer only from a generic report without the KB audit

### 4. Generic tool audit across traces

- Prompt: `比较这两个 trace dir 的 tool usage，有没有调用成功但回复说没找到`
- Expected route: `audit tools`
- Must not do: collapse into a single-trace report

### 5. Broad production symptom with no stable ID

- Prompt: `production 昨天下午用户说机器人没响应，先帮我定位可疑 session`
- Expected route: `discover`, then `trace` for the chosen candidate
- Must not do: guess a session ID, run `doctor` as a default preflight, or jump directly to `report`

## Should Not Trigger

### 6. Generic Kibana search

- Prompt: `帮我在 Kibana 里搜 assistant_runtime 的 timeout`
- Expected route: do not use this skill; route to `kibana`

### 7. Architecture explanation

- Prompt: `解释一下 NCA、AIG、GMG 的调用链路`
- Expected route: do not use this skill unless the request is tied to a concrete trace investigation

### 8. Postmortem writing

- Prompt: `帮我写一份这次 IVA 故障的事故复盘`
- Expected route: do not use this skill unless the user first needs trace evidence gathered

## Ambiguous Cases

### 9. Single symptom plus likely session

- Prompt: `这个 s-abc123 可能有 tool 问题，帮我看看是不是工具调用没完成`
- Expected route: `trace --save-json`, then either `audit tools` or `report`
- Pass condition: the skill states why it chose the narrower audit or the broader report

### 10. Saved trace directory but missing JSON artifacts

- Prompt: `用这个 trace dir 做 turn 分析`
- Expected route: validate for `*_trace.json`, then either continue with `turn` or explicitly say the trace is incomplete and should be rerun with `--save-json`
- Pass condition: the skill does not guess or silently continue with missing artifacts

### 11. Normal trace should not start with doctor

- Prompt: `trace 这个 sessionId s-abc123，看 agent 为什么没回复`
- Expected route: `trace --save-json` then `report` by default
- Must not do: run `doctor` first unless the request also questions env setup, credentials, or component index availability

## High-Risk Additions

### 12. Broad symptom but explicit tool suspicion

- Prompt: `production 15:10 到 15:25 有用户投诉“查联系人一直没结果”，先帮我定位可疑 session，再判断是不是工具调用根本没完成`
- Expected route: `discover`, then `trace`, then `audit tools`
- Must not do: flatten into the default `report` path and lose the tool-audit intent

### 13. Broad symptom but explicit KB suspicion

- Prompt: `production 今天下午有用户说机器人回答“没找到知识”，先定位 session，再判断是不是 KB 调到了但答案没采用`
- Expected route: `discover`, then `trace`, then `audit kb`
- Must not do: treat discovery as a reason to drop the KB-audit intent

### 14. Stable ID with KB-flavored tool lifecycle question

- Prompt: `这个 conversationId c-mixed-015 帮我看知识库工具调用是不是成功了，如果成功为什么最终回复还是说没找到人`
- Expected route: `trace --save-json`, then `audit tools`
- Must not do: downgrade to `audit kb` just because the underlying data sounds like directory or people lookup content

### 15. Saved trace directory, tool audit requested but JSON missing

- Prompt: `用这个 saved trace dir 审查工具调用状态，看看是不是 tool 已经返回成功但最终回复没采用`
- Expected route: validate `*_trace.json` first, then either continue with `audit tools` or explicitly stop with an incomplete-trace message
- Must not do: guess tool lifecycle from partial artifacts

### 16. Saved trace directory, KB audit requested but JSON missing

- Prompt: `用这个 saved trace dir 看看知识库是不是调到了但最终回答没采用`
- Expected route: validate `*_trace.json` first, then either continue with `audit kb` or explicitly stop with an incomplete-trace message
- Must not do: infer KB contradiction from partial artifacts

## Pass Criteria

- All five should-trigger prompts route to the expected command family.
- All three should-not-trigger prompts stay out of `iva-logtracer`.
- Ambiguous cases explicitly explain the chosen path.
- Any request for `turn`, `report`, or `audit tools` checks for `*_trace.json` first.
- Any request with only a broad symptom and no stable trace target starts with `discover`.
- Normal `discover` or `trace` cases do not insert `doctor` unless the prompt explicitly questions environment, credentials, or index availability.
- Broad symptom cases with explicit KB or tool suspicion preserve that narrower audit intent after discovery.
- Explicit tool-lifecycle questions win over KB wording when both signals appear in the same trace request.
- Saved-trace KB or tool audits stop on missing artifacts instead of guessing from partial output.
