import Testing
@testable import PikiclawCore

@Test func voicePlannerBuildsDelegatedAgentPrompt() {
    let workspace = Workspace(
        id: "workspace",
        name: "Pikiclaw",
        pathDisplay: "/repo/pikiclaw",
        trustState: .trusted
    )

    let plan = VoiceAssistantPlanner.makePlan(
        utterance: "Fix the mac native voice assistant and run tests",
        workspace: workspace,
        preferredAgent: .codex
    )

    #expect(plan.title == "Fix the mac native voice assistant and run tests")
    #expect(plan.suggestedAgentKind == .codex)
    #expect(plan.permissionMode == .askBeforeEdit)
    #expect(plan.intent == .delegate)
    #expect(plan.needsConfirmation == false)
    #expect(plan.routeSummary.contains("Codex"))
    #expect(plan.contextRefs.contains { $0.kind == "workspace" && $0.label == "Pikiclaw" })
    #expect(plan.agentPrompt.contains("You are Pikiclaw Voice Assistant Agent"))
    #expect(plan.agentPrompt.contains("Own the user's spoken or typed request end-to-end."))
    #expect(plan.agentPrompt.contains("Use Pikiclaw's existing capabilities"))
    #expect(plan.agentPrompt.contains("specialist agents such as Codex"))
    #expect(plan.agentPrompt.contains("Voice Assistant request"))
    #expect(plan.agentPrompt.contains("Intent: delegate"))
    #expect(plan.agentPrompt.contains("Acceptance criteria"))
    #expect(plan.acceptanceCriteria.contains("Run the narrowest relevant verification available"))
}

@Test func voicePlannerRoutesChineseCodeTasksToCodex() {
    let plan = VoiceAssistantPlanner.makePlan(
        utterance: "帮我重新设计这个 mac native voice assistant 的界面并跑测试",
        workspace: Workspace(
            id: "workspace",
            name: "Pikiclaw",
            pathDisplay: "/repo/pikiclaw",
            trustState: .trusted
        ),
        preferredAgent: .hermes
    )

    #expect(plan.intent == .delegate)
    #expect(plan.suggestedAgentKind == .codex)
    #expect(plan.needsConfirmation == false)
    #expect(plan.acceptanceCriteria.contains("Run the narrowest relevant verification available"))
    #expect(plan.acceptanceCriteria.contains("Check the primary UI path for layout, contrast, and text overflow"))
}

@Test func voicePlannerDelegatesChineseCommitRequestsToCodex() {
    let plan = VoiceAssistantPlanner.makePlan(
        utterance: "本地代码提交",
        workspace: Workspace(
            id: "workspace",
            name: "Pikiclaw",
            pathDisplay: "/repo/pikiclaw",
            trustState: .trusted
        ),
        preferredAgent: .hermes
    )

    #expect(plan.intent == .delegate)
    #expect(plan.suggestedAgentKind == .codex)
    #expect(plan.needsConfirmation == false)
    #expect(plan.acceptanceCriteria.contains("Ask before committing, pushing, or writing to external systems"))
}

@Test func voicePlannerTreatsChineseProductRequestsAsDelegation() {
    let plan = VoiceAssistantPlanner.makePlan(
        utterance: "我想重新设计一下 mac native voice assistant，让它自然对话",
        workspace: Workspace(
            id: "workspace",
            name: "Pikiclaw",
            pathDisplay: "/repo/pikiclaw",
            trustState: .trusted
        ),
        preferredAgent: .codex
    )

    #expect(plan.intent == .delegate)
    #expect(plan.needsConfirmation == false)
    #expect(plan.acceptanceCriteria.contains("Check the primary UI path for layout, contrast, and text overflow"))
}

@Test func voicePlannerDelegatesVoiceConfigurationComplaints() {
    let plan = VoiceAssistantPlanner.makePlan(
        utterance: "还有其他语音可以选择吗，因为我觉得你目前的声音很不自然",
        workspace: Workspace(
            id: "workspace",
            name: "Pikiclaw",
            pathDisplay: "/repo/pikiclaw",
            trustState: .trusted
        ),
        preferredAgent: .codex
    )

    #expect(plan.intent == .delegate)
    #expect(plan.suggestedAgentKind == .codex)
    #expect(plan.needsConfirmation == false)
    #expect(plan.agentPrompt.contains("声音很不自然"))
}

@Test func voicePlannerKeepsStatusAsConversationalIntent() {
    let plan = VoiceAssistantPlanner.makePlan(
        utterance: "现在进度怎么样了",
        workspace: nil,
        preferredAgent: .codex
    )

    #expect(plan.intent == .status)
    #expect(plan.needsConfirmation == true)
    #expect(plan.spokenPreview.contains("current run status"))
}

@Test func voicePlannerTreatsActiveWorkQuestionsAsStatusIntent() {
    let plan = VoiceAssistantPlanner.makePlan(
        utterance: "当前还在工作的任务",
        workspace: nil,
        preferredAgent: .codex
    )

    #expect(plan.intent == .status)
    #expect(plan.needsConfirmation == true)
}

@Test func voicePlannerKeepsCapabilityQuestionsConversational() {
    let plan = VoiceAssistantPlanner.makePlan(
        utterance: "你可以做什么",
        workspace: nil,
        preferredAgent: .codex
    )

    #expect(plan.intent == .converse)
    #expect(plan.needsConfirmation == true)
}

@Test func voicePlannerDelegatesActionableStateManagementRequests() {
    let plan = VoiceAssistantPlanner.makePlan(
        utterance: "帮我检查 voice 状态切换，从 listening 到 thinking 再到 speaking 是否自然",
        workspace: Workspace(
            id: "workspace",
            name: "Pikiclaw",
            pathDisplay: "/repo/pikiclaw",
            trustState: .trusted
        ),
        preferredAgent: .codex
    )

    #expect(plan.intent == .delegate)
    #expect(plan.needsConfirmation == false)
}

@Test func voiceReporterNarratesTerminalStates() {
    let plan = VoiceAssistantPlanner.makePlan(
        utterance: "Review the latest run",
        workspace: nil,
        preferredAgent: .codex
    )
    let run = AgentRun(
        workspaceId: "workspace",
        agentProfileId: "agent-codex",
        state: .completed,
        promptSnapshot: plan.agentPrompt
    )

    let report = VoiceAssistantPlanner.report(for: plan, run: run)

    #expect(report.headline == "Completed")
    #expect(report.tone == "done")
    #expect(report.spokenText.contains("completed"))
}

@Test func voiceReporterSpeaksAgentTranscriptSummary() {
    let plan = VoiceAssistantPlanner.makePlan(
        utterance: "帮我检查语音助手是否自然",
        workspace: Workspace(
            id: "workspace",
            name: "Pikiclaw",
            pathDisplay: "/repo/pikiclaw",
            trustState: .trusted
        ),
        preferredAgent: .codex
    )
    var run = AgentRun(
        workspaceId: "workspace",
        agentProfileId: "agent-codex",
        state: .completed,
        promptSnapshot: plan.agentPrompt
    )
    run.transcript = """
    [tool] swift test
    已经完成语音助手的自然对话链路，识别后会自动交给 agent。
    验证通过：26 个 macOS 测试全部通过。
    """

    let report = VoiceAssistantPlanner.report(for: plan, run: run)

    #expect(report.spokenText.contains("自动交给 agent"))
    #expect(report.spokenText.contains("26 个 macOS 测试全部通过"))
    #expect(!report.spokenText.contains("[tool]"))
}
