import Foundation
import Testing
@testable import PikiclawCore
@testable import PikiclawMac
@testable import PikiclawRunner

@MainActor
@Test func detectingAgentUpdatesCapabilityHealth() async throws {
    let directory = URL(fileURLWithPath: NSTemporaryDirectory())
        .appendingPathComponent("pikiclaw-agent-detect-\(UUID().uuidString)", isDirectory: true)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: directory) }

    let agent = AgentProfile(
        id: "agent-codex-detect",
        kind: .codex,
        displayName: "Codex",
        executableName: "codex",
        isEnabled: true
    )
    let seed = NativeAppSeed(
        projects: [],
        workspaces: [],
        workItems: [],
        runs: [],
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
            DetectingAgentAdapter(descriptor: descriptor, detection: AgentDetection(
                isAvailable: true,
                executablePath: "/opt/homebrew/bin/codex",
                authState: "configured",
                detail: "ready"
            ))
        }
    )
    await model.reload()

    let detection = try #require(await model.detectAgent(kind: .codex))
    let snapshot = try await store.loadSnapshot()
    let capability = try #require(snapshot.capabilities.first(where: { $0.id == "capability-agent-agent-codex-detect" }))

    #expect(detection.isAvailable)
    #expect(capability.name == "Codex CLI")
    #expect(capability.installState == "detected")
    #expect(capability.configState == "configured · /opt/homebrew/bin/codex")
    #expect(capability.healthState == .healthy)
}

@MainActor
@Test func detectingUnavailableAgentPersistsFailureDetail() async throws {
    let directory = URL(fileURLWithPath: NSTemporaryDirectory())
        .appendingPathComponent("pikiclaw-agent-detect-missing-\(UUID().uuidString)", isDirectory: true)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: directory) }

    let agent = AgentProfile(
        id: "agent-codex-missing",
        kind: .codex,
        displayName: "Codex",
        executableName: "codex",
        isEnabled: true
    )
    let seed = NativeAppSeed(
        projects: [],
        workspaces: [],
        workItems: [],
        runs: [],
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
            DetectingAgentAdapter(descriptor: descriptor, detection: AgentDetection(
                isAvailable: false,
                authState: "unknown",
                detail: "codex not found on PATH"
            ))
        }
    )
    await model.reload()

    _ = await model.detectAgent(kind: .codex)
    let snapshot = try await store.loadSnapshot()
    let capability = try #require(snapshot.capabilities.first(where: { $0.id == "capability-agent-agent-codex-missing" }))

    #expect(capability.installState == "missing")
    #expect(capability.configState == "unknown · codex not found on PATH")
    #expect(capability.healthState == .unavailable)
}

@MainActor
@Test func agentLoginStagesTerminalCommand() async throws {
    let directory = URL(fileURLWithPath: NSTemporaryDirectory())
        .appendingPathComponent("pikiclaw-agent-login-\(UUID().uuidString)", isDirectory: true)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: directory) }

    let store = JSONNativeStore(fileURL: directory.appendingPathComponent("state.json"), seed: .preview())
    let model = NativeAppModel(store: store)
    await model.reload()
    let workspace = try #require(model.snapshot.workspaces.first)

    #expect(model.stageAgentLogin(kind: .codex, workspaceId: workspace.id))
    #expect(model.terminalCommand == "codex login")
    #expect(model.terminalCurrentDirectory(for: workspace) == workspace.pathDisplay)
    #expect(model.selectedAgentKind == .codex)
    #expect(model.statusLine == "Codex login command staged in Context Terminal")
}

@MainActor
@Test func agentSmokeTestRunsReadOnlyWithReadinessPrompt() async throws {
    let directory = URL(fileURLWithPath: NSTemporaryDirectory())
        .appendingPathComponent("pikiclaw-agent-smoke-\(UUID().uuidString)", isDirectory: true)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: directory) }

    let workspace = Workspace(
        id: "workspace-agent-smoke",
        name: "Agent Smoke",
        pathDisplay: directory.path,
        currentBranch: "codex/native-agent-smoke",
        trustState: .trusted
    )
    let agent = AgentProfile(
        id: "agent-codex-smoke",
        kind: .codex,
        displayName: "Codex",
        executableName: "codex",
        isEnabled: true
    )
    let seed = NativeAppSeed(
        projects: [],
        workspaces: [workspace],
        workItems: [],
        runs: [],
        artifacts: [],
        capabilities: [],
        knowledgeCards: [],
        automations: [],
        agentProfiles: [agent],
        providerProfiles: []
    )
    let store = JSONNativeStore(fileURL: directory.appendingPathComponent("state.json"), seed: seed)
    let capture = SmokePromptCapture()
    let model = NativeAppModel(
        store: store,
        agentAdapterFactory: { descriptor in
            SmokeAgentAdapter(descriptor: descriptor, capture: capture)
        }
    )
    await model.reload()
    model.selectedPermissionMode = .autopilot

    let runId = try #require(await model.startAgentSmokeTest(kind: .codex, workspaceId: workspace.id))
    let snapshot = try await store.loadSnapshot()
    let run = try #require(snapshot.runs.first(where: { $0.id == runId }))
    let item = try #require(run.workItemId.flatMap { workItemId in
        snapshot.workItems.first(where: { $0.id == workItemId })
    })
    let prompt = try #require(capture.prompts.last)

    #expect(item.title == "Read-only agent smoke test: Codex")
    #expect(run.permissionMode == .readOnly)
    #expect(model.selectedPermissionMode == .autopilot)
    #expect(prompt.contains("Agent smoke test: Codex"))
    #expect(prompt.contains("Branch: codex/native-agent-smoke"))
    #expect(prompt.contains("Do not edit files."))
    #expect(prompt.contains("End with the next concrete action"))
}

@MainActor
@Test func agentSmokeTestRequiresWorkspace() async throws {
    let directory = URL(fileURLWithPath: NSTemporaryDirectory())
        .appendingPathComponent("pikiclaw-agent-no-workspace-\(UUID().uuidString)", isDirectory: true)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: directory) }

    let agent = AgentProfile(
        id: "agent-codex-no-workspace",
        kind: .codex,
        displayName: "Codex",
        executableName: "codex",
        isEnabled: true
    )
    let seed = NativeAppSeed(
        projects: [],
        workspaces: [],
        workItems: [],
        runs: [],
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

    let runId = await model.startAgentSmokeTest(kind: .codex)

    #expect(runId == nil)
    #expect(model.statusLine == "Add a workspace before testing Codex")
}

