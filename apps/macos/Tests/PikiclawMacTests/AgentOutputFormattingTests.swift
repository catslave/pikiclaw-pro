import Testing
@testable import PikiclawMac

@Test func friendlyAgentOutputHidesCodexCliDiagnostics() {
    let raw = """
    2026-06-20T13:53:31.303904Z WARN codex_core_plugins::manifest: ignoring interface.defaultPrompt[0]: prompt must be at most 128 characters path=/Users/michael.yang/.codex/.tmp/plugins/plugins/ngs-analysis/.codex-plugin/plugin.json
    plugin.json
    2026-06-20T13:53:31.328495Z WARN codex_core_skills::loader: ignoring interface.icon_small: icon path with '..' must resolve under plugin assets/
    hook: SessionStart
    Reading additional input from stdin...
    Reading prompt from stdin...
    I am checking the repository first.
    [tool] exec_command
    [artifact] changed-files
    [completed with exit code 0]
    """

    #expect(friendlyAgentOutput(raw) == """
    I am checking the repository first.
    Tool: exec_command
    Artifact: changed-files
    """)
}

@Test func friendlyAgentOutputRendersCodexJsonEventsAsAgentActivity() {
    let raw = """
    {"type":"thread.started","thread_id":"thread-1"}
    {"type":"response_item","payload":{"type":"reasoning","summary":[{"type":"summary_text","text":"Need inspect the files."}]}}
    {"type":"response_item","payload":{"type":"function_call","name":"exec_command","call_id":"call-1","arguments":"{\\"cmd\\":\\"rg -n runDetail\\"}"}}
    {"type":"response_item","payload":{"type":"function_call_output","call_id":"call-1","output":"RootView.swift:4156"}}
    {"type":"response_item","payload":{"type":"fileChange","path":"/tmp/project/RootView.swift"}}
    {"type":"response_item","payload":{"type":"message","role":"assistant","phase":"final_answer","content":[{"type":"output_text","text":"Done."}]}}
    {"type":"turn.completed","status":"completed"}
    """

    #expect(friendlyAgentOutput(raw) == """
    Thinking: Need inspect the files.
    Tool: exec_command
    Tool result: exec_command
    File: RootView.swift
    Done.
    """)
}

@Test func agentOutputReviewSignalSummaryCountsDecisionAndActionableNotes() {
    let output = """
    Decision: not ready to merge until focused validation is captured.
    Blockers:
    - waiting for Jira write permission.
    Risk: full app smoke has not run.
    Open question: whether voice flow needs a manual smoke pass.
    Next action: run the focused validation and paste the result into Jira.
    Validation: swift test --filter AgentOutputFormattingTests passed
    Changed file: apps/macos/Sources/PikiclawMac/RootView.swift:8772
    """

    let summary = agentOutputReviewSignalSummary(output)

    #expect(summary.decisionSignalCount == 1)
    #expect(summary.actionableNoteCount == 4)
    #expect(summary.validationSignalCount == 1)
    #expect(summary.codeReferenceCount == 1)
    #expect(summary.hasDecisionOrAction)
}
