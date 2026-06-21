import Foundation
import Testing
@testable import PikiclawCore
@testable import PikiclawMac
@testable import PikiclawRunner

@MainActor
@Test func sendingNextChatMessagePreservesPreviousTurnInHistory() async throws {
    let directory = URL(fileURLWithPath: NSTemporaryDirectory())
        .appendingPathComponent("pikiclaw-chat-history-\(UUID().uuidString)", isDirectory: true)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: directory) }

    let workspace = Workspace(
        id: "workspace-chat-history",
        name: "Chat History",
        pathDisplay: directory.path,
        trustState: .trusted
    )
    let agent = AgentProfile(
        id: "agent-codex-history",
        kind: .codex,
        displayName: "Codex",
        executableName: "codex",
        isEnabled: true
    )
    let run = AgentRun(
        id: "run-chat-history",
        workspaceId: workspace.id,
        agentProfileId: agent.id,
        state: .completed,
        endedAt: Date(timeIntervalSince1970: 10),
        promptSnapshot: "first question",
        transcript: "first answer\n[completed with exit code 0]\n"
    )
    let seed = NativeAppSeed(
        projects: [],
        workspaces: [workspace],
        workItems: [],
        runs: [run],
        artifacts: [],
        capabilities: [],
        knowledgeCards: [],
        automations: [],
        agentProfiles: [agent],
        providerProfiles: []
    )
    let store = JSONNativeStore(fileURL: directory.appendingPathComponent("state.json"), seed: seed)
    let model = NativeAppModel(
        store: store,
        agentAdapterFactory: { descriptor in
            MockAgentAdapter(descriptor: descriptor, output: ["second answer\n"])
        }
    )
    await model.reload()

    let sentRunId = try #require(await model.sendMessage(in: run.id, message: "second question"))

    #expect(sentRunId == run.id)
    let updated = try #require((try await store.loadSnapshot()).runs.first(where: { $0.id == run.id }))
    #expect(updated.promptSnapshot == "second question")
    #expect(updated.transcript.contains("second answer"))
    #expect(updated.messages.map(\.role) == [.user, .assistant])
    #expect(updated.messages[0].content == "first question")
    #expect(updated.messages[1].content.contains("first answer"))
}

@MainActor
@Test func rerunningChatPreservesPreviousAttemptInHistory() async throws {
    let directory = URL(fileURLWithPath: NSTemporaryDirectory())
        .appendingPathComponent("pikiclaw-chat-rerun-\(UUID().uuidString)", isDirectory: true)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: directory) }

    let workspace = Workspace(
        id: "workspace-chat-rerun",
        name: "Chat Rerun",
        pathDisplay: directory.path,
        trustState: .trusted
    )
    let agent = AgentProfile(
        id: "agent-codex-rerun",
        kind: .codex,
        displayName: "Codex",
        executableName: "codex",
        isEnabled: true
    )
    let run = AgentRun(
        id: "run-chat-rerun",
        workspaceId: workspace.id,
        agentProfileId: agent.id,
        state: .failed,
        endedAt: Date(timeIntervalSince1970: 10),
        promptSnapshot: "same question",
        transcript: "first failed answer\n[completed with exit code 1]\n"
    )
    let seed = NativeAppSeed(
        projects: [],
        workspaces: [workspace],
        workItems: [],
        runs: [run],
        artifacts: [],
        capabilities: [],
        knowledgeCards: [],
        automations: [],
        agentProfiles: [agent],
        providerProfiles: []
    )
    let store = JSONNativeStore(fileURL: directory.appendingPathComponent("state.json"), seed: seed)
    let model = NativeAppModel(
        store: store,
        agentAdapterFactory: { descriptor in
            MockAgentAdapter(descriptor: descriptor, output: ["second answer\n"])
        }
    )
    await model.reload()

    let rerunId = try #require(await model.rerunChat(runId: run.id))

    #expect(rerunId == run.id)
    let updated = try #require((try await store.loadSnapshot()).runs.first(where: { $0.id == run.id }))
    #expect(updated.promptSnapshot == "same question")
    #expect(updated.transcript.contains("second answer"))
    #expect(updated.messages.map(\.role) == [.user, .assistant])
    #expect(updated.messages.count == 2)
    let firstMessage = try #require(updated.messages.first)
    let secondMessage = try #require(updated.messages.dropFirst().first)
    #expect(firstMessage.content == "same question")
    #expect(secondMessage.content.contains("first failed answer"))
}

@MainActor
@Test func sendingNextChatMessagePassesHistoryToAgent() async throws {
    let directory = URL(fileURLWithPath: NSTemporaryDirectory())
        .appendingPathComponent("pikiclaw-chat-history-prompt-\(UUID().uuidString)", isDirectory: true)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: directory) }

    let workspace = Workspace(
        id: "workspace-chat-history-prompt",
        name: "Chat History Prompt",
        pathDisplay: directory.path,
        trustState: .trusted
    )
    let agent = AgentProfile(
        id: "agent-codex-history-prompt",
        kind: .codex,
        displayName: "Codex",
        executableName: "codex",
        isEnabled: true
    )
    let run = AgentRun(
        id: "run-chat-history-prompt",
        workspaceId: workspace.id,
        agentProfileId: agent.id,
        state: .completed,
        endedAt: Date(timeIntervalSince1970: 10),
        promptSnapshot: "first question",
        transcript: "first answer\n[completed with exit code 0]\n"
    )
    let seed = NativeAppSeed(
        projects: [],
        workspaces: [workspace],
        workItems: [],
        runs: [run],
        artifacts: [],
        capabilities: [],
        knowledgeCards: [],
        automations: [],
        agentProfiles: [agent],
        providerProfiles: []
    )
    let store = JSONNativeStore(fileURL: directory.appendingPathComponent("state.json"), seed: seed)
    let capture = PromptCapture()
    let model = NativeAppModel(
        store: store,
        agentAdapterFactory: { descriptor in
            CapturingAgentAdapter(descriptor: descriptor, capture: capture)
        }
    )
    await model.reload()

    _ = try #require(await model.sendMessage(in: run.id, message: "second question"))

    let prompt = try #require(capture.prompts.last)
    #expect(prompt.contains("Conversation so far:"))
    #expect(prompt.contains("User: first question"))
    #expect(prompt.contains("Assistant: first answer"))
    #expect(prompt.contains("User: second question"))
}

@MainActor
@Test func sendingFollowUpReplyCanOverrideRunPermission() async throws {
    let directory = URL(fileURLWithPath: NSTemporaryDirectory())
        .appendingPathComponent("pikiclaw-chat-follow-up-permission-\(UUID().uuidString)", isDirectory: true)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: directory) }

    let workspace = Workspace(
        id: "workspace-chat-follow-up-permission",
        name: "Chat Follow-up Permission",
        pathDisplay: directory.path,
        trustState: .trusted
    )
    let agent = AgentProfile(
        id: "agent-chat-follow-up-permission",
        kind: .codex,
        displayName: "Codex",
        executableName: "codex",
        isEnabled: true
    )
    let run = AgentRun(
        id: "run-chat-follow-up-permission",
        workspaceId: workspace.id,
        agentProfileId: agent.id,
        permissionMode: .autopilot,
        state: .completed,
        endedAt: Date(timeIntervalSince1970: 10),
        promptSnapshot: "implement the Jira sync fix",
        transcript: "implementation completed\n[completed with exit code 0]\n"
    )
    let seed = NativeAppSeed(
        projects: [],
        workspaces: [workspace],
        workItems: [],
        runs: [run],
        artifacts: [],
        capabilities: [],
        knowledgeCards: [],
        automations: [],
        agentProfiles: [agent],
        providerProfiles: []
    )
    let store = JSONNativeStore(fileURL: directory.appendingPathComponent("state.json"), seed: seed)
    let capture = PromptCapture()
    let model = NativeAppModel(
        store: store,
        agentAdapterFactory: { descriptor in
            CapturingAgentAdapter(descriptor: descriptor, capture: capture)
        }
    )
    await model.reload()

    let sentRunId = try #require(await model.sendMessage(
        in: run.id,
        message: "Review this as a read-only follow-up.",
        permissionMode: .readOnly
    ))

    #expect(sentRunId == run.id)
    let updated = try #require((try await store.loadSnapshot()).runs.first(where: { $0.id == run.id }))
    #expect(updated.permissionMode == .readOnly)
    #expect(updated.promptSnapshot == "Review this as a read-only follow-up.")
    #expect(capture.permissionModes.last == .readOnly)
}

