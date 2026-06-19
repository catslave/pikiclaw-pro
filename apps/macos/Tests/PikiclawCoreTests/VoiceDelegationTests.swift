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
    #expect(plan.contextRefs.contains { $0.kind == "workspace" && $0.label == "Pikiclaw" })
    #expect(plan.agentPrompt.contains("Voice delegated request"))
    #expect(plan.agentPrompt.contains("Acceptance criteria"))
    #expect(plan.acceptanceCriteria.contains("Run the narrowest relevant verification available"))
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