@MainActor
@Test func workflowTemplatesStageSpecificPrompts() async throws {
    let directory = URL(fileURLWithPath: NSTemporaryDirectory())
        .appendingPathComponent("pikiclaw-workflow-stage-\(UUID().uuidString)", isDirectory: true)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: directory) }

    let workspace = Workspace(
        id: "workspace-workflow-stage",
        name: "Workflow Stage",
        pathDisplay: directory.path,
        currentBranch: "codex/workflow-context",
        trustState: .trusted
    )
    let terminalDirectory = directory.appendingPathComponent("apps/macos", isDirectory: true)
    try FileManager.default.createDirectory(at: terminalDirectory, withIntermediateDirectories: true)
    let workItem = WorkItem(
        id: "workitem-workflow-stage",
        workspaceId: workspace.id,
        title: "Reduce workflow prompt friction",
        description: "Make launch cards carry the active task boundary.",
        sourceType: .jira,
        sourceRefs: [
            SourceRef(kind: "doc", label: "Spec A", uri: "obsidian://spec-a"),
            SourceRef(kind: "chat", label: "Planning chat"),
            SourceRef(kind: "file", label: "RootView.swift"),
            SourceRef(kind: "extra", label: "Should not appear")
        ],
        state: .active,
        priority: 7,
        acceptanceCriteria: ["Prompt includes selected work item"],
        dueAt: Date(timeIntervalSince1970: 1_800_000_000),
        externalRefs: [
            SourceRef(kind: "mr", label: "MR 42", uri: "https://example.com/mr/42")
        ],
        currentRunId: "run-workflow-stage",
        jira: JiraWorkItemFields(
            key: "PK-123",
            status: "In Progress",
            assignee: "Michael",
            priority: "High",
            issueType: "Task",
            sprint: "Sprint 12",
            remoteUpdatedAt: "2026-06-20"
        )
    )
    let store = JSONNativeStore(fileURL: directory.appendingPathComponent("state.json"), seed: NativeAppSeed(
        projects: [],
        workspaces: [workspace],
        workItems: [workItem],
        runs: [],
        artifacts: [],
        capabilities: [],
        knowledgeCards: [],
        automations: [],
        agentProfiles: [],
        providerProfiles: []
    ))
    let model = NativeAppModel(store: store)
    await model.reload()
    model.terminalWorkingDirectories[workspace.id] = terminalDirectory.path

    let regression = try #require(nativeWorkflowLaunchTemplates.first(where: { $0.id == "regression-triage" }))
    #expect(model.stageWorkflow(regression, workspaceId: workspace.id, workItemId: workItem.id))
    #expect(model.draftPrompt.contains("Run regression triage for Workflow Stage."))
    #expect(model.draftPrompt.contains("smallest safe fix"))
    #expect(model.draftPrompt.contains("Context:"))
    #expect(model.draftPrompt.contains("Path: \(directory.path)"))
    #expect(model.draftPrompt.contains("Branch: codex/workflow-context"))
    #expect(model.draftPrompt.contains("cwd: \(terminalDirectory.path)"))
    #expect(model.draftPrompt.contains("Work item: Reduce workflow prompt friction"))
    #expect(model.draftPrompt.contains("Source: jira"))
    #expect(model.draftPrompt.contains("Priority: 7"))
    #expect(model.draftPrompt.contains("Due:"))
    #expect(model.draftPrompt.contains("Current run: run-workflow-stage"))
    #expect(model.draftPrompt.contains("Jira: PK-123"))
    #expect(model.draftPrompt.contains("Jira detail: status In Progress, assignee Michael, priority High, type Task, sprint Sprint 12, updated 2026-06-20"))
    #expect(model.draftPrompt.contains("Acceptance: Prompt includes selected work item"))
    #expect(model.draftPrompt.contains("Source refs: doc: Spec A (obsidian://spec-a); chat: Planning chat; file: RootView.swift"))
    #expect(!model.draftPrompt.contains("Should not appear"))
    #expect(model.draftPrompt.contains("External refs: mr: MR 42 (https://example.com/mr/42)"))
    #expect(model.selectedAgentKind == .codex)
}

@MainActor
@Test func assistantPromptStagesWorkspaceAndWorkItemContext() async throws {
    let directory = URL(fileURLWithPath: NSTemporaryDirectory())
        .appendingPathComponent("pikiclaw-assistant-context-\(UUID().uuidString)", isDirectory: true)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: directory) }

    let workspace = Workspace(
        id: "workspace-assistant-context",
        name: "Assistant Context",
        pathDisplay: directory.path,
        currentBranch: "codex/assistant-context",
        trustState: .trusted
    )
    let workItem = WorkItem(
        id: "workitem-assistant-context",
        workspaceId: workspace.id,
        title: "Ship assistant launch context",
        description: "Assistant cards should know the selected task.",
        sourceType: .todo,
        state: .planned
    )
    let store = JSONNativeStore(fileURL: directory.appendingPathComponent("state.json"), seed: NativeAppSeed(
        projects: [],
        workspaces: [workspace],
        workItems: [workItem],
        runs: [],
        artifacts: [],
        capabilities: [],
        knowledgeCards: [],
        automations: [],
        agentProfiles: [],
        providerProfiles: []
    ))
    let model = NativeAppModel(store: store)
    await model.reload()

    #expect(model.stageAssistantPrompt(
        title: "Mac Native Builder",
        prompt: "Improve {project} from {workItem} on {branch}.",
        agentKind: .gemini,
        workspaceId: workspace.id,
        workItemId: workItem.id
    ))
    #expect(model.draftPrompt.contains("Improve Assistant Context from Ship assistant launch context on codex/assistant-context."))
    #expect(model.draftPrompt.contains("Path: \(directory.path)"))
    #expect(model.draftPrompt.contains("Work item state: planned"))
    #expect(model.selectedAgentKind == .gemini)
    #expect(model.selectedPermissionMode == .askBeforeEdit)
}

@MainActor
@Test func assistantPromptPreservesUserInputWhenStagingFromComposer() async throws {
    let directory = URL(fileURLWithPath: NSTemporaryDirectory())
        .appendingPathComponent("pikiclaw-assistant-user-input-\(UUID().uuidString)", isDirectory: true)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: directory) }

    let workspace = Workspace(
        id: "workspace-assistant-user-input",
        name: "Assistant User Input",
        pathDisplay: directory.path,
        trustState: .trusted
    )
    let store = JSONNativeStore(fileURL: directory.appendingPathComponent("state.json"), seed: NativeAppSeed(
        projects: [],
        workspaces: [workspace],
        workItems: [],
        runs: [],
        artifacts: [],
        capabilities: [],
        knowledgeCards: [],
        automations: [],
        agentProfiles: [],
        providerProfiles: []
    ))
    let model = NativeAppModel(store: store)
    await model.reload()

    #expect(model.stageAssistantPrompt(
        title: "Bug Analysis",
        prompt: "Analyze the current bug in {project}.",
        workspaceId: workspace.id,
        userInput: "Crash after Jira sync\nconversationId: p-v-user-input"
    ))
    #expect(model.draftPrompt.contains("Analyze the current bug in Assistant User Input."))
    #expect(model.draftPrompt.contains("User-provided context:\nCrash after Jira sync\nconversationId: p-v-user-input"))
    #expect(model.draftPrompt.contains("Context:"))

    let firstAssistantPrompt = model.draftPrompt
    #expect(model.stageAssistantPrompt(
        title: "MR Review",
        prompt: "Review the current changes in {project}.",
        workspaceId: workspace.id,
        userInput: firstAssistantPrompt
    ))
    #expect(model.draftPrompt.contains("Review the current changes in Assistant User Input."))
    #expect(model.draftPrompt.contains("User-provided context:\nCrash after Jira sync\nconversationId: p-v-user-input"))
    #expect(!model.draftPrompt.contains("User-provided context:\nAnalyze the current bug"))

    #expect(model.stageAssistantPrompt(
        title: "Bug Analysis",
        prompt: "Analyze the current bug in {project}.",
        workspaceId: workspace.id,
        userInput: "   "
    ))
    #expect(!model.draftPrompt.contains("User-provided context:"))

    let assistantPromptWithoutUserInput = model.draftPrompt
    #expect(model.stageAssistantPrompt(
        title: "MR Review",
        prompt: "Review the current changes in {project}.",
        workspaceId: workspace.id,
        userInput: assistantPromptWithoutUserInput
    ))
    #expect(model.draftPrompt.contains("Review the current changes in Assistant User Input."))
    #expect(!model.draftPrompt.contains("User-provided context:"))
}

@MainActor
@Test func assistantPromptCanStageRecommendedPermissionMode() async throws {
    let directory = URL(fileURLWithPath: NSTemporaryDirectory())
        .appendingPathComponent("pikiclaw-assistant-permission-\(UUID().uuidString)", isDirectory: true)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: directory) }

    let workspace = Workspace(
        id: "workspace-assistant-permission",
        name: "Assistant Permission",
        pathDisplay: directory.path,
        trustState: .trusted
    )
    let store = JSONNativeStore(fileURL: directory.appendingPathComponent("state.json"), seed: NativeAppSeed(
        projects: [],
        workspaces: [workspace],
        workItems: [],
        runs: [],
        artifacts: [],
        capabilities: [],
        knowledgeCards: [],
        automations: [],
        agentProfiles: [],
        providerProfiles: []
    ))
    let model = NativeAppModel(store: store)
    await model.reload()
    model.selectedPermissionMode = .autopilot

    #expect(model.stageAssistantPrompt(
        title: "MR Review",
        prompt: "Review {project}.",
        permissionMode: .readOnly,
        workspaceId: workspace.id
    ))

    #expect(model.selectedPermissionMode == .readOnly)
    #expect(model.draftPrompt.contains("Review Assistant Permission."))
    #expect(model.draftPrompt.contains("Permission guard:"))
    #expect(model.draftPrompt.contains("Do not edit files"))
    #expect(model.draftPrompt.contains("ask before editing"))
}