@Test func chatRunFollowUpActionsPrioritizeFailureAndJiraNextSteps() {
    let longLead = String(repeating: "Preparing Jira sync context. ", count: 24)
    let assistantOutput = """
    \(longLead)
    Steps to reproduce:
    - Open native Jira queue
    - Sync current sprint
    Observed: queue sync failed after Jira MCP search
    Expected: Queue keeps Jira tickets visible or records a sync blocker
    Root cause: Jira MCP search failure is surfaced only as terminal output.
    Likely seam: Native Jira sync result mapping drops blocker context before work items render.
    Impact: current sprint queue can look empty while sync is blocked.
    Proposed fix: persist a sync blocker artifact before clearing candidates.
    error: queue sync failed after Jira MCP search
    Process exited with code 1
    """
    let run = AgentRun(
        id: "run-follow-up",
        workspaceId: "workspace-follow-up",
        agentProfileId: "agent-follow-up",
        state: .failed,
        promptSnapshot: "Fix Jira queue",
        transcript: assistantOutput
    )
    let workItem = WorkItem(
        id: "workitem-follow-up",
        workspaceId: "workspace-follow-up",
        title: "Repair native Jira queue",
        sourceType: .jira,
        sourceRefs: [
            SourceRef(kind: "chat-run", label: "Prior queue triage", uri: "pikiclaw://runs/run-queue-triage"),
            SourceRef(kind: "obsidian", label: "Queue sync note")
        ],
        state: .active,
        acceptanceCriteria: [
            "Queue sync keeps Jira tickets visible",
            "Follow-up actions preserve source evidence"
        ],
        externalRefs: [
            SourceRef(kind: "gitlab", label: "Queue MR", uri: "https://gitlab.example.com/pikiclaw/mr/901")
        ],
        jira: JiraWorkItemFields(key: "IVAS-9001", status: "In Progress")
    )

    let actions = chatRunFollowUpActions(
        run: run,
        workItem: workItem,
        assistantText: assistantOutput
    )

    #expect(actions.map(\.id) == ["bug-analysis", "mr-review", "validation", "jira-update"])
    #expect(actions[0].prompt.contains("Analyze this run as a bug"))
    #expect(actions[0].detail == "Read-only triage")
    #expect(actions[0].permissionMode == .readOnly)
    #expect(actions[0].prompt.contains("Output contract:"))
    #expect(actions[0].prompt.contains("Confirmed facts, likely seam, smallest safe fix, focused validation, and missing input"))
    #expect(actions[0].prompt.contains("Read-only follow-up"))
    #expect(actions[1].prompt.contains("code-review stance"))
    #expect(actions[1].detail == "Read-only review")
    #expect(actions[1].permissionMode == .readOnly)
    #expect(actions[1].prompt.contains("findings, open questions, verification gaps, and ready/not-ready"))
    #expect(actions[1].prompt.contains("Put findings first, ordered by severity"))
    #expect(actions[1].prompt.contains("Read-only follow-up"))
    #expect(actions[2].prompt.contains("narrowest useful test"))
    #expect(actions[2].detail == "Validate only")
    #expect(actions[2].permissionMode == .askBeforeEdit)
    #expect(actions[2].prompt.contains("check run, result, evidence, and next action"))
    #expect(actions[2].prompt.contains("Do not modify implementation in this validation pass"))
    #expect(actions[2].prompt.contains("Ask-before-edit follow-up"))
    #expect(actions[2].prompt.contains("Ask before editing files"))
    #expect(actions[2].prompt.contains("Keep validation evidence separate from proposed fixes"))
    #expect(actions[3].prompt.contains("Jira-ready update"))
    #expect(actions[3].detail == "Read-only update")
    #expect(actions[3].permissionMode == .readOnly)
    #expect(actions[3].prompt.contains("paste-ready Jira comment with Status, Evidence, Validation, Blockers, and Next action"))
    #expect(actions[3].prompt.contains("Read-only follow-up"))
    #expect(actions.allSatisfy { $0.prompt.contains("Run context:") })
    #expect(actions[1].prompt.contains("- Original prompt: Fix Jira queue"))
    #expect(actions[1].prompt.contains("- State: failed"))
    #expect(actions[1].prompt.contains("- Jira: IVAS-9001 · In Progress"))
    #expect(actions[1].prompt.contains("- Acceptance: Queue sync keeps Jira tickets visible; Follow-up actions preserve source evidence"))
    #expect(actions[1].prompt.contains("- Source refs: chat-run: Prior queue triage (pikiclaw://runs/run-queue-triage); obsidian: Queue sync note"))
    #expect(actions[1].prompt.contains("- External refs: gitlab: Queue MR (https://gitlab.example.com/pikiclaw/mr/901)"))
    #expect(actions[0].prompt.contains("Reproduction notes:"))
    #expect(actions[0].prompt.contains("Steps: Open native Jira queue | Sync current sprint"))
    #expect(actions[0].prompt.contains("Observed: queue sync failed after Jira MCP search"))
    #expect(actions[0].prompt.contains("Expected: Queue keeps Jira tickets visible or records a sync blocker"))
    #expect(actions[3].prompt.contains("Steps: Open native Jira queue | Sync current sprint"))
    #expect(actions[3].prompt.contains("Expected: Queue keeps Jira tickets visible or records a sync blocker"))
    #expect(actions[0].prompt.contains("Diagnosis notes:"))
    #expect(actions[0].prompt.contains("Root cause: Jira MCP search failure is surfaced only as terminal output."))
    #expect(actions[0].prompt.contains("Likely seam: Native Jira sync result mapping drops blocker context before work items render."))
    #expect(actions[0].prompt.contains("Impact: current sprint queue can look empty while sync is blocked."))
    #expect(actions[0].prompt.contains("Fix path: persist a sync blocker artifact before clearing candidates."))
    #expect(actions[3].prompt.contains("Likely seam: Native Jira sync result mapping drops blocker context before work items render."))
    #expect(actions[3].prompt.contains("Fix path: persist a sync blocker artifact before clearing candidates."))
    #expect(actions[0].prompt.contains("Failure signals:"))
    #expect(actions[0].prompt.contains("error: queue sync failed after Jira MCP search"))
    #expect(actions[0].prompt.contains("Process exited with code 1"))
    #expect(actions.allSatisfy { $0.prompt.contains("Prior queue triage") })
}

@Test func chatRunFollowUpActionsPreserveDecisionSignalsForBugReviewAndJira() {
    let assistantOutput = """
    Decision: not ready to merge until retry validation covers the nil workspace case.
    Merge readiness:
    - Blocked on RootView.swift:42 validation gap.
    - Approval can proceed after focused validation is captured.
    Recommendation: fix the nil workspace guard before posting Jira done.
    error: nil workspace crash in native chat follow-up
    Jira: IVAS-9020
    """
    let run = AgentRun(
        id: "run-follow-up-decision-signals",
        workspaceId: "workspace-follow-up",
        agentProfileId: "agent-follow-up",
        state: .failed,
        promptSnapshot: "Review native follow-up crash",
        transcript: assistantOutput
    )
    let workItem = WorkItem(
        id: "workitem-follow-up-decision-signals",
        workspaceId: "workspace-follow-up",
        title: "Repair native follow-up crash",
        sourceType: .jira,
        state: .review,
        jira: JiraWorkItemFields(key: "IVAS-9020", status: "In Review")
    )

    let actions = chatRunFollowUpActions(
        run: run,
        workItem: workItem,
        assistantText: assistantOutput
    )

    #expect(actions.map(\.id) == ["bug-analysis", "mr-review", "validation", "jira-update"])
    #expect(actions[0].prompt.contains("Decision signals:"))
    #expect(actions[0].prompt.contains("Decision: not ready to merge until retry validation covers the nil workspace case."))
    #expect(actions[0].prompt.contains("Readiness: Blocked on RootView.swift:42 validation gap. | Approval can proceed after focused validation is captured."))
    #expect(actions[0].prompt.contains("Recommendation: fix the nil workspace guard before posting Jira done."))
    #expect(actions[0].prompt.contains("Preserve Decision signals as the current triage status"))
    #expect(actions[1].prompt.contains("Decision signals:"))
    #expect(actions[1].prompt.contains("Preserve Decision signals as merge readiness"))
    #expect(actions[1].prompt.contains("preserve decision signals, preserve artifact refs"))
    #expect(actions[1].prompt.contains("Readiness: Blocked on RootView.swift:42 validation gap. | Approval can proceed after focused validation is captured."))
    #expect(actions[3].prompt.contains("decision signals"))
    #expect(actions[3].prompt.contains("Fold Decision signals into Status or Next action"))
    #expect(actions[3].prompt.contains("Recommendation: fix the nil workspace guard before posting Jira done."))
    #expect(actions[3].prompt.contains("Ticket refs: IVAS-9020"))
    #expect(actions[0].prompt.contains("Reproduction notes:") == false)
}

