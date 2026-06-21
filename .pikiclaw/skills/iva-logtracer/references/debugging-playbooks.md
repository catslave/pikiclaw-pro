# Debugging Playbooks

Use these playbooks when the user wants diagnosis, not just raw logs.

## Bot Not Responding

1. Run a full trace for the reported `sessionId` or `conversationId`.
2. Inspect `summary.json` to verify the trace covered expected services.
3. Search `combine.log` for `error`, `exception`, and `timeout`.
4. Inspect `nca_message.log` for upstream failures or request stalls.
5. Report the first concrete failure point, not every noisy symptom.

## LLM Response Issues

1. Limit loaders to `aig` and `gmg` if full-session context is unnecessary.
2. Confirm the `request_id` path from `nca` into `aig` and `gmg`.
3. Look for timeout, retry, error, or abnormal latency patterns.
4. Separate model execution failures from upstream orchestration problems.

## KB Wrong Answer

1. Run a full trace for the `conversationId` or `sessionId`.
2. Confirm the KB tool is present in assistant init metadata.
3. Run `iva-logtracer audit kb` against the saved trace directory.
4. Check whether:
   - the KB tool was actually invoked
   - the retrieval query matches the caller's question
   - KB returned a direct matching answer
   - the final AIR answer contradicts the KB result
5. If contradiction exists, report it as "tool used but response synthesis ignored or overrode KB evidence".

## Generic Tool Usage

1. Run a full trace for the `conversationId` or `sessionId` with `--save-json`.
2. Run `iva-logtracer turn` if you need the full turn timeline.
3. Run `iva-logtracer audit tools` against the saved trace directory.
4. Use the audit output as the normalized tool lifecycle view:
   - `tool_type`: `client`, `server`, or `unknown`
   - `observed_components`: which services logged the same logical tool call
   - `lifecycle`: `invoked_and_completed`, `invoked_no_completion`, `completion_only`, or `observed_without_phase`
5. Review any contradiction findings, especially:
   - successful tool result but answer says "I couldn't find" or "I don't have information"
   - failed transfer tool but answer still says the transfer is happening
   - empty directory result but answer claims the person was found
6. Only escalate to manual grepping when the audit still leaves ambiguity about missing phases or missing tool results.

## Speech Recognition Or Speech Generation Issues

1. Include `assistant_runtime`, `cprc_srs`, and `cprc_sgs` in the trace.
2. Confirm the session exposes `srs_session_id` or `sgs_session_id`.
3. Check CPRC logs for errors, low confidence, or missing downstream events.
4. Report whether the fault is missing input, recognition quality, or response generation.

## Turn-Level Questions

1. Confirm a saved trace directory exists.
2. Confirm the directory includes `*_trace.json`; if not, rerun the trace with `--save-json`.
3. Run `iva-logtracer turn` against that directory.
4. Use turn analysis only when chronology, latency, or event sequencing matters.
5. If turn output conflicts with `combine.log`, call that out explicitly instead of averaging the two.