@MainActor
@Test func enterpriseParityAuditStagesReadOnlyGoalPrompt() async throws {
    let directory = URL(fileURLWithPath: NSTemporaryDirectory())
        .appendingPathComponent("pikiclaw-enterprise-parity-\(UUID().uuidString)", isDirectory: true)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: directory) }

    let workspace = Workspace(
        id: "workspace-enterprise-parity",
        name: "Enterprise Parity",
        pathDisplay: directory.path,
        currentBranch: "codex/enterprise-parity",
        trustState: .trusted
    )
    let goal = AgentEnterpriseAlignment.goalWorkItem(workspaceId: workspace.id)
    let store = JSONNativeStore(fileURL: directory.appendingPathComponent("state.json"), seed: NativeAppSeed(
        projects: [],
        workspaces: [workspace],
        workItems: [goal],
        runs: [],
        artifacts: [],
        capabilities: [],
        knowledgeCards: [],
        automations: [],
        agentProfiles: [],
        providerProfiles: []
    ))
    let model = NativeAppModel(store: store)
    await model.reload()
    model.selectedPermissionMode = .autopilot

    #expect(model.stageEnterpriseParityAudit(workspaceId: workspace.id))
    #expect(model.selectedAgentKind == .codex)
    #expect(model.selectedPermissionMode == .readOnly)
    #expect(model.statusLine == "Enterprise parity audit staged")
    #expect(model.draftPrompt.contains("Run an enterprise agent parity audit for Enterprise Parity."))
    #expect(model.draftPrompt.contains("Codex, Claude Code, and Gemini Enterprise"))
    #expect(model.draftPrompt.contains("Plan review, durable goals, human input, approvals, artifacts, resume"))
    #expect(model.draftPrompt.contains("Permission guard:"))
    #expect(model.draftPrompt.contains("Do not edit files"))
    #expect(model.draftPrompt.contains("Work item: Align Mac Native with Codex, Claude, and Gemini Enterprise"))
    #expect(model.draftPrompt.contains("Source: goal"))
    #expect(model.draftPrompt.contains("Branch: codex/enterprise-parity"))
}

@MainActor
@Test func enterpriseParityAuditRunAutoCapturesGoalEvidence() async throws {
    let directory = URL(fileURLWithPath: NSTemporaryDirectory())
        .appendingPathComponent("pikiclaw-enterprise-parity-evidence-\(UUID().uuidString)", isDirectory: true)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: directory) }

    let workspace = Workspace(
        id: "workspace-enterprise-parity-evidence",
        name: "Enterprise Parity Evidence",
        pathDisplay: directory.path,
        currentBranch: "codex/enterprise-parity-evidence",
        trustState: .trusted
    )
    let agent = AgentProfile(
        id: "agent-codex-enterprise-parity",
        kind: .codex,
        displayName: "Codex",
        executableName: "codex",
        isEnabled: true
    )
    let goal = AgentEnterpriseAlignment.goalWorkItem(workspaceId: workspace.id)
    let seed = NativeAppSeed(
        projects: [],
        workspaces: [workspace],
        workItems: [goal],
        runs: [],
        artifacts: [],
        capabilities: [],
        knowledgeCards: [],
        automations: [],
        agentProfiles: [agent],
        providerProfiles: []
    )
    let store = JSONNativeStore(fileURL: directory.appendingPathComponent("state.json"), seed: seed)
    let capture = SmokePromptCapture()
    let model = NativeAppModel(
        store: store,
        agentAdapterFactory: { descriptor in
            SmokeAgentAdapter(descriptor: descriptor, capture: capture)
        }
    )
    await model.reload()

    #expect(model.stageEnterpriseParityAudit(workspaceId: workspace.id))
    let runId = try #require(await model.run(workItemId: goal.id, promptOverride: model.draftPrompt))
    let snapshot = try await store.loadSnapshot()
    let run = try #require(snapshot.runs.first(where: { $0.id == runId }))
    let artifact = try #require(snapshot.artifacts.first { artifact in
        artifact.runId == runId
            && artifact.workItemId == goal.id
            && artifact.kind == .commandOutputSummary
    })

    #expect(run.state == .completed)
    #expect(run.permissionMode == .readOnly)
    #expect(artifact.status == .ready)
    #expect(artifact.title == "Evidence: Align Mac Native with Codex, Claude, and Gemini Enterprise")
    #expect(artifact.uri == "pikiclaw://runs/\(runId.rawValue)/evidence")
    #expect(artifact.provenance.contains("smoke ok"))
    #expect(artifact.sourceRefs.contains(SourceRef(kind: "work-item", label: goal.title, uri: "pikiclaw://work-items/\(goal.id.rawValue)")))
    #expect(artifact.sourceRefs.contains { $0.kind == "chat-run" && $0.uri == "pikiclaw://runs/\(runId.rawValue)" })
    #expect(model.statusLine == "Enterprise parity evidence saved")
    #expect(capture.prompts.last?.contains("Run an enterprise agent parity audit") == true)
}

@MainActor
@Test func assistantTemplatePromptAppliesReadOnlyGuardOnlyWhenEffectivePermissionIsReadOnly() async throws {
    let directory = URL(fileURLWithPath: NSTemporaryDirectory())
        .appendingPathComponent("pikiclaw-assistant-template-guard-\(UUID().uuidString)", isDirectory: true)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: directory) }

    let workspace = Workspace(
        id: "workspace-assistant-template-guard",
        name: "Assistant Template Guard",
        pathDisplay: directory.path,
        trustState: .trusted
    )
    let store = JSONNativeStore(fileURL: directory.appendingPathComponent("state.json"), seed: NativeAppSeed(
        projects: [],
        workspaces: [workspace],
        workItems: [],
        runs: [],
        artifacts: [],
        capabilities: [],
        knowledgeCards: [],
        automations: [],
        agentProfiles: [],
        providerProfiles: []
    ))
    let model = NativeAppModel(store: store)
    await model.reload()

    let review = try #require(assistantLaunchTemplates.first(where: { $0.id == "mr-review" }))
    model.selectedPermissionMode = .autopilot
    #expect(model.stageAssistantPrompt(
        title: review.title,
        prompt: review.prompt,
        agentKind: review.agentKind,
        permissionMode: review.permissionMode,
        workspaceId: workspace.id
    ))
    #expect(model.selectedPermissionMode == .readOnly)
    #expect(model.draftPrompt.contains("Permission guard:"))
    #expect(model.draftPrompt.contains("Read-only task: inspect, analyze, and report only."))

    model.draftPrompt = "Please review the Jira sync diff first."
    #expect(model.stageAssistantPrompt(
        title: review.title,
        prompt: review.prompt,
        agentKind: review.agentKind,
        permissionMode: review.permissionMode,
        workspaceId: workspace.id,
        userInput: model.draftPrompt
    ))
    #expect(model.selectedPermissionMode == .readOnly)
    #expect(model.draftPrompt.contains("Permission guard:"))
    #expect(model.draftPrompt.contains("User-provided context:\nPlease review the Jira sync diff first."))

    let bug = try #require(assistantLaunchTemplates.first(where: { $0.id == "bug-analysis" }))
    model.selectedPermissionMode = .autopilot
    #expect(model.stageAssistantPrompt(
        title: bug.title,
        prompt: bug.prompt,
        agentKind: bug.agentKind,
        permissionMode: bug.permissionMode,
        workspaceId: workspace.id
    ))
    #expect(model.selectedPermissionMode == .readOnly)
    #expect(model.draftPrompt.contains("Permission guard:"))
    #expect(model.draftPrompt.contains("Read-only task: inspect, analyze, and report only."))

    let skill = try #require(assistantLaunchTemplates.first(where: { $0.id == "skill-hardening" }))
    model.selectedPermissionMode = .autopilot
    #expect(model.stageAssistantPrompt(
        title: skill.title,
        prompt: skill.prompt,
        agentKind: skill.agentKind,
        permissionMode: skill.permissionMode,
        workspaceId: workspace.id
    ))
    #expect(model.selectedPermissionMode == .askBeforeEdit)
    #expect(!model.draftPrompt.contains("Permission guard:"))
    #expect(model.draftPrompt.contains("Harden a high-frequency Pikiclaw skill"))
}

