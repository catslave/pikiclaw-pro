import Foundation
import Testing
@preconcurrency import UserNotifications
@testable import PikiclawCore
@testable import PikiclawMac
@testable import PikiclawRunner

@MainActor
private final class FakeNativeNotificationCenterClient: NativeNotificationCenterClient {
    var status: UNAuthorizationStatus
    var authorizationGrant: Bool
    var requestedOptions: UNAuthorizationOptions?
    var addedRequests: [UNNotificationRequest] = []

    init(status: UNAuthorizationStatus, authorizationGrant: Bool = true) {
        self.status = status
        self.authorizationGrant = authorizationGrant
    }

    func authorizationStatus() async -> UNAuthorizationStatus {
        status
    }

    func requestAuthorization(options: UNAuthorizationOptions) async throws -> Bool {
        requestedOptions = options
        status = authorizationGrant ? .authorized : .denied
        return authorizationGrant
    }

    func add(_ request: UNNotificationRequest) async throws {
        addedRequests.append(request)
    }
}

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
@Test func detectingReadyEnterpriseAgentEnablesProfile() async throws {
    let directory = URL(fileURLWithPath: NSTemporaryDirectory())
        .appendingPathComponent("pikiclaw-agent-detect-ready-\(UUID().uuidString)", isDirectory: true)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: directory) }

    let agent = AgentProfile(
        id: "agent-claude-ready",
        kind: .claude,
        displayName: "Claude Code",
        executableName: "claude",
        isEnabled: false
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
                executablePath: "/opt/homebrew/bin/claude",
                authState: "configured",
                detail: "ready"
            ))
        }
    )
    await model.reload()

    let detection = try #require(await model.detectAgent(kind: .claude))
    let snapshot = try await store.loadSnapshot()
    let profile = try #require(snapshot.agentProfiles.first(where: { $0.kind == .claude }))
    let capability = try #require(snapshot.capabilities.first(where: { $0.id == "capability-agent-agent-claude-ready" }))

    #expect(detection.isAvailable)
    #expect(profile.isEnabled)
    #expect(capability.healthState == .healthy)
    #expect(model.statusLine == "Claude Code ready and enabled")
}

@MainActor
@Test func detectingUnauthedEnterpriseAgentKeepsProfileDisabled() async throws {
    let directory = URL(fileURLWithPath: NSTemporaryDirectory())
        .appendingPathComponent("pikiclaw-agent-detect-unauth-\(UUID().uuidString)", isDirectory: true)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: directory) }

    let agent = AgentProfile(
        id: "agent-gemini-unauth",
        kind: .gemini,
        displayName: "Gemini CLI",
        executableName: "gemini",
        isEnabled: false
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
                executablePath: "/opt/homebrew/bin/gemini",
                authState: "unknown",
                detail: "login required"
            ))
        }
    )
    await model.reload()

    let detection = try #require(await model.detectAgent(kind: .gemini))
    let snapshot = try await store.loadSnapshot()
    let profile = try #require(snapshot.agentProfiles.first(where: { $0.kind == .gemini }))
    let capability = try #require(snapshot.capabilities.first(where: { $0.id == "capability-agent-agent-gemini-unauth" }))

    #expect(detection.isAvailable)
    #expect(profile.isEnabled == false)
    #expect(capability.healthState == .healthy)
    #expect(model.statusLine == "Gemini CLI detected; login before enabling")
}

