import Foundation
import Testing
@testable import PikiclawRunner

@Test func codexRPCIdleTimeoutUsesVisibleProgressWindow() {
    #expect(CodexRPCAgentConnection.turnEventIdleTimeout == 4 * 60)
}

@Test func codexRPCThreadOpenTimeoutAllowsSlowResumeBeforeFallback() {
    #expect(CodexRPCAgentConnection.threadOpenTimeout == 90)
}

@Test func codexRPCFailureMessageHidesEmptyDiagnostics() {
    #expect(CodexRPCAgentConnection.failureMessage(
        "RPC call 'thread/resume' timed out.",
        diagnostic: "\n  \n"
    ) == "RPC call 'thread/resume' timed out.")
}

@Test func codexRPCFailureMessageTrimsDiagnostics() {
    #expect(CodexRPCAgentConnection.failureMessage(
        "Failed to start Codex app-server.",
        diagnostic: "\n  first line  \n\n second line\n"
    ) == "Failed to start Codex app-server.\nCodex app-server diagnostics:\nfirst line\nsecond line")
}

@Test func codexRPCAgentMessageTextReadsContentArray() {
    let item: [String: Any] = [
        "type": "agentMessage",
        "content": [
            ["type": "output_text", "text": "First line."],
            ["type": "output_text", "text": "Second line."]
        ]
    ]

    #expect(CodexRPCAgentConnection.agentMessageText(from: item) == "First line.\nSecond line.")
}

@Test func codexRPCReasoningTextReadsSummaryObjects() {
    let item: [String: Any] = [
        "type": "reasoning",
        "summary": [
            ["type": "summary_text", "text": "Check the diff first."],
            "Then verify runtime behavior."
        ]
    ]

    #expect(CodexRPCAgentConnection.reasoningText(from: item) == "Check the diff first.\nThen verify runtime behavior.")
}

@Test func codexRPCNormalizesCurrentCodexItemTypes() {
    let messageItem: [String: Any] = ["type": "agent_message"]
    let commandItem: [String: Any] = [
        "type": "command_execution",
        "command": "git status --short"
    ]

    #expect(CodexRPCAgentConnection.normalizedItemType(messageItem) == "agentMessage")
    #expect(CodexRPCAgentConnection.normalizedItemType(commandItem) == "commandExecution")
    #expect(CodexRPCAgentConnection.commandExecutionLabel(from: commandItem) == "git status --short")
}

@Test func codexRPCThinkingOutputLabelsOnlyNonEmptyLines() {
    let text = "\nI am reading the changed files.\n\nThinking: Already labeled.\n"

    #expect(CodexRPCAgentConnection.thinkingOutput(text) == "\nThinking: I am reading the changed files.\n\nThinking: Already labeled.\n")
}

@Test func codexRPCThreadStartedOutputIsValidJSON() throws {
    let output = CodexRPCAgentConnection.threadStartedOutput(threadId: "019ef809-706b-7573-95eb-ca9eb68583ef")
    let trimmed = output.trimmingCharacters(in: .whitespacesAndNewlines)
    let data = try #require(trimmed.data(using: .utf8))
    let object = try #require(JSONSerialization.jsonObject(with: data) as? [String: Any])

    #expect(object["type"] as? String == "thread.started")
    #expect(object["thread_id"] as? String == "019ef809-706b-7573-95eb-ca9eb68583ef")
}

@Test func codexRPCSanitizesQuotedThreadIdsFromPreviousBuilds() {
    #expect(CodexRPCAgentConnection.sanitizedThreadId(#""019ef809-706b-7573-95eb-ca9eb68583ef""#) == "019ef809-706b-7573-95eb-ca9eb68583ef")
    #expect(CodexRPCAgentConnection.sanitizedThreadId(#""\"019ef809-706b-7573-95eb-ca9eb68583ef\"""#) == "019ef809-706b-7573-95eb-ca9eb68583ef")
    #expect(CodexRPCAgentConnection.sanitizedThreadId(" 019ef809-706b-7573-95eb-ca9eb68583ef ") == "019ef809-706b-7573-95eb-ca9eb68583ef")
    #expect(CodexRPCAgentConnection.sanitizedThreadId("   ") == nil)
}