@MainActor
@Test func assistantPromptIncludesGitChangeSummaryWhenWorkspaceIsRepository() async throws {
    let directory = URL(fileURLWithPath: NSTemporaryDirectory())
        .appendingPathComponent("pikiclaw-assistant-git-context-\(UUID().uuidString)", isDirectory: true)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    let stateURL = directory
        .deletingLastPathComponent()
        .appendingPathComponent("pikiclaw-assistant-git-context-state-\(UUID().uuidString).json")
    defer {
        try? FileManager.default.removeItem(at: directory)
        try? FileManager.default.removeItem(at: stateURL)
    }

    try runGit(["init"], in: directory)
    let changedFile = directory.appendingPathComponent("RootView.swift")
    try "first line\n".data(using: .utf8)!.write(to: changedFile)
    try runGit(["add", "RootView.swift"], in: directory)
    try "first line\nsecond line\n".data(using: .utf8)!.write(to: changedFile)

    let workspace = Workspace(
        id: "workspace-assistant-git-context",
        name: "Assistant Git Context",
        pathDisplay: directory.path,
        trustState: .trusted
    )
    let store = JSONNativeStore(fileURL: stateURL, seed: NativeAppSeed(
        projects: [],
        workspaces: [workspace],
        workItems: [],
        runs: [],
        artifacts: [],
        capabilities: [],
        knowledgeCards: [],
        automations: [],
        agentProfiles: [],
        providerProfiles: []
    ))
    let model = NativeAppModel(store: store)
    await model.reload()

    #expect(model.stageAssistantPrompt(
        title: "MR Review",
        prompt: "Review {project}.",
        permissionMode: .readOnly,
        workspaceId: workspace.id
    ))

    #expect(model.draftPrompt.contains("Git changes: 1 file"))
    #expect(model.draftPrompt.contains("AM RootView.swift"))
    #expect(model.draftPrompt.contains("Git diff: staged"))
    #expect(model.draftPrompt.contains("unstaged"))
}

@MainActor
@Test func assistantPromptIncludesAvailableSkillCommands() async throws {
    let directory = URL(fileURLWithPath: NSTemporaryDirectory())
        .appendingPathComponent("pikiclaw-assistant-skill-context-\(UUID().uuidString)", isDirectory: true)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: directory) }

    let workspace = Workspace(
        id: "workspace-assistant-skill-context",
        name: "Assistant Skill Context",
        pathDisplay: directory.path,
        trustState: .trusted
    )
    let logtrace = Capability(
        kind: .skill,
        name: "IVA Log Tracer",
        scope: .workspace,
        installState: "installed",
        configState: "ready",
        trustLevel: .trusted,
        healthState: .healthy
    )
    let clickhouse = Capability(
        kind: .skill,
        name: "ClickHouse Query",
        scope: .workspace,
        installState: "installed",
        configState: "ready",
        trustLevel: .trusted,
        healthState: .healthy
    )
    let cli = Capability(
        kind: .cliTool,
        name: "Codex CLI",
        scope: .global,
        installState: "installed",
        configState: "ready",
        trustLevel: .trusted,
        healthState: .healthy
    )
    let store = JSONNativeStore(fileURL: directory.appendingPathComponent("state.json"), seed: NativeAppSeed(
        projects: [],
        workspaces: [workspace],
        workItems: [],
        runs: [],
        artifacts: [],
        capabilities: [clickhouse, cli, logtrace],
        knowledgeCards: [],
        automations: [],
        agentProfiles: [],
        providerProfiles: []
    ))
    let model = NativeAppModel(store: store)
    await model.reload()

    let logAnalysis = try #require(assistantLaunchTemplates.first(where: { $0.id == "log-analysis" }))
    #expect(model.stageAssistantPrompt(
        title: logAnalysis.title,
        prompt: logAnalysis.prompt,
        agentKind: logAnalysis.agentKind,
        permissionMode: logAnalysis.permissionMode,
        workspaceId: workspace.id
    ))

    #expect(model.draftPrompt.contains("Available skills: /logtrace (IVA Log Tracer, ready); /clickhouse (ClickHouse Query, ready)"))
    #expect(!model.draftPrompt.contains("Codex CLI"))
}

@MainActor
@Test func assistantPromptIncludesRelevantOutputsAndKnowledgeCards() async throws {
    let directory = URL(fileURLWithPath: NSTemporaryDirectory())
        .appendingPathComponent("pikiclaw-assistant-evidence-context-\(UUID().uuidString)", isDirectory: true)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: directory) }

    let workspace = Workspace(
        id: "workspace-evidence-context",
        name: "Evidence Context",
        pathDisplay: directory.path,
        currentBranch: "codex/evidence-context",
        trustState: .trusted
    )
    let otherWorkspace = Workspace(
        id: "workspace-evidence-other",
        name: "Other Evidence",
        pathDisplay: directory.appendingPathComponent("other", isDirectory: true).path,
        trustState: .trusted
    )
    let workItem = WorkItem(
        id: "workitem-evidence-context",
        workspaceId: workspace.id,
        title: "Review saved evidence",
        description: "Assistant prompts should carry high-value prior outputs.",
        sourceType: .jira,
        state: .active,
        jira: JiraWorkItemFields(key: "IVAS-9100", status: "In Progress")
    )
    let artifact = Artifact(
        id: "artifact-evidence-context",
        workspaceId: workspace.id,
        workItemId: workItem.id,
        runId: "run-evidence-context",
        kind: .commandOutputSummary,
        title: "Evidence: validation passed",
        uri: "pikiclaw://runs/run-evidence-context/evidence",
        status: .ready,
        provenance: """
        Validated the saved output workflow.
        Decision: not ready to merge until retry validation is captured.
        Merge readiness:
        - Blocked on missing nil workspace guard.
        - Approval can proceed after focused validation.
        Request changes: add the guard before posting Jira done.
        Blockers:
        - waiting for Jira write permission.
        Risk: full app smoke has not run.
        Open question: whether voice flow needs a manual smoke pass.
        Next action: run the focused validation and paste the result into Jira.
        Validation: git diff --check passed
        Next command: `swift test --filter ChatMessageHistoryTests`
        """,
        createdAt: Date(timeIntervalSince1970: 20)
    )
    let unrelated = Artifact(
        id: "artifact-evidence-unrelated",
        workspaceId: otherWorkspace.id,
        workItemId: nil,
        kind: .commandOutputSummary,
        title: "Unrelated output",
        uri: "pikiclaw://runs/unrelated/evidence",
        status: .ready,
        provenance: "Should not leak.",
        createdAt: Date(timeIntervalSince1970: 30)
    )
    let card = KnowledgeCard(
        id: "knowledge-evidence-context",
        scope: .workspace,
        title: "Evidence workflow shortcut",
        body: "Saved outputs can drive follow-up assistant prompts.",
        sourceRefs: [
            SourceRef(kind: "work-item", label: workItem.title, uri: "pikiclaw://work-items/\(workItem.id.rawValue)")
        ],
        artifactRefs: [artifact.id],
        tags: ["output", "jira"],
        confidence: 0.9,
        createdAt: Date(timeIntervalSince1970: 40),
        updatedAt: Date(timeIntervalSince1970: 40)
    )
    let unrelatedCard = KnowledgeCard(
        id: "knowledge-evidence-unrelated",
        scope: .workspace,
        title: "Unrelated card",
        body: "This should not be part of the selected task.",
        sourceRefs: [],
        artifactRefs: [unrelated.id],
        tags: ["output"],
        confidence: 1.0
    )
    let failedRun = AgentRun(
        id: "run-evidence-failed",
        workItemId: workItem.id,
        workspaceId: workspace.id,
        agentProfileId: "agent-codex",
        permissionMode: .askBeforeEdit,
        state: .failed,
        startedAt: Date(timeIntervalSince1970: 50),
        endedAt: Date(timeIntervalSince1970: 60),
        promptSnapshot: "Validate saved output workflow\nwith extra detail"
    )
    let unrelatedRun = AgentRun(
        id: "run-evidence-unrelated",
        workspaceId: otherWorkspace.id,
        agentProfileId: "agent-codex",
        permissionMode: .askBeforeEdit,
        state: .failed,
        promptSnapshot: "Should not leak run context"
    )
    let store = JSONNativeStore(fileURL: directory.appendingPathComponent("state.json"), seed: NativeAppSeed(
        projects: [],
        workspaces: [workspace, otherWorkspace],
        workItems: [workItem],
        runs: [failedRun, unrelatedRun],
        artifacts: [artifact, unrelated],
        capabilities: [],
        knowledgeCards: [card, unrelatedCard],
        automations: [],
        agentProfiles: [],
        providerProfiles: []
    ))
    let model = NativeAppModel(store: store)
    await model.reload()

    let summary = model.assistantLaunchContextSummary(workspaceId: workspace.id, workItemId: workItem.id)
    #expect(summary.outputCount == 1)
    #expect(summary.artifactRefCount == 1)
    #expect(summary.pendingCommands == ["swift test --filter ChatMessageHistoryTests"])
    #expect(summary.validationEvidence == ["git diff --check (passed)"])
    #expect(summary.decisionSignals == [
        "Decision: not ready to merge until retry validation is captured.",
        "Readiness: Blocked on missing nil workspace guard. | Approval can proceed after focused validation.",
        "Approval: add the guard before posting Jira done."
    ])
    #expect(summary.actionableNotes == [
        "Blocker: waiting for Jira write permission.",
        "Risk: full app smoke has not run.",
        "Open question: whether voice flow needs a manual smoke pass.",
        "Next action: run the focused validation and paste the result into Jira."
    ])
    #expect(summary.knowledgeCardCount == 1)
    #expect(summary.recentRunCount == 1)
    #expect(summary.hasContextPack)

    #expect(model.stageAssistantPrompt(
        title: "MR Review",
        prompt: "Review current work in {project}.",
        workspaceId: workspace.id,
        workItemId: workItem.id
    ))

    #expect(model.draftPrompt.contains("Relevant outputs: commandOutputSummary ready: Evidence: validation passed"))
    #expect(model.draftPrompt.contains("Decision signals: Decision: not ready to merge until retry validation is captured.; Readiness: Blocked on missing nil workspace guard. | Approval can proceed after focused validation.; Approval: add the guard before posting Jira done."))
    #expect(model.draftPrompt.contains("Actionable notes: Blocker: waiting for Jira write permission.; Risk: full app smoke has not run.; Open question: whether voice flow needs a manual smoke pass.; Next action: run the focused validation and paste the result into Jira."))
    #expect(model.draftPrompt.contains("Validation evidence: git diff --check (passed)"))
    #expect(model.draftPrompt.contains("Artifact refs: Evidence: validation passed (pikiclaw://runs/run-evidence-context/evidence)"))
    #expect(model.draftPrompt.contains("Pending commands: swift test --filter ChatMessageHistoryTests"))
    #expect(model.draftPrompt.contains("Knowledge cards: Evidence workflow shortcut [output,jira]: Saved outputs can drive follow-up assistant prompts."))
    #expect(model.draftPrompt.contains("Recent runs: failed run-evidence-failed: Validate saved output workflow"))
    #expect(model.draftPrompt.contains("Jira: IVAS-9100"))
    #expect(!model.draftPrompt.contains("Unrelated output"))
    #expect(!model.draftPrompt.contains("Unrelated card"))
    #expect(!model.draftPrompt.contains("Should not leak run context"))
}