@Test func enterpriseAgentBestForSummaryUsesParityRows() throws {
    let snapshot = NativeStoreSnapshot(seed: .preview())
    let codex = try #require(snapshot.agentProfiles.first(where: { $0.kind == .codex }))
    let gemini = try #require(snapshot.agentProfiles.first(where: { $0.kind == .gemini }))
    let hermes = try #require(snapshot.agentProfiles.first(where: { $0.kind == .hermes }))

    #expect(enterpriseAgentBestForSummary(profile: codex, snapshot: snapshot) == "Best for issue workflow, approval gate, artifacts")
    #expect(enterpriseAgentBestForSummary(profile: gemini, snapshot: snapshot) == "Best after Detect + Login")
    #expect(enterpriseAgentBestForSummary(profile: hermes, snapshot: snapshot) == "Best for native workspace runs")
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
@Test func disabledAgentSmokeTestStagesDetectLoginGuidance() async throws {
    let directory = URL(fileURLWithPath: NSTemporaryDirectory())
        .appendingPathComponent("pikiclaw-agent-smoke-disabled-\(UUID().uuidString)", isDirectory: true)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: directory) }

    let workspace = Workspace(
        id: "workspace-agent-smoke-disabled",
        name: "Disabled Agent Smoke",
        pathDisplay: directory.path,
        trustState: .trusted
    )
    let agent = AgentProfile(
        id: "agent-gemini-disabled-smoke",
        kind: .gemini,
        displayName: "Gemini CLI",
        executableName: "gemini",
        isEnabled: false
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
    let model = NativeAppModel(store: store)
    await model.reload()

    #expect(model.stageAgentSmokePrerequisite(kind: .gemini, workspaceId: workspace.id))
    #expect(model.selectedAgentKind == .gemini)
    #expect(model.terminalCommand == "gemini auth login")
    #expect(model.terminalCurrentDirectory(for: workspace) == workspace.pathDisplay)
    #expect(model.statusLine == "Gemini CLI needs Detect + Login before Test; login command staged")

    let runId = await model.startAgentSmokeTest(kind: .gemini, workspaceId: workspace.id)
    let snapshot = try await store.loadSnapshot()

    #expect(runId == nil)
    #expect(snapshot.runs.isEmpty)
    #expect(model.terminalCommand == "gemini auth login")
    #expect(model.statusLine == "Gemini CLI needs Detect + Login before Test; login command staged")
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
        externalRefs: [
            SourceRef(kind: "gitlab", label: "Native MR", uri: "https://gitlab.example.com/pikiclaw/pikiclaw/-/merge_requests/910")
        ],
        jira: JiraWorkItemFields(key: "IVAS-9100", url: "https://jira.example.com/browse/IVAS-9100", status: "In Progress")
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
        Error: queue sync failed after Jira MCP search.
        Process exited with code 1
        MR: https://gitlab.example.com/pikiclaw/pikiclaw/-/merge_requests/910
        Findings:
        - [P1] Missing retry validation in RootView.swift:6519 before marking the MR ready.
        Skill /logtrace failed because IVA_LOGTRACER_ENV_FILE is missing.
        Inspect `.pikiclaw/skills/iva-logtracer/SKILL.md` before changing behavior.
        Suggested skill command: `/logtrace env=stage conversationId=p-v-voice-123 last=24h`
        Code refs:
        - apps/macos/Sources/PikiclawMac/RootView.swift:6519
        - apps/macos/Tests/PikiclawMacTests/AgentStudioWorkflowTests.swift:1119
        Jira update:
        Status: retry validation still missing
        Evidence: RootView context needs handoff drafts.
        Jira write-back: Failed IVAS-9100; retry or paste the draft manually.
        MR review comment:
        Ready after adding handoff draft context; residual risk is manual smoke.
        Branch decision: Needs follow-up via Review - Read-only review.
        Open question: whether voice flow needs a manual smoke pass.
        Next action: run the focused validation and paste the result into Jira.
        Validation: git diff --check passed
        Next command: `swift test --filter ChatMessageHistoryTests`
        """,
        createdAt: Date(timeIntervalSince1970: 20),
        sourceRefs: [
            SourceRef(kind: "jira", label: "IVAS-9100", uri: "https://jira.example.com/browse/IVAS-9100"),
            SourceRef(kind: "jira-write-back", label: "failed", uri: "https://jira.example.com/browse/IVAS-9100"),
            SourceRef(kind: "artifact-resolution", label: "needs-follow-up", uri: "pikiclaw://runs/run-review-side-chat")
        ]
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
    #expect(summary.reviewFindings == [
        "[P1] Missing retry validation in RootView.swift:6519 before marking the MR ready."
    ])
    #expect(summary.handoffDrafts == [
        "Jira draft: Status: retry validation still missing | Evidence: RootView context needs handoff drafts.",
        "MR draft: Ready after adding handoff draft context; residual risk is manual smoke."
    ])
    #expect(summary.branchDecisions == [
        "Branch needs follow-up: Evidence: validation passed - Branch decision: Needs follow-up via Review - Read-only review."
    ])
    #expect(summary.reviewRefs == [
        "Native MR (https://gitlab.example.com/pikiclaw/pikiclaw/-/merge_requests/910)",
        "MR: https://gitlab.example.com/pikiclaw/pikiclaw/-/merge_requests/910"
    ])
    #expect(summary.jiraRefs == [
        "IVAS-9100 (https://jira.example.com/browse/IVAS-9100)"
    ])
    #expect(summary.jiraWriteBackSignals == [
        "Jira write-back: Failed IVAS-9100; retry or paste the draft manually."
    ])
    #expect(summary.codeRefs == [
        ".pikiclaw/skills/iva-logtracer/SKILL.md",
        "apps/macos/Sources/PikiclawMac/RootView.swift:6519",
        "apps/macos/Tests/PikiclawMacTests/AgentStudioWorkflowTests.swift:1119"
    ])
    #expect(summary.skillRefs == [
        "Skill /logtrace failed because IVA_LOGTRACER_ENV_FILE is missing.",
        "/logtrace",
        "IVA_LOGTRACER_ENV_FILE",
        ".pikiclaw/skills/iva-logtracer/SKILL.md",
        "/logtrace env=stage conversationId=p-v-voice-123 last=24h"
    ])
    #expect(summary.skillRecoveries == [
        "Recover /logtrace: set IVA_LOGTRACER_ENV_FILE before rerun.",
        "Inspect skill: .pikiclaw/skills/iva-logtracer/SKILL.md",
        "Rerun: /logtrace env=stage conversationId=p-v-voice-123 last=24h"
    ])
    #expect(summary.failureSignals == [
        "Error: queue sync failed after Jira MCP search.",
        "Exit: Process exited with code 1",
        "Failure: Skill /logtrace failed because IVA_LOGTRACER_ENV_FILE is missing."
    ])
    #expect(summary.knowledgeCardCount == 1)
    #expect(summary.recentRunCount == 1)
    #expect(summary.hasContextPack)
    #expect(assistantContextPackVisibleHighlights(summary: summary) == [
        "Skill recovery: Recover /logtrace: set IVA_LOGTRACER_ENV_FILE before rerun.",
        "Review: [P1] Missing retry validation in RootView.swift:6519 before marking the MR ready.",
        "Jira write-back: Jira write-back: Failed IVAS-9100; retry or paste the draft manually."
    ])
    #expect(assistantContextPackVisibleHighlights(summary: summary, limit: 2) == [
        "Skill recovery: Recover /logtrace: set IVA_LOGTRACER_ENV_FILE before rerun.",
        "Review: [P1] Missing retry validation in RootView.swift:6519 before marking the MR ready."
    ])

    #expect(model.stageAssistantPrompt(
        title: "MR Review",
        prompt: "Review current work in {project}.",
        workspaceId: workspace.id,
        workItemId: workItem.id
    ))

    #expect(model.draftPrompt.contains("Relevant outputs: commandOutputSummary ready: Evidence: validation passed"))
    #expect(model.draftPrompt.contains("Decision signals: Decision: not ready to merge until retry validation is captured.; Readiness: Blocked on missing nil workspace guard. | Approval can proceed after focused validation.; Approval: add the guard before posting Jira done."))
    #expect(model.draftPrompt.contains("Actionable notes: Blocker: waiting for Jira write permission.; Risk: full app smoke has not run.; Open question: whether voice flow needs a manual smoke pass.; Next action: run the focused validation and paste the result into Jira."))
    #expect(model.draftPrompt.contains("Review findings: [P1] Missing retry validation in RootView.swift:6519 before marking the MR ready."))
    #expect(model.draftPrompt.contains("Handoff drafts: Jira draft: Status: retry validation still missing | Evidence: RootView context needs handoff drafts.; MR draft: Ready after adding handoff draft context; residual risk is manual smoke."))
    #expect(model.draftPrompt.contains("Branch decisions: Branch needs follow-up: Evidence: validation passed - Branch decision: Needs follow-up via Review - Read-only review."))
    #expect(model.draftPrompt.contains("Failure signals: Error: queue sync failed after Jira MCP search.; Exit: Process exited with code 1; Failure: Skill /logtrace failed because IVA_LOGTRACER_ENV_FILE is missing."))
    #expect(model.draftPrompt.contains("Validation evidence: git diff --check (passed)"))
    #expect(model.draftPrompt.contains("Artifact refs: Evidence: validation passed (pikiclaw://runs/run-evidence-context/evidence)"))
    #expect(model.draftPrompt.contains("MR/PR refs: Native MR (https://gitlab.example.com/pikiclaw/pikiclaw/-/merge_requests/910); MR: https://gitlab.example.com/pikiclaw/pikiclaw/-/merge_requests/910"))
    #expect(model.draftPrompt.contains("Jira refs: IVAS-9100 (https://jira.example.com/browse/IVAS-9100)"))
    #expect(model.draftPrompt.contains("Jira write-back: Failed IVAS-9100; retry or paste the draft manually."))
    #expect(model.draftPrompt.contains("Code refs: .pikiclaw/skills/iva-logtracer/SKILL.md; apps/macos/Sources/PikiclawMac/RootView.swift:6519; apps/macos/Tests/PikiclawMacTests/AgentStudioWorkflowTests.swift:1119"))
    #expect(model.draftPrompt.contains("Skill refs: Skill /logtrace failed because IVA_LOGTRACER_ENV_FILE is missing.; /logtrace; IVA_LOGTRACER_ENV_FILE; .pikiclaw/skills/iva-logtracer/SKILL.md; /logtrace env=stage conversationId=p-v-voice-123 last=24h"))
    #expect(model.draftPrompt.contains("Skill recovery: Recover /logtrace: set IVA_LOGTRACER_ENV_FILE before rerun.; Inspect skill: .pikiclaw/skills/iva-logtracer/SKILL.md; Rerun: /logtrace env=stage conversationId=p-v-voice-123 last=24h"))
    #expect(model.draftPrompt.contains("Pending commands: swift test --filter ChatMessageHistoryTests"))
    #expect(model.draftPrompt.contains("Knowledge cards: Evidence workflow shortcut [output,jira]: Saved outputs can drive follow-up assistant prompts."))
    #expect(model.draftPrompt.contains("Recent runs: failed run-evidence-failed: Validate saved output workflow"))
    #expect(model.draftPrompt.contains("Jira: IVAS-9100"))
    #expect(!model.draftPrompt.contains("Unrelated output"))
    #expect(!model.draftPrompt.contains("Unrelated card"))
    #expect(!model.draftPrompt.contains("Should not leak run context"))
}

@MainActor
@Test func assistantContextSummaryCarriesNativeMissionLinks() async throws {
    let directory = URL(fileURLWithPath: NSTemporaryDirectory())
        .appendingPathComponent("pikiclaw-assistant-native-links-\(UUID().uuidString)", isDirectory: true)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: directory) }

    let workspace = Workspace(
        id: "workspace-native-links",
        name: "Native Links",
        pathDisplay: directory.path,
        trustState: .trusted
    )
    let workItem = WorkItem(
        id: "workitem-native-links",
        workspaceId: workspace.id,
        title: "Review native links",
        sourceType: .manualPrompt,
        updatedAt: Date(timeIntervalSince1970: 100)
    )
    let codex = AgentProfile(id: "agent-native-link-codex", kind: .codex, displayName: "Codex", executableName: "codex")
    let claude = AgentProfile(id: "agent-native-link-claude", kind: .claude, displayName: "Claude", executableName: "claude")
    let gemini = AgentProfile(id: "agent-native-link-gemini", kind: .gemini, displayName: "Gemini", executableName: "gemini")
    let codexRun = AgentRun(
        id: "run-native-link-codex",
        workItemId: workItem.id,
        workspaceId: workspace.id,
        agentProfileId: codex.id,
        state: .completed,
        startedAt: Date(timeIntervalSince1970: 200),
        endedAt: Date(timeIntervalSince1970: 240),
        sideChatRunIds: ["run-native-link-claude"],
        promptSnapshot: "Codex maps the evidence gap"
    )
    let claudeRun = AgentRun(
        id: "run-native-link-claude",
        workItemId: workItem.id,
        workspaceId: workspace.id,
        agentProfileId: claude.id,
        state: .completed,
        startedAt: Date(timeIntervalSince1970: 300),
        endedAt: Date(timeIntervalSince1970: 340),
        sideChatOfRunId: codexRun.id,
        promptSnapshot: "Claude reviews the handoff"
    )
    let artifact = Artifact(
        id: "artifact-native-link-output",
        workspaceId: workspace.id,
        workItemId: workItem.id,
        runId: claudeRun.id,
        kind: .commandOutputSummary,
        title: "Claude handoff output",
        uri: "pikiclaw://artifacts/artifact-native-link-output",
        status: .ready,
        provenance: "Evidence: Claude output needs native review.",
        createdAt: Date(timeIntervalSince1970: 360)
    )
    let store = JSONNativeStore(fileURL: directory.appendingPathComponent("state.json"), seed: NativeAppSeed(
        projects: [],
        workspaces: [workspace],
        workItems: [workItem],
        runs: [codexRun, claudeRun],
        artifacts: [artifact],
        capabilities: [],
        knowledgeCards: [],
        automations: [],
        agentProfiles: [codex, claude, gemini],
        providerProfiles: []
    ))
    let model = NativeAppModel(store: store)
    await model.reload()

    let summary = model.assistantLaunchContextSummary(workspaceId: workspace.id, workItemId: workItem.id)

    #expect(summary.nativeLinks == [
        "Mission latest evidence (pikiclaw://mission-control/latest-evidence/workitem-native-links)",
        "Mission output review (pikiclaw://mission-control/output-review)",
        "Output: Claude handoff output (pikiclaw://artifacts/artifact-native-link-output)"
    ])
    #expect(summary.nativeLinkCount == 3)
    #expect(summary.hasContextPack)

    #expect(model.stageAssistantPrompt(
        title: "Context Handoff",
        prompt: "Prepare handoff for {project}.",
        workspaceId: workspace.id,
        workItemId: workItem.id
    ))
    #expect(model.draftPrompt.contains("Native links: Mission latest evidence (pikiclaw://mission-control/latest-evidence/workitem-native-links); Mission output review (pikiclaw://mission-control/output-review); Output: Claude handoff output (pikiclaw://artifacts/artifact-native-link-output)"))
}

@MainActor
@Test func notificationFollowUpAutomationStagesNativeLinksPayload() async throws {
    let directory = URL(fileURLWithPath: NSTemporaryDirectory())
        .appendingPathComponent("pikiclaw-notification-native-links-\(UUID().uuidString)", isDirectory: true)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: directory) }

    let workspace = Workspace(
        id: "workspace-notification-native-links",
        name: "Notification Native Links",
        pathDisplay: directory.path,
        trustState: .trusted
    )
    let workItem = WorkItem(
        id: "workitem-notification-native-links",
        workspaceId: workspace.id,
        title: "Follow notification evidence",
        sourceType: .scheduledAutomation,
        updatedAt: Date(timeIntervalSince1970: 100)
    )
    let codex = AgentProfile(id: "agent-notification-codex", kind: .codex, displayName: "Codex", executableName: "codex")
    let claude = AgentProfile(id: "agent-notification-claude", kind: .claude, displayName: "Claude", executableName: "claude")
    let codexRun = AgentRun(
        id: "run-notification-codex",
        workItemId: workItem.id,
        workspaceId: workspace.id,
        agentProfileId: codex.id,
        state: .completed,
        startedAt: Date(timeIntervalSince1970: 200),
        endedAt: Date(timeIntervalSince1970: 220),
        sideChatRunIds: ["run-notification-claude"],
        promptSnapshot: "Codex prepares the reminder evidence"
    )
    let claudeRun = AgentRun(
        id: "run-notification-claude",
        workItemId: workItem.id,
        workspaceId: workspace.id,
        agentProfileId: claude.id,
        state: .completed,
        startedAt: Date(timeIntervalSince1970: 260),
        endedAt: Date(timeIntervalSince1970: 280),
        sideChatOfRunId: codexRun.id,
        promptSnapshot: "Claude validates the reminder evidence"
    )
    let artifact = Artifact(
        id: "artifact-notification-follow-up",
        workspaceId: workspace.id,
        workItemId: workItem.id,
        runId: claudeRun.id,
        kind: .verificationResult,
        title: "Notification follow-up output",
        uri: "pikiclaw://artifacts/artifact-notification-follow-up",
        status: .ready,
        provenance: "Evidence: reminder needs a native follow-up.",
        createdAt: Date(timeIntervalSince1970: 300)
    )
    let automation = Automation(
        id: "automation-notification-follow-up",
        workspaceId: workspace.id,
        kind: .notificationFollowUp,
        name: "Review notification follow-up",
        state: .enabled,
        scheduleDescription: "When a reminder is clicked"
    )
    let store = JSONNativeStore(fileURL: directory.appendingPathComponent("state.json"), seed: NativeAppSeed(
        projects: [],
        workspaces: [workspace],
        workItems: [workItem],
        runs: [codexRun, claudeRun],
        artifacts: [artifact],
        capabilities: [],
        knowledgeCards: [],
        automations: [automation],
        agentProfiles: [codex, claude],
        providerProfiles: []
    ))
    let notificationCenter = FakeNativeNotificationCenterClient(status: .notDetermined)
    let model = NativeAppModel(store: store, nativeNotificationCenter: notificationCenter)
    await model.reload()
    await model.refreshNativeNotificationReadiness()
    #expect(model.nativeNotificationReadiness == .notDetermined)

    let payload = try #require(model.notificationActionPayload(
        for: automation,
        workspaceId: workspace.id,
        workItemId: workItem.id
    ))
    #expect(payload.automationId == automation.id)
    #expect(payload.automationName == "Review notification follow-up")
    #expect(payload.title == "Review notification follow-up")
    #expect(payload.body == "Open Mission latest evidence for Follow notification evidence.")
    #expect(payload.primaryLink?.label == "Mission latest evidence")
    #expect(payload.primaryLink?.uri == "pikiclaw://mission-control/latest-evidence/workitem-notification-native-links")
    #expect(payload.primaryLink?.displayText == "Mission latest evidence (pikiclaw://mission-control/latest-evidence/workitem-notification-native-links)")
    #expect(payload.links.map(\.displayText) == [
        "Mission latest evidence (pikiclaw://mission-control/latest-evidence/workitem-notification-native-links)",
        "Mission output review (pikiclaw://mission-control/output-review)",
        "Output: Notification follow-up output (pikiclaw://artifacts/artifact-notification-follow-up)"
    ])
    let payloadPrimaryURL = try #require(payload.primaryURL)
    #expect(payloadPrimaryURL.absoluteString == "pikiclaw://mission-control/latest-evidence/workitem-notification-native-links")
    let notificationUserInfo = try #require(NativeNotificationBridge.userInfo(for: payload))
    #expect(pikiclawNotificationDeepLinkURL(from: notificationUserInfo) == payloadPrimaryURL)
    let notificationContent = try #require(NativeNotificationBridge.content(for: payload))
    #expect(notificationContent.title == "Review notification follow-up")
    #expect(notificationContent.body == "Open Mission latest evidence for Follow notification evidence.")
    #expect(pikiclawNotificationDeepLinkURL(from: notificationContent.userInfo) == payloadPrimaryURL)
    let notificationRequest = try #require(NativeNotificationBridge.request(for: payload))
    #expect(notificationRequest.identifier == "pikiclaw.notification.automation-notification-follow-up")
    #expect(notificationRequest.trigger == nil)
    #expect(notificationRequest.content.title == "Review notification follow-up")
    #expect(pikiclawNotificationDeepLinkURL(from: notificationRequest.content.userInfo) == payloadPrimaryURL)
    let scheduleResult = await NativeNotificationBridge.enqueue(payload, center: notificationCenter)
    #expect(scheduleResult.didEnqueue)
    #expect(scheduleResult.readiness == .authorized)
    #expect(scheduleResult.requestIdentifier == "pikiclaw.notification.automation-notification-follow-up")
    #expect(scheduleResult.statusLine == "Notification scheduled: Mission latest evidence")
    #expect(notificationCenter.requestedOptions?.contains(.alert) == true)
    #expect(notificationCenter.requestedOptions?.contains(.sound) == true)
    #expect(notificationCenter.requestedOptions?.contains(.badge) == true)
    #expect(notificationCenter.addedRequests.count == 1)
    #expect(pikiclawNotificationDeepLinkURL(from: notificationCenter.addedRequests[0].content.userInfo) == payloadPrimaryURL)

    let primaryURL = try #require(model.automationPrimaryNativeURL(
        automation,
        workspaceId: workspace.id,
        workItemId: workItem.id
    ))
    #expect(primaryURL == payloadPrimaryURL)
    let plainAutomation = Automation(
        id: "automation-plain",
        workspaceId: workspace.id,
        kind: .scheduledPrompt,
        name: "Plain automation",
        state: .enabled
    )
    #expect(model.automationPrimaryNativeURL(
        plainAutomation,
        workspaceId: workspace.id,
        workItemId: workItem.id
    ) == nil)
    #expect(model.notificationActionPayload(
        for: plainAutomation,
        workspaceId: workspace.id,
        workItemId: workItem.id
    ) == nil)

    notificationCenter.addedRequests.removeAll()
    #expect(await model.scheduleAutomationNotification(
        automation,
        workspaceId: workspace.id,
        workItemId: workItem.id
    ))
    #expect(model.nativeNotificationReadiness == .authorized)
    #expect(model.statusLine == "Notification scheduled: Mission latest evidence")
    #expect(notificationCenter.addedRequests.count == 1)
    let plainScheduled = await model.scheduleAutomationNotification(
        plainAutomation,
        workspaceId: workspace.id,
        workItemId: workItem.id
    )
    #expect(!plainScheduled)
    #expect(model.statusLine == "No notification payload for Plain automation")

    #expect(model.stageAutomation(automation, workspaceId: workspace.id, workItemId: workItem.id))
    #expect(model.selectedAgentKind == .codex)
    #expect(model.draftPrompt.contains("Run the saved automation workflow \"Review notification follow-up\""))
    #expect(model.draftPrompt.contains("- Kind: notificationFollowUp"))
    #expect(model.draftPrompt.contains("- State: enabled"))
    #expect(model.draftPrompt.contains("- Schedule: When a reminder is clicked"))
    #expect(model.draftPrompt.contains("Notification payload native links:"))
    #expect(model.draftPrompt.contains("- Mission latest evidence (pikiclaw://mission-control/latest-evidence/workitem-notification-native-links)"))
    #expect(model.draftPrompt.contains("- Mission output review (pikiclaw://mission-control/output-review)"))
    #expect(model.draftPrompt.contains("- Output: Notification follow-up output (pikiclaw://artifacts/artifact-notification-follow-up)"))
    #expect(model.draftPrompt.contains("Native links: Mission latest evidence (pikiclaw://mission-control/latest-evidence/workitem-notification-native-links); Mission output review (pikiclaw://mission-control/output-review); Output: Notification follow-up output (pikiclaw://artifacts/artifact-notification-follow-up)"))
}

@MainActor
@Test func assistantContextSummaryPreservesNamedSkillAliasRecovery() async throws {
    let directory = URL(fileURLWithPath: NSTemporaryDirectory())
        .appendingPathComponent("pikiclaw-assistant-skill-alias-\(UUID().uuidString)", isDirectory: true)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: directory) }

    let workspace = Workspace(
        id: "workspace-assistant-skill-alias",
        name: "Assistant Skill Alias",
        pathDisplay: directory.path,
        trustState: .trusted
    )
    let artifact = Artifact(
        id: "artifact-assistant-skill-alias",
        workspaceId: workspace.id,
        kind: .commandOutputSummary,
        title: "Skill recovery evidence",
        uri: "pikiclaw://runs/run-assistant-skill-alias/evidence",
        status: .ready,
        provenance: """
        chsql failed because CLICKHOUSE_PROFILE is missing.
        建议技能命令：`/clickhouse show error spans for TraceId=0123456789abcdef0123456789abcdef limit=20`
        """
    )
    let store = JSONNativeStore(fileURL: directory.appendingPathComponent("state.json"), seed: NativeAppSeed(
        projects: [],
        workspaces: [workspace],
        workItems: [],
        runs: [],
        artifacts: [artifact],
        capabilities: [],
        knowledgeCards: [],
        automations: [],
        agentProfiles: [],
        providerProfiles: []
    ))
    let model = NativeAppModel(store: store)
    await model.reload()

    let summary = model.assistantLaunchContextSummary(workspaceId: workspace.id)

    #expect(summary.skillRefs == [
        "chsql failed because CLICKHOUSE_PROFILE is missing.",
        "chsql",
        "CLICKHOUSE_PROFILE",
        "/clickhouse show error spans for TraceId=0123456789abcdef0123456789abcdef limit=20"
    ])
    #expect(summary.skillRecoveries == [
        "Recover /clickhouse: set CLICKHOUSE_PROFILE before rerun.",
        "Rerun: /clickhouse show error spans for TraceId=0123456789abcdef0123456789abcdef limit=20"
    ])
    #expect(assistantLaunchRecommendation(summary: summary, workItem: nil)?.templateId == "skill-hardening")
}

@MainActor
@Test func assistantContextSummaryExtractsChineseBugAnalysisFromSavedArtifacts() async throws {
    let directory = URL(fileURLWithPath: NSTemporaryDirectory())
        .appendingPathComponent("pikiclaw-assistant-chinese-bug-context-\(UUID().uuidString)", isDirectory: true)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: directory) }

    let workspace = Workspace(
        id: "workspace-chinese-bug-context",
        name: "Chinese Bug Context",
        pathDisplay: directory.path,
        trustState: .trusted
    )
    let workItem = WorkItem(
        id: "workitem-chinese-bug-context",
        workspaceId: workspace.id,
        title: "IVAS-9301: 修复 Jira Start 入口",
        sourceType: .jira,
        state: .active,
        jira: JiraWorkItemFields(key: "IVAS-9301", status: "In Progress")
    )
    let artifact = Artifact(
        id: "artifact-chinese-bug-context",
        workspaceId: workspace.id,
        workItemId: workItem.id,
        kind: .commandOutputSummary,
        title: "中文 bug 分析",
        uri: "pikiclaw://runs/run-chinese-bug/evidence",
        status: .ready,
        provenance: """
        复现步骤：
        - 打开 Jira ticket 后点击 Start。
        实际结果：没有创建 ticket chat。
        预期结果：应该进入右侧工作区并创建 run。
        根因：detailTab 没有传入 Jira 工作区。
        修复方案：把 detailTab 绑定到 JiraWorkQueueView。
        决策：不能合并，缺少 focused validation。
        下一步：运行 focused test 后再写回 Jira。
        MR 评审意见：无阻塞问题；残余风险是手动 smoke。
        Validation command: `swift test --package-path apps/macos --filter JiraNativeWorkflowTests`
        """,
        createdAt: Date(timeIntervalSince1970: 20)
    )
    let store = JSONNativeStore(fileURL: directory.appendingPathComponent("state.json"), seed: NativeAppSeed(
        projects: [],
        workspaces: [workspace],
        workItems: [workItem],
        runs: [],
        artifacts: [artifact],
        capabilities: [],
        knowledgeCards: [],
        automations: [],
        agentProfiles: [],
        providerProfiles: []
    ))
    let model = NativeAppModel(store: store)
    await model.reload()

    let summary = model.assistantLaunchContextSummary(workspaceId: workspace.id, workItemId: workItem.id)
    #expect(summary.reproductionNotes == [
        "Steps: 打开 Jira ticket 后点击 Start。",
        "Actual: 没有创建 ticket chat。",
        "Expected: 应该进入右侧工作区并创建 run。"
    ])
    #expect(summary.diagnosisNotes == [
        "Root cause: detailTab 没有传入 Jira 工作区。",
        "Fix path: 把 detailTab 绑定到 JiraWorkQueueView。"
    ])
    #expect(summary.decisionSignals == [
        "Decision: 不能合并，缺少 focused validation。"
    ])
    #expect(summary.actionableNotes == [
        "Next action: 运行 focused test 后再写回 Jira。"
    ])
    #expect(summary.reviewFindings == [
        "无阻塞问题；残余风险是手动 smoke。"
    ])
    #expect(summary.pendingCommands == [
        "swift test --package-path apps/macos --filter JiraNativeWorkflowTests"
    ])
    let recommendation = try #require(assistantLaunchRecommendation(summary: summary, workItem: workItem))
    #expect(recommendation.templateId == "bug-analysis")
    #expect(recommendation.reason == "Diagnosis")

    #expect(model.stageAssistantPrompt(
        title: "Bug Analysis",
        prompt: "Analyze this bug in {project}.",
        workspaceId: workspace.id,
        workItemId: workItem.id
    ))
    #expect(model.draftPrompt.contains("Reproduction notes: Steps: 打开 Jira ticket 后点击 Start。; Actual: 没有创建 ticket chat。; Expected: 应该进入右侧工作区并创建 run。"))
    #expect(model.draftPrompt.contains("Diagnosis notes: Root cause: detailTab 没有传入 Jira 工作区。; Fix path: 把 detailTab 绑定到 JiraWorkQueueView。"))
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
    #expect(bug.prompt.contains("Generated UI contract:"))
    #expect(bug.prompt.contains("emit a fenced `pikiclaw-ui` JSON block"))
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

@Test func enterpriseAgentFitCardsRankBestWorkFromParityRows() throws {
    let profiles = [
        AgentProfile(id: "agent-codex-fit", kind: .codex, displayName: "Codex", executableName: "codex"),
        AgentProfile(id: "agent-claude-fit", kind: .claude, displayName: "Claude", executableName: "claude"),
        AgentProfile(id: "agent-gemini-fit", kind: .gemini, displayName: "Gemini", executableName: "gemini")
    ]
    let capabilities = [
        Capability(kind: .cliTool, name: "Codex CLI", scope: .agent, trustLevel: .trusted, healthState: .healthy),
        Capability(kind: .cliTool, name: "Claude CLI", scope: .agent, trustLevel: .trusted, healthState: .healthy),
        Capability(kind: .cliTool, name: "Gemini CLI", scope: .agent, trustLevel: .trusted, healthState: .healthy)
    ]
    let snapshot = NativeStoreSnapshot(seed: NativeAppSeed(
        projects: [],
        workspaces: [],
        workItems: [],
        runs: [],
        artifacts: [],
        capabilities: capabilities,
        knowledgeCards: [],
        automations: [],
        agentProfiles: profiles,
        providerProfiles: []
    ))

    let cards = enterpriseAgentFitCards(parityRows: AgentEnterpriseAlignment.parityRows(snapshot: snapshot))
    let codex = try #require(cards.first { $0.agentKind == .codex })
    let claude = try #require(cards.first { $0.agentKind == .claude })
    let gemini = try #require(cards.first { $0.agentKind == .gemini })

    #expect(cards.map(\.agentKind) == AgentEnterpriseAlignment.focusAgents)
    #expect(codex.mode == .native)
    #expect(codex.coverageLabel == "11/11")
    #expect(Array(codex.bestFor.prefix(3)) == ["Jira / issue updates", "Plan and review", "Approval gates"])
    #expect(codex.gapLabel == nil)
    #expect(claude.mode == .native)
    #expect(Array(claude.bestFor.prefix(3)) == ["Plan and review", "Approval gates", "Forked follow-up"])
    #expect(claude.gapLabel == nil)
    #expect(gemini.mode == .portable)
    #expect(gemini.coverageLabel == "10/11")
    #expect(Array(gemini.bestFor.prefix(3)) == ["Jira / issue updates", "Plan and review", "Approval gates"])
    #expect(gemini.gapLabel == "Gap: Active steering")
    #expect(gemini.nextAction.contains("steering"))
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
    #expect(assistantLaunchRecommendedTemplate(in: newChatAssistantQuickLaunchTemplates(), recommendation: validation)?.id == "validation")
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

    let traceParentContext = AssistantLaunchContextSummary(
        outputCount: 1,
        artifactRefCount: 1,
        pendingCommands: [],
        validationEvidence: [],
        decisionSignals: [],
        actionableNotes: ["Trace parent: 00-4a0031017ceb19eab6d3a39468a20000-0123456789abcdef-01"],
        knowledgeCardCount: 0,
        recentRunCount: 1
    )
    let traceParentRecommendation = try #require(assistantLaunchRecommendation(summary: traceParentContext, workItem: jiraItem))
    #expect(traceParentRecommendation.templateId == "log-analysis")
    #expect(traceParentRecommendation.reason == "Log lookup")

    let rawTraceParentContext = AssistantLaunchContextSummary(
        outputCount: 1,
        artifactRefCount: 1,
        pendingCommands: [],
        validationEvidence: [],
        decisionSignals: [],
        actionableNotes: ["00-4a0031017ceb19eab6d3a39468a20000-0123456789abcdef-01"],
        knowledgeCardCount: 0,
        recentRunCount: 1
    )
    let rawTraceParentRecommendation = try #require(assistantLaunchRecommendation(summary: rawTraceParentContext, workItem: jiraItem))
    #expect(rawTraceParentRecommendation.templateId == "log-analysis")
    #expect(rawTraceParentRecommendation.reason == "Log lookup")

    let spacedConversationContext = AssistantLaunchContextSummary(
        outputCount: 1,
        artifactRefCount: 1,
        pendingCommands: [],
        validationEvidence: [],
        decisionSignals: [],
        actionableNotes: ["conversation id: p-v-voice-123 needs a log lookup before the Jira update."],
        knowledgeCardCount: 0,
        recentRunCount: 1
    )
    let spacedConversationRecommendation = try #require(assistantLaunchRecommendation(summary: spacedConversationContext, workItem: jiraItem))
    #expect(spacedConversationRecommendation.templateId == "log-analysis")
    #expect(spacedConversationRecommendation.reason == "Log lookup")

    let snakeTraceContext = AssistantLaunchContextSummary(
        outputCount: 1,
        artifactRefCount: 1,
        pendingCommands: [],
        validationEvidence: [],
        decisionSignals: [],
        actionableNotes: ["trace_id=4a0031017ceb19eab6d3a39468a20000 should be checked before Jira execution."],
        knowledgeCardCount: 0,
        recentRunCount: 1
    )
    let snakeTraceRecommendation = try #require(assistantLaunchRecommendation(summary: snakeTraceContext, workItem: jiraItem))
    #expect(snakeTraceRecommendation.templateId == "log-analysis")
    #expect(snakeTraceRecommendation.reason == "Log lookup")

    let hyphenRequestContext = AssistantLaunchContextSummary(
        outputCount: 1,
        artifactRefCount: 1,
        pendingCommands: [],
        validationEvidence: [],
        decisionSignals: [],
        actionableNotes: ["request-id req-voice-123 and turn_id turn-voice-456 need a quick log lookup."],
        knowledgeCardCount: 0,
        recentRunCount: 1
    )
    let hyphenRequestRecommendation = try #require(assistantLaunchRecommendation(summary: hyphenRequestContext, workItem: jiraItem))
    #expect(hyphenRequestRecommendation.templateId == "log-analysis")
    #expect(hyphenRequestRecommendation.reason == "Log lookup")

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

    let skillRefContext = AssistantLaunchContextSummary(
        outputCount: 1,
        artifactRefCount: 0,
        pendingCommands: [],
        validationEvidence: [],
        decisionSignals: [],
        actionableNotes: [],
        skillRefs: ["Skill /logtrace failed because IVA_LOGTRACER_ENV_FILE is missing."],
        knowledgeCardCount: 0,
        recentRunCount: 0
    )
    #expect(assistantLaunchRecommendation(summary: skillRefContext, workItem: jiraItem)?.templateId == "skill-hardening")

    let skillRecoveryContext = AssistantLaunchContextSummary(
        outputCount: 1,
        artifactRefCount: 0,
        pendingCommands: ["swift test --filter AgentStudioWorkflowTests"],
        validationEvidence: [],
        decisionSignals: [],
        actionableNotes: [],
        skillRecoveries: ["Recover /logtrace: set IVA_LOGTRACER_ENV_FILE before rerun."],
        knowledgeCardCount: 0,
        recentRunCount: 0
    )
    let skillRecoveryRecommendation = try #require(assistantLaunchRecommendation(summary: skillRecoveryContext, workItem: jiraItem))
    #expect(skillRecoveryRecommendation.templateId == "skill-hardening")
    #expect(skillRecoveryRecommendation.reason == "Skill recovery")

    let chineseSkillFailureContext = AssistantLaunchContextSummary(
        outputCount: 1,
        artifactRefCount: 0,
        pendingCommands: [],
        validationEvidence: [],
        decisionSignals: [],
        actionableNotes: ["技能 /logtrace 执行失败：缺少 IVA_LOGTRACER_ENV_FILE，找不到环境配置。"],
        knowledgeCardCount: 0,
        recentRunCount: 0
    )
    let chineseSkillFailureRecommendation = try #require(assistantLaunchRecommendation(summary: chineseSkillFailureContext, workItem: jiraItem))
    #expect(chineseSkillFailureRecommendation.templateId == "skill-hardening")
    #expect(chineseSkillFailureRecommendation.reason == "Skill signal")

    let hyphenatedSkillFailureContext = AssistantLaunchContextSummary(
        outputCount: 1,
        artifactRefCount: 0,
        pendingCommands: [],
        validationEvidence: [],
        decisionSignals: [],
        actionableNotes: ["iva-logtracer failed because IVA_LOGTRACER_ENV_FILE is missing."],
        knowledgeCardCount: 0,
        recentRunCount: 0
    )
    let hyphenatedSkillFailureRecommendation = try #require(assistantLaunchRecommendation(summary: hyphenatedSkillFailureContext, workItem: jiraItem))
    #expect(hyphenatedSkillFailureRecommendation.templateId == "skill-hardening")
    #expect(hyphenatedSkillFailureRecommendation.reason == "Skill signal")

    let chsqlSkillFailureContext = AssistantLaunchContextSummary(
        outputCount: 1,
        artifactRefCount: 0,
        pendingCommands: [],
        validationEvidence: [],
        decisionSignals: [],
        actionableNotes: ["chsql failed because CLICKHOUSE_PROFILE is missing."],
        knowledgeCardCount: 0,
        recentRunCount: 0
    )
    let chsqlSkillFailureRecommendation = try #require(assistantLaunchRecommendation(summary: chsqlSkillFailureContext, workItem: jiraItem))
    #expect(chsqlSkillFailureRecommendation.templateId == "skill-hardening")
    #expect(chsqlSkillFailureRecommendation.reason == "Skill signal")

    let failedWithPendingCommand = AssistantLaunchContextSummary(
        outputCount: 1,
        artifactRefCount: 0,
        pendingCommands: ["swift test --filter AgentStudioWorkflowTests"],
        validationEvidence: [],
        decisionSignals: [],
        actionableNotes: [],
        failureSignals: ["Error: queue sync failed after Jira MCP search."],
        knowledgeCardCount: 0,
        recentRunCount: 1
    )
    let failedRecommendation = try #require(assistantLaunchRecommendation(summary: failedWithPendingCommand, workItem: jiraItem))
    #expect(failedRecommendation.templateId == "bug-analysis")
    #expect(failedRecommendation.reason == "Failed output")

    let skillContextWithLogCommand = AssistantLaunchContextSummary(
        outputCount: 1,
        artifactRefCount: 0,
        pendingCommands: ["/logtrace p-v-123 --env stage"],
        validationEvidence: [],
        decisionSignals: [],
        actionableNotes: [],
        skillRefs: [".pikiclaw/skills/iva-logtracer/SKILL.md", "/logtrace"],
        knowledgeCardCount: 0,
        recentRunCount: 1
    )
    let skillContextRecommendation = try #require(assistantLaunchRecommendation(summary: skillContextWithLogCommand, workItem: nil))
    #expect(skillContextRecommendation.templateId == "skill-hardening")
    #expect(skillContextRecommendation.reason == "Skill context")

    let plainLogCommand = AssistantLaunchContextSummary(
        outputCount: 1,
        artifactRefCount: 0,
        pendingCommands: ["/logtrace p-v-123 --env stage"],
        validationEvidence: [],
        decisionSignals: [],
        actionableNotes: [],
        knowledgeCardCount: 0,
        recentRunCount: 1
    )
    let logRecommendation = try #require(assistantLaunchRecommendation(summary: plainLogCommand, workItem: nil))
    #expect(logRecommendation.templateId == "log-analysis")
    #expect(logRecommendation.reason == "Log lookup")

    let findingWithPendingCommand = AssistantLaunchContextSummary(
        outputCount: 1,
        artifactRefCount: 0,
        pendingCommands: ["swift test --filter AgentStudioWorkflowTests"],
        validationEvidence: [],
        decisionSignals: [],
        actionableNotes: [],
        reviewFindings: ["[P1] Missing retry validation in RootView.swift:6519 before marking the MR ready."],
        knowledgeCardCount: 0,
        recentRunCount: 1
    )
    let findingRecommendation = try #require(assistantLaunchRecommendation(summary: findingWithPendingCommand, workItem: jiraItem))
    #expect(findingRecommendation.templateId == "bug-analysis")
    #expect(findingRecommendation.reason == "Review finding")

    let nonBlockingFinding = AssistantLaunchContextSummary(
        outputCount: 1,
        artifactRefCount: 0,
        pendingCommands: ["swift test --filter AgentStudioWorkflowTests"],
        validationEvidence: [],
        decisionSignals: [],
        actionableNotes: [],
        reviewFindings: ["[P2] Rename status label before MR approval."],
        knowledgeCardCount: 0,
        recentRunCount: 1
    )
    let nonBlockingFindingRecommendation = try #require(assistantLaunchRecommendation(summary: nonBlockingFinding, workItem: jiraItem))
    #expect(nonBlockingFindingRecommendation.templateId == "mr-review")
    #expect(nonBlockingFindingRecommendation.reason == "Review findings")

    let cleanReviewWithPendingCommand = AssistantLaunchContextSummary(
        outputCount: 1,
        artifactRefCount: 0,
        pendingCommands: ["swift build --product PikiclawMac"],
        validationEvidence: ["swift test --filter ChatMessageHistoryTests (passed)"],
        decisionSignals: [],
        actionableNotes: [],
        reviewFindings: ["No blocking findings in the follow-up context change; residual risk is manual app smoke."],
        knowledgeCardCount: 0,
        recentRunCount: 1
    )
    let cleanReviewRecommendation = try #require(assistantLaunchRecommendation(summary: cleanReviewWithPendingCommand, workItem: jiraItem))
    #expect(cleanReviewRecommendation.templateId == "validation")
    #expect(cleanReviewRecommendation.reason == "Pending check")

    let chineseCleanReviewWithPendingCommand = AssistantLaunchContextSummary(
        outputCount: 1,
        artifactRefCount: 0,
        pendingCommands: ["swift build --product PikiclawMac"],
        validationEvidence: ["swift test --filter ChatMessageHistoryTests (passed)"],
        decisionSignals: [],
        actionableNotes: [],
        reviewFindings: ["无阻塞问题；残余风险是手动 smoke。"],
        knowledgeCardCount: 0,
        recentRunCount: 1
    )
    let chineseCleanReviewRecommendation = try #require(assistantLaunchRecommendation(summary: chineseCleanReviewWithPendingCommand, workItem: jiraItem))
    #expect(chineseCleanReviewRecommendation.templateId == "validation")
    #expect(chineseCleanReviewRecommendation.reason == "Pending check")

    let blockedBranchDecision = AssistantLaunchContextSummary(
        outputCount: 1,
        artifactRefCount: 0,
        pendingCommands: ["swift test --filter AgentStudioWorkflowTests"],
        validationEvidence: [],
        decisionSignals: [],
        actionableNotes: [],
        branchDecisions: ["Branch blocked: Evidence: validation failed - Branch decision: Blocked via Review - Read-only review."],
        knowledgeCardCount: 0,
        recentRunCount: 1
    )
    let blockedBranchRecommendation = try #require(assistantLaunchRecommendation(summary: blockedBranchDecision, workItem: jiraItem))
    #expect(blockedBranchRecommendation.templateId == "bug-analysis")
    #expect(blockedBranchRecommendation.reason == "Branch decision")

    let jiraHandoffWithPendingCommand = AssistantLaunchContextSummary(
        outputCount: 1,
        artifactRefCount: 0,
        pendingCommands: ["swift test --filter AgentStudioWorkflowTests"],
        validationEvidence: [],
        decisionSignals: [],
        actionableNotes: [],
        handoffDrafts: ["Jira draft: Status: retry validation still missing | Evidence: context needs handoff drafts."],
        knowledgeCardCount: 0,
        recentRunCount: 1
    )
    let jiraHandoffRecommendation = try #require(assistantLaunchRecommendation(summary: jiraHandoffWithPendingCommand, workItem: nil))
    #expect(jiraHandoffRecommendation.templateId == "jira-execution")
    #expect(jiraHandoffRecommendation.reason == "Handoff draft")

    let genericHandoffOnJiraTicket = AssistantLaunchContextSummary(
        outputCount: 1,
        artifactRefCount: 0,
        pendingCommands: ["swift test --filter AgentStudioWorkflowTests"],
        validationEvidence: [],
        decisionSignals: [],
        actionableNotes: [],
        handoffDrafts: ["Handoff draft: Status: ready for Jira update | Validation: focused test passed."],
        knowledgeCardCount: 0,
        recentRunCount: 1
    )
    let genericJiraHandoffRecommendation = try #require(assistantLaunchRecommendation(summary: genericHandoffOnJiraTicket, workItem: jiraItem))
    #expect(genericJiraHandoffRecommendation.templateId == "jira-execution")
    #expect(genericJiraHandoffRecommendation.reason == "Handoff draft")

    let reviewHandoffWithPendingCommand = AssistantLaunchContextSummary(
        outputCount: 1,
        artifactRefCount: 0,
        pendingCommands: ["swift test --filter AgentStudioWorkflowTests"],
        validationEvidence: [],
        decisionSignals: [],
        actionableNotes: [],
        handoffDrafts: ["MR draft: Ready after focused tests; residual risk is manual smoke."],
        knowledgeCardCount: 0,
        recentRunCount: 1
    )
    let reviewHandoffRecommendation = try #require(assistantLaunchRecommendation(summary: reviewHandoffWithPendingCommand, workItem: nil))
    #expect(reviewHandoffRecommendation.templateId == "mr-review")
    #expect(reviewHandoffRecommendation.reason == "Handoff draft")

    let chineseJiraHandoff = AssistantLaunchContextSummary(
        outputCount: 1,
        artifactRefCount: 0,
        pendingCommands: [],
        validationEvidence: [],
        decisionSignals: [],
        actionableNotes: [],
        handoffDrafts: ["Jira 更新草稿：Status: 已完成 | Validation: focused test passed."],
        knowledgeCardCount: 0,
        recentRunCount: 1
    )
    let chineseJiraHandoffRecommendation = try #require(assistantLaunchRecommendation(summary: chineseJiraHandoff, workItem: nil))
    #expect(chineseJiraHandoffRecommendation.templateId == "jira-execution")
    #expect(chineseJiraHandoffRecommendation.reason == "Handoff draft")

    let chineseReviewHandoff = AssistantLaunchContextSummary(
        outputCount: 1,
        artifactRefCount: 0,
        pendingCommands: [],
        validationEvidence: [],
        decisionSignals: [],
        actionableNotes: [],
        handoffDrafts: ["MR 评审草稿：无阻塞问题；残余风险是手动 smoke。"],
        knowledgeCardCount: 0,
        recentRunCount: 1
    )
    let chineseReviewHandoffRecommendation = try #require(assistantLaunchRecommendation(summary: chineseReviewHandoff, workItem: nil))
    #expect(chineseReviewHandoffRecommendation.templateId == "mr-review")
    #expect(chineseReviewHandoffRecommendation.reason == "Handoff draft")

    let resolvedBranchOnJira = AssistantLaunchContextSummary(
        outputCount: 1,
        artifactRefCount: 0,
        pendingCommands: ["swift test --filter AgentStudioWorkflowTests"],
        validationEvidence: [],
        decisionSignals: [],
        actionableNotes: [],
        branchDecisions: ["Branch resolved: Evidence: branch review - Branch decision: Resolved via Review - Read-only review."],
        knowledgeCardCount: 0,
        recentRunCount: 1
    )
    let resolvedJiraBranchRecommendation = try #require(assistantLaunchRecommendation(summary: resolvedBranchOnJira, workItem: jiraItem))
    #expect(resolvedJiraBranchRecommendation.templateId == "jira-execution")
    #expect(resolvedJiraBranchRecommendation.reason == "Branch decision")

    let resolvedBranchWithoutJira = AssistantLaunchContextSummary(
        outputCount: 1,
        artifactRefCount: 0,
        pendingCommands: ["swift test --filter AgentStudioWorkflowTests"],
        validationEvidence: [],
        decisionSignals: [],
        actionableNotes: [],
        branchDecisions: ["Branch resolved: Evidence: branch review - Branch decision: Resolved via Review - Read-only review."],
        knowledgeCardCount: 0,
        recentRunCount: 1
    )
    let resolvedReviewBranchRecommendation = try #require(assistantLaunchRecommendation(summary: resolvedBranchWithoutJira, workItem: nil))
    #expect(resolvedReviewBranchRecommendation.templateId == "mr-review")
    #expect(resolvedReviewBranchRecommendation.reason == "Branch decision")

    let jiraWriteBackContext = AssistantLaunchContextSummary(
        outputCount: 1,
        artifactRefCount: 1,
        pendingCommands: ["swift test --filter AgentStudioWorkflowTests"],
        validationEvidence: [],
        decisionSignals: [],
        actionableNotes: [],
        jiraWriteBackSignals: ["Jira write-back: Failed IVAS-9300; retry or paste the draft manually."],
        failureSignals: ["Jira write-back: Failed IVAS-9300; retry or paste the draft manually."],
        knowledgeCardCount: 0,
        recentRunCount: 1
    )
    let jiraWriteBackRecommendation = try #require(assistantLaunchRecommendation(summary: jiraWriteBackContext, workItem: nil))
    #expect(jiraWriteBackRecommendation.templateId == "jira-execution")
    #expect(jiraWriteBackRecommendation.reason == "Jira write-back")

    let chineseJiraWriteBackContext = AssistantLaunchContextSummary(
        outputCount: 1,
        artifactRefCount: 1,
        pendingCommands: ["swift test --filter AgentStudioWorkflowTests"],
        validationEvidence: [],
        decisionSignals: [],
        actionableNotes: [],
        jiraWriteBackSignals: ["Jira write-back: Jira 写回失败：IVAS-9301 缺少 token，需要重试或手动粘贴草稿。"],
        failureSignals: ["Jira 写回失败：IVAS-9301 缺少 token，需要重试或手动粘贴草稿。"],
        knowledgeCardCount: 0,
        recentRunCount: 1
    )
    let chineseJiraWriteBackRecommendation = try #require(assistantLaunchRecommendation(summary: chineseJiraWriteBackContext, workItem: nil))
    #expect(chineseJiraWriteBackRecommendation.templateId == "jira-execution")
    #expect(chineseJiraWriteBackRecommendation.reason == "Jira write-back")

    let postedJiraWriteBackContext = AssistantLaunchContextSummary(
        outputCount: 1,
        artifactRefCount: 1,
        pendingCommands: ["swift build --product PikiclawMac"],
        validationEvidence: ["swift test --filter AgentStudioWorkflowTests (passed)"],
        decisionSignals: [],
        actionableNotes: [],
        jiraWriteBackSignals: ["Jira write-back: Posted IVAS-9300 to Jira."],
        knowledgeCardCount: 0,
        recentRunCount: 1
    )
    let postedJiraWriteBackRecommendation = try #require(assistantLaunchRecommendation(summary: postedJiraWriteBackContext, workItem: jiraItem))
    #expect(postedJiraWriteBackRecommendation.templateId == "validation")
    #expect(postedJiraWriteBackRecommendation.reason == "Pending check")

    let chinesePostedJiraWriteBackContext = AssistantLaunchContextSummary(
        outputCount: 1,
        artifactRefCount: 1,
        pendingCommands: ["swift build --product PikiclawMac"],
        validationEvidence: ["swift test --filter AgentStudioWorkflowTests (passed)"],
        decisionSignals: [],
        actionableNotes: [],
        jiraWriteBackSignals: ["Jira write-back: Jira 写回已发布：IVAS-9301 已发布到 Jira。"],
        knowledgeCardCount: 0,
        recentRunCount: 1
    )
    let chinesePostedJiraWriteBackRecommendation = try #require(assistantLaunchRecommendation(summary: chinesePostedJiraWriteBackContext, workItem: jiraItem))
    #expect(chinesePostedJiraWriteBackRecommendation.templateId == "validation")
    #expect(chinesePostedJiraWriteBackRecommendation.reason == "Pending check")

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

    let residualRiskContext = AssistantLaunchContextSummary(
        outputCount: 1,
        artifactRefCount: 1,
        pendingCommands: [],
        validationEvidence: ["swift test --filter AgentStudioWorkflowTests (passed)"],
        decisionSignals: [],
        actionableNotes: ["Risk: full app smoke has not run."],
        knowledgeCardCount: 0,
        recentRunCount: 1
    )
    let residualRiskRecommendation = try #require(assistantLaunchRecommendation(summary: residualRiskContext, workItem: nil))
    #expect(residualRiskRecommendation.templateId == "validation")
    #expect(residualRiskRecommendation.reason == "Validation gap")

    let genericResidualRiskContext = AssistantLaunchContextSummary(
        outputCount: 1,
        artifactRefCount: 1,
        pendingCommands: [],
        validationEvidence: ["swift test --filter AgentStudioWorkflowTests (passed)"],
        decisionSignals: [],
        actionableNotes: ["Risk: UI polish needs product review before release."],
        knowledgeCardCount: 0,
        recentRunCount: 1
    )
    let genericResidualRiskRecommendation = try #require(assistantLaunchRecommendation(summary: genericResidualRiskContext, workItem: nil))
    #expect(genericResidualRiskRecommendation.templateId == "mr-review")
    #expect(genericResidualRiskRecommendation.reason == "Review-ready context")

    let blockingRiskContext = AssistantLaunchContextSummary(
        outputCount: 1,
        artifactRefCount: 1,
        pendingCommands: [],
        validationEvidence: [],
        decisionSignals: [],
        actionableNotes: ["Blocking risk: retry can drop unsaved Jira draft data."],
        knowledgeCardCount: 0,
        recentRunCount: 1
    )
    let blockingRiskRecommendation = try #require(assistantLaunchRecommendation(summary: blockingRiskContext, workItem: nil))
    #expect(blockingRiskRecommendation.templateId == "bug-analysis")
    #expect(blockingRiskRecommendation.reason == "Blocked output")

    let chineseBlockingRiskContext = AssistantLaunchContextSummary(
        outputCount: 1,
        artifactRefCount: 1,
        pendingCommands: [],
        validationEvidence: [],
        decisionSignals: [],
        actionableNotes: ["阻塞风险：Jira 草稿重试可能丢失未保存内容，必须修复后再继续。"],
        knowledgeCardCount: 0,
        recentRunCount: 1
    )
    let chineseBlockingRiskRecommendation = try #require(assistantLaunchRecommendation(summary: chineseBlockingRiskContext, workItem: nil))
    #expect(chineseBlockingRiskRecommendation.templateId == "bug-analysis")
    #expect(chineseBlockingRiskRecommendation.reason == "Blocked output")

    let validationGapContext = AssistantLaunchContextSummary(
        outputCount: 1,
        artifactRefCount: 1,
        pendingCommands: [],
        validationEvidence: [],
        decisionSignals: [],
        actionableNotes: ["Validation gap: missing tests for the voice regression smoke."],
        knowledgeCardCount: 0,
        recentRunCount: 1
    )
    let validationGapRecommendation = try #require(assistantLaunchRecommendation(summary: validationGapContext, workItem: nil))
    #expect(validationGapRecommendation.templateId == "validation")
    #expect(validationGapRecommendation.reason == "Validation gap")

    let chineseValidationGapContext = AssistantLaunchContextSummary(
        outputCount: 1,
        artifactRefCount: 1,
        pendingCommands: [],
        validationEvidence: [],
        decisionSignals: [],
        actionableNotes: ["验证缺口：缺少测试覆盖，voice 回归 smoke 还没跑。"],
        knowledgeCardCount: 0,
        recentRunCount: 1
    )
    let chineseValidationGapRecommendation = try #require(assistantLaunchRecommendation(summary: chineseValidationGapContext, workItem: nil))
    #expect(chineseValidationGapRecommendation.templateId == "validation")
    #expect(chineseValidationGapRecommendation.reason == "Validation gap")

    let missingInputContext = AssistantLaunchContextSummary(
        outputCount: 1,
        artifactRefCount: 1,
        pendingCommands: [],
        validationEvidence: [],
        decisionSignals: [],
        actionableNotes: ["Missing input: reproduction steps for the native crash."],
        knowledgeCardCount: 0,
        recentRunCount: 1
    )
    let missingInputRecommendation = try #require(assistantLaunchRecommendation(summary: missingInputContext, workItem: nil))
    #expect(missingInputRecommendation.templateId == "bug-analysis")
    #expect(missingInputRecommendation.reason == "Blocked output")

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
    let jiraUpdateReady = try #require(assistantLaunchRecommendation(summary: reviewReady, workItem: jiraItem))
    #expect(jiraUpdateReady.templateId == "jira-execution")
    #expect(jiraUpdateReady.reason == "Jira update")

    let jiraLinkedContext = AssistantLaunchContextSummary(
        outputCount: 1,
        artifactRefCount: 1,
        pendingCommands: [],
        validationEvidence: [],
        decisionSignals: [],
        actionableNotes: [],
        jiraRefs: ["IVAS-9300 (https://jira.example.com/browse/IVAS-9300)"],
        knowledgeCardCount: 0,
        recentRunCount: 1
    )
    let jiraLinkedRecommendation = try #require(assistantLaunchRecommendation(summary: jiraLinkedContext, workItem: nil))
    #expect(jiraLinkedRecommendation.templateId == "jira-execution")
    #expect(jiraLinkedRecommendation.reason == "Jira context")

    let jiraValidationContext = AssistantLaunchContextSummary(
        outputCount: 1,
        artifactRefCount: 1,
        pendingCommands: [],
        validationEvidence: ["swift test --filter JiraNativeWorkflowTests (passed)"],
        decisionSignals: [],
        actionableNotes: [],
        jiraRefs: ["IVAS-9300"],
        knowledgeCardCount: 0,
        recentRunCount: 1
    )
    let jiraValidationRecommendation = try #require(assistantLaunchRecommendation(summary: jiraValidationContext, workItem: nil))
    #expect(jiraValidationRecommendation.templateId == "jira-execution")
    #expect(jiraValidationRecommendation.reason == "Jira update")

    let mrLinked = AssistantLaunchContextSummary(
        outputCount: 1,
        artifactRefCount: 1,
        pendingCommands: [],
        validationEvidence: [],
        decisionSignals: [],
        actionableNotes: [],
        reviewRefs: ["MR: https://gitlab.example.com/pikiclaw/pikiclaw/-/merge_requests/930"],
        knowledgeCardCount: 0,
        recentRunCount: 1
    )
    let mrReview = try #require(assistantLaunchRecommendation(summary: mrLinked, workItem: jiraItem))
    #expect(mrReview.templateId == "mr-review")
    #expect(mrReview.reason == "MR/PR context")

    let chineseMRContext = AssistantLaunchContextSummary(
        outputCount: 1,
        artifactRefCount: 1,
        pendingCommands: [],
        validationEvidence: [],
        decisionSignals: [],
        actionableNotes: ["合并请求评审上下文：准备合并前需要复查最终评审评论。"],
        knowledgeCardCount: 0,
        recentRunCount: 1
    )
    let chineseMRReview = try #require(assistantLaunchRecommendation(summary: chineseMRContext, workItem: nil))
    #expect(chineseMRReview.templateId == "mr-review")
    #expect(chineseMRReview.reason == "MR/PR context")

    let codeLinkedContext = AssistantLaunchContextSummary(
        outputCount: 1,
        artifactRefCount: 1,
        pendingCommands: [],
        validationEvidence: [],
        decisionSignals: [],
        actionableNotes: [],
        codeRefs: ["apps/macos/Sources/PikiclawMac/RootView.swift:6519"],
        knowledgeCardCount: 0,
        recentRunCount: 1
    )
    let codeReview = try #require(assistantLaunchRecommendation(summary: codeLinkedContext, workItem: nil))
    #expect(codeReview.templateId == "mr-review")
    #expect(codeReview.reason == "Code context")

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

@Test func composerSkillCardsShowForBareSlash() {
    #expect(composerShouldShowSkillCards(for: ""))
    #expect(composerShouldShowSkillCards(for: "   "))
    #expect(composerShouldShowSkillCards(for: "/"))
    #expect(composerShouldShowSkillCards(for: " / "))
    #expect(!composerShouldShowSkillCards(for: "/log"))
    #expect(!composerShouldShowSkillCards(for: "trace lookup"))
    #expect(!composerShouldShowSlashCommandList(for: ""))
    #expect(!composerShouldShowSlashCommandList(for: "   "))
    #expect(composerShouldShowSlashCommandList(for: "/"))
    #expect(composerShouldShowSlashCommandList(for: " / "))
    #expect(composerShouldShowSlashCommandList(for: "/log"))
    #expect(composerShouldShowSlashCommandList(for: "/code"))
    #expect(!composerShouldShowSlashCommandList(for: "/log trace"))
}

@Test func composerBuiltinCommandsFollowSelectedAgentCapabilities() {
    let codexCommands = composerBuiltinCommandOptions(for: .codex).map(\.command)
    #expect(codexCommands.contains("/goal "))
    #expect(codexCommands.contains("/goal pause"))
    #expect(codexCommands.contains("/goal resume"))
    #expect(codexCommands.contains("/goal clear"))
    #expect(codexCommands.contains("/plan "))

    let claudeCommands = composerBuiltinCommandOptions(for: .claude).map(\.command)
    #expect(claudeCommands.contains("/goal "))
    #expect(claudeCommands.contains("/goal clear"))
    #expect(claudeCommands.contains("/plan "))
    #expect(!claudeCommands.contains("/goal pause"))
    #expect(!claudeCommands.contains("/goal resume"))

    let hermesCommands = composerBuiltinCommandOptions(for: .hermes).map(\.command)
    #expect(hermesCommands.contains("/goal "))
    #expect(hermesCommands.contains("/goal pause"))
    #expect(hermesCommands.contains("/goal resume"))
    #expect(!hermesCommands.contains("/plan "))

    #expect(composerBuiltinCommandOptions(for: .customCLI).isEmpty)
}

@Test func composerSlashCommandsFilterByQueryText() {
    let snapshot = NativeStoreSnapshot(capabilities: [
        Capability(
            kind: .skill,
            name: "code-review",
            scope: .workspace,
            installState: "installed",
            configState: "ready",
            trustLevel: .trusted,
            healthState: .healthy
        ),
        Capability(
            kind: .skill,
            name: "IVA Log Tracer",
            scope: .workspace,
            installState: "installed",
            configState: "ready",
            trustLevel: .trusted,
            healthState: .healthy
        ),
        Capability(
            kind: .skill,
            name: "Using Superpowers",
            scope: .workspace,
            installState: "installed",
            configState: "ready",
            trustLevel: .trusted,
            healthState: .healthy
        )
    ])

    let codeCommands = composerCommandCards(snapshot: snapshot, agentKind: .codex, draftText: "/code").map(\.command)
    #expect(codeCommands.contains("/sk_code_review "))
    #expect(!codeCommands.contains("/logtrace env=lab conversationId= last=24h "))

    let reviewCommands = composerCommandCards(snapshot: snapshot, agentKind: .codex, draftText: "/review").map(\.command)
    #expect(reviewCommands.contains("/sk_code_review "))

    let goalCommands = composerCommandCards(snapshot: snapshot, agentKind: .codex, draftText: "/goal").map(\.command)
    #expect(goalCommands.contains("/goal "))
    #expect(goalCommands.contains("/goal pause"))
    #expect(!goalCommands.contains("/sk_code_review "))
}

@Test func composerSkillAvailabilityFollowsSelectedAgent() {
    let readyWorkspaceSkill = Capability(
        kind: .skill,
        name: "IVA Log Tracer",
        scope: .workspace,
        installState: "installed",
        configState: "ready",
        trustLevel: .trusted,
        healthState: .healthy
    )
    let agentSkill = Capability(
        kind: .skill,
        name: "Codex Review",
        scope: .agent,
        installState: "installed",
        configState: "ready",
        trustLevel: .trusted,
        healthState: .healthy
    )
    let needsSetupSkill = Capability(
        kind: .skill,
        name: "ClickHouse Query",
        scope: .workspace,
        installState: "installed",
        configState: "requires clickhouse-lab MCP",
        trustLevel: .trusted,
        healthState: .needsConfiguration
    )

    #expect(composerSkillAvailability(for: readyWorkspaceSkill, agentKind: .codex).mode == .portable)
    #expect(composerSkillAvailability(for: agentSkill, agentKind: .codex).mode == .native)
    #expect(composerSkillAvailability(for: needsSetupSkill, agentKind: .codex).mode == .needsSetup)
    #expect(composerSkillAvailability(for: readyWorkspaceSkill, agentKind: .customCLI).mode == .unsupported)
    #expect(
        composerSkillAvailabilityPriority(for: readyWorkspaceSkill, agentKind: .codex)
            < composerSkillAvailabilityPriority(for: needsSetupSkill, agentKind: .codex)
    )
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