@Test func chatRunFollowUpActionsRouteBlockingReviewDecisionToBugAnalysis() {
    let assistantOutput = """
    MR review comment:
    Request changes: add a nil workspace guard before merge.
    Decision: not ready to merge until focused validation is captured.
    Go/No-go: no-go until `swift test --filter ChatMessageHistoryTests` covers it.
    Jira: IVAS-9021
    """
    let run = AgentRun(
        id: "run-follow-up-blocking-review-decision",
        workspaceId: "workspace-follow-up",
        agentProfileId: "agent-follow-up",
        state: .completed,
        promptSnapshot: "Review native follow-up MR",
        transcript: assistantOutput
    )
    let workItem = WorkItem(
        id: "workitem-follow-up-blocking-review-decision",
        workspaceId: "workspace-follow-up",
        title: "Fix native follow-up review blocker",
        sourceType: .jira,
        state: .review,
        jira: JiraWorkItemFields(key: "IVAS-9021", status: "In Review")
    )

    let actions = chatRunFollowUpActions(
        run: run,
        workItem: workItem,
        assistantText: assistantOutput
    )

    #expect(actions.map(\.id) == ["bug-analysis", "mr-review", "validation", "jira-update"])
    #expect(actions[0].prompt.contains("blocking review decision"))
    #expect(actions[0].prompt.contains("Decision signals:"))
    #expect(actions[0].prompt.contains("Approval: add a nil workspace guard before merge."))
    #expect(actions[0].prompt.contains("Decision: not ready to merge until focused validation is captured."))
    #expect(actions[0].prompt.contains("Decision: no-go until `swift test --filter ChatMessageHistoryTests` covers it."))
    #expect(actions[0].prompt.contains("Failure signals:") == false)
    #expect(actions[1].prompt.contains("Decision signals:"))
    #expect(actions[3].prompt.contains("Ticket refs: IVAS-9021"))
}

@Test func chatRunFollowUpActionsPreserveValidationEvidenceForReviewAndJira() {
    let run = AgentRun(
        id: "run-follow-up-validation-evidence",
        workspaceId: "workspace-follow-up",
        agentProfileId: "agent-follow-up",
        state: .completed,
        promptSnapshot: "Implement native Jira follow-up polish",
        transcript: """
        Implemented native follow-up polish.
        Status: implementation complete; Jira write-back still pending
        Result: ready for MR review after focused tests
        Jira: https://jira.example.com/browse/IVAS-9018.
        MR: [Native follow-up MR](https://gitlab.example.com/pikiclaw/pikiclaw/-/merge_requests/901/diffs)
        Artifact: pikiclaw://artifacts/artifact-follow-up-validation
        Run evidence: `pikiclaw://runs/run-follow-up-validation-evidence/evidence`
        Evidence note: [Obsidian note](obsidian://open?vault=Pikiclaw&file=repo%2Fpikiclaw%2Fsync.md)
        Obsidian export: /Users/michael.yang/Documents/Obsidian Vault/repo/pikiclaw/native-follow-up.md
        Jira update:
        Status: implementation complete; Jira write-back still pending
        Evidence: RootView now preserves status, validation, file refs, and handoff drafts.
        Validation: swift test --filter ChatMessageHistoryTests passed
        Blockers: waiting for Jira write permission
        Next action: paste the validation summary into IVAS-9018
        MR review comment:
        No blocking findings in the follow-up context change; residual risk is manual app smoke.
        Changed files:
        - [RootView.swift](/Users/michael.yang/Codes/Personal/pikiclaw/apps/macos/Sources/PikiclawMac/RootView.swift:6623)
        - `apps/macos/Tests/PikiclawMacTests/ChatMessageHistoryTests.swift:329`
        Validation:
        - `swift test --filter ChatMessageHistoryTests` passed
        - git diff --check passed
        Blockers: waiting for Jira write permission
        Next action: paste the validation summary into IVAS-9018
        Open question: whether the MR needs a voice regression smoke
        Risk: full app smoke was not run
        Next command: `swift build --product PikiclawMac`
        """
    )
    let workItem = WorkItem(
        id: "workitem-follow-up-validation-evidence",
        workspaceId: "workspace-follow-up",
        title: "Preserve validation in Jira update",
        sourceType: .jira,
        state: .review,
        jira: JiraWorkItemFields(key: "IVAS-9018", status: "In Review")
    )

    let actions = chatRunFollowUpActions(
        run: run,
        workItem: workItem,
        assistantText: run.transcript
    )

    #expect(actions.map(\.id) == ["mr-review", "validation", "jira-update"])
    #expect(actions[0].prompt.contains("Validation evidence:"))
    #expect(actions[0].prompt.contains("swift test --filter ChatMessageHistoryTests (passed)"))
    #expect(actions[0].prompt.contains("git diff --check (passed)"))
    #expect(actions[0].prompt.contains("File refs:"))
    #expect(actions[0].prompt.contains("/Users/michael.yang/Codes/Personal/pikiclaw/apps/macos/Sources/PikiclawMac/RootView.swift:6623"))
    #expect(actions[0].prompt.contains("apps/macos/Tests/PikiclawMacTests/ChatMessageHistoryTests.swift:329"))
    #expect(actions[0].prompt.contains("Status summary:"))
    #expect(actions[0].prompt.contains("Status: implementation complete; Jira write-back still pending"))
    #expect(actions[0].prompt.contains("Result: ready for MR review after focused tests"))
    #expect(actions[0].prompt.contains("Progress: Implemented native follow-up polish."))
    #expect(actions[0].prompt.contains("Handoff drafts:"))
    #expect(actions[0].prompt.contains("Jira draft: Status: implementation complete; Jira write-back still pending | Evidence: RootView now preserves status, validation, file refs, and handoff drafts."))
    #expect(actions[0].prompt.contains("MR draft: No blocking findings in the follow-up context change; residual risk is manual app smoke."))
    #expect(actions[0].prompt.contains("External links:"))
    #expect(actions[0].prompt.contains("Jira: https://jira.example.com/browse/IVAS-9018"))
    #expect(actions[0].prompt.contains("MR: https://gitlab.example.com/pikiclaw/pikiclaw/-/merge_requests/901"))
    #expect(actions[0].prompt.contains("preserve artifact refs as evidence pointers"))
    #expect(actions[0].prompt.contains("Treat Artifact refs as evidence pointers and Next commands as follow-up candidates"))
    #expect(actions[0].prompt.contains("Artifact refs:"))
    #expect(actions[0].prompt.contains("Pikiclaw artifact: pikiclaw://artifacts/artifact-follow-up-validation"))
    #expect(actions[0].prompt.contains("Pikiclaw run: pikiclaw://runs/run-follow-up-validation-evidence/evidence"))
    #expect(actions[0].prompt.contains("Obsidian: obsidian://open?vault=Pikiclaw&file=repo%2Fpikiclaw%2Fsync.md"))
    #expect(actions[0].prompt.contains("Obsidian: /Users/michael.yang/Documents/Obsidian Vault/repo/pikiclaw/native-follow-up.md"))
    #expect(actions[0].prompt.contains("Ticket refs: IVAS-9018"))
    #expect(actions[0].prompt.contains("Actionable notes:"))
    #expect(actions[0].prompt.contains("Blocker: waiting for Jira write permission"))
    #expect(actions[0].prompt.contains("Next action: paste the validation summary into IVAS-9018"))
    #expect(actions[0].prompt.contains("Open question: whether the MR needs a voice regression smoke"))
    #expect(actions[0].prompt.contains("Risk: full app smoke was not run"))
    #expect(actions[0].prompt.contains("Next commands:"))
    #expect(actions[0].prompt.contains("swift build --product PikiclawMac"))
    #expect(actions[0].prompt.contains("swift build --product PikiclawMac (passed)") == false)
    #expect(actions[1].prompt.contains("Prefer a relevant Next command"))
    #expect(actions[1].prompt.contains("Next commands:"))
    #expect(actions[1].prompt.contains("swift build --product PikiclawMac"))
    #expect(actions[2].prompt.contains("Jira-ready update"))
    #expect(actions[2].prompt.contains("Preserve artifact refs in Evidence"))
    #expect(actions[2].prompt.contains("Fold Artifact refs into Evidence and Next commands into Next action"))
    #expect(actions[2].prompt.contains("swift test --filter ChatMessageHistoryTests (passed)"))
    #expect(actions[2].prompt.contains("git diff --check (passed)"))
    #expect(actions[2].prompt.contains("swift build --product PikiclawMac"))
    #expect(actions[2].prompt.contains("swift build --product PikiclawMac (passed)") == false)
    #expect(actions[2].prompt.contains("apps/macos/Tests/PikiclawMacTests/ChatMessageHistoryTests.swift:329"))
    #expect(actions[2].prompt.contains("Status: implementation complete; Jira write-back still pending"))
    #expect(actions[2].prompt.contains("Result: ready for MR review after focused tests"))
    #expect(actions[2].prompt.contains("Jira draft: Status: implementation complete; Jira write-back still pending | Evidence: RootView now preserves status, validation, file refs, and handoff drafts."))
    #expect(actions[2].prompt.contains("MR draft: No blocking findings in the follow-up context change; residual risk is manual app smoke."))
    #expect(actions[2].prompt.contains("Jira: https://jira.example.com/browse/IVAS-9018"))
    #expect(actions[2].prompt.contains("MR: https://gitlab.example.com/pikiclaw/pikiclaw/-/merge_requests/901"))
    #expect(actions[2].prompt.contains("Pikiclaw artifact: pikiclaw://artifacts/artifact-follow-up-validation"))
    #expect(actions[2].prompt.contains("Obsidian: obsidian://open?vault=Pikiclaw&file=repo%2Fpikiclaw%2Fsync.md"))
    #expect(actions[2].prompt.contains("Ticket refs: IVAS-9018"))
    #expect(actions[2].prompt.contains("Blocker: waiting for Jira write permission"))
    #expect(actions[2].prompt.contains("Next action: paste the validation summary into IVAS-9018"))
}