@MainActor
@Test func launchPromptIgnoresWorkItemFromDifferentWorkspace() async throws {
    let directory = URL(fileURLWithPath: NSTemporaryDirectory())
        .appendingPathComponent("pikiclaw-launch-context-mismatch-\(UUID().uuidString)", isDirectory: true)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: directory) }

    let selectedWorkspace = Workspace(
        id: "workspace-selected",
        name: "Selected Workspace",
        pathDisplay: directory.appendingPathComponent("selected", isDirectory: true).path,
        trustState: .trusted
    )
    let otherWorkspace = Workspace(
        id: "workspace-other",
        name: "Other Workspace",
        pathDisplay: directory.appendingPathComponent("other", isDirectory: true).path,
        trustState: .trusted
    )
    let otherItem = WorkItem(
        id: "workitem-other",
        workspaceId: otherWorkspace.id,
        title: "Do not attach this task",
        sourceType: .todo,
        state: .active
    )
    let store = JSONNativeStore(fileURL: directory.appendingPathComponent("state.json"), seed: NativeAppSeed(
        projects: [],
        workspaces: [selectedWorkspace, otherWorkspace],
        workItems: [otherItem],
        runs: [],
        artifacts: [],
        capabilities: [],
        knowledgeCards: [],
        automations: [],
        agentProfiles: [],
        providerProfiles: []
    ))
    let model = NativeAppModel(store: store)
    await model.reload()

    #expect(model.stageAssistantPrompt(
        title: "Mismatch Guard",
        prompt: "Start {project}.",
        workspaceId: selectedWorkspace.id,
        workItemId: otherItem.id
    ))
    #expect(model.draftPrompt.contains("Workspace: Selected Workspace"))
    #expect(!model.draftPrompt.contains("Do not attach this task"))
    #expect(!model.draftPrompt.contains("Work item state: active"))
}

@MainActor
@Test func launchPromptFallsBackToCurrentActiveWorkItem() async throws {
    let directory = URL(fileURLWithPath: NSTemporaryDirectory())
        .appendingPathComponent("pikiclaw-launch-context-fallback-\(UUID().uuidString)", isDirectory: true)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: directory) }

    let workspace = Workspace(
        id: "workspace-fallback",
        name: "Fallback Workspace",
        pathDisplay: directory.path,
        currentBranch: "codex/fallback-context",
        trustState: .trusted
    )
    let archived = WorkItem(
        id: "workitem-archived-fallback",
        workspaceId: workspace.id,
        title: "Archived task should not leak",
        sourceType: .todo,
        state: .archived,
        updatedAt: Date(timeIntervalSince1970: 20_000)
    )
    let active = WorkItem(
        id: "workitem-active-fallback",
        workspaceId: workspace.id,
        title: "Investigate Jira queue regression",
        description: "Jira quick actions should launch with the selected ticket context.",
        sourceType: .jira,
        state: .active,
        priority: 3,
        updatedAt: Date(timeIntervalSince1970: 10_000),
        jira: JiraWorkItemFields(
            key: "IVAS-4321",
            url: "https://jira.example/browse/IVAS-4321",
            status: "In Progress",
            assignee: "Michael",
            priority: "High",
            issueType: "Bug",
            sprint: "Mac Native"
        )
    )
    let store = JSONNativeStore(fileURL: directory.appendingPathComponent("state.json"), seed: NativeAppSeed(
        projects: [],
        workspaces: [workspace],
        workItems: [archived, active],
        runs: [],
        artifacts: [],
        capabilities: [],
        knowledgeCards: [],
        automations: [],
        agentProfiles: [],
        providerProfiles: []
    ))
    let model = NativeAppModel(store: store)
    await model.reload()

    #expect(model.assistantLaunchContextWorkItem(workspaceId: workspace.id)?.id == active.id)

    #expect(model.stageAssistantPrompt(
        title: "Bug Assistant",
        prompt: "Analyze the current work for {project}.",
        workspaceId: workspace.id
    ))
    #expect(model.draftPrompt.contains("Work item: Investigate Jira queue regression"))
    #expect(model.draftPrompt.contains("Jira: IVAS-4321"))
    #expect(model.draftPrompt.contains("Jira detail: status In Progress"))
    #expect(model.draftPrompt.contains("Source: jira"))
    #expect(!model.draftPrompt.contains("Archived task should not leak"))
}

@MainActor
@Test func workflowBuilderAndImportStageActionablePrompts() async throws {
    let directory = URL(fileURLWithPath: NSTemporaryDirectory())
        .appendingPathComponent("pikiclaw-workflow-builder-\(UUID().uuidString)", isDirectory: true)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: directory) }

    let workspace = Workspace(
        id: "workspace-workflow-builder",
        name: "Workflow Builder",
        pathDisplay: directory.path,
        currentBranch: "codex/workflow-builder",
        trustState: .trusted
    )
    let store = JSONNativeStore(fileURL: directory.appendingPathComponent("state.json"), seed: NativeAppSeed(
        projects: [],
        workspaces: [workspace],
        workItems: [],
        runs: [],
        artifacts: [],
        capabilities: [],
        knowledgeCards: [],
        automations: [],
        agentProfiles: [],
        providerProfiles: []
    ))
    let model = NativeAppModel(store: store)
    await model.reload()

    #expect(model.stageWorkflowBuilder(workspaceId: workspace.id))
    #expect(model.draftPrompt.contains("Design a reusable Pikiclaw workflow for Workflow Builder."))
    #expect(model.draftPrompt.contains("agent/skill routing"))
    #expect(model.draftPrompt.contains("smallest verification step"))
    #expect(model.draftPrompt.contains("Branch: codex/workflow-builder"))

    #expect(model.stageWorkflowImport(workspaceId: workspace.id))
    #expect(model.draftPrompt.contains("Import or convert an existing repeated process"))
    #expect(model.draftPrompt.contains("native workflow card"))
    #expect(model.draftPrompt.contains("Preserve source provenance"))
    #expect(model.draftPrompt.contains("ask before installing tools"))
}

