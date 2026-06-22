import AppKit
import Testing
@testable import PikiclawMac

@Test func friendlyAgentOutputHidesCodexCliDiagnostics() {
    let raw = """
    2026-06-20T13:53:31.303904Z WARN codex_core_plugins::manifest: ignoring interface.defaultPrompt[0]: prompt must be at most 128 characters path=/Users/michael.yang/.codex/.tmp/plugins/plugins/ngs-analysis/.codex-plugin/plugin.json
    2026-06-21T01:14:47.963532Z ERROR codex_core::session::session: failed to load skill /Users/michael.yang/Codes/Personal/pikiclaw/.pikiclaw/skills/jira/SKILL.md: missing YAML frontmatter delimited by ---
    plugin.json
    2026-06-20T13:53:31.328495Z WARN codex_core_skills::loader: ignoring interface.icon_small: icon path with '..' must resolve under plugin assets/
    hook: SessionStart
    Reading additional input from stdin...
    Reading prompt from stdin...
    [system] Marked stale because Pikiclaw restarted before this run reported completion.
    I am checking the repository first.
    [tool] exec_command
    [artifact] changed-files
    [completed with exit code 0]
    """

    #expect(friendlyAgentOutput(raw) == """
    Thinking: I am checking the repository first.
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

@Test func friendlyAgentOutputRendersCurrentCodexJsonItems() {
    let raw = """
    {"type":"thread.started","thread_id":"thread-2"}
    {"type":"turn.started"}
    {"type":"item.started","item":{"id":"item_0","type":"command_execution","command":"/bin/zsh -lc pwd","aggregated_output":"","exit_code":null,"status":"in_progress"}}
    {"type":"item.completed","item":{"id":"item_0","type":"command_execution","command":"/bin/zsh -lc pwd","aggregated_output":"/tmp/project\\n","exit_code":0,"status":"completed"}}
    {"type":"item.completed","item":{"id":"item_1","type":"agent_message","text":"当前目录是：`/tmp/project`。"}}
    {"type":"turn.completed","usage":{"input_tokens":10,"output_tokens":3}}
    """

    #expect(friendlyAgentOutput(raw) == """
    Tool: pwd
    Tool result: pwd
    Tool output: /tmp/project
    当前目录是：`/tmp/project`。
    """)
}

@Test func friendlyAgentOutputSummarizesLongCommandResults() {
    let raw = """
    {"type":"item.completed","item":{"id":"item_0","type":"command_execution","command":"swift test","aggregated_output":"one\\ntwo\\nthree\\nfour\\nfive\\n","exit_code":0,"status":"completed"}}
    """

    #expect(friendlyAgentOutput(raw) == """
    Tool result: swift test
    Tool output: [5 output lines]
    """)
}

@Test func friendlyAgentOutputRedactsSensitiveCommandResults() {
    let raw = """
    {"type":"item.completed","item":{"id":"item_0","type":"command_execution","command":"printenv RC_JIRA_READ_TOKEN","aggregated_output":"RC_JIRA_READ_TOKEN=secret-value\\n","exit_code":0,"status":"completed"}}
    """

    #expect(friendlyAgentOutput(raw) == """
    Tool result: printenv RC_JIRA_READ_TOKEN
    Tool output: [redacted sensitive output]
    """)
}

@Test func friendlyAgentOutputTreatsIntermediateCodexMessagesAsThinking() {
    let raw = """
    {"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"我先确认 workspace。"}}
    {"type":"item.started","item":{"id":"item_1","type":"command_execution","command":"git status --short","aggregated_output":"","exit_code":null,"status":"in_progress"}}
    {"type":"item.completed","item":{"id":"item_1","type":"command_execution","command":"git status --short","aggregated_output":" M RootView.swift\\n","exit_code":0,"status":"completed"}}
    {"type":"item.completed","item":{"id":"item_2","type":"agent_message","text":"已经改好了。\\nJira 会使用当前选中的 workspace 启动。"}}
    {"type":"turn.completed","usage":{"input_tokens":10,"output_tokens":3}}
    """

    #expect(friendlyAgentOutput(raw) == """
    Thinking: 我先确认 workspace。
    Tool: git status --short
    Tool result: git status --short
    Tool output: M RootView.swift
    已经改好了。
    Jira 会使用当前选中的 workspace 启动。
    """)
}

@Test func agentResponsePresentationKeepsToolOutputOutOfFinalResponse() {
    let output = """
    Thinking: I need to inspect the repo.
    Tool: git status --short
    Tool result: git status --short
    Tool output: [30 output lines]
    Tool result: sed -n '1,80p' README.md
    Tool output: /Users/michael.yang/Codes/Personal/pikiclaw/README.md
    已经处理好了：Jira ticket 会使用你选中的 workspace 启动。
    """

    let preview = agentResponsePresentationPreview(text: output)

    #expect(preview.finalText == "已经处理好了：Jira ticket 会使用你选中的 workspace 启动。")
    #expect(preview.generativeItems == [
        AgentResponsePresentationPreviewItem(title: "Tool", detail: "git status --short"),
        AgentResponsePresentationPreviewItem(title: "Tool result", detail: "git status --short"),
        AgentResponsePresentationPreviewItem(title: "Tool result", detail: "sed -n '1,80p' README.md")
    ])
}

@Test func agentResponsePresentationSeparatesThinkingFromToolCalls() {
    let output = """
    Thinking: 我先确认 workspace。
    Tool: git status --short
    Tool result: git status --short
    Tool output: [7 output lines]
    Thinking: 接下来只改展示层。
    File: apps/macos/Sources/PikiclawMac/RootView.swift
    Done.
    """

    let preview = agentResponsePresentationPreview(text: output)

    #expect(preview.finalText == "Done.")
    #expect(preview.thinkingItems == [
        AgentResponsePresentationPreviewItem(title: "Thinking", detail: "我先确认 workspace。"),
        AgentResponsePresentationPreviewItem(title: "Thinking", detail: "接下来只改展示层。")
    ])
    #expect(preview.toolItems == [
        AgentResponsePresentationPreviewItem(title: "Running tool", detail: "git status --short"),
        AgentResponsePresentationPreviewItem(title: "Ran a command", detail: "git status --short"),
        AgentResponsePresentationPreviewItem(title: "Tool output", detail: "[7 output lines]"),
        AgentResponsePresentationPreviewItem(title: "Edited a file", detail: "apps/macos/Sources/PikiclawMac/RootView.swift")
    ])
    #expect(preview.toolSummary == "1 call · 1 completed · 1 output · 1 file")
}

@Test func agentResponsePresentationHidesActivityAfterCompletion() {
    let output = """
    Thinking: 我先确认 workspace。
    Tool: git status --short
    Tool result: git status --short
    Tool output: [7 output lines]
    Done.
    """

    let preview = agentResponsePresentationPreview(text: output, state: .completed, isRunning: false)

    #expect(preview.finalText == "Done.")
    #expect(preview.showsFinalResponse)
    #expect(preview.thinkingItems.count == 1)
    #expect(preview.toolItems.count == 3)
    #expect(preview.visibleThinkingItems.isEmpty)
    #expect(preview.showsThinkingTimeline == false)
}

@Test func agentResponsePresentationHidesToolCallsInsideRunningThinking() {
    let output = """
    Thinking: 我先确认 workspace。
    Tool: git status --short
    Tool result: git status --short
    Tool output: [7 output lines]
    """

    let preview = agentResponsePresentationPreview(text: output, state: .running, isRunning: true)

    #expect(preview.visibleThinkingItems == [
        AgentResponsePresentationPreviewItem(title: "Thinking", detail: "我先确认 workspace。")
    ])
    #expect(preview.toolItems.count == 3)
    #expect(preview.showsThinkingTimeline)
    #expect(preview.startsThinkingTimelineExpanded)
    #expect(preview.activitySummary == "1 thinking")
    #expect(preview.toolSummary == "1 call · 1 completed · 1 output")
}

@Test func agentResponsePresentationShowsRunningReadableTextInsideThinking() {
    let output = """
    我正在确认这次改动是否只限制在当前工程。
    """

    let preview = agentResponsePresentationPreview(text: output, state: .running, isRunning: true)

    #expect(preview.finalText == "")
    #expect(preview.showsFinalResponse == false)
    #expect(preview.visibleThinkingItems == [
        AgentResponsePresentationPreviewItem(
            title: "Thinking",
            detail: "我正在确认这次改动是否只限制在当前工程。"
        )
    ])
    #expect(preview.showsThinkingTimeline)
    #expect(preview.startsThinkingTimelineExpanded)
}

@Test func agentResponsePresentationKeepsCompletedReadableTextOutOfThinking() {
    let output = """
    改动范围只在当前工程。
    """

    let preview = agentResponsePresentationPreview(text: output, state: .completed, isRunning: false)

    #expect(preview.finalText == "改动范围只在当前工程。")
    #expect(preview.showsFinalResponse)
    #expect(preview.visibleThinkingItems.isEmpty)
    #expect(preview.showsThinkingTimeline == false)
    #expect(preview.startsThinkingTimelineExpanded == false)
}

@Test func agentRunDurationTextFormatsMessageDuration() {
    let start = Date(timeIntervalSince1970: 100)

    #expect(agentRunDurationText(startedAt: start, endedAt: Date(timeIntervalSince1970: 105)) == "5s")
    #expect(agentRunDurationText(startedAt: start, endedAt: Date(timeIntervalSince1970: 943)) == "14m 3s")
    #expect(agentRunDurationText(startedAt: start, endedAt: Date(timeIntervalSince1970: 7_660)) == "2h 6m")
}

@Test func agentResponsePresentationPromotesKnowledgeAndConfirmationToGenerativeItems() {
    let output = """
    Saved reusable memory from this generated UI run.
    Knowledge note: /Users/michael.yang/Documents/Obsidian Vault/repo/Personal/pikiclaw/generated-ui-save.md
    Should I save this evidence to Obsidian?
    """

    let preview = agentResponsePresentationPreview(text: output)

    #expect(preview.finalText == "Saved reusable memory from this generated UI run.")
    #expect(preview.generativeItems == [
        AgentResponsePresentationPreviewItem(
            title: "Knowledge note",
            detail: "/Users/michael.yang/Documents/Obsidian Vault/repo/Personal/pikiclaw/generated-ui-save.md"
        ),
        AgentResponsePresentationPreviewItem(
            title: "Confirmation",
            detail: "Save or Not now"
        )
    ])
}

@Test func agentResponsePresentationPromotesKnowledgeCompareToGenerativeItems() {
    let output = """
    Knowledge note: /Users/michael.yang/Documents/Obsidian Vault/repo/Personal/pikiclaw/generated-ui-save.md
    Tool result: swift test --filter ChatMessageHistoryTests
    New run evidence confirms the generated UI save pattern.
    """

    let preview = agentResponsePresentationPreview(text: output)

    #expect(preview.finalText == "New run evidence confirms the generated UI save pattern.")
    #expect(preview.generativeItems == [
        AgentResponsePresentationPreviewItem(
            title: "Knowledge note",
            detail: "/Users/michael.yang/Documents/Obsidian Vault/repo/Personal/pikiclaw/generated-ui-save.md"
        ),
        AgentResponsePresentationPreviewItem(
            title: "Tool result",
            detail: "swift test --filter ChatMessageHistoryTests"
        ),
        AgentResponsePresentationPreviewItem(
            title: "Knowledge compare",
            detail: "1 note / 1 evidence"
        )
    ])
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

@Test func nativeMarkdownReviewAttributedStringRendersCommonMarkdown() {
    let markdown = """
    # Plan
    - **Run** `swift test`
    ```bash
    swift build --product PikiclawMac
    ```
    """

    let rendered = nativeMarkdownReviewAttributedString(markdown)

    #expect(rendered.string == "Plan\n• Run swift test\nswift build --product PikiclawMac")
    #expect(!rendered.string.contains("```"))
    #expect(!rendered.string.contains("**"))
}

@Test func chatOutputReviewPromptCombinesMultipleInlineComments() {
    let prompt = chatOutputReviewPrompt(
        outputTitle: "Kafka fallback plan",
        comments: [
            ChatOutputReviewComment(quote: "Use cnlab01-west as fallback.", note: "Please add why lab03 stays empty."),
            ChatOutputReviewComment(quote: "nc -vz kafka 31100\n# succeeded", note: "Move this into a validation section.")
        ]
    )

    #expect(prompt.contains("Kafka fallback plan"))
    #expect(prompt.contains("1. Selected output:"))
    #expect(prompt.contains("> Use cnlab01-west as fallback."))
    #expect(prompt.contains("Please add why lab03 stays empty."))
    #expect(prompt.contains("2. Selected output:"))
    #expect(prompt.contains("> nc -vz kafka 31100\n> # succeeded"))
    #expect(prompt.contains("Move this into a validation section."))
}