@Test func chatRunFollowUpActionsIncludeLogAnalysisForTraceSignals() {
    let output = """
    error: no audio conversationId=p-v-voice-123 TraceId=0123456789abcdef0123456789abcdef
    Lookup command: /logtrace --env lab region=west accountId=7542904004 conversationId=p-v-voice-123 last=24h
    """
    let run = AgentRun(
        id: "run-follow-up-log-analysis",
        workspaceId: "workspace-follow-up",
        agentProfileId: "agent-follow-up",
        state: .failed,
        promptSnapshot: "Investigate no-audio runtime failure",
        transcript: output
    )
    let workItem = WorkItem(
        id: "workitem-follow-up-log-analysis",
        workspaceId: "workspace-follow-up",
        title: "Trace native no-audio failure",
        sourceType: .jira,
        state: .active,
        jira: JiraWorkItemFields(key: "IVAS-9006", status: "In Progress")
    )

    let actions = chatRunFollowUpActions(
        run: run,
        workItem: workItem,
        assistantText: output
    )

    #expect(actions.map(\.id) == ["bug-analysis", "log-analysis", "skill-hardening", "jira-update"])
    #expect(actions[1].title == "Logs")
    #expect(actions[1].detail == "Read-only trace")
    #expect(actions[1].permissionMode == .readOnly)
    #expect(actions[1].prompt.contains("Keep conversationId, sessionId, traceId, requestId, and taskId distinct"))
    #expect(actions[1].prompt.contains("`/logtrace`"))
    #expect(actions[1].prompt.contains("`/clickhouse`"))
    #expect(actions[1].prompt.contains("conversationId=p-v-voice-123"))
    #expect(actions[1].prompt.contains("IDs checked, timeline/phases, error family, ambiguity, and next lookup"))
    #expect(actions[1].prompt.contains("Include the exact skill command to run next"))
    #expect(actions[1].prompt.contains("Suggested log commands:"))
    #expect(actions[1].prompt.contains("/logtrace env=lab conversationId=p-v-voice-123 last=24h"))
    #expect(actions[1].prompt.contains("/clickhouse show error spans for TraceId=0123456789abcdef0123456789abcdef ConversationId=p-v-voice-123 limit=20"))
    #expect(actions[1].prompt.contains("Environment refs:"))
    #expect(actions[1].prompt.contains("env=lab"))
    #expect(actions[1].prompt.contains("region=west"))
    #expect(actions[1].prompt.contains("accountId=7542904004"))
    #expect(actions[2].prompt.contains("Skill refs: /logtrace"))
    #expect(actions[2].prompt.contains("accountId=7542904004"))
    #expect(actions[3].prompt.contains("accountId=7542904004"))
    #expect(actions[1].prompt.contains("Read-only follow-up"))
    #expect(actions[3].prompt.contains("Jira-ready update"))
}

@Test func chatRunFollowUpActionsExtractTraceParentNextCommands() {
    let traceParent = "00-4a0031017ceb19eab6d3a39468a20000-0123456789abcdef-01"
    let run = AgentRun(
        id: "run-follow-up-traceparent",
        workspaceId: "workspace-follow-up",
        agentProfileId: "agent-follow-up",
        state: .completed,
        promptSnapshot: "Trace copied span context",
        transcript: "traceparent=\(traceParent)"
    )

    let actions = chatRunFollowUpActions(
        run: run,
        workItem: nil,
        assistantText: "traceparent=\(traceParent)"
    )

    #expect(actions.map(\.id) == ["log-analysis", "mr-review", "validation", "capture-evidence"])
    #expect(actions[0].prompt.contains("Suggested log commands:"))
    #expect(actions[0].prompt.contains("/logtrace env=lab traceId=4a0031017ceb19eab6d3a39468a20000 last=24h"))
    #expect(actions[0].prompt.contains("/clickhouse trace lookup TraceId=4a0031017ceb19eab6d3a39468a20000 limit=20"))
}

@Test func chatRunFollowUpActionsPreserveGitRefsForReview() {
    let output = """
    Branch: codex/mac-native-v2-foundation
    Commit SHA: abc1234def5678
    Findings:
    - [P1] Missing retry validation in RootView.swift:42 before marking the MR ready.
    Validation: swift test passed
    """
    let run = AgentRun(
        id: "run-follow-up-git-refs",
        workspaceId: "workspace-follow-up",
        agentProfileId: "agent-follow-up",
        state: .completed,
        promptSnapshot: "Review branch codex/mac-native-v2-foundation",
        transcript: output
    )

    let actions = chatRunFollowUpActions(
        run: run,
        workItem: nil,
        assistantText: output
    )

    #expect(actions.map(\.id) == ["mr-review", "validation", "capture-evidence"])
    #expect(actions[0].prompt.contains("Git refs:"))
    #expect(actions[0].prompt.contains("branch codex/mac-native-v2-foundation"))
    #expect(actions[0].prompt.contains("commit abc1234def5678"))
    #expect(actions[0].prompt.contains("Review findings:"))
    #expect(actions[0].prompt.contains("[P1] Missing retry validation in RootView.swift:42 before marking the MR ready."))
    #expect(actions[0].prompt.contains("Validation evidence:"))
    #expect(actions[0].prompt.contains("swift test"))
}