@Test func workflowTemplateLibraryCoversHighFrequencyWork() {
    let ids = nativeWorkflowLaunchTemplates.map(\.id)
    #expect(Set(ids).count == ids.count)
    #expect(ids.contains("repository-audit"))
    #expect(ids.contains("regression-triage"))
    #expect(ids.contains("release-readiness"))
    #expect(ids.contains("native-mac-validation"))
    #expect(ids.contains("skill-hardening"))
    #expect(ids.contains("context-handoff"))
    #expect(ids.contains("jira-sprint-sweep"))
    #expect(ids.contains("post-run-evidence-review"))
}

@Test func chatQuickLaunchAssistantsCoverHighFrequencyWork() throws {
    let templates = newChatAssistantQuickLaunchTemplates()
    let ids = templates.map(\.id)

    #expect(ids == newChatAssistantQuickLaunchTemplateIDs)
    #expect(Set(ids).count == ids.count)
    #expect(ids.contains("bug-analysis"))
    #expect(ids.contains("mr-review"))
    #expect(ids.contains("validation"))
    #expect(ids.contains("jira-execution"))
    #expect(ids.contains("log-analysis"))
    #expect(ids.contains("skill-hardening"))

    let skill = templates.first(where: { $0.id == "skill-hardening" })
    #expect(skill?.title == "Skill Hardening Assistant")
    #expect(skill?.prompt.contains("parameter clarity") == true)
    #expect(skill?.prompt.contains("focused validation") == true)
    let logAnalysis = templates.first(where: { $0.id == "log-analysis" })
    #expect(logAnalysis?.prompt.contains("/logtrace") == true)
    #expect(logAnalysis?.prompt.contains("/clickhouse") == true)

    #expect(templates.first(where: { $0.id == "mr-review" })?.permissionMode == .readOnly)
    #expect(templates.first(where: { $0.id == "validation" })?.permissionMode == .askBeforeEdit)
    #expect(templates.first(where: { $0.id == "jira-execution" })?.permissionMode == .askBeforeEdit)
    #expect(templates.first(where: { $0.id == "log-analysis" })?.permissionMode == .readOnly)
    #expect(assistantLaunchTemplates.first(where: { $0.id == "release-check" })?.permissionMode == .readOnly)
    #expect(templates.first(where: { $0.id == "bug-analysis" })?.permissionMode == .readOnly)
    #expect(templates.first(where: { $0.id == "skill-hardening" })?.permissionMode == .askBeforeEdit)

    let review = try #require(templates.first(where: { $0.id == "mr-review" }))
    let jira = try #require(templates.first(where: { $0.id == "jira-execution" }))
    let bug = try #require(templates.first(where: { $0.id == "bug-analysis" }))
    let validation = try #require(templates.first(where: { $0.id == "validation" }))
    let skillTemplate = try #require(templates.first(where: { $0.id == "skill-hardening" }))
    let logs = try #require(templates.first(where: { $0.id == "log-analysis" }))
    let release = try #require(assistantLaunchTemplates.first(where: { $0.id == "release-check" }))
    #expect(assistantTemplatePermissionMode(review, current: .autopilot) == .readOnly)
    #expect(assistantTemplatePermissionMode(validation, current: .readOnly) == .askBeforeEdit)
    #expect(assistantTemplatePermissionMode(jira, current: .readOnly) == .askBeforeEdit)
    #expect(assistantTemplatePermissionMode(bug, current: .autopilot) == .readOnly)
    #expect(assistantTemplatePermissionMode(skillTemplate, current: .autopilot) == .askBeforeEdit)

    #expect(bug.prompt.contains("Output contract:"))
    #expect(bug.prompt.contains("Confirmed facts, likely seam, smallest safe fix, focused validation, and missing input"))
    #expect(bug.prompt.contains("Efficiency handoff:"))
    #expect(bug.prompt.contains("ready-to-use bug handoff"))
    #expect(bug.prompt.contains("artifact title and body"))
    #expect(review.prompt.contains("findings, open questions, verification gaps, and ready/not-ready"))
    #expect(review.prompt.contains("paste-ready MR review comment"))
    #expect(review.prompt.contains("merge readiness"))
    #expect(validation.prompt.contains("check run, result, evidence, and next action"))
    #expect(validation.prompt.contains("ready-to-paste validation note"))
    #expect(validation.prompt.contains("Do not modify implementation during this validation pass"))
    #expect(jira.prompt.contains("ticket boundary, implementation seam, change plan, validation, and Jira update"))
    #expect(jira.prompt.contains("paste-ready Jira update"))
    #expect(jira.prompt.contains("Preserve acceptance criteria, source refs, external refs, and ticket key"))
    #expect(logs.prompt.contains("IDs checked, timeline/phases, error family, ambiguity, and next lookup"))
    #expect(logs.prompt.contains("exact next `/logtrace` or `/clickhouse` command"))
    #expect(logs.prompt.contains("phase summary that can be pasted into Jira"))
    #expect(skillTemplate.prompt.contains("skill path, current failure, invocation improvement, guardrail/doc change, and validation"))
    #expect(skillTemplate.prompt.contains("improved invocation shape"))
    #expect(skillTemplate.prompt.contains("knowledge-card body"))
    #expect(release.prompt.contains("checks run, result, go/no-go, blocking risks, and handoff"))
    #expect(release.prompt.contains("ready-to-use handoff"))
}

@Test func assistantLaunchRecommendationPrioritizesContextSignals() throws {
    let jiraItem = WorkItem(
        id: "jira-recommendation",
        workspaceId: "workspace-recommendation",
        title: "IVAS-9300: Reduce launch friction",
        sourceType: .jira,
        jira: JiraWorkItemFields(key: "IVAS-9300", status: "In Progress")
    )
    let pendingValidation = AssistantLaunchContextSummary(
        outputCount: 1,
        artifactRefCount: 1,
        pendingCommands: ["swift test --filter AgentStudioWorkflowTests"],
        validationEvidence: [],
        decisionSignals: [],
        actionableNotes: [],
        knowledgeCardCount: 0,
        recentRunCount: 1
    )

    let validation = try #require(assistantLaunchRecommendation(summary: pendingValidation, workItem: jiraItem))
    #expect(validation.templateId == "validation")
    #expect(validation.reason == "Pending check")
    #expect(assistantLaunchTemplatesForContext(newChatAssistantQuickLaunchTemplates(), recommendation: validation).first?.id == "validation")

    let logContext = AssistantLaunchContextSummary(
        outputCount: 1,
        artifactRefCount: 0,
        pendingCommands: ["/logtrace env=lab conversationId=p-v-voice last=24h"],
        validationEvidence: [],
        decisionSignals: [],
        actionableNotes: [],
        knowledgeCardCount: 0,
        recentRunCount: 0
    )
    #expect(assistantLaunchRecommendation(summary: logContext, workItem: jiraItem)?.templateId == "log-analysis")

    let skillContext = AssistantLaunchContextSummary(
        outputCount: 1,
        artifactRefCount: 0,
        pendingCommands: [],
        validationEvidence: [],
        decisionSignals: [],
        actionableNotes: ["Skill /logtrace failed because IVA_LOGTRACER_ENV_FILE is missing."],
        knowledgeCardCount: 0,
        recentRunCount: 0
    )
    #expect(assistantLaunchRecommendation(summary: skillContext, workItem: jiraItem)?.templateId == "skill-hardening")

    let blockedContext = AssistantLaunchContextSummary(
        outputCount: 1,
        artifactRefCount: 1,
        pendingCommands: [],
        validationEvidence: [],
        decisionSignals: ["Decision: not ready to merge until validation is captured."],
        actionableNotes: [],
        knowledgeCardCount: 0,
        recentRunCount: 1
    )
    #expect(assistantLaunchRecommendation(summary: blockedContext, workItem: nil)?.templateId == "bug-analysis")

    let reviewReady = AssistantLaunchContextSummary(
        outputCount: 1,
        artifactRefCount: 1,
        pendingCommands: [],
        validationEvidence: ["swift test --filter AgentStudioWorkflowTests (passed)"],
        decisionSignals: [],
        actionableNotes: [],
        knowledgeCardCount: 0,
        recentRunCount: 1
    )
    #expect(assistantLaunchRecommendation(summary: reviewReady, workItem: nil)?.templateId == "mr-review")

    let emptyContext = AssistantLaunchContextSummary(
        outputCount: 0,
        artifactRefCount: 0,
        pendingCommands: [],
        validationEvidence: [],
        decisionSignals: [],
        actionableNotes: [],
        knowledgeCardCount: 0,
        recentRunCount: 0
    )
    #expect(assistantLaunchRecommendation(summary: emptyContext, workItem: jiraItem)?.templateId == "jira-execution")
    #expect(assistantLaunchRecommendation(summary: emptyContext, workItem: nil) == nil)
}