@Test func chatRunFollowUpActionsIncludeSkillHardeningForSkillSignals() {
    let skillOutput = """
    Skill /logtrace failed because IVA_LOGTRACER_ENV_FILE was missing.
    Inspect .pikiclaw/skills/iva-logtracer/SKILL.md before changing behavior.
    Fallback command: `/clickhouse trace lookup TraceId=0123456789abcdef0123456789abcdef limit=20`
    Next command: `PIKICLAW_DEV_FOREGROUND=1 npm run dev`
    """
    let run = AgentRun(
        id: "run-follow-up-skill-hardening",
        workspaceId: "workspace-follow-up",
        agentProfileId: "agent-follow-up",
        state: .failed,
        promptSnapshot: "Improve /logtrace recovery",
        transcript: skillOutput
    )
    let workItem = WorkItem(
        id: "workitem-follow-up-skill-hardening",
        workspaceId: "workspace-follow-up",
        title: "Harden logtrace skill",
        sourceType: .manualPrompt,
        state: .active
    )

    let actions = chatRunFollowUpActions(
        run: run,
        workItem: workItem,
        assistantText: skillOutput
    )

    #expect(actions.map(\.id) == ["bug-analysis", "log-analysis", "skill-hardening", "mr-review"])
    #expect(actions[2].title == "Skill")
    #expect(actions[2].detail == "Ask before edits")
    #expect(actions[2].permissionMode == .askBeforeEdit)
    #expect(actions[2].prompt.contains("Harden the skill path"))
    #expect(actions[2].prompt.contains("inspect its SKILL.md and scripts"))
    #expect(actions[2].prompt.contains("Preserve environment and credential boundaries"))
    #expect(actions[2].prompt.contains("skill path, current failure, invocation improvement, guardrail/doc change, and validation"))
    #expect(actions[2].prompt.contains("Distinguish confirmed SKILL.md/script behavior from proposed edits"))
    #expect(actions[2].prompt.contains("Ask-before-edit follow-up"))
    #expect(actions[2].prompt.contains("Ask before editing files"))
    #expect(actions[2].prompt.contains("Skill refs:"))
    #expect(actions[2].prompt.contains("/logtrace"))
    #expect(actions[2].prompt.contains("/clickhouse"))
    #expect(actions[2].prompt.contains("IVA_LOGTRACER_ENV_FILE"))
    #expect(actions[2].prompt.contains(".pikiclaw/skills/iva-logtracer/SKILL.md"))
    #expect(actions[2].prompt.contains("Next commands:"))
    #expect(actions[2].prompt.contains("PIKICLAW_DEV_FOREGROUND=1 npm run dev"))
    #expect(actions[2].prompt.contains("Validation evidence:") == false)
}

@Test func chatRunFollowUpActionsKeepJiraVisibleWhenSignalsOverflow() {
    let run = AgentRun(
        id: "run-follow-up-overflow",
        workspaceId: "workspace-follow-up",
        agentProfileId: "agent-follow-up",
        state: .failed,
        promptSnapshot: "Debug IVAS-9011 with /logtrace",
        transcript: "Skill /logtrace failed for IVAS-9011 conversationId=p-v-overflow"
    )
    let workItem = WorkItem(
        id: "workitem-follow-up-overflow",
        workspaceId: "workspace-follow-up",
        title: "Overflow follow-up triage",
        sourceType: .manualPrompt,
        state: .active
    )

    let actions = chatRunFollowUpActions(
        run: run,
        workItem: workItem,
        assistantText: "Skill /logtrace failed for IVAS-9011 conversationId=p-v-overflow"
    )

    #expect(actions.map(\.id) == ["bug-analysis", "log-analysis", "skill-hardening", "jira-update"])
    #expect(actions[3].title == "Jira")
    #expect(actions[3].permissionMode == .readOnly)
    #expect(actions[3].prompt.contains("IVAS-9011"))
    #expect(actions.contains(where: { $0.id == "mr-review" }) == false)
}

@Test func runFollowUpStagedContextPreservesActionDetail() {
    let action = RunFollowUpAction(
        id: "skill-hardening",
        title: "Skill",
        symbol: "puzzlepiece.extension",
        permissionMode: .askBeforeEdit,
        prompt: "Harden /logtrace"
    )

    #expect(action.detail == "Ask before edits")
    #expect(runFollowUpStagedLabel(action) == "Skill - Ask before edits")
    #expect(runFollowUpStagedStatus(action) == "Skill follow-up staged - Ask before edits")
}

@Test func chatRunFollowUpActionsKeepGenericEvidenceReadOnly() {
    let run = AgentRun(
        id: "run-follow-up-evidence",
        workspaceId: "workspace-follow-up",
        agentProfileId: "agent-follow-up",
        state: .completed,
        promptSnapshot: "Validate native follow-up actions",
        transcript: "validation passed"
    )
    let workItem = WorkItem(
        id: "workitem-follow-up-evidence",
        workspaceId: "workspace-follow-up",
        title: "Native follow-up polish",
        sourceType: .manualPrompt,
        state: .active
    )

    let actions = chatRunFollowUpActions(
        run: run,
        workItem: workItem,
        assistantText: "validation passed"
    )

    #expect(actions.map(\.id) == ["mr-review", "validation", "capture-evidence"])
    #expect(actions[0].permissionMode == .readOnly)
    #expect(actions[1].permissionMode == .askBeforeEdit)
    #expect(actions[2].permissionMode == .readOnly)
    #expect(actions[2].detail == "Read-only capture")
    #expect(actions[2].prompt.contains("Extract durable evidence"))
    #expect(actions[2].prompt.contains("artifact-ready evidence with Source refs, Outputs, Validation, Blockers, and Next action"))
    #expect(actions[2].prompt.contains("proposed knowledge card only when it has durable reusable value"))
    #expect(actions[2].prompt.contains("Read-only follow-up"))
}

@Test func chatRunFollowUpActionsInferJiraUpdateFromTicketKey() {
    let run = AgentRun(
        id: "run-follow-up-jira-key",
        workspaceId: "workspace-follow-up",
        agentProfileId: "agent-follow-up",
        state: .completed,
        promptSnapshot: "Summarize IVAS-9010 after validation",
        transcript: "Validated IVAS-9010 and found one blocker"
    )
    let workItem = WorkItem(
        id: "workitem-follow-up-jira-key",
        workspaceId: "workspace-follow-up",
        title: "Ad hoc ticket note",
        sourceType: .manualPrompt,
        state: .active
    )

    let actions = chatRunFollowUpActions(
        run: run,
        workItem: workItem,
        assistantText: "Validated IVAS-9010 and found one blocker"
    )

    #expect(actions.map(\.id) == ["mr-review", "validation", "jira-update"])
    #expect(actions[2].permissionMode == .readOnly)
    #expect(actions[2].prompt.contains("Jira-ready update"))
    #expect(actions[2].prompt.contains("ticket key"))
    #expect(actions[2].prompt.contains("what needs to be synced before posting"))
    #expect(actions[2].prompt.contains("IVAS-9010"))
    #expect(actions[2].prompt.contains("Ticket refs: IVAS-9010"))
}

@Test func chatRunFollowUpActionsWaitForTerminalStates() {
    let run = AgentRun(
        id: "run-follow-up-running",
        workspaceId: "workspace-follow-up",
        agentProfileId: "agent-follow-up",
        state: .running,
        promptSnapshot: "Still working",
        transcript: "Thinking..."
    )

    let actions = chatRunFollowUpActions(
        run: run,
        workItem: nil,
        assistantText: "Thinking..."
    )

    #expect(actions.isEmpty)
}

@Test func chatCanCaptureEvidenceWaitsForDurableOutput() {
    let completedRun = AgentRun(
        id: "run-evidence-completed",
        workspaceId: "workspace-evidence",
        agentProfileId: "agent-evidence",
        state: .completed,
        promptSnapshot: "Review Jira sync"
    )
    let runningRun = AgentRun(
        id: "run-evidence-running",
        workspaceId: "workspace-evidence",
        agentProfileId: "agent-evidence",
        state: .running,
        promptSnapshot: "Review Jira sync"
    )

    #expect(chatCanCaptureEvidence(run: completedRun, assistantText: "Validated current sprint sync.") == true)
    #expect(chatCanCaptureEvidence(run: completedRun, assistantText: "No assistant output yet.") == false)
    #expect(chatCanCaptureEvidence(run: completedRun, assistantText: "Reading additional input from stdin...") == false)
    #expect(chatCanCaptureEvidence(run: runningRun, assistantText: "Partial stream") == false)
}

@Test func workItemOutputsSortAndResolveSourceRun() {
    let item = WorkItem(
        id: "workitem-output-actions",
        workspaceId: "workspace-output-actions",
        title: "Make outputs actionable"
    )
    let run = AgentRun(
        id: "run-output-source",
        workItemId: item.id,
        workspaceId: item.workspaceId,
        agentProfileId: "agent-output-source",
        state: .completed,
        promptSnapshot: "Capture evidence"
    )
    let older = Artifact(
        id: "artifact-output-older",
        workspaceId: item.workspaceId,
        workItemId: item.id,
        runId: run.id,
        kind: .commandOutputSummary,
        title: "Older evidence",
        uri: "pikiclaw://runs/run-output-source/evidence",
        status: .ready,
        provenance: "Older",
        createdAt: Date(timeIntervalSince1970: 10)
    )
    let newer = Artifact(
        id: "artifact-output-newer",
        workspaceId: item.workspaceId,
        workItemId: item.id,
        kind: .verificationResult,
        title: "Newer evidence",
        uri: "pikiclaw://runs/run-output-source/evidence",
        status: .verified,
        provenance: "Newer",
        createdAt: Date(timeIntervalSince1970: 20),
        sourceRefs: [
            SourceRef(kind: "chat-run", label: "Capture evidence", uri: "pikiclaw://runs/run-output-source")
        ]
    )
    let snapshot = NativeStoreSnapshot(
        workItems: [item],
        runs: [run],
        artifacts: [older, newer]
    )

    #expect(workItemOutputs(for: item, snapshot: snapshot).map(\.id) == [newer.id, older.id])
    #expect(artifactSourceRun(newer, snapshot: snapshot)?.id == run.id)
    #expect(artifactDisplaySubtitle(newer, sourceRun: run) == "verificationResult - verified - chat completed")
}

@Test func artifactClipboardSummaryPreservesWorkItemRunAndRefs() {
    let item = WorkItem(
        id: "workitem-output-copy",
        workspaceId: "workspace-output-copy",
        title: "IVAS-9003: Copy evidence",
        sourceType: .jira,
        sourceRefs: [
            SourceRef(kind: "jira", label: "IVAS-9003", uri: "https://jira.example/browse/IVAS-9003")
        ]
    )
    let run = AgentRun(
        id: "run-output-copy",
        workItemId: item.id,
        workspaceId: item.workspaceId,
        agentProfileId: "agent-output-copy",
        state: .failed,
        promptSnapshot: "Review failed sync"
    )
    let artifact = Artifact(
        id: "artifact-output-copy",
        workspaceId: item.workspaceId,
        workItemId: item.id,
        runId: run.id,
        kind: .commandOutputSummary,
        title: "Evidence: failed sync",
        uri: "pikiclaw://runs/run-output-copy/evidence",
        status: .failed,
        provenance: "Captured from failed chat output: queue sync failed",
        sourceRefs: [
            SourceRef(kind: "chat-run", label: "Review failed sync", uri: "pikiclaw://runs/run-output-copy"),
            SourceRef(kind: "jira", label: "IVAS-9003", uri: "https://jira.example/browse/IVAS-9003")
        ]
    )

    let summary = artifactClipboardSummary(artifact: artifact, run: run, workItem: item)

    #expect(summary.contains("Output: Evidence: failed sync"))
    #expect(summary.contains("Work item: IVAS-9003: Copy evidence"))
    #expect(summary.contains("Source chat: Review failed sync"))
    #expect(summary.contains("Captured from failed chat output"))
    #expect(summary.components(separatedBy: "[jira] IVAS-9003").count == 2)
}

@Test func artifactFollowUpPromptCarriesStructuredSignalsFromSavedOutput() {
    let item = WorkItem(
        id: "workitem-output-signals",
        workspaceId: "workspace-output-signals",
        title: "IVAS-9006: Continue saved output",
        sourceType: .jira,
        jira: JiraWorkItemFields(key: "IVAS-9006", status: "In Progress")
    )
    let run = AgentRun(
        id: "run-output-signals",
        workItemId: item.id,
        workspaceId: item.workspaceId,
        agentProfileId: "agent-output-signals",
        state: .completed,
        promptSnapshot: "Summarize saved output"
    )
    let artifact = Artifact(
        id: "artifact-output-signals",
        workspaceId: item.workspaceId,
        workItemId: item.id,
        runId: run.id,
        kind: .commandOutputSummary,
        title: "Evidence: saved output signals",
        uri: "pikiclaw://runs/run-output-signals/evidence",
        status: .ready,
        provenance: """
        Decision: not ready to post Jira done until validation is copied.
        Blockers:
        - waiting for Jira write permission.
        Risk: full app smoke has not run.
        Validation: swift test --filter ChatMessageHistoryTests passed
        Next command: `git status --short`
        """
    )

    let summary = artifactClipboardSummary(artifact: artifact, run: run, workItem: item)
    let prompt = artifactFollowUpPrompt(artifact: artifact, run: run, workItem: item)

    #expect(summary.contains("Output signals:"))
    #expect(summary.contains("Decision signals: Decision: not ready to post Jira done until validation is copied."))
    #expect(summary.contains("Actionable notes: Blocker: waiting for Jira write permission.; Risk: full app smoke has not run."))
    #expect(summary.contains("Validation evidence: swift test --filter ChatMessageHistoryTests (passed)"))
    #expect(summary.contains("Next commands: git status --short"))
    #expect(prompt.contains("Output signals:"))
    #expect(prompt.contains("Actionable notes: Blocker: waiting for Jira write permission.; Risk: full app smoke has not run."))
    #expect(prompt.contains("Next commands: git status --short"))
    #expect(prompt.contains("Evidence:"))
}

@Test func artifactFollowUpPromptSpecializesJiraAndGenericWork() {
    let jiraItem = WorkItem(
        id: "workitem-output-jira-follow-up",
        workspaceId: "workspace-output-follow-up",
        title: "IVAS-9004: Publish evidence",
        sourceType: .jira,
        sourceRefs: [
            SourceRef(kind: "jira", label: "IVAS-9004", uri: "https://jira.example/browse/IVAS-9004")
        ],
        jira: JiraWorkItemFields(key: "IVAS-9004", status: "In Progress")
    )
    let manualItem = WorkItem(
        id: "workitem-output-manual-follow-up",
        workspaceId: "workspace-output-follow-up",
        title: "Improve output workflow",
        sourceType: .manualPrompt
    )
    let run = AgentRun(
        id: "run-output-follow-up",
        workItemId: jiraItem.id,
        workspaceId: jiraItem.workspaceId,
        agentProfileId: "agent-output-follow-up",
        state: .completed,
        promptSnapshot: "Summarize validation"
    )
    let artifact = Artifact(
        id: "artifact-output-follow-up",
        workspaceId: jiraItem.workspaceId,
        workItemId: jiraItem.id,
        runId: run.id,
        kind: .commandOutputSummary,
        title: "Evidence: validation passed",
        uri: "pikiclaw://runs/run-output-follow-up/evidence",
        status: .ready,
        provenance: "Captured validation evidence"
    )

    let jiraPrompt = artifactFollowUpPrompt(artifact: artifact, run: run, workItem: jiraItem)
    let manualPrompt = artifactFollowUpPrompt(artifact: artifact, run: run, workItem: manualItem)
    let reviewArtifact = Artifact(
        id: "artifact-output-review-follow-up",
        workspaceId: manualItem.workspaceId,
        workItemId: manualItem.id,
        runId: run.id,
        kind: .reviewComment,
        title: "MR review findings",
        uri: "pikiclaw://runs/run-output-follow-up/review",
        status: .draft,
        provenance: "Finding: missing validation for retry flow."
    )
    let reviewPrompt = artifactFollowUpPrompt(artifact: reviewArtifact, run: run, workItem: manualItem)

    #expect(jiraPrompt.contains("Prepare a Jira-ready update"))
    #expect(jiraPrompt.contains("paste as a Jira comment"))
    #expect(jiraPrompt.contains("Output: Evidence: validation passed"))
    #expect(reviewPrompt.contains("Prepare an MR-ready review note"))
    #expect(reviewPrompt.contains("actionable findings and risk"))
    #expect(reviewPrompt.contains("merge request review"))
    #expect(reviewPrompt.contains("Finding: missing validation for retry flow."))
    #expect(manualPrompt.contains("Continue from this saved output"))
    #expect(manualPrompt.contains("next highest-leverage action"))
    #expect(manualPrompt.contains("preserve source refs"))
}