@Test func composerSkillDraftsKeepExistingInputAsSkillArguments() {
    let logtrace = Capability(
        kind: .skill,
        name: "IVA Log Tracer",
        scope: .workspace,
        installState: "installed",
        configState: "ready",
        trustLevel: .trusted,
        healthState: .healthy
    )
    let clickhouse = Capability(
        kind: .skill,
        name: "ClickHouse Query",
        scope: .workspace,
        installState: "installed",
        configState: "ready",
        trustLevel: .trusted,
        healthState: .healthy
    )

    let logtraceCommand = composerSkillCommand(for: logtrace)
    let traceParent = "00-4a0031017ceb19eab6d3a39468a20000-0123456789abcdef-01"
    #expect(logtraceCommand == "/logtrace env=lab conversationId= last=24h ")
    #expect(composerSkillPreviewCommand(for: logtrace, existingText: "prod p-v-voice-123 48h") == "/logtrace env=production conversationId=p-v-voice-123 last=48h")
    #expect(composerSkillPreviewCommand(for: logtrace, existingText: "field=message Cannot send generation request last=2h") == "/logtrace env=lab query=\"message:\\\"Cannot send generation request\\\"\" last=2h")
    #expect(composerSkillDraft(command: logtraceCommand, existingText: "") == logtraceCommand)
    #expect(composerSkillDraft(command: logtraceCommand, existingText: "p-v-voice-123") == "/logtrace env=lab conversationId=p-v-voice-123 last=24h")
    #expect(composerSkillDraft(command: logtraceCommand, existingText: "prod p-v-voice-123 48h") == "/logtrace env=production conversationId=p-v-voice-123 last=48h")
    #expect(composerSkillDraft(command: logtraceCommand, existingText: "prod p-v-voice-123 48 hours") == "/logtrace env=production conversationId=p-v-voice-123 last=48h")
    #expect(composerSkillDraft(command: logtraceCommand, existingText: "prd p-v-voice-123 2h") == "/logtrace env=production conversationId=p-v-voice-123 last=2h")
    #expect(composerSkillDraft(command: logtraceCommand, existingText: "stg p-v-stage-123 2h") == "/logtrace env=stage conversationId=p-v-stage-123 last=2h")
    #expect(composerSkillDraft(command: logtraceCommand, existingText: "cnlab03 p-v-voice-123 最近 30 分钟") == "/logtrace env=lab conversationId=p-v-voice-123 last=30m")
    #expect(composerSkillDraft(command: logtraceCommand, existingText: "lab05 agent stayed silent") == "/logtrace env=lab conversationId= last=24h symptom=\"agent stayed silent\"")
    #expect(composerSkillDraft(command: logtraceCommand, existingText: "production agent stayed silent 48h") == "/logtrace env=production conversationId= last=48h symptom=\"agent stayed silent\"")
    #expect(composerSkillDraft(command: logtraceCommand, existingText: "production agent stayed silent last 48 hours") == "/logtrace env=production conversationId= last=48h symptom=\"agent stayed silent\"")
    #expect(composerSkillDraft(command: logtraceCommand, existingText: "最近 2 天 agent stayed silent") == "/logtrace env=lab conversationId= last=2d symptom=\"agent stayed silent\"")
    #expect(composerSkillDraft(command: logtraceCommand, existingText: "最近 30 分钟 agent stayed silent") == "/logtrace env=lab conversationId= last=30m symptom=\"agent stayed silent\"")
    #expect(composerSkillDraft(command: logtraceCommand, existingText: "env=production agent stayed silent last=48h") == "/logtrace env=production conversationId= last=48h symptom=\"agent stayed silent\"")
    #expect(composerSkillDraft(command: logtraceCommand, existingText: "conversationId: p-v-voice-123") == "/logtrace env=lab conversationId=p-v-voice-123 last=24h")
    #expect(composerSkillDraft(command: logtraceCommand, existingText: "conversationId=p-v-voice-123") == "/logtrace env=lab conversationId=p-v-voice-123 last=24h")
    #expect(composerSkillDraft(command: logtraceCommand, existingText: "env=production conversationId=p-v-voice-123 last=48h") == "/logtrace env=production conversationId=p-v-voice-123 last=48h")
    #expect(composerSkillDraft(command: logtraceCommand, existingText: "no audio sessionId s-voice-123") == "/logtrace env=lab sessionId=s-voice-123 last=24h")
    #expect(composerSkillDraft(command: logtraceCommand, existingText: "trace_id: trace_123") == "/logtrace env=lab traceId=trace_123 last=24h")
    #expect(composerSkillDraft(command: logtraceCommand, existingText: "trace id 0123456789abcdef0123456789abcdef") == "/logtrace env=lab traceId=0123456789abcdef0123456789abcdef last=24h")
    #expect(composerSkillDraft(command: logtraceCommand, existingText: "trace-id trace_123") == "/logtrace env=lab traceId=trace_123 last=24h")
    #expect(composerSkillDraft(command: logtraceCommand, existingText: "traceparent=\(traceParent)") == "/logtrace env=lab traceId=4a0031017ceb19eab6d3a39468a20000 last=24h")
    #expect(composerSkillDraft(command: logtraceCommand, existingText: "prod trace parent \(traceParent) last 2 hours") == "/logtrace env=production traceId=4a0031017ceb19eab6d3a39468a20000 last=2h")
    #expect(composerSkillDraft(command: logtraceCommand, existingText: traceParent) == "/logtrace env=lab traceId=4a0031017ceb19eab6d3a39468a20000 last=24h")
    #expect(composerSkillDraft(command: logtraceCommand, existingText: "prod request id req-voice-123 2d") == "/logtrace env=production requestId=req-voice-123 last=2d")
    #expect(composerSkillDraft(command: logtraceCommand, existingText: "prod request id req-voice-123 last 2 days") == "/logtrace env=production requestId=req-voice-123 last=2d")
    #expect(composerSkillDraft(command: logtraceCommand, existingText: "turn id turn-voice-123 最近 30 分钟") == "/logtrace env=lab turnId=turn-voice-123 last=30m")
    #expect(composerSkillDraft(command: logtraceCommand, existingText: "sessionId=s-123 last=48h") == "/logtrace env=lab sessionId=s-123 last=48h")
    #expect(composerSkillDraft(command: logtraceCommand, existingText: "0123456789abcdef0123456789abcdef") == "/logtrace env=lab conversationId=0123456789abcdef0123456789abcdef last=24h")
    #expect(composerSkillDraft(command: logtraceCommand, existingText: "agent stayed silent") == "/logtrace env=lab conversationId= last=24h symptom=\"agent stayed silent\"")
    #expect(composerSkillDraft(command: logtraceCommand, existingText: "prod message contains Cannot send generation request last 2 hours") == "/logtrace env=production query=\"message:\\\"Cannot send generation request\\\"\" last=2h")
    #expect(composerSkillDraft(command: logtraceCommand, existingText: "production p-v-voice-123 message contains Cannot send generation request 2h") == "/logtrace env=production conversationId=p-v-voice-123 query=\"message:\\\"Cannot send generation request\\\"\" last=2h")
    #expect(composerSkillDraft(command: logtraceCommand, existingText: "prod error Cannot send generation request 2h") == "/logtrace env=production query=\"message:\\\"error Cannot send generation request\\\"\" last=2h")
    #expect(composerSkillDraft(command: logtraceCommand, existingText: "field=message Cannot send generation request last=2h") == "/logtrace env=lab query=\"message:\\\"Cannot send generation request\\\"\" last=2h")

    let clickhouseCommand = composerSkillCommand(for: clickhouse)
    #expect(clickhouseCommand == "/clickhouse ")
    #expect(composerSkillPreviewCommand(for: clickhouse, existingText: "slow traceparent=\(traceParent) top 5") == "/clickhouse show slow spans for TraceId=4a0031017ceb19eab6d3a39468a20000 limit=5")
    #expect(composerSkillPreviewCommand(for: clickhouse, existingText: "conversation id 01234567-89ab-cdef-0123-456789abcdef rows 30") == "/clickhouse trace lookup TraceId=0123456789abcdef0123456789abcdef ConversationId=01234567-89ab-cdef-0123-456789abcdef limit=30")
    #expect(composerSkillDraft(command: clickhouseCommand, existingText: "TraceId=abc123") == "/clickhouse trace lookup TraceId=abc123 limit=20")
    #expect(composerSkillDraft(command: clickhouseCommand, existingText: "TraceId=abc123 limit=50") == "/clickhouse trace lookup TraceId=abc123 limit=50")
    #expect(composerSkillDraft(command: clickhouseCommand, existingText: "select count() from gen_eva_trace_v2.otel_traces_main") == "/clickhouse select count() from gen_eva_trace_v2.otel_traces_main")
    #expect(composerSkillDraft(command: clickhouseCommand, existingText: "select * from gen_eva_trace_v2.otel_traces_main limit 5") == "/clickhouse select * from gen_eva_trace_v2.otel_traces_main limit 5")
    #expect(composerSkillDraft(command: clickhouseCommand, existingText: "TraceId=0123456789abcdef0123456789abcdef") == "/clickhouse trace lookup TraceId=0123456789abcdef0123456789abcdef limit=20")
    #expect(composerSkillDraft(command: clickhouseCommand, existingText: "traceparent=\(traceParent)") == "/clickhouse trace lookup TraceId=4a0031017ceb19eab6d3a39468a20000 limit=20")
    #expect(composerSkillDraft(command: clickhouseCommand, existingText: "trace parent \(traceParent)") == "/clickhouse trace lookup TraceId=4a0031017ceb19eab6d3a39468a20000 limit=20")
    #expect(composerSkillDraft(command: clickhouseCommand, existingText: "trace id 0123456789abcdef0123456789abcdef") == "/clickhouse trace lookup TraceId=0123456789abcdef0123456789abcdef limit=20")
    #expect(composerSkillDraft(command: clickhouseCommand, existingText: "trace id 0123456789abcdef0123456789abcdef top 100") == "/clickhouse trace lookup TraceId=0123456789abcdef0123456789abcdef limit=100")
    #expect(composerSkillDraft(command: clickhouseCommand, existingText: "ConversationId: 01234567-89ab-cdef-0123-456789abcdef") == "/clickhouse trace lookup TraceId=0123456789abcdef0123456789abcdef ConversationId=01234567-89ab-cdef-0123-456789abcdef limit=20")
    #expect(composerSkillDraft(command: clickhouseCommand, existingText: "conversation id 01234567-89ab-cdef-0123-456789abcdef") == "/clickhouse trace lookup TraceId=0123456789abcdef0123456789abcdef ConversationId=01234567-89ab-cdef-0123-456789abcdef limit=20")
    #expect(composerSkillDraft(command: clickhouseCommand, existingText: "conversation id 01234567-89ab-cdef-0123-456789abcdef rows 30") == "/clickhouse trace lookup TraceId=0123456789abcdef0123456789abcdef ConversationId=01234567-89ab-cdef-0123-456789abcdef limit=30")
    #expect(composerSkillDraft(command: clickhouseCommand, existingText: "01234567-89ab-cdef-0123-456789abcdef") == "/clickhouse trace lookup TraceId=0123456789abcdef0123456789abcdef ConversationId=01234567-89ab-cdef-0123-456789abcdef limit=20")
    #expect(composerSkillDraft(command: clickhouseCommand, existingText: "0123456789abcdef0123456789abcdef") == "/clickhouse trace lookup TraceId=0123456789abcdef0123456789abcdef limit=20")
    #expect(composerSkillDraft(command: clickhouseCommand, existingText: "0123456789abcdef0123456789abcdef limit 1000") == "/clickhouse trace lookup TraceId=0123456789abcdef0123456789abcdef limit=500")
    #expect(composerSkillDraft(command: clickhouseCommand, existingText: "slow spans 0123456789abcdef0123456789abcdef") == "/clickhouse show slow spans for TraceId=0123456789abcdef0123456789abcdef limit=10")
    #expect(composerSkillDraft(command: clickhouseCommand, existingText: "slow traceparent=\(traceParent) top 5") == "/clickhouse show slow spans for TraceId=4a0031017ceb19eab6d3a39468a20000 limit=5")
    #expect(composerSkillDraft(command: clickhouseCommand, existingText: "conversation id 01234567-89ab-cdef-0123-456789abcdef slow top 5") == "/clickhouse show slow spans for TraceId=0123456789abcdef0123456789abcdef ConversationId=01234567-89ab-cdef-0123-456789abcdef limit=5")
    #expect(composerSkillDraft(command: clickhouseCommand, existingText: "errors for trace id 0123456789abcdef0123456789abcdef rows 50") == "/clickhouse show error spans for TraceId=0123456789abcdef0123456789abcdef limit=50")
    #expect(composerSkillDraft(command: clickhouseCommand, existingText: "慢 01234567-89ab-cdef-0123-456789abcdef limit 1000") == "/clickhouse show slow spans for TraceId=0123456789abcdef0123456789abcdef ConversationId=01234567-89ab-cdef-0123-456789abcdef limit=500")
    #expect(composerSkillDraft(command: clickhouseCommand, existingText: "查一下 01234567-89ab-cdef-0123-456789abcdef 的 trace") == "/clickhouse trace lookup TraceId=0123456789abcdef0123456789abcdef ConversationId=01234567-89ab-cdef-0123-456789abcdef limit=20")
    #expect(composerSkillDraft(command: clickhouseCommand, existingText: "check trace 0123456789abcdef0123456789abcdef") == "/clickhouse trace lookup TraceId=0123456789abcdef0123456789abcdef limit=20")
    #expect(composerSkillDraft(command: clickhouseCommand, existingText: "check IVAS-1234") == "/clickhouse check IVAS-1234")
}