@MainActor
@Test func saveArtifactKnowledgeNoteCreatesObsidianArtifactAndKnowledgeCard() async throws {
    let directory = URL(fileURLWithPath: NSTemporaryDirectory())
        .appendingPathComponent("pikiclaw-output-knowledge-\(UUID().uuidString)", isDirectory: true)
    let vault = directory.appendingPathComponent("Obsidian Vault", isDirectory: true)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: directory) }

    let workspace = Workspace(
        id: "workspace-output-knowledge",
        name: "Output Knowledge",
        pathDisplay: directory.path,
        trustState: .trusted
    )
    let agent = AgentProfile(
        id: "agent-output-knowledge",
        kind: .codex,
        displayName: "Codex",
        executableName: "codex",
        isEnabled: true
    )
    let workItem = WorkItem(
        id: "workitem-output-knowledge",
        workspaceId: workspace.id,
        title: "IVAS-9005: Save output knowledge",
        sourceType: .jira,
        sourceRefs: [
            SourceRef(kind: "jira", label: "IVAS-9005", uri: "https://jira.example/browse/IVAS-9005")
        ],
        state: .active,
        jira: JiraWorkItemFields(key: "IVAS-9005", status: "In Progress")
    )
    let run = AgentRun(
        id: "run-output-knowledge",
        workItemId: workItem.id,
        workspaceId: workspace.id,
        agentProfileId: agent.id,
        state: .completed,
        promptSnapshot: "Save useful output"
    )
    let artifact = Artifact(
        id: "artifact-output-knowledge",
        workspaceId: workspace.id,
        workItemId: workItem.id,
        runId: run.id,
        kind: .commandOutputSummary,
        title: "Evidence: reusable workflow",
        uri: "pikiclaw://runs/run-output-knowledge/evidence",
        status: .ready,
        provenance: "Captured durable workflow evidence",
        sourceRefs: [
            SourceRef(kind: "chat-run", label: "Save useful output", uri: "pikiclaw://runs/run-output-knowledge")
        ]
    )
    let seed = NativeAppSeed(
        projects: [],
        workspaces: [workspace],
        workItems: [workItem],
        runs: [run],
        artifacts: [artifact],
        capabilities: [],
        knowledgeCards: [],
        automations: [],
        agentProfiles: [agent],
        providerProfiles: []
    )
    let store = JSONNativeStore(fileURL: directory.appendingPathComponent("state.json"), seed: seed)
    let model = NativeAppModel(store: store)
    await model.reload()

    let noteArtifactId = try #require(await model.saveArtifactKnowledgeNote(
        artifactId: artifact.id,
        obsidianRoot: vault
    ))
    let secondNoteArtifactId = try #require(await model.saveArtifactKnowledgeNote(
        artifactId: artifact.id,
        obsidianRoot: vault
    ))

    let snapshot = try await store.loadSnapshot()
    let noteArtifact = try #require(snapshot.artifacts.first(where: { $0.id == noteArtifactId }))
    let card = try #require(snapshot.knowledgeCards.first(where: { $0.id == "knowledge-artifact-output-knowledge" }))

    #expect(noteArtifactId == secondNoteArtifactId)
    #expect(noteArtifact.kind == .obsidianNote)
    #expect(noteArtifact.uri.hasPrefix(vault.path))
    #expect(FileManager.default.fileExists(atPath: noteArtifact.uri))
    let noteBody = try String(contentsOf: URL(fileURLWithPath: noteArtifact.uri), encoding: .utf8)
    #expect(noteBody.contains("# Evidence: reusable workflow"))
    #expect(noteBody.contains("Captured durable workflow evidence"))
    #expect(noteBody.contains("IVAS-9005: Save output knowledge"))
    #expect(card.artifactRefs.contains(artifact.id))
    #expect(card.artifactRefs.contains(noteArtifact.id))
    #expect(card.sourceRefs.contains(SourceRef(kind: "artifact", label: artifact.id.rawValue, uri: artifact.uri)))
    #expect(card.sourceRefs.contains(where: { $0.kind == "obsidian" && $0.uri == noteArtifact.uri }))
    #expect(card.sourceRefs.contains(SourceRef(kind: "jira", label: "IVAS-9005", uri: "https://jira.example/browse/IVAS-9005")))
    #expect(card.tags.contains("jira"))
    #expect(model.statusLine == "Knowledge note saved")
}

@MainActor
@Test func followUpSideChatStartsChildRunWithPrompt() async throws {
    let directory = URL(fileURLWithPath: NSTemporaryDirectory())
        .appendingPathComponent("pikiclaw-follow-up-side-chat-\(UUID().uuidString)", isDirectory: true)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: directory) }

    let workspace = Workspace(
        id: "workspace-follow-up-side-chat",
        name: "Follow-up Side Chat",
        pathDisplay: directory.path,
        trustState: .trusted
    )
    let agent = AgentProfile(
        id: "agent-follow-up-side-chat",
        kind: .codex,
        displayName: "Codex",
        executableName: "codex",
        isEnabled: true
    )
    let workItem = WorkItem(
        id: "workitem-follow-up-side-chat",
        workspaceId: workspace.id,
        title: "Repair validation follow-up",
        sourceType: .jira,
        state: .active,
        acceptanceCriteria: [
            "Reproduce the failed validation",
            "Confirm the smallest safe fix"
        ],
        jira: JiraWorkItemFields(
            key: "IVAS-9012",
            url: "https://jira.example/browse/IVAS-9012",
            status: "In Progress",
            assignee: "Michael",
            priority: "High",
            issueType: "Task",
            sprint: "Sprint 14"
        )
    )
    let parent = AgentRun(
        id: "run-follow-up-parent",
        workItemId: workItem.id,
        workspaceId: workspace.id,
        agentProfileId: agent.id,
        permissionMode: .autopilot,
        state: .completed,
        endedAt: Date(timeIntervalSince1970: 10),
        promptSnapshot: "original work",
        transcript: "original answer\n[completed with exit code 0]\n"
    )
    let relatedArtifact = Artifact(
        id: "artifact-follow-up-validation",
        workspaceId: workspace.id,
        workItemId: workItem.id,
        runId: parent.id,
        kind: .verificationResult,
        title: "Validation: retry still failing",
        uri: "pikiclaw://artifacts/artifact-follow-up-validation",
        status: .failed,
        provenance: "Validation failed after the retry; inspect the smallest failing path before changing code.",
        createdAt: Date(timeIntervalSince1970: 11)
    )
    let unrelatedArtifact = Artifact(
        id: "artifact-follow-up-unrelated",
        workspaceId: workspace.id,
        workItemId: "workitem-follow-up-other",
        runId: parent.id,
        kind: .markdownReport,
        title: "Unrelated report",
        uri: "pikiclaw://artifacts/artifact-follow-up-unrelated",
        status: .ready,
        provenance: "This output belongs to a different work item.",
        createdAt: Date(timeIntervalSince1970: 12)
    )
    let relatedKnowledgeCard = KnowledgeCard(
        id: "knowledge-follow-up-validation",
        scope: .workspace,
        title: "Validation retry rule",
        body: "When retry validation fails, preserve the failing command and inspect the smallest failing path first.",
        sourceRefs: [
            SourceRef(kind: "work-item", label: workItem.title, uri: "pikiclaw://work-items/\(workItem.id.rawValue)")
        ],
        artifactRefs: [relatedArtifact.id],
        tags: ["validation", "jira"],
        confidence: 0.92,
        createdAt: Date(timeIntervalSince1970: 13),
        updatedAt: Date(timeIntervalSince1970: 13)
    )
    let unrelatedKnowledgeCard = KnowledgeCard(
        id: "knowledge-follow-up-unrelated",
        scope: .workspace,
        title: "Unrelated knowledge",
        body: "This belongs to the unrelated report.",
        sourceRefs: [],
        artifactRefs: [unrelatedArtifact.id],
        tags: ["other"],
        confidence: 1.0,
        createdAt: Date(timeIntervalSince1970: 14),
        updatedAt: Date(timeIntervalSince1970: 14)
    )
    let seed = NativeAppSeed(
        projects: [],
        workspaces: [workspace],
        workItems: [workItem],
        runs: [parent],
        artifacts: [relatedArtifact, unrelatedArtifact],
        capabilities: [],
        knowledgeCards: [relatedKnowledgeCard, unrelatedKnowledgeCard],
        automations: [],
        agentProfiles: [agent],
        providerProfiles: []
    )
    let store = JSONNativeStore(fileURL: directory.appendingPathComponent("state.json"), seed: seed)
    let capture = PromptCapture()
    let model = NativeAppModel(
        store: store,
        agentAdapterFactory: { descriptor in
            CapturingAgentAdapter(descriptor: descriptor, capture: capture)
        }
    )
    await model.reload()
    model.activeRunId = parent.id

    let childId = try #require(await model.startFollowUpSideChat(
        parentRunId: parent.id,
        prompt: "Review the failed validation in a side chat.",
        permissionMode: .readOnly,
        followUpLabel: "Review - Read-only review"
    ))

    let snapshot = try await store.loadSnapshot()
    let updatedParent = try #require(snapshot.runs.first(where: { $0.id == parent.id }))
    let child = try #require(snapshot.runs.first(where: { $0.id == childId }))

    #expect(updatedParent.sideChatRunIds == [childId])
    #expect(child.sideChatOfRunId == parent.id)
    #expect(child.permissionMode == .readOnly)
    #expect(child.contextRefs.contains(ContextRef(kind: "follow-up", label: "Review - Read-only review")))
    #expect(sideChatPaneLabel(for: child) == "Review - Read-only review")
    #expect(child.promptSnapshot == "Review the failed validation in a side chat.")
    #expect(child.transcript.contains("second answer"))
    let capturedPrompt = try #require(capture.prompts.last)
    #expect(capturedPrompt.contains("Review the failed validation in a side chat."))
    #expect(capturedPrompt.contains("focused side chat"))
    #expect(capturedPrompt.contains("- Parent run: run-follow-up-parent"))
    #expect(capturedPrompt.contains("- Follow-up: Review - Read-only review"))
    #expect(capturedPrompt.contains("- Work item: Repair validation follow-up"))
    #expect(capturedPrompt.contains("- Work item state: active"))
    #expect(capturedPrompt.contains("- Work item source: jira"))
    #expect(capturedPrompt.contains("- Jira: key IVAS-9012, status In Progress, priority High, assignee Michael, type Task, sprint Sprint 14"))
    #expect(capturedPrompt.contains("- Jira URL: https://jira.example/browse/IVAS-9012"))
    #expect(capturedPrompt.contains("- Acceptance criteria:\n- Reproduce the failed validation\n- Confirm the smallest safe fix"))
    #expect(capturedPrompt.contains("- Related outputs:\n- [verificationResult/failed] Validation: retry still failing"))
    #expect(capturedPrompt.contains("Validation failed after the retry; inspect the smallest failing path before changing code."))
    #expect(capturedPrompt.contains("pikiclaw://artifacts/artifact-follow-up-validation"))
    #expect(capturedPrompt.contains("- Related knowledge:\n- Validation retry rule [validation,jira]"))
    #expect(capturedPrompt.contains("When retry validation fails, preserve the failing command and inspect the smallest failing path first."))
    #expect(!capturedPrompt.contains("Unrelated report"))
    #expect(!capturedPrompt.contains("Unrelated knowledge"))
    #expect(capturedPrompt.contains("- Parent prompt:\noriginal work"))
    #expect(capturedPrompt.contains("- Parent output:\noriginal answer"))
    #expect(!capturedPrompt.contains("[completed with exit code 0]"))
    #expect(model.activeRunId == parent.id)
}

@MainActor
@Test func captureRunEvidenceCreatesWorkItemArtifactAndUpdatesItInPlace() async throws {
    let directory = URL(fileURLWithPath: NSTemporaryDirectory())
        .appendingPathComponent("pikiclaw-run-evidence-\(UUID().uuidString)", isDirectory: true)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: directory) }

    let workspace = Workspace(
        id: "workspace-run-evidence",
        name: "Run Evidence",
        pathDisplay: directory.path,
        trustState: .trusted
    )
    let agent = AgentProfile(
        id: "agent-run-evidence",
        kind: .codex,
        displayName: "Codex",
        executableName: "codex",
        isEnabled: true
    )
    let workItem = WorkItem(
        id: "workitem-run-evidence",
        workspaceId: workspace.id,
        title: "IVAS-9002: Repair Jira evidence flow",
        sourceType: .jira,
        sourceRefs: [
            SourceRef(kind: "jira", label: "IVAS-9002", uri: "https://jira.example/browse/IVAS-9002")
        ],
        state: .active,
        jira: JiraWorkItemFields(key: "IVAS-9002", status: "In Progress")
    )
    let run = AgentRun(
        id: "run-evidence-source",
        workItemId: workItem.id,
        workspaceId: workspace.id,
        agentProfileId: agent.id,
        state: .completed,
        endedAt: Date(timeIntervalSince1970: 10),
        promptSnapshot: "Validate Jira evidence flow",
        contextRefs: [
            ContextRef(kind: "file", label: "RootView.swift", uri: "apps/macos/Sources/PikiclawMac/RootView.swift")
        ],
        transcript: "Validated current sprint sync and captured outputs.\n[completed with exit code 0]\n"
    )
    let seed = NativeAppSeed(
        projects: [],
        workspaces: [workspace],
        workItems: [workItem],
        runs: [run],
        artifacts: [],
        capabilities: [],
        knowledgeCards: [],
        automations: [],
        agentProfiles: [agent],
        providerProfiles: []
    )
    let store = JSONNativeStore(fileURL: directory.appendingPathComponent("state.json"), seed: seed)
    let model = NativeAppModel(store: store)
    await model.reload()

    let firstArtifactId = try #require(await model.captureRunEvidence(runId: run.id))
    let secondArtifactId = try #require(await model.captureRunEvidence(runId: run.id))

    let snapshot = try await store.loadSnapshot()
    let runArtifacts = snapshot.artifacts.filter { $0.runId == run.id && $0.kind == .commandOutputSummary }
    let artifact = try #require(runArtifacts.first)

    #expect(firstArtifactId == secondArtifactId)
    #expect(runArtifacts.count == 1)
    #expect(artifact.workspaceId == workspace.id)
    #expect(artifact.workItemId == workItem.id)
    #expect(artifact.status == .ready)
    #expect(artifact.title == "Evidence: IVAS-9002: Repair Jira evidence flow")
    #expect(artifact.uri == "pikiclaw://runs/run-evidence-source/evidence")
    #expect(artifact.provenance.contains("Validated current sprint sync"))
    #expect(artifact.sourceRefs.contains(SourceRef(kind: "chat-run", label: "Validate Jira evidence flow", uri: "pikiclaw://runs/run-evidence-source")))
    #expect(artifact.sourceRefs.contains(SourceRef(kind: "jira", label: "IVAS-9002", uri: "https://jira.example/browse/IVAS-9002")))
    #expect(artifact.sourceRefs.contains(SourceRef(kind: "file", label: "RootView.swift", uri: "apps/macos/Sources/PikiclawMac/RootView.swift")))
    #expect(model.statusLine == "Evidence updated")
}

private final class PromptCapture: @unchecked Sendable {
    var prompts: [String] = []
    var permissionModes: [PermissionMode] = []
}

private struct CapturingAgentAdapter: AgentAdapter {
    let descriptor: AgentDescriptor
    let capture: PromptCapture

    func detect() async -> AgentDetection {
        AgentDetection(isAvailable: true, executablePath: "/usr/bin/true", authState: "mock", detail: "Capturing adapter")
    }

    func start(_ request: AgentLaunchRequest) -> AsyncThrowingStream<RunnerEvent, Error> {
        capture.prompts.append(request.prompt)
        capture.permissionModes.append(request.run.permissionMode)
        return AsyncThrowingStream { continuation in
            continuation.yield(.stateChanged(.running))
            continuation.yield(.output("second answer\n"))
            continuation.yield(.completed(exitCode: 0))
            continuation.finish()
        }
    }
}