@Test func composerSkillCardsHideAfterUserStartsTyping() {
    #expect(composerShouldShowSkillCards(for: ""))
    #expect(composerShouldShowSkillCards(for: "  \n  "))
    #expect(!composerShouldShowSkillCards(for: "trace p-v-voice-123"))
    #expect(!composerShouldShowSkillCards(for: "/logtrace env=lab conversationId=p-v-voice-123 last=24h"))
}

private struct DetectingAgentAdapter: AgentAdapter {
    let descriptor: AgentDescriptor
    let detection: AgentDetection

    func detect() async -> AgentDetection {
        detection
    }

    func start(_ request: AgentLaunchRequest) -> AsyncThrowingStream<RunnerEvent, Error> {
        AsyncThrowingStream { continuation in
            continuation.yield(.completed(exitCode: 0))
            continuation.finish()
        }
    }
}

private final class SmokePromptCapture: @unchecked Sendable {
    var prompts: [String] = []
}

private func runGit(_ arguments: [String], in directory: URL) throws {
    let process = Process()
    process.executableURL = URL(fileURLWithPath: "/usr/bin/env")
    process.arguments = ["git", "-C", directory.path] + arguments
    let output = Pipe()
    process.standardOutput = output
    process.standardError = output
    try process.run()
    process.waitUntilExit()
    if process.terminationStatus != 0 {
        let data = output.fileHandleForReading.readDataToEndOfFile()
        let message = String(data: data, encoding: .utf8) ?? "git failed"
        throw GitTestError(description: message)
    }
}

private struct GitTestError: Error, CustomStringConvertible {
    let description: String
}

private struct SmokeAgentAdapter: AgentAdapter {
    let descriptor: AgentDescriptor
    let capture: SmokePromptCapture

    func detect() async -> AgentDetection {
        AgentDetection(isAvailable: true)
    }

    func start(_ request: AgentLaunchRequest) -> AsyncThrowingStream<RunnerEvent, Error> {
        capture.prompts.append(request.prompt)
        return AsyncThrowingStream { continuation in
            continuation.yield(.stateChanged(.running))
            continuation.yield(.output("smoke ok\n"))
            continuation.yield(.completed(exitCode: 0))
            continuation.finish()
        }
    }
}
