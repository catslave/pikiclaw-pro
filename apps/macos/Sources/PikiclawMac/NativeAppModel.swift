import AppKit
import Foundation
import PikiclawCore
import PikiclawRunner

struct NativeWorkflowLaunchTemplate: Identifiable, Hashable {
    var id: String
    var title: String
    var category: String
    var summary: String
    var symbol: String
    var steps: Int
    var outputs: Int
    var effort: String
    var agentKind: NativeAgentKind
    var prompt: String
}

struct AssistantLaunchContextSummary: Hashable {
    var outputCount: Int
    var artifactRefCount: Int
    var pendingCommands: [String]
    var validationEvidence: [String]
    var decisionSignals: [String]
    var actionableNotes: [String]
    var knowledgeCardCount: Int
    var recentRunCount: Int

    var pendingCommandCount: Int {
        pendingCommands.count
    }

    var validationEvidenceCount: Int {
        validationEvidence.count
    }

    var decisionSignalCount: Int {
        decisionSignals.count
    }

    var actionableNoteCount: Int {
        actionableNotes.count
    }

    var hasContextPack: Bool {
        outputCount > 0
            || artifactRefCount > 0
            || pendingCommandCount > 0
            || validationEvidenceCount > 0
            || decisionSignalCount > 0
            || actionableNoteCount > 0
            || knowledgeCardCount > 0
            || recentRunCount > 0
    }
}

let nativeWorkflowLaunchTemplates: [NativeWorkflowLaunchTemplate] = [
    NativeWorkflowLaunchTemplate(
        id: "repository-audit",
        title: "Repository Audit",
        category: "Engineering",
        summary: "Map the repo surface, identify current gaps, and turn findings into a durable next action.",
        symbol: "stethoscope",
        steps: 4,
        outputs: 4,
        effort: "Deep",
        agentKind: .codex,
        prompt: """
        Run a repository audit for {project}.

        Read the current repo state before making claims. Map the relevant product surface, identify gaps that affect day-to-day work, rank them by user-efficiency impact, and propose the smallest implementation sequence. Save or point to durable evidence when useful.
        """
    ),
    NativeWorkflowLaunchTemplate(
        id: "regression-triage",
        title: "Regression Triage",
        category: "Engineering",
        summary: "Convert a bug symptom into reproduction, likely cause, smallest fix path, and verification.",
        symbol: "ladybug",
        steps: 5,
        outputs: 4,
        effort: "Deep",
        agentKind: .codex,
        prompt: """
        Run regression triage for {project}.

        Start from the reported symptom. Reproduce or narrow it with evidence, identify the likely seam, separate confirmed facts from guesses, implement only the smallest safe fix if the seam is clear, and run focused validation. If reproduction is blocked, return the shortest unblock request.
        """
    ),
    NativeWorkflowLaunchTemplate(
        id: "release-readiness",
        title: "Release Readiness",
        category: "Operations",
        summary: "Collect build, test, smoke, risk, and handoff evidence before install or rollout.",
        symbol: "checkmark.seal",
        steps: 4,
        outputs: 4,
        effort: "Medium",
        agentKind: .codex,
        prompt: """
        Run a release readiness pass for {project}.

        Verify the relevant build and focused tests, inspect high-risk surfaces touched by current changes, summarize go/no-go status, and list only risks that would change the shipping decision. Include exact commands and results.
        """
    ),
    NativeWorkflowLaunchTemplate(
        id: "native-mac-validation",
        title: "Native Mac Validation",
        category: "Operations",
        summary: "Run the focused macOS package tests and app build, then return clear go/no-go evidence.",
        symbol: "macwindow",
        steps: 3,
        outputs: 3,
        effort: "Medium",
        agentKind: .codex,
        prompt: """
        Validate the Pikiclaw mac native client for {project}.

        Focus on the Swift package under apps/macos when present. Run the most relevant focused tests first. For a full app rebuild, use the shared build script from the repo root (`./apps/macos/scripts/build-app.sh`) or from apps/macos (`./scripts/build-app.sh`) instead of launching parallel Swift builds. Report exact commands, failures, and the next smallest fix if validation does not pass.
        """
    ),
    NativeWorkflowLaunchTemplate(
        id: "skill-hardening",
        title: "Skill Hardening",
        category: "Skills",
        summary: "Improve one high-frequency skill so invocation, parameters, failures, and output are crisp.",
        symbol: "puzzlepiece.extension",
        steps: 5,
        outputs: 3,
        effort: "Deep",
        agentKind: .codex,
        prompt: """
        Harden a high-frequency Pikiclaw skill for {project}.

        Pick the most relevant current skill, inspect its SKILL.md and scripts, make the invocation faster and harder to misuse, improve parameter examples, preserve environment boundaries, and add focused validation where possible. Keep source-grounded behavior distinct from guesses.
        """
    ),
    NativeWorkflowLaunchTemplate(
        id: "context-handoff",
        title: "Context Handoff",
        category: "Engineering",
        summary: "Turn current repo, branch, terminal, and task context into a concise next-agent handoff.",
        symbol: "arrow.triangle.branch",
        steps: 3,
        outputs: 2,
        effort: "Light",
        agentKind: .codex,
        prompt: """
        Prepare a context handoff for {project}.

        Read the current workspace state, active task, branch, and any recent terminal evidence available in the prompt. Produce a concise handoff with confirmed facts, open risks, next action, and the minimum validation needed before continuing.
        """
    ),
    NativeWorkflowLaunchTemplate(
        id: "jira-sprint-sweep",
        title: "Jira Sprint Sweep",
        category: "Jira",
        summary: "Sync sprint work, rank tickets by actionability, and start the next best work item.",
        symbol: "checklist",
        steps: 4,
        outputs: 3,
        effort: "Medium",
        agentKind: .codex,
        prompt: """
        Run a Jira sprint sweep for {project}.

        Sync or inspect current Jira work, rank tickets by urgency, ambiguity, and implementation readiness, choose the highest-leverage next action, and start from repo evidence. Keep ticket state, source evidence, and final validation tied together.
        """
    ),
    NativeWorkflowLaunchTemplate(
        id: "post-run-evidence-review",
        title: "Post-Run Evidence Review",
        category: "Operations",
        summary: "Review a completed or failed run, preserve evidence, and decide the next practical step.",
        symbol: "doc.text.magnifyingglass",
        steps: 4,
        outputs: 3,
        effort: "Medium",
        agentKind: .codex,
        prompt: """
        Review the latest run evidence for {project}.

        Inspect the current task context and any available transcript or terminal output. Separate verified facts from guesses, identify the first actionable failure or gap, and return a short next-step plan with the validation command that should close the loop.
        """
    )
]

@MainActor
final class NativeAppModel: ObservableObject {
    @Published var snapshot = NativeStoreSnapshot(seed: .preview())
    @Published var draftPrompt = ""
    @Published var selectedPermissionMode: PermissionMode = .askBeforeEdit
    @Published var selectedAgentKind: NativeAgentKind = .codex
    @Published var statusLine = "Ready"
    @Published var isRunning = false
    @Published private(set) var runningRunIds: Set<EntityID> = []
    @Published var activeRunId: EntityID?
    @Published var branchOptionsByWorkspace: [EntityID: [String]] = [:]
    @Published var branchStatusByWorkspace: [EntityID: String] = [:]
    @Published var terminalCommand = ""
    @Published var terminalTranscript = ""
    @Published var terminalIsRunning = false
    @Published var terminalWorkingDirectories: [EntityID: String] = [:]
    @Published var jiraSyncIsRunning = false

    private let store: JSONNativeStore
    private let agentAdapterFactory: @Sendable (AgentDescriptor) -> any AgentAdapter
    private var didRecoverPersistedActiveRuns = false
    private var lastStagedAssistantPrompt: String?
    private var lastStagedAssistantUserInput: String?
    private var lastStagedJiraPrompt: String?
    private var lastStagedJiraUserInput: String?
    @MainActor private static var restartInFlight = false

    init(
        store: JSONNativeStore? = nil,
        agentAdapterFactory: @escaping @Sendable (AgentDescriptor) -> any AgentAdapter = { descriptor in
            ProcessAgentAdapter(descriptor: descriptor)
        }
    ) {
        self.store = store ?? JSONNativeStore()
        self.agentAdapterFactory = agentAdapterFactory
        Task {
            await recoverPersistedActiveRunsOnLaunch()
            await reload()
        }
    }

    var restartBlockedByActiveRun: Bool {
        isRunning || snapshot.runs.contains { run in
            Self.isActiveExecutionState(run.state)
        }
    }

    func reload() async {
        do {
            if !didRecoverPersistedActiveRuns {
                await recoverPersistedActiveRunsOnLaunch()
            }
            var next = try await store.loadSnapshot()
            if Self.syncProjectSkillCapabilities(into: &next) {
                try await store.replaceSnapshot(next)
            }
            snapshot = next
            ensureSelectedAgentIsEnabled()
            statusLine = "Loaded \(snapshot.workItems.count) work item(s)"
        } catch {
            statusLine = "Load failed: \(error.localizedDescription)"
        }
    }

    func recoverPersistedActiveRunsOnLaunch() async {
        guard !didRecoverPersistedActiveRuns else { return }
        didRecoverPersistedActiveRuns = true
        do {
            var next = try await store.loadSnapshot()
            var recoveredRunIds: [EntityID] = []
            for index in next.runs.indices where Self.isActiveExecutionState(next.runs[index].state) {
                guard !runningRunIds.contains(next.runs[index].id) else { continue }
                next.runs[index].state = .stale
                next.runs[index].endedAt = Date()
                let staleLine = "[system] Marked stale because Pikiclaw restarted before this run reported completion."
                let transcript = next.runs[index].transcript.trimmingCharacters(in: .whitespacesAndNewlines)
                next.runs[index].transcript = transcript.isEmpty ? staleLine : "\(transcript)\n\(staleLine)"
                recoveredRunIds.append(next.runs[index].id)
            }
            guard !recoveredRunIds.isEmpty else { return }
            try await store.replaceSnapshot(next)
            for runId in recoveredRunIds {
                runningRunIds.remove(runId)
            }
            isRunning = !runningRunIds.isEmpty
            statusLine = "Recovered \(recoveredRunIds.count) stale run(s)"
        } catch {
            statusLine = "Run recovery failed: \(error.localizedDescription)"
        }
    }

    func addWorkspace(path: String) async {
        let url = URL(fileURLWithPath: path, isDirectory: true)
        let workspace = Workspace(
            name: url.lastPathComponent.isEmpty ? path : url.lastPathComponent,
            pathDisplay: path,
            lastOpenedAt: Date(),
            trustState: .trusted,
            defaultAgentProfileId: agentProfile(for: selectedAgentKind)?.id
        )
        do {
            try await store.saveWorkspace(workspace)
            try await store.appendAuditEvent(AuditEvent(
                kind: .workspaceAccess,
                actor: "user",
                summary: "Added workspace \(path)",
                workspaceId: workspace.id
            ))
            await reload()
            await refreshBranches(for: workspace)
        } catch {
            statusLine = "Add workspace failed: \(error.localizedDescription)"
        }
    }

    func moveProject(_ projectId: EntityID, before targetProjectId: EntityID) async {
        guard projectId != targetProjectId else { return }
        do {
            var next = try await store.loadSnapshot()
            guard let sourceIndex = next.projects.firstIndex(where: { $0.id == projectId }),
                  let targetIndex = next.projects.firstIndex(where: { $0.id == targetProjectId }) else {
                return
            }
            let project = next.projects.remove(at: sourceIndex)
            next.projects.insert(project, at: targetIndex)
            try await store.replaceSnapshot(next)
            statusLine = "Project order updated"
            await reload()
        } catch {
            statusLine = "Move project failed: \(error.localizedDescription)"
        }
    }

    func moveWorkspace(_ workspaceId: EntityID, before targetWorkspaceId: EntityID) async {
        guard workspaceId != targetWorkspaceId else { return }
        do {
            var next = try await store.loadSnapshot()
            guard let sourceIndex = next.workspaces.firstIndex(where: { $0.id == workspaceId }),
                  let targetIndex = next.workspaces.firstIndex(where: { $0.id == targetWorkspaceId }) else {
                return
            }
            let workspace = next.workspaces.remove(at: sourceIndex)
            next.workspaces.insert(workspace, at: targetIndex)
            for index in next.projects.indices {
                guard let projectSourceIndex = next.projects[index].workspaceIds.firstIndex(of: workspaceId),
                      let projectTargetIndex = next.projects[index].workspaceIds.firstIndex(of: targetWorkspaceId) else {
                    continue
                }
                let movedWorkspaceId = next.projects[index].workspaceIds.remove(at: projectSourceIndex)
                next.projects[index].workspaceIds.insert(movedWorkspaceId, at: projectTargetIndex)
            }
            try await store.replaceSnapshot(next)
            statusLine = "Workspace order updated"
            await reload()
        } catch {
            statusLine = "Move workspace failed: \(error.localizedDescription)"
        }
    }

    func deleteProject(_ projectId: EntityID) async {
        do {
            var next = try await store.loadSnapshot()
            let originalCount = next.projects.count
            next.projects.removeAll { $0.id == projectId }
            guard next.projects.count != originalCount else {
                statusLine = "Project not found"
                return
            }
            for index in next.workItems.indices where next.workItems[index].projectId == projectId {
                next.workItems[index].projectId = nil
            }
            try await store.replaceSnapshot(next)
            statusLine = "Project deleted"
            await reload()
        } catch {
            statusLine = "Delete project failed: \(error.localizedDescription)"
        }
    }

    func deleteWorkspace(_ workspaceId: EntityID) async {
        do {
            var next = try await store.loadSnapshot()
            let originalCount = next.workspaces.count
            next.workspaces.removeAll { $0.id == workspaceId }
            guard next.workspaces.count != originalCount else {
                statusLine = "Workspace not found"
                return
            }

            next.projects = next.projects.map { project in
                var updated = project
                updated.workspaceIds.removeAll { $0 == workspaceId }
                return updated
            }

            let removedWorkItemIds = Set(next.workItems.filter { $0.workspaceId == workspaceId }.map(\.id))
            next.workItems.removeAll { $0.workspaceId == workspaceId }
            next.runs.removeAll { run in
                run.workspaceId == workspaceId || run.workItemId.map { removedWorkItemIds.contains($0) } == true
            }
            next.artifacts.removeAll { artifact in
                artifact.workItemId.map { removedWorkItemIds.contains($0) } == true
            }

            if let activeRunId,
               !next.runs.contains(where: { $0.id == activeRunId }) {
                self.activeRunId = nil
            }
            branchOptionsByWorkspace.removeValue(forKey: workspaceId)
            branchStatusByWorkspace.removeValue(forKey: workspaceId)

            try await store.replaceSnapshot(next)
            statusLine = "Workspace removed"
            await reload()
        } catch {
            statusLine = "Delete workspace failed: \(error.localizedDescription)"
        }
    }

    @discardableResult
    func refreshBranches(for workspace: Workspace?) async -> Workspace? {
        guard let workspace else { return nil }

        do {
            let insideWorkTree = try Self.gitOutput(["rev-parse", "--is-inside-work-tree"], in: workspace.pathDisplay).gitTrimmed
            guard insideWorkTree == "true" else {
                return await clearBranchState(for: workspace)
            }

            let showCurrent = try Self.gitOutput(["branch", "--show-current"], in: workspace.pathDisplay).gitTrimmed
            let fallbackCurrent = showCurrent.isEmpty
                ? try Self.gitOutput(["rev-parse", "--abbrev-ref", "HEAD"], in: workspace.pathDisplay).gitTrimmed
                : showCurrent
            let currentBranch = fallbackCurrent == "HEAD" ? "Detached HEAD" : fallbackCurrent
            let branchList = try Self.gitOutput(["branch", "--format=%(refname:short)"], in: workspace.pathDisplay)
            let branches = Self.orderedBranches(currentBranch: currentBranch, branchList: branchList)

            branchOptionsByWorkspace[workspace.id] = branches
            branchStatusByWorkspace[workspace.id] = branches.isEmpty ? "No local branches found" : nil

            let storedBranch = currentBranch.isEmpty ? nil : currentBranch
            if workspace.currentBranch != storedBranch {
                var updated = workspace
                updated.currentBranch = storedBranch
                try await store.saveWorkspace(updated)
                await reload()
                return updated
            }
            return workspace
        } catch let error as NativeGitError where error.isNotGitRepository {
            return await clearBranchState(for: workspace)
        } catch {
            branchStatusByWorkspace[workspace.id] = "Branch lookup failed: \(error.localizedDescription)"
            return workspace
        }
    }

    private func clearBranchState(for workspace: Workspace) async -> Workspace {
        branchOptionsByWorkspace[workspace.id] = []
        branchStatusByWorkspace[workspace.id] = nil

        guard workspace.currentBranch != nil else {
            return workspace
        }

        var updated = workspace
        updated.currentBranch = nil
        do {
            try await store.saveWorkspace(updated)
            await reload()
            return updated
        } catch {
            statusLine = "Branch state cleanup failed: \(error.localizedDescription)"
            return workspace
        }
    }

    func switchBranch(_ branch: String, workspace: Workspace?) async {
        guard let workspace else { return }
        let target = branch.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !target.isEmpty else { return }

        do {
            branchStatusByWorkspace[workspace.id] = "Switching to \(target)"
            _ = try Self.gitOutput(["switch", target], in: workspace.pathDisplay)

            var updated = workspace
            updated.currentBranch = target
            updated.lastOpenedAt = Date()
            try await store.saveWorkspace(updated)
            try await store.appendAuditEvent(AuditEvent(
                kind: .workspaceAccess,
                actor: "user",
                summary: "Switched branch to \(target)",
                workspaceId: workspace.id
            ))

            statusLine = "Branch switched to \(target)"
            branchStatusByWorkspace[workspace.id] = nil
            await reload()
            await refreshBranches(for: updated)
        } catch {
            branchStatusByWorkspace[workspace.id] = "Switch failed: \(error.localizedDescription)"
            statusLine = "Branch switch failed: \(error.localizedDescription)"
        }
    }

    func prepareNewChat() {
        activeRunId = nil
        draftPrompt = ""
        statusLine = "New chat ready"
    }

    @discardableResult
    func detectAgent(kind: NativeAgentKind? = nil) async -> AgentDetection? {
        let requestedKind = kind ?? selectedAgentKind
        guard let profile = snapshot.agentProfiles.first(where: { $0.kind == requestedKind }) ?? snapshot.agentProfiles.first else {
            statusLine = "No agent profile configured"
            return nil
        }

        selectedAgentKind = profile.kind
        statusLine = "Detecting \(profile.displayName)"
        let detection = await agentAdapterFactory(Self.agentDescriptor(for: profile)).detect()

        do {
            var next = try await store.loadSnapshot()
            let capability = Self.agentCapability(for: profile, detection: detection)
            _ = Self.upsertCapability(capability, into: &next.capabilities)
            try await store.replaceSnapshot(next)
            snapshot = next
            if detection.isAvailable {
                let path = detection.executablePath.map(Self.shortTerminalPath) ?? profile.executableName
                statusLine = "\(profile.displayName) detected at \(path)"
            } else {
                statusLine = "\(profile.displayName) unavailable: \(detection.detail)"
            }
        } catch {
            statusLine = "Detect saved result failed: \(error.localizedDescription)"
        }

        return detection
    }

    @discardableResult
    func stageAgentLogin(kind: NativeAgentKind? = nil, workspaceId: EntityID? = nil) -> Bool {
        let requestedKind = kind ?? selectedAgentKind
        guard let profile = snapshot.agentProfiles.first(where: { $0.kind == requestedKind }) ?? snapshot.agentProfiles.first else {
            statusLine = "No agent profile configured"
            return false
        }

        selectedAgentKind = profile.kind
        if let workspace = selectedWorkspace(id: workspaceId) ?? snapshot.workspaces.first {
            terminalWorkingDirectories[workspace.id] = terminalCurrentDirectory(for: workspace) ?? workspace.pathDisplay
        }
        terminalCommand = Self.agentLoginCommand(for: profile)
        statusLine = "\(profile.displayName) login command staged in Context Terminal"
        return true
    }

    @discardableResult
    func stageAssistantPrompt(
        title: String,
        prompt: String,
        agentKind: NativeAgentKind = .codex,
        permissionMode: PermissionMode? = nil,
        workspaceId: EntityID? = nil,
        workItemId: EntityID? = nil,
        userInput: String? = nil
    ) -> Bool {
        let workspace = selectedWorkspace(id: workspaceId) ?? snapshot.workspaces.first
        let workItem = selectedWorkItem(id: workItemId, workspaceId: workspace?.id)
        let effectivePermissionMode = permissionMode ?? selectedPermissionMode
        selectedAgentKind = agentKind
        if let permissionMode {
            selectedPermissionMode = permissionMode
        }
        let normalizedUserInput = normalizedAssistantUserInput(userInput)
        draftPrompt = launchPrompt(
            from: prompt,
            workspace: workspace,
            workItem: workItem,
            permissionMode: effectivePermissionMode,
            userInput: normalizedUserInput
        )
        lastStagedAssistantPrompt = draftPrompt
        lastStagedAssistantUserInput = normalizedUserInput?.gitTrimmed.nilIfEmpty
        statusLine = "\(title) staged"
        return true
    }

    @discardableResult
    func stageWorkflow(
        _ template: NativeWorkflowLaunchTemplate,
        workspaceId: EntityID? = nil,
        workItemId: EntityID? = nil
    ) -> Bool {
        let workspace = selectedWorkspace(id: workspaceId) ?? snapshot.workspaces.first
        let workItem = selectedWorkItem(id: workItemId, workspaceId: workspace?.id)
        selectedAgentKind = template.agentKind
        draftPrompt = launchPrompt(from: template.prompt, workspace: workspace, workItem: workItem)
        statusLine = "\(template.title) workflow staged"
        return true
    }

    @discardableResult
    func stageWorkflowBuilder(workspaceId: EntityID? = nil, workItemId: EntityID? = nil) -> Bool {
        let workspace = selectedWorkspace(id: workspaceId) ?? snapshot.workspaces.first
        let workItem = selectedWorkItem(id: workItemId, workspaceId: workspace?.id)
        let project = workspace?.name ?? "current project"
        selectedAgentKind = .codex
        draftPrompt = launchPrompt(from: """
        Design a reusable Pikiclaw workflow for \(project).

        Start from the repeated work I do most often. Define the trigger, inputs, source evidence, agent/skill routing, expected outputs, validation, and what should be visible in mac native. Keep it practical enough to run from the Workflow page without extra explanation. Include the smallest verification step that proves the workflow helped.
        """, workspace: workspace, workItem: workItem)
        statusLine = "Workflow builder staged"
        return true
    }

    @discardableResult
    func stageWorkflowImport(workspaceId: EntityID? = nil, workItemId: EntityID? = nil) -> Bool {
        let workspace = selectedWorkspace(id: workspaceId) ?? snapshot.workspaces.first
        let workItem = selectedWorkItem(id: workItemId, workspaceId: workspace?.id)
        let project = workspace?.name ?? "current project"
        selectedAgentKind = .codex
        draftPrompt = launchPrompt(from: """
        Import or convert an existing repeated process into a Pikiclaw workflow for \(project).

        Read the source description I provide next, extract the durable steps, identify required skills or MCP tools, define inputs and outputs, and turn it into a native workflow card plus an executable prompt. Preserve source provenance, and ask before installing tools, changing credentials, or running destructive steps.
        """, workspace: workspace, workItem: workItem)
        statusLine = "Workflow import staged"
        return true
    }

    @discardableResult
    func stageEnterpriseParityAudit(workspaceId: EntityID? = nil, workItemId: EntityID? = nil) -> Bool {
        let workspace = selectedWorkspace(id: workspaceId) ?? snapshot.workspaces.first
        let goalId = workItemId ?? snapshot.workItems.first {
            $0.id == AgentEnterpriseAlignment.goalWorkItemId
                && (workspace == nil || $0.workspaceId == workspace?.id)
        }?.id
        let workItem = selectedWorkItem(id: goalId, workspaceId: workspace?.id)
        selectedAgentKind = .codex
        selectedPermissionMode = .readOnly
        draftPrompt = launchPrompt(from: """
        Run an enterprise agent parity audit for {project}.

        Goal: align the macOS native client with Codex, Claude Code, and Gemini Enterprise style agent platforms. Compare these areas:
        - Runtime setup and authentication for Codex, Claude, and Gemini.
        - Plan review, durable goals, human input, approvals, artifacts, resume, fork/worktree, active steering, MCP/tools, and multimodal outputs.
        - Enterprise readiness: governed tools, audit events, source-grounded artifacts, and clear next actions.

        Start from repo and native app evidence in apps/macos. Do not edit files in this pass. Return a compact gap table, the smallest implementation sequence, and the exact validation commands needed before this goal can move forward.
        """, workspace: workspace, workItem: workItem, permissionMode: .readOnly)
        statusLine = "Enterprise parity audit staged"
        return true
    }

    @discardableResult
    func startAgentSmokeTest(kind: NativeAgentKind? = nil, workspaceId: EntityID? = nil) async -> EntityID? {
        let requestedKind = kind ?? selectedAgentKind
        guard let profile = snapshot.agentProfiles.first(where: { $0.kind == requestedKind }) ?? snapshot.agentProfiles.first else {
            statusLine = "No agent profile configured"
            return nil
        }
        guard profile.isEnabled else {
            statusLine = "\(profile.displayName) is disabled. Enable it before testing."
            return nil
        }

        selectedAgentKind = profile.kind
        guard let workspace = selectedWorkspace(id: workspaceId) ?? snapshot.workspaces.first else {
            statusLine = "Add a workspace before testing \(profile.displayName)"
            return nil
        }
        let prompt = Self.agentSmokeTestPrompt(for: profile, workspace: workspace)
        draftPrompt = prompt

        let previousPermissionMode = selectedPermissionMode
        selectedPermissionMode = .readOnly
        let created = await createWorkItem(
            title: "Read-only agent smoke test: \(profile.displayName)",
            workspaceId: workspace.id
        )
        guard let created else {
            selectedPermissionMode = previousPermissionMode
            return nil
        }
        let runId = await run(workItemId: created)
        selectedPermissionMode = previousPermissionMode
        return runId
    }

    @discardableResult
    func syncJiraTickets(scope: JiraTicketSyncScope = .currentSprint, workspaceId: EntityID? = nil) async -> EntityID? {
        guard !jiraSyncIsRunning else {
            statusLine = "Jira sync already running"
            return nil
        }
        let workspace = selectedWorkspace(id: workspaceId) ?? snapshot.workspaces.first
        guard let workspace else {
            statusLine = "Add a workspace before syncing Jira"
            return nil
        }
        let projectId = snapshot.projects.first(where: { $0.workspaceIds.contains(workspace.id) })?.id

        jiraSyncIsRunning = true
        statusLine = "Syncing Jira \(scope.title.lowercased()) tickets"
        do {
            var syncing = try await store.loadSnapshot()
            syncing.jiraSync = JiraSyncState(
                status: .syncing,
                scope: scope,
                source: syncing.jiraSync?.source,
                lastSyncAt: syncing.jiraSync?.lastSyncAt,
                ticketCount: syncing.jiraSync?.ticketCount ?? 0
            )
            try await store.replaceSnapshot(syncing)
            snapshot = syncing

            let fetched = try await JiraTicketFetcher.fetch(scope: scope)
            var next = try await store.loadSnapshot()
            let summary = next.applyJiraTickets(fetched.tickets, workspaceId: workspace.id, projectId: projectId)
            next.jiraSync = JiraSyncState(
                status: .succeeded,
                scope: scope,
                source: fetched.source,
                lastSyncAt: Date(),
                ticketCount: summary.ticketCount
            )
            try await store.replaceSnapshot(next)
            snapshot = next
            jiraSyncIsRunning = false
            statusLine = "Jira synced \(summary.ticketCount) ticket(s): \(summary.created) new, \(summary.updated) updated"
            return summary.selectedWorkItemId
        } catch {
            var failed = (try? await store.loadSnapshot()) ?? snapshot
            failed.jiraSync = JiraSyncState(
                status: .failed,
                scope: scope,
                source: failed.jiraSync?.source,
                lastSyncAt: failed.jiraSync?.lastSyncAt,
                lastError: error.localizedDescription,
                ticketCount: failed.jiraSync?.ticketCount ?? snapshot.workItems.filter { $0.sourceType == .jira }.count
            )
            try? await store.replaceSnapshot(failed)
            snapshot = failed
            jiraSyncIsRunning = false
            statusLine = "Jira sync failed: \(error.localizedDescription)"
            return nil
        }
    }

    @discardableResult
    func startJiraTicketWork(workItemId: EntityID?) async -> EntityID? {
        let explicit = workItemId.flatMap { id in snapshot.workItems.first(where: { $0.id == id && $0.sourceType == .jira }) }
        let fallback = snapshot.workItems.first(where: { $0.sourceType == .jira && $0.state != .done && $0.state != .cancelled })
        guard let item = explicit ?? fallback else {
            statusLine = "Sync or select a Jira ticket first"
            return nil
        }
        prepareJiraExecutionPermission()
        return await run(workItemId: item.id)
    }

    @discardableResult
    func stageJiraTicketForChat(workItemId: EntityID?, userInput: String? = nil) -> EntityID? {
        let explicit = workItemId.flatMap { id in snapshot.workItems.first(where: { $0.id == id && $0.sourceType == .jira }) }
        let fallback = jiraTicketCardCandidates(from: snapshot.workItems, selectedWorkItemId: workItemId, limit: 1).first
        guard let item = explicit ?? fallback else {
            statusLine = "Sync or select a Jira ticket first"
            return nil
        }
        prepareJiraExecutionPermission()
        let workspace = snapshot.workspaces.first { $0.id == item.workspaceId }
        let normalizedUserInput = normalizedJiraUserInput(userInput)
        draftPrompt = jiraTicketLaunchPrompt(for: item, workspace: workspace, userInput: normalizedUserInput)
        lastStagedJiraPrompt = draftPrompt
        lastStagedJiraUserInput = normalizedUserInput?.gitTrimmed.nilIfEmpty
        statusLine = "\(item.jira?.key ?? "Jira ticket") attached to chat"
        return item.id
    }

    @discardableResult
    func startJiraTicketFromChat(
        workItemId: EntityID?,
        parentRunId: EntityID? = nil,
        userInput: String? = nil
    ) async -> EntityID? {
        guard let stagedId = stageJiraTicketForChat(workItemId: workItemId, userInput: userInput) else { return nil }
        return await run(workItemId: stagedId, sideChatOfRunId: parentRunId, promptOverride: draftPrompt)
    }

    private func prepareJiraExecutionPermission() {
        guard selectedPermissionMode == .readOnly else { return }
        selectedPermissionMode = .askBeforeEdit
    }

    func deleteChat(runId: EntityID) async {
        do {
            var next = try await store.loadSnapshot()
            guard next.runs.contains(where: { $0.id == runId }) else {
                statusLine = "Chat not found"
                return
            }
            next.runs = next.runs.map { run in
                var updated = run
                updated.sideChatRunIds.removeAll { $0 == runId }
                if updated.sideChatOfRunId == runId {
                    updated.sideChatOfRunId = nil
                }
                return updated
            }
            next.runs.removeAll { $0.id == runId }
            next.workItems = next.workItems.map { item in
                var updated = item
                if updated.currentRunId == runId {
                    updated.currentRunId = nil
                }
                return updated
            }
            try await store.replaceSnapshot(next)
            if activeRunId == runId {
                activeRunId = nil
            }
            statusLine = "Chat deleted"
            await reload()
        } catch {
            statusLine = "Delete chat failed: \(error.localizedDescription)"
        }
    }

    func markChatRead(runId: EntityID) async {
        do {
            var next = try await store.loadSnapshot()
            guard let index = next.runs.firstIndex(where: { $0.id == runId }),
                  next.runs[index].isCompletedUnread else {
                return
            }
            next.runs[index].readAt = Date()
            try await store.replaceSnapshot(next)
            snapshot = next
        } catch {
            statusLine = "Mark chat read failed: \(error.localizedDescription)"
        }
    }

    func attachSideChat(parentRunId: EntityID, childRunId: EntityID) async {
        guard parentRunId != childRunId else {
            statusLine = "A chat cannot be nested into itself"
            return
        }

        do {
            var next = try await store.loadSnapshot()
            guard
                let parentIndex = next.runs.firstIndex(where: { $0.id == parentRunId }),
                let childIndex = next.runs.firstIndex(where: { $0.id == childRunId })
            else {
                statusLine = "Chat not found"
                return
            }
            guard !Self.wouldCreateSideChatCycle(parentRunId: parentRunId, childRunId: childRunId, runs: next.runs) else {
                statusLine = "Cannot nest a parent chat into its child"
                return
            }
            guard next.runs[parentIndex].sideChatOfRunId == nil else {
                statusLine = "Side chats cannot contain other chats"
                return
            }
            guard next.runs[childIndex].sideChatRunIds.isEmpty else {
                statusLine = "Detach this chat's side chats before nesting it"
                return
            }

            let previousParentId = next.runs[childIndex].sideChatOfRunId
            if let previousParentId,
               let previousParentIndex = next.runs.firstIndex(where: { $0.id == previousParentId }) {
                next.runs[previousParentIndex].sideChatRunIds.removeAll { $0 == childRunId }
            }

            next.runs[childIndex].sideChatOfRunId = parentRunId
            if !next.runs[parentIndex].sideChatRunIds.contains(childRunId) {
                next.runs[parentIndex].sideChatRunIds.append(childRunId)
            }

            try await store.replaceSnapshot(next)
            activeRunId = parentRunId
            statusLine = "Chat nested into workspace"
            await reload()
        } catch {
            statusLine = "Nest chat failed: \(error.localizedDescription)"
        }
    }

    func detachSideChat(runId: EntityID, focus: Bool = true) async {
        do {
            var next = try await store.loadSnapshot()
            guard let childIndex = next.runs.firstIndex(where: { $0.id == runId }) else {
                statusLine = "Chat not found"
                return
            }
            let parentId = next.runs[childIndex].sideChatOfRunId
            if let parentId,
               let parentIndex = next.runs.firstIndex(where: { $0.id == parentId }) {
                next.runs[parentIndex].sideChatRunIds.removeAll { $0 == runId }
            }
            next.runs[childIndex].sideChatOfRunId = nil

            try await store.replaceSnapshot(next)
            if focus {
                activeRunId = runId
            }
            statusLine = "Chat detached"
            await reload()
        } catch {
            statusLine = "Detach chat failed: \(error.localizedDescription)"
        }
    }

    @discardableResult
    func createInlineSideChat(parentRunId: EntityID, permissionMode: PermissionMode? = nil) async -> EntityID? {
        do {
            var next = try await store.loadSnapshot()
            guard let parentIndex = next.runs.firstIndex(where: { $0.id == parentRunId }) else {
                statusLine = "Parent chat not found"
                return nil
            }
            let parent = next.runs[parentIndex]
            var child = AgentRun(
                workItemId: parent.workItemId,
                workspaceId: parent.workspaceId,
                agentProfileId: parent.agentProfileId,
                teamProfileId: parent.teamProfileId,
                permissionMode: permissionMode ?? parent.permissionMode,
                modelProfileId: parent.modelProfileId,
                state: .draft,
                startedAt: Date(),
                sideChatOfRunId: parent.id,
                promptSnapshot: "Side chat"
            )
            child.transcript = "Ready for a focused side chat."

            next.runs.append(child)
            next.runs[parentIndex].sideChatRunIds.append(child.id)
            next.runs[parentIndex].sideChatRunIds = Self.dedupedRunIds(next.runs[parentIndex].sideChatRunIds)

            try await store.replaceSnapshot(next)
            activeRunId = parent.id
            statusLine = "Inline chat added"
            await reload()
            return child.id
        } catch {
            statusLine = "Add inline chat failed: \(error.localizedDescription)"
            return nil
        }
    }

    @discardableResult
    func startFollowUpSideChat(
        parentRunId: EntityID,
        prompt: String,
        permissionMode: PermissionMode? = nil,
        followUpLabel: String? = nil
    ) async -> EntityID? {
        let nextPrompt = prompt.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !nextPrompt.isEmpty else {
            statusLine = "Type a follow-up first"
            return nil
        }
        let parent = snapshot.runs.first(where: { $0.id == parentRunId })
        guard let childId = await createInlineSideChat(parentRunId: parentRunId, permissionMode: permissionMode) else {
            return nil
        }
        if let parent {
            await seedFollowUpSideChatContext(childRunId: childId, parent: parent, followUpLabel: followUpLabel)
        }
        return await sendMessage(in: childId, message: nextPrompt)
    }

    private func seedFollowUpSideChatContext(
        childRunId: EntityID,
        parent: AgentRun,
        followUpLabel: String? = nil
    ) async {
        let label = followUpLabel?.gitTrimmed.nilIfEmpty
        do {
            var next = try await store.loadSnapshot()
            guard let childIndex = next.runs.firstIndex(where: { $0.id == childRunId }) else { return }
            let parentWorkItem = parent.workItemId.flatMap { workItemId in
                next.workItems.first(where: { $0.id == workItemId })
            }
            let relatedArtifacts = Self.followUpContextArtifacts(
                in: next.artifacts,
                parent: parent,
                workItem: parentWorkItem
            )
            let relatedKnowledgeCards = Self.followUpContextKnowledgeCards(
                in: next.knowledgeCards,
                artifacts: relatedArtifacts,
                workItem: parentWorkItem
            )
            let context = Self.followUpSideChatContext(
                parent: parent,
                followUpLabel: label,
                workItem: parentWorkItem,
                artifacts: relatedArtifacts,
                knowledgeCards: relatedKnowledgeCards
            )
            if let label {
                let ref = ContextRef(kind: "follow-up", label: label)
                if !next.runs[childIndex].contextRefs.contains(ref) {
                    next.runs[childIndex].contextRefs.append(ref)
                }
            }
            if !context.isEmpty {
                next.runs[childIndex].messages.append(AgentRunMessage(role: .system, content: context))
            }
            try await store.replaceSnapshot(next)
            snapshot = next
        } catch {
            statusLine = "Side chat context failed: \(error.localizedDescription)"
        }
    }

    @discardableResult
    func captureRunEvidence(runId: EntityID) async -> EntityID? {
        do {
            var next = try await store.loadSnapshot()
            guard let run = next.runs.first(where: { $0.id == runId }) else {
                statusLine = "Chat not found"
                return nil
            }
            guard Self.canCaptureEvidence(from: run) else {
                statusLine = "Wait for output before saving evidence"
                return nil
            }

            let workspace = next.workspaces.first(where: { $0.id == run.workspaceId })
            let workItem = run.workItemId.flatMap { itemId in
                next.workItems.first(where: { $0.id == itemId })
            }
            let output = Self.evidenceOutput(for: run)
            let titleTarget = workItem?.title.firstLineFallback("") ?? run.promptSnapshot.firstLineFallback("Chat")
            let evidenceTitle = "Evidence: \(titleTarget)"
            let evidenceURI = "pikiclaw://runs/\(run.id.rawValue)/evidence"
            let artifactStatus = Self.evidenceArtifactStatus(for: run.state)
            let provenance = Self.evidenceProvenance(run: run, output: output)
            let sourceRefs = Self.evidenceSourceRefs(
                run: run,
                workspace: workspace,
                workItem: workItem
            )

            let artifactId: EntityID
            let created: Bool
            if let index = next.artifacts.firstIndex(where: { $0.runId == run.id && $0.kind == .commandOutputSummary }) {
                var artifact = next.artifacts[index]
                artifact.workspaceId = run.workspaceId
                artifact.workItemId = run.workItemId
                artifact.title = evidenceTitle
                artifact.uri = evidenceURI
                artifact.status = artifactStatus
                artifact.provenance = provenance
                artifact.sourceRefs = sourceRefs
                next.artifacts[index] = artifact
                artifactId = artifact.id
                created = false
            } else {
                let artifact = Artifact(
                    workspaceId: run.workspaceId,
                    workItemId: run.workItemId,
                    runId: run.id,
                    kind: .commandOutputSummary,
                    title: evidenceTitle,
                    uri: evidenceURI,
                    status: artifactStatus,
                    provenance: provenance,
                    sourceRefs: sourceRefs
                )
                next.artifacts.append(artifact)
                artifactId = artifact.id
                created = true
            }

            if let workItemId = run.workItemId,
               let itemIndex = next.workItems.firstIndex(where: { $0.id == workItemId }) {
                next.workItems[itemIndex].updatedAt = Date()
            }

            try await store.replaceSnapshot(next)
            try await store.appendAuditEvent(AuditEvent(
                kind: .artifactCreated,
                actor: "user",
                summary: "\(created ? "Saved" : "Updated") chat evidence for \(run.promptSnapshot.firstLineFallback("chat"))",
                runId: run.id,
                workItemId: run.workItemId,
                workspaceId: run.workspaceId
            ))
            snapshot = try await store.loadSnapshot()
            statusLine = created ? "Evidence saved" : "Evidence updated"
            return artifactId
        } catch {
            statusLine = "Save evidence failed: \(error.localizedDescription)"
            return nil
        }
    }

    @discardableResult
    func saveArtifactKnowledgeNote(artifactId: EntityID, obsidianRoot: URL? = nil) async -> EntityID? {
        do {
            var next = try await store.loadSnapshot()
            guard let artifact = next.artifacts.first(where: { $0.id == artifactId }) else {
                statusLine = "Output not found"
                return nil
            }
            let workspace = next.workspaces.first(where: { $0.id == artifact.workspaceId })
            let workItem = artifact.workItemId.flatMap { itemId in
                next.workItems.first(where: { $0.id == itemId })
            }
            let run = artifact.runId.flatMap { runId in
                next.runs.first(where: { $0.id == runId })
            }

            let directory = Self.obsidianRepoDirectory(root: obsidianRoot, workspace: workspace)
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            let existingNoteIndex = next.artifacts.firstIndex { candidate in
                candidate.kind == .obsidianNote
                    && candidate.sourceRefs.contains(SourceRef(kind: "artifact", label: artifact.id.rawValue, uri: artifact.uri))
            }
            let noteURL: URL
            if let existingNoteIndex {
                noteURL = URL(fileURLWithPath: next.artifacts[existingNoteIndex].uri)
            } else {
                noteURL = directory.appendingPathComponent(Self.knowledgeNoteFileName(for: artifact))
            }

            let noteMarkdown = Self.knowledgeNoteMarkdown(
                artifact: artifact,
                workspace: workspace,
                workItem: workItem,
                run: run
            )
            try FileManager.default.createDirectory(
                at: noteURL.deletingLastPathComponent(),
                withIntermediateDirectories: true
            )
            try noteMarkdown.write(to: noteURL, atomically: true, encoding: .utf8)

            let sourceRefs = Self.knowledgeSourceRefs(
                artifact: artifact,
                workspace: workspace,
                workItem: workItem,
                run: run,
                noteURL: noteURL
            )
            let noteArtifactId: EntityID
            if let existingNoteIndex {
                var noteArtifact = next.artifacts[existingNoteIndex]
                noteArtifact.workspaceId = artifact.workspaceId
                noteArtifact.workItemId = artifact.workItemId
                noteArtifact.runId = artifact.runId
                noteArtifact.title = "Knowledge note: \(artifact.title.firstLineFallback("Output"))"
                noteArtifact.uri = noteURL.path
                noteArtifact.status = .ready
                noteArtifact.provenance = "Saved from output artifact \(artifact.id.rawValue)"
                noteArtifact.sourceRefs = sourceRefs
                next.artifacts[existingNoteIndex] = noteArtifact
                noteArtifactId = noteArtifact.id
            } else {
                let noteArtifact = Artifact(
                    workspaceId: artifact.workspaceId,
                    workItemId: artifact.workItemId,
                    runId: artifact.runId,
                    kind: .obsidianNote,
                    title: "Knowledge note: \(artifact.title.firstLineFallback("Output"))",
                    uri: noteURL.path,
                    status: .ready,
                    provenance: "Saved from output artifact \(artifact.id.rawValue)",
                    sourceRefs: sourceRefs
                )
                next.artifacts.append(noteArtifact)
                noteArtifactId = noteArtifact.id
            }

            let cardId = EntityID("knowledge-\(artifact.id.rawValue)")
            let now = Date()
            let body = Self.knowledgeCardBody(
                artifact: artifact,
                workItem: workItem,
                run: run,
                noteURL: noteURL
            )
            let card = KnowledgeCard(
                id: cardId,
                scope: .workspace,
                title: artifact.title.firstLineFallback("Saved output"),
                body: body,
                sourceRefs: sourceRefs,
                artifactRefs: Self.dedupedRunIds([artifact.id, noteArtifactId]),
                tags: Self.knowledgeTags(for: artifact, workItem: workItem),
                confidence: 0.86,
                createdAt: next.knowledgeCards.first(where: { $0.id == cardId })?.createdAt ?? now,
                updatedAt: now
            )
            if let cardIndex = next.knowledgeCards.firstIndex(where: { $0.id == cardId }) {
                next.knowledgeCards[cardIndex] = card
            } else {
                next.knowledgeCards.append(card)
            }

            if let workItemId = artifact.workItemId,
               let itemIndex = next.workItems.firstIndex(where: { $0.id == workItemId }) {
                next.workItems[itemIndex].updatedAt = now
            }

            try await store.replaceSnapshot(next)
            try await store.appendAuditEvent(AuditEvent(
                kind: .artifactCreated,
                actor: "user",
                summary: "Saved knowledge note for \(artifact.title.firstLineFallback("output"))",
                runId: artifact.runId,
                workItemId: artifact.workItemId,
                workspaceId: artifact.workspaceId
            ))
            snapshot = try await store.loadSnapshot()
            statusLine = "Knowledge note saved"
            return noteArtifactId
        } catch {
            statusLine = "Save knowledge note failed: \(error.localizedDescription)"
            return nil
        }
    }

    func clearTerminal() {
        terminalTranscript = ""
        terminalCommand = ""
        statusLine = "Context terminal cleared"
    }

    func terminalCurrentDirectory(for workspace: Workspace?) -> String? {
        guard let workspace else { return nil }
        if let stored = terminalWorkingDirectories[workspace.id],
           Self.directoryExists(stored) {
            return stored
        }
        return workspace.pathDisplay
    }

    func terminalDisplayDirectory(for workspace: Workspace?) -> String {
        guard let directory = terminalCurrentDirectory(for: workspace) else {
            return "No workspace"
        }
        return Self.shortTerminalPath(directory)
    }

    func assistantLaunchContextSummary(
        workspaceId: EntityID? = nil,
        workItemId: EntityID? = nil
    ) -> AssistantLaunchContextSummary {
        let workspace = selectedWorkspace(id: workspaceId) ?? snapshot.workspaces.first
        let workItem = assistantLaunchContextWorkItem(workspaceId: workspace?.id, workItemId: workItemId)
        let artifacts = relevantArtifacts(workspace: workspace, workItem: workItem)
        let cards = relevantKnowledgeCards(for: artifacts, workItem: workItem, workspace: workspace)
        let commands = Array(Self.dedupedContextValues(artifacts.flatMap(Self.pendingCommands(from:))).prefix(4))
        let validationEvidence = Array(Self.dedupedContextValues(artifacts.flatMap(Self.validationEvidence(from:))).prefix(4))
        let decisionSignals = Array(Self.dedupedContextValues(artifacts.flatMap(Self.decisionSignals(from:))).prefix(4))
        let actionableNotes = Array(Self.dedupedContextValues(artifacts.flatMap(Self.actionableNotes(from:))).prefix(4))
        let artifactRefs = artifacts
            .map(\.uri)
            .map(\.gitTrimmed)
            .filter { !$0.isEmpty }

        return AssistantLaunchContextSummary(
            outputCount: artifacts.count,
            artifactRefCount: artifactRefs.count,
            pendingCommands: commands,
            validationEvidence: validationEvidence,
            decisionSignals: decisionSignals,
            actionableNotes: actionableNotes,
            knowledgeCardCount: cards.count,
            recentRunCount: recentRunsForContext(workspace: workspace, workItem: workItem).count
        )
    }

    func assistantLaunchContextWorkItem(
        workspaceId: EntityID? = nil,
        workItemId: EntityID? = nil
    ) -> WorkItem? {
        let workspace = selectedWorkspace(id: workspaceId) ?? snapshot.workspaces.first
        return selectedWorkItem(id: workItemId, workspaceId: workspace?.id)
    }

    nonisolated static func terminalSuggestions(for workspace: Workspace?) -> [String] {
        guard let workspace else {
            return ["pwd", "ls", "git status --short"]
        }
        let workspaceURL = URL(fileURLWithPath: workspace.pathDisplay, isDirectory: true)
        let macOSPackagePath = workspaceURL
            .appendingPathComponent("apps/macos", isDirectory: true)
            .path
        let packagePath = workspaceURL.appendingPathComponent("Package.swift").path
        let isMacOSPackageRoot = workspaceURL.lastPathComponent == "macos"
            && workspaceURL.deletingLastPathComponent().lastPathComponent == "apps"
            && FileManager.default.fileExists(atPath: packagePath)
        if directoryExists(macOSPackagePath) || isMacOSPackageRoot {
            let commandPrefix = isMacOSPackageRoot ? "" : "cd apps/macos && "
            let buildCommand = isMacOSPackageRoot ? "./scripts/build-app.sh" : "./apps/macos/scripts/build-app.sh"
            return [
                "git status --short",
                "\(commandPrefix)swift test",
                buildCommand
            ]
        }
        if workspace.pathDisplay.contains("pikiclaw") {
            return ["pwd", "git status --short", "npm test"]
        }
        return ["pwd", "ls", "git status --short"]
    }

    func openNativeTerminal(workspace: Workspace?) {
        guard let directory = terminalCurrentDirectory(for: workspace) else {
            statusLine = "Add a workspace first"
            return
        }
        guard Self.directoryExists(directory) else {
            statusLine = "Terminal directory is missing"
            return
        }
        guard let terminalURL = NSWorkspace.shared.urlForApplication(withBundleIdentifier: "com.apple.Terminal") else {
            statusLine = "Terminal.app was not found"
            return
        }

        let configuration = NSWorkspace.OpenConfiguration()
        configuration.activates = true
        let directoryURL = URL(fileURLWithPath: directory, isDirectory: true)
        NSWorkspace.shared.open([directoryURL], withApplicationAt: terminalURL, configuration: configuration) { _, error in
            Task { @MainActor in
                if let error {
                    self.statusLine = "Native shell failed: \(error.localizedDescription)"
                } else {
                    self.statusLine = "Opened Terminal at \(Self.shortTerminalPath(directory))"
                }
            }
        }
    }

    func runTerminalCommand(_ command: String, workspace: Workspace?) async {
        let cleanCommand = command.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !cleanCommand.isEmpty else {
            statusLine = "Type a terminal command first"
            return
        }
        guard !terminalIsRunning else {
            statusLine = "Terminal command already running"
            return
        }
        guard let workspace else {
            statusLine = "Add a workspace first"
            return
        }
        if cleanCommand == "clear" || cleanCommand == "cls" {
            clearTerminal()
            return
        }

        terminalIsRunning = true
        statusLine = "Running terminal command"
        let workingDirectory = terminalCurrentDirectory(for: workspace) ?? workspace.pathDisplay
        terminalWorkingDirectories[workspace.id] = workingDirectory
        let promptLine = "\(Self.shortTerminalPath(workingDirectory)) $ \(cleanCommand)"
        terminalTranscript = [terminalTranscript.gitTrimmed, promptLine]
            .filter { !$0.isEmpty }
            .joined(separator: "\n\n")

        do {
            let result = try await Task.detached(priority: .userInitiated) {
                try Self.shellCommandOutput(cleanCommand, in: workingDirectory)
            }.value
            if let resultDirectory = result.workingDirectory,
               Self.directoryExists(resultDirectory) {
                terminalWorkingDirectories[workspace.id] = resultDirectory
            }
            let output = result.output.gitTrimmed
            if !output.isEmpty {
                terminalTranscript += "\n\(output)"
            }
            if let resultDirectory = result.workingDirectory,
               resultDirectory != workingDirectory {
                terminalTranscript += "\n[cwd \(Self.shortTerminalPath(resultDirectory))]"
            }
            terminalTranscript += "\n[exit \(result.exitCode)]"
            terminalCommand = ""
            statusLine = result.exitCode == 0 ? "Terminal command completed" : "Terminal command exited \(result.exitCode)"
        } catch {
            terminalTranscript += "\n[terminal failed] \(error.localizedDescription)"
            statusLine = "Terminal failed: \(error.localizedDescription)"
        }

        terminalIsRunning = false
    }

    @discardableResult
    func stageTerminalTranscriptForChat(
        workspace: Workspace?,
        workItem: WorkItem? = nil,
        activeRun: AgentRun? = nil,
        agentKind: NativeAgentKind? = nil,
        permissionMode: PermissionMode? = nil
    ) -> Bool {
        let transcript = terminalTranscript.gitTrimmed
        guard !transcript.isEmpty else {
            statusLine = "Run a terminal command first"
            return false
        }

        let followUpTitle = workItem?.title ?? workspace?.name ?? "agent"
        var lines = ["Terminal follow-up: \(followUpTitle)"]
        if let workspace {
            lines.append("Workspace: \(workspace.name)")
            lines.append("Path: \(workspace.pathDisplay)")
            if let branch = workspace.currentBranch?.gitTrimmed, !branch.isEmpty {
                lines.append("Branch: \(branch)")
            }
            lines.append("cwd: \(terminalCurrentDirectory(for: workspace) ?? workspace.pathDisplay)")
            lines.append(contentsOf: macOSBuildDisciplineContextLines(for: workspace))
        }
        if let agentKind {
            lines.append("Target Agent: \(agentKind.rawValue)")
        }
        if let permissionMode {
            lines.append("Permission Mode: \(permissionMode.rawValue)")
        }
        if let workItem {
            lines.append("Work Item: \(workItem.title)")
        }
        if let activeRun {
            lines.append("Active Chat: \(activeRun.promptSnapshot.firstLineFallback("Conversation"))")
            lines.append("Run State: \(activeRun.state.rawValue)")
        }
        lines.append("")
        let stagedTranscript = Self.terminalTranscriptForChat(transcript)
        if stagedTranscript.wasTruncated {
            lines.append("Terminal Output (truncated to the last \(stagedTranscript.limit) characters):")
        } else {
            lines.append("Terminal Output:")
        }
        lines.append("```text")
        lines.append(stagedTranscript.text)
        lines.append("```")
        lines.append("")
        lines.append("Please use this terminal context to continue the investigation or implementation.")

        draftPrompt = lines.joined(separator: "\n")
        statusLine = "Terminal output staged for chat"
        return true
    }

    nonisolated private static func terminalTranscriptForChat(
        _ transcript: String,
        limit: Int = 6_000
    ) -> (text: String, wasTruncated: Bool, limit: Int) {
        guard transcript.count > limit else {
            return (transcript, false, limit)
        }
        return (String(transcript.suffix(limit)), true, limit)
    }

    func restartApplication() {
        guard !Self.restartInFlight else {
            statusLine = "Restart already in progress"
            return
        }
        guard !restartBlockedByActiveRun else {
            statusLine = "Restart blocked while a run is active"
            return
        }

        do {
            Self.restartInFlight = true
            statusLine = "Restarting Pikiclaw"
            try Self.launchReplacementApplication()
            NSApp.terminate(nil)
        } catch {
            Self.restartInFlight = false
            statusLine = "Restart failed: \(error.localizedDescription)"
        }
    }

    @discardableResult
    func createWorkItem(title: String? = nil, workspaceId: EntityID? = nil) async -> EntityID? {
        let workspace = selectedWorkspace(id: workspaceId) ?? snapshot.workspaces.first
        guard let workspace else {
            statusLine = "Add a workspace first"
            return nil
        }
        let prompt = draftPrompt.trimmingCharacters(in: .whitespacesAndNewlines)
        let item = WorkItem(
            workspaceId: workspace.id,
            projectId: snapshot.projects.first(where: { $0.workspaceIds.contains(workspace.id) })?.id,
            title: title ?? prompt.firstLineFallback("New Work Item"),
            description: prompt,
            sourceType: .manualPrompt,
            state: .active,
            priority: 1,
            acceptanceCriteria: ["Run completes", "Transcript is persisted", "Artifacts are captured when produced"]
        )
        do {
            try await store.saveWorkItem(item)
            try await store.appendAuditEvent(AuditEvent(
                kind: .runStateChange,
                actor: "user",
                summary: "Created work item \(item.title)",
                workItemId: item.id,
                workspaceId: workspace.id
            ))
            await reload()
            return item.id
        } catch {
            statusLine = "Create work item failed: \(error.localizedDescription)"
            return nil
        }
    }

    @discardableResult
    func startChat(workspaceId: EntityID?, targetWorkItemId: EntityID?) async -> EntityID? {
        let prompt = draftPrompt.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !prompt.isEmpty else {
            statusLine = "Type a message first"
            return nil
        }

        let workspace = selectedWorkspace(id: workspaceId) ?? snapshot.workspaces.first
        if let workspace {
            await refreshBranches(for: workspace)
        }

        let target = snapshot.workItems.first(where: { $0.id == targetWorkItemId })
        let shouldReuseTarget = target.map { item in
            prompt == item.title || prompt == item.description
        } ?? false

        if shouldReuseTarget, let target {
            return await run(workItemId: target.id)
        }

        guard let created = await createWorkItem(
            title: prompt.firstLineFallback("New Chat"),
            workspaceId: workspaceId
        ) else {
            return nil
        }
        return await run(workItemId: created)
    }

    @discardableResult
    func sendMessage(
        in runId: EntityID,
        message: String,
        permissionMode: PermissionMode? = nil
    ) async -> EntityID? {
        let prompt = message.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !prompt.isEmpty else {
            statusLine = "Type a message first"
            return nil
        }

        do {
            let latest = try await store.loadSnapshot()
            guard var run = latest.runs.first(where: { $0.id == runId }) else {
                statusLine = "Chat not found"
                return nil
            }
            switch run.state {
            case .queued, .starting, .running, .cancelling:
                statusLine = "Current chat is still running"
                return runId
            case .waitingForUser, .completed, .failed, .cancelled, .stale, .draft:
                break
            }
            guard let workspace = latest.workspaces.first(where: { $0.id == run.workspaceId }) else {
                statusLine = "Workspace missing"
                return nil
            }
            guard let profile = latest.agentProfiles.first(where: { $0.id == run.agentProfileId }) else {
                statusLine = "Agent profile missing"
                return nil
            }
            guard profile.isEnabled else {
                statusLine = "\(profile.displayName) is disabled. Enable it in Agent Studio first."
                return nil
            }

            let preservedActiveRunId = activeRunId ?? run.sideChatOfRunId ?? run.id
            let launchWorkspace = await refreshBranches(for: workspace) ?? workspace
            run.messages = Self.appendingCurrentChatTurnMessages(
                to: run.messages,
                prompt: run.promptSnapshot,
                transcript: run.transcript,
                state: run.state,
                createdAt: run.endedAt ?? Date()
            )
            run.promptSnapshot = prompt
            run.transcript = ""
            if let permissionMode {
                run.permissionMode = permissionMode
            }
            run.state = .queued
            run.startedAt = Date()
            run.endedAt = nil

            statusLine = "Starting \(profile.displayName)"

            try await store.saveRun(run)
            try await store.appendAuditEvent(AuditEvent(
                kind: .runStateChange,
                actor: "runner",
                summary: "Queued \(profile.displayName) pane message",
                runId: run.id,
                workItemId: run.workItemId,
                workspaceId: launchWorkspace.id
            ))
            activeRunId = preservedActiveRunId
            await reload()
            activeRunId = preservedActiveRunId

            return await launchAgentRun(run, profile: profile, workspace: launchWorkspace, preserveActiveRunId: preservedActiveRunId)
        } catch {
            statusLine = "Send failed: \(error.localizedDescription)"
            return nil
        }
    }

    @discardableResult
    func rerunChat(runId: EntityID) async -> EntityID? {
        guard !isRunning else { return activeRunId }

        do {
            let latest = try await store.loadSnapshot()
            guard var run = latest.runs.first(where: { $0.id == runId }) else {
                statusLine = "Chat not found"
                return nil
            }
            switch run.state {
            case .queued, .starting, .running, .cancelling:
                statusLine = "Current chat is still running"
                return runId
            case .waitingForUser, .completed, .failed, .cancelled, .stale, .draft:
                break
            }
            guard let workspace = latest.workspaces.first(where: { $0.id == run.workspaceId }) else {
                statusLine = "Workspace missing"
                return nil
            }
            guard let profile = latest.agentProfiles.first(where: { $0.id == run.agentProfileId }) else {
                statusLine = "Agent profile missing"
                return nil
            }
            guard profile.isEnabled else {
                statusLine = "\(profile.displayName) is disabled. Enable it in Agent Studio first."
                return nil
            }

            let preservedActiveRunId = activeRunId ?? run.sideChatOfRunId ?? run.id
            let launchWorkspace = await refreshBranches(for: workspace) ?? workspace
            run.messages = Self.appendingCurrentChatTurnMessages(
                to: run.messages,
                prompt: run.promptSnapshot,
                transcript: run.transcript,
                state: run.state,
                createdAt: run.endedAt ?? Date()
            )
            run.transcript = ""
            run.state = .queued
            run.startedAt = Date()
            run.endedAt = nil

            statusLine = "Re-running \(profile.displayName)"

            try await store.saveRun(run)
            try await store.appendAuditEvent(AuditEvent(
                kind: .runStateChange,
                actor: "runner",
                summary: "Re-ran \(profile.displayName) chat",
                runId: run.id,
                workItemId: run.workItemId,
                workspaceId: launchWorkspace.id
            ))
            activeRunId = preservedActiveRunId
            await reload()
            activeRunId = preservedActiveRunId

            return await launchAgentRun(run, profile: profile, workspace: launchWorkspace, preserveActiveRunId: preservedActiveRunId)
        } catch {
            statusLine = "Re-run failed: \(error.localizedDescription)"
            return nil
        }
    }

    nonisolated private static func appendingCurrentChatTurnMessages(
        to messages: [AgentRunMessage],
        prompt: String,
        transcript: String,
        state: RunState,
        createdAt: Date
    ) -> [AgentRunMessage] {
        guard state != .draft else { return messages }
        let userText = prompt.trimmingCharacters(in: .whitespacesAndNewlines)
        let assistantText = transcript.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !userText.isEmpty || !assistantText.isEmpty else { return messages }

        var next = messages
        if !userText.isEmpty {
            next.append(AgentRunMessage(role: .user, content: userText, createdAt: createdAt))
        }
        if !assistantText.isEmpty {
            next.append(AgentRunMessage(role: .assistant, content: assistantText, createdAt: createdAt))
        }
        return next
    }

    @discardableResult
    func ensureVoiceConversation(workspaceId: EntityID?, focus: Bool = true) async -> EntityID? {
        let workspace = selectedWorkspace(id: workspaceId) ?? snapshot.workspaces.first
        guard let workspace else {
            statusLine = "Add a workspace first"
            return nil
        }
        guard let profile = firstEnabledAgentProfile() else {
            statusLine = "Enable an agent in Agent Studio first"
            return nil
        }

        let run = AgentRun(
            workspaceId: workspace.id,
            agentProfileId: profile.id,
            permissionMode: selectedPermissionMode,
            state: .draft,
            startedAt: Date(),
            promptSnapshot: "Pikiclaw Voice Assistant Agent",
            contextRefs: [
                ContextRef(kind: "voice", label: "Voice Assistant"),
                ContextRef(kind: "voiceAssistantAgent", label: "Pikiclaw Voice Assistant"),
                ContextRef(kind: "workspace", id: workspace.id, label: workspace.name, uri: workspace.pathDisplay)
            ],
            transcript: "[voice assistant] Conversation opened.\n"
        )

        do {
            try await store.saveRun(run)
            try await store.appendAuditEvent(AuditEvent(
                kind: .runStateChange,
                actor: "voice-assistant",
                summary: "Opened Voice Assistant Agent conversation",
                runId: run.id,
                workspaceId: workspace.id
            ))
            if focus {
                activeRunId = run.id
                selectedAgentKind = profile.kind
            }
            await reload()
            if focus {
                activeRunId = run.id
            }
            return run.id
        } catch {
            statusLine = "Voice conversation failed: \(error.localizedDescription)"
            return nil
        }
    }

    @discardableResult
    func appendVoiceConversationTurn(
        runId: EntityID?,
        role: String,
        text: String,
        caption: String? = nil
    ) async -> Bool {
        guard let runId else { return false }
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return false }

        do {
            let latest = try await store.loadSnapshot()
            guard var run = latest.runs.first(where: { $0.id == runId }) else {
                statusLine = "Voice conversation not found"
                return false
            }

            let entry = Self.voiceConversationTranscriptEntry(role: role, text: trimmed, caption: caption)
            let nextTranscript = Self.appendingVoiceTranscriptEntry(entry, to: run.transcript)
            guard nextTranscript != run.transcript else { return true }

            run.transcript = nextTranscript
            try await store.saveRun(run)
            await reload()
            return true
        } catch {
            statusLine = "Voice transcript failed: \(error.localizedDescription)"
            return false
        }
    }

    @discardableResult
    func submitVoiceTurn(
        _ plan: VoiceDelegationPlan,
        conversationRunId: EntityID?,
        workspaceId: EntityID?,
        targetWorkItemId: EntityID?,
        preserveActiveRunId: EntityID? = nil,
        inputRole: String = "user voice"
    ) async -> EntityID? {
        do {
            let latest = try await store.loadSnapshot()
            let requestedWorkspace = workspaceId.flatMap { id in
                latest.workspaces.first(where: { $0.id == id })
            }
            let conversationWorkspace = conversationRunId
                .flatMap { id in latest.runs.first(where: { $0.id == id })?.workspaceId }
                .flatMap { id in latest.workspaces.first(where: { $0.id == id }) }
            guard let workspace = requestedWorkspace ?? conversationWorkspace ?? latest.workspaces.first
            else {
                statusLine = "Add a workspace first"
                return nil
            }
            guard let profile = voiceAgentProfile(for: plan, profiles: latest.agentProfiles) else {
                statusLine = "Enable an agent in Agent Studio first"
                return nil
            }

            let launchWorkspace = await refreshBranches(for: workspace) ?? workspace
            let currentConversationRun = conversationRunId.flatMap { id in latest.runs.first(where: { $0.id == id }) }
            var run = currentConversationRun.flatMap { existingRun in
                Self.isActiveExecutionState(existingRun.state) ? nil : existingRun
            }
                ?? AgentRun(
                    workspaceId: launchWorkspace.id,
                    agentProfileId: profile.id,
                    permissionMode: selectedPermissionMode,
                    state: .draft,
                    promptSnapshot: "Pikiclaw Voice Assistant Agent"
                )

            run.workspaceId = launchWorkspace.id
            run.agentProfileId = profile.id
            run.permissionMode = selectedPermissionMode
            run.workItemId = targetWorkItemId ?? run.workItemId
            run.state = .queued
            run.startedAt = Date()
            run.endedAt = nil
            let previousTranscript = run.transcript
            run.promptSnapshot = Self.voiceConversationPrompt(for: plan, previousTranscript: previousTranscript)
            run.contextRefs = Self.voiceContextRefs(
                plan.contextRefs,
                workspace: launchWorkspace
            )
            run.transcript = Self.appendingVoiceTurn(plan.capturedUtterance, role: inputRole, to: run.transcript)

            statusLine = "Starting \(profile.displayName)"
            activeRunId = preserveActiveRunId ?? run.id
            if preserveActiveRunId == nil {
                selectedAgentKind = profile.kind
            }
            draftPrompt = ""

            try await store.saveRun(run)
            try await store.appendAuditEvent(AuditEvent(
                kind: .runStateChange,
                actor: "voice-assistant",
                summary: "Voice Assistant Agent used \(profile.displayName) for a user request",
                runId: run.id,
                workItemId: run.workItemId,
                workspaceId: launchWorkspace.id
            ))
            await reload()
            activeRunId = preserveActiveRunId ?? run.id
            markRunStarted(run.id)
            Task { @MainActor [self, run, profile, launchWorkspace, preserveActiveRunId] in
                _ = await self.launchAgentRun(
                    run,
                    profile: profile,
                    workspace: launchWorkspace,
                    preserveActiveRunId: preserveActiveRunId
                )
            }
            return run.id
        } catch {
            statusLine = "Voice submission failed: \(error.localizedDescription)"
            return nil
        }
    }

    @discardableResult
    func startVoiceDelegation(_ plan: VoiceDelegationPlan, workspaceId: EntityID?, targetWorkItemId: EntityID?) async -> EntityID? {
        let workspace = selectedWorkspace(id: workspaceId) ?? snapshot.workspaces.first
        guard let workspace else {
            statusLine = "Add a workspace first"
            return nil
        }

        let existingContext = snapshot.workItems.first(where: { $0.id == targetWorkItemId })
        let item = WorkItem(
            workspaceId: workspace.id,
            projectId: snapshot.projects.first(where: { $0.workspaceIds.contains(workspace.id) })?.id,
            title: plan.title,
            description: plan.agentPrompt,
            sourceType: .voiceDelegation,
            sourceRefs: [
                SourceRef(kind: "voiceAssistantAgent", label: "Pikiclaw Voice Assistant"),
                SourceRef(kind: "workspace", label: workspace.name, uri: workspace.pathDisplay)
            ],
            state: .active,
            priority: 1,
            acceptanceCriteria: plan.acceptanceCriteria,
            externalRefs: existingContext.map { [SourceRef(kind: "workItem", label: $0.title)] } ?? []
        )

        do {
            try await store.saveWorkItem(item)
            try await store.appendAuditEvent(AuditEvent(
                kind: .runStateChange,
                actor: "voice-assistant",
                summary: "Voice Assistant Agent created \(item.title)",
                workItemId: item.id,
                workspaceId: workspace.id
            ))
            selectedAgentKind = plan.suggestedAgentKind
            activeRunId = nil
            draftPrompt = ""
            await reload()
            return await run(workItemId: item.id)
        } catch {
            statusLine = "Voice delegation failed: \(error.localizedDescription)"
            return nil
        }
    }

    @discardableResult
    func run(
        workItemId: EntityID?,
        sideChatOfRunId: EntityID? = nil,
        promptOverride: String? = nil
    ) async -> EntityID? {
        guard !isRunning else { return activeRunId }
        guard let item = snapshot.workItems.first(where: { $0.id == workItemId }) ?? snapshot.workItems.first else {
            guard let created = await createWorkItem() else { return nil }
            return await run(workItemId: created)
        }
        guard let workspace = snapshot.workspaces.first(where: { $0.id == item.workspaceId }) else {
            statusLine = "Workspace missing"
            return nil
        }
        let launchWorkspace = await refreshBranches(for: workspace) ?? workspace
        guard let profile = agentProfile(for: selectedAgentKind) else {
            statusLine = "Agent profile missing"
            return nil
        }
        guard profile.isEnabled else {
            statusLine = "\(profile.displayName) is disabled. Enable it in Agent Studio first."
            return nil
        }

        statusLine = "Starting \(profile.displayName)"

        let run = AgentRun(
            workItemId: item.id,
            workspaceId: launchWorkspace.id,
            agentProfileId: profile.id,
            permissionMode: selectedPermissionMode,
            state: .queued,
            sideChatOfRunId: sideChatOfRunId,
            promptSnapshot: promptOverride?.gitTrimmed.nilIfEmpty ?? runPrompt(for: item, workspace: launchWorkspace)
        )
        activeRunId = run.id

        do {
            try await store.saveRun(run)
            if let sideChatOfRunId {
                var next = try await store.loadSnapshot()
                if let parentIndex = next.runs.firstIndex(where: { $0.id == sideChatOfRunId }),
                   !next.runs[parentIndex].sideChatRunIds.contains(run.id) {
                    next.runs[parentIndex].sideChatRunIds.append(run.id)
                    next.runs[parentIndex].sideChatRunIds = Self.dedupedRunIds(next.runs[parentIndex].sideChatRunIds)
                    try await store.replaceSnapshot(next)
                }
            }
            var runningItem = item
            if runningItem.state.canTransition(to: .active) {
                runningItem.state = .active
            }
            runningItem.currentRunId = run.id
            runningItem.updatedAt = Date()
            try await store.saveWorkItem(runningItem)
            try await store.appendAuditEvent(AuditEvent(
                kind: .runStateChange,
                actor: "runner",
                summary: "Queued \(profile.displayName) run",
                runId: run.id,
                workItemId: item.id,
                workspaceId: launchWorkspace.id
            ))
            await reload()
            return await launchAgentRun(run, profile: profile, workspace: launchWorkspace)
        } catch {
            statusLine = "Run failed: \(error.localizedDescription)"
            return nil
        }
    }

    private func runPrompt(for item: WorkItem, workspace: Workspace) -> String {
        if item.sourceType == .jira {
            return jiraTicketLaunchPrompt(for: item, workspace: workspace)
        }
        return item.description.isEmpty ? item.title : item.description
    }

    private func jiraTicketLaunchPrompt(
        for item: WorkItem,
        workspace: Workspace?,
        userInput: String? = nil
    ) -> String {
        let brief = jiraTicketAgentBrief(for: item, workspace: workspace)
        let userBlock = Self.userProvidedContextBlock(userInput)
        let context = launchContextBlock(workspace: workspace, workItem: item)
        return [brief, userBlock, context]
            .filter { !$0.isEmpty }
            .joined(separator: "\n\n")
    }

    private func launchAgentRun(
        _ initialRun: AgentRun,
        profile: AgentProfile,
        workspace: Workspace,
        preserveActiveRunId: EntityID? = nil
    ) async -> EntityID? {
        var run = initialRun
        markRunStarted(run.id)
        do {
            let descriptor = Self.agentDescriptor(for: profile)
            let adapter = agentAdapterFactory(descriptor)
            let launchPrompt = Self.agentPrompt(for: run)
            var request = AgentLaunchRequest(
                workspacePath: workspace.pathDisplay,
                prompt: launchPrompt,
                run: run
            )
            if profile.kind == .codex {
                request.stdinText = launchPrompt
            }
            request.arguments = arguments(for: profile.kind, request: request)

            for try await event in adapter.start(request) {
                apply(event, to: &run)
                try await store.saveRun(run)
                await reload()
                if let preserveActiveRunId {
                    activeRunId = preserveActiveRunId
                }
            }
        } catch {
            run.state = .failed
            run.endedAt = Date()
            run.transcript += "\n[runner failed] \(error.localizedDescription)\n"
            try? await store.saveRun(run)
            statusLine = "Run failed: \(error.localizedDescription)"
        }

        markRunFinished(run.id)
        await reload()
        if let preserveActiveRunId {
            activeRunId = preserveActiveRunId
        }
        return run.id
    }

    nonisolated private static func agentDescriptor(for profile: AgentProfile) -> AgentDescriptor {
        AgentDescriptor(
            id: profile.id,
            kind: profile.kind.runnerKind,
            displayName: profile.displayName,
            executableName: profile.executableName
        )
    }

    nonisolated private static func agentCapability(for profile: AgentProfile, detection: AgentDetection) -> Capability {
        let configState = agentCapabilityConfigState(for: detection)
        return Capability(
            id: EntityID("capability-agent-\(profile.id.rawValue.skillSlug)"),
            kind: .cliTool,
            name: "\(profile.displayName) CLI",
            scope: .workspace,
            installState: detection.isAvailable ? "detected" : "missing",
            configState: configState,
            trustLevel: detection.isAvailable ? .trusted : .unknown,
            healthState: detection.isAvailable ? .healthy : .unavailable
        )
    }

    nonisolated private static func agentCapabilityConfigState(for detection: AgentDetection) -> String {
        let auth = detection.authState.gitTrimmed.isEmpty ? "unknown" : detection.authState.gitTrimmed
        let detail = detection.detail.gitTrimmed
        guard let executablePath = detection.executablePath?.gitTrimmed, !executablePath.isEmpty else {
            return detail.isEmpty ? auth : "\(auth) · \(detail)"
        }
        return "\(auth) · \(shortTerminalPath(executablePath))"
    }

    nonisolated private static func agentLoginCommand(for profile: AgentProfile) -> String {
        switch profile.kind {
        case .codex:
            return "\(profile.executableName) login"
        case .claude:
            return "\(profile.executableName)"
        case .cursor:
            return "\(profile.executableName) login"
        case .gemini:
            return "\(profile.executableName) auth login"
        case .githubCopilot:
            return "gh auth login"
        case .hermes:
            return "\(profile.executableName) auth login"
        case .customCLI:
            return "\(profile.executableName) --help"
        }
    }

    nonisolated private static func agentSmokeTestPrompt(for profile: AgentProfile, workspace: Workspace?) -> String {
        let workspaceLine = workspace.map { "Workspace: \($0.name) (\($0.pathDisplay))" } ?? "Workspace: current project"
        let branchLine = workspace?.currentBranch.map { "Branch: \($0)" } ?? "Branch: unknown"
        return """
        Agent smoke test: \(profile.displayName)

        \(workspaceLine)
        \(branchLine)
        Executable: \(profile.executableName)

        Please do a read-only readiness check:
        - Confirm you are running inside the requested workspace.
        - Report the agent identity/version or the closest available signal.
        - Do not edit files.
        - Summarize any missing authentication, PATH, or configuration blocker.
        - End with the next concrete action to make this agent ready, or say Ready.
        """
    }

    private func apply(_ event: RunnerEvent, to run: inout AgentRun) {
        switch event {
        case .stateChanged(let state):
            run.state = state
            if state == .running && run.startedAt == nil {
                run.startedAt = Date()
            }
            statusLine = "Run \(state.rawValue)"
        case .output(let text):
            run.transcript += text
            statusLine = "Streaming output"
        case .toolCallStarted(let name):
            run.transcript += "\n[tool] \(name)\n"
        case .artifactCreated(let id):
            run.transcript += "\n[artifact] \(id.rawValue)\n"
        case .completed(let exitCode):
            run.endedAt = Date()
            run.state = exitCode == 0 ? .completed : .failed
            run.readAt = activeRunId == run.id || run.state != .completed ? Date() : nil
            run.transcript += "\n[completed with exit code \(exitCode)]\n"
            statusLine = run.state == .completed ? "Run completed" : "Run failed"
        case .failed(let message):
            run.endedAt = Date()
            run.state = .failed
            run.transcript += "\n[failed] \(message)\n"
            statusLine = "Run failed"
        }
    }

    nonisolated private static func agentPrompt(for run: AgentRun) -> String {
        let current = run.promptSnapshot.trimmingCharacters(in: .whitespacesAndNewlines)
        let history = run.messages
            .map { message -> String? in
                let content = message.content.trimmingCharacters(in: .whitespacesAndNewlines)
                guard !content.isEmpty else { return nil }
                switch message.role {
                case .user:
                    return "User: \(content)"
                case .assistant:
                    return "Assistant: \(friendlyAgentOutput(content))"
                case .system:
                    return "System: \(content)"
                case .tool:
                    return "Tool: \(content)"
                }
            }
            .compactMap { $0 }

        guard !history.isEmpty else { return current }
        return """
        Continue this conversation.

        Conversation so far:
        \(history.joined(separator: "\n\n"))

        User: \(current)
        """
    }

    nonisolated private static func canCaptureEvidence(from run: AgentRun) -> Bool {
        switch run.state {
        case .queued, .starting, .running, .cancelling, .draft:
            return false
        case .waitingForUser, .completed, .failed, .cancelled, .stale:
            return !evidenceOutput(for: run).isEmpty
        }
    }

    nonisolated private static func evidenceOutput(for run: AgentRun) -> String {
        let transcript = run.transcript.trimmingCharacters(in: .whitespacesAndNewlines)
        let assistantMessage = run.messages.reversed().first { $0.role == .assistant }?.content ?? ""
        let rawOutput = transcript.isEmpty ? assistantMessage : transcript
        return friendlyAgentOutput(rawOutput).trimmingCharacters(in: .whitespacesAndNewlines)
    }

    nonisolated private static func followUpSideChatContext(
        parent: AgentRun,
        followUpLabel: String? = nil,
        workItem: WorkItem? = nil,
        artifacts: [Artifact] = [],
        knowledgeCards: [KnowledgeCard] = []
    ) -> String {
        var lines = [
            "This is a focused side chat. Treat the parent chat context below as the inherited conversation context.",
            "",
            "Parent chat context:",
            "- Parent run: \(parent.id.rawValue)",
            "- Parent state: \(parent.state.rawValue)"
        ]
        if let followUpLabel {
            lines.append("- Follow-up: \(followUpLabel)")
        }
        if let workItem {
            lines.append("- Work item: \(workItem.title)")
            lines.append("- Work item state: \(workItem.state.rawValue)")
            lines.append("- Work item source: \(workItem.sourceType.rawValue)")
            if let jira = workItem.jira {
                let jiraParts = [
                    jira.key.gitTrimmed.nilIfEmpty.map { "key \($0)" },
                    jira.status?.gitTrimmed.nilIfEmpty.map { "status \($0)" },
                    jira.priority?.gitTrimmed.nilIfEmpty.map { "priority \($0)" },
                    jira.assignee?.gitTrimmed.nilIfEmpty.map { "assignee \($0)" },
                    jira.issueType?.gitTrimmed.nilIfEmpty.map { "type \($0)" },
                    jira.sprint?.gitTrimmed.nilIfEmpty.map { "sprint \($0)" }
                ].compactMap { $0 }
                if !jiraParts.isEmpty {
                    lines.append("- Jira: \(jiraParts.joined(separator: ", "))")
                }
                if let url = jira.url?.gitTrimmed.nilIfEmpty {
                    lines.append("- Jira URL: \(url)")
                }
            }
            let criteria = workItem.acceptanceCriteria
                .map { compactedSideChatContext($0, limit: 240) }
                .filter { !$0.isEmpty }
            if !criteria.isEmpty {
                lines.append("- Acceptance criteria:\n\(criteria.prefix(4).map { "- \($0)" }.joined(separator: "\n"))")
            }
        }
        let artifactLines = artifacts
            .prefix(3)
            .map { followUpArtifactContextLine($0) }
            .filter { !$0.isEmpty }
        if !artifactLines.isEmpty {
            lines.append("- Related outputs:\n\(artifactLines.joined(separator: "\n"))")
        }
        let knowledgeLines = knowledgeCards
            .prefix(2)
            .map { followUpKnowledgeContextLine($0) }
            .filter { !$0.isEmpty }
        if !knowledgeLines.isEmpty {
            lines.append("- Related knowledge:\n\(knowledgeLines.joined(separator: "\n"))")
        }
        let parentPrompt = compactedSideChatContext(parent.promptSnapshot, limit: 1_200)
        if !parentPrompt.isEmpty {
            lines.append("- Parent prompt:\n\(parentPrompt)")
        }
        let parentOutput = compactedSideChatContext(evidenceOutput(for: parent), limit: 1_800)
        if !parentOutput.isEmpty {
            lines.append("- Parent output:\n\(parentOutput)")
        }
        let recentHistory = parent.messages.suffix(4).compactMap { message -> String? in
            let content = compactedSideChatContext(message.content, limit: 700)
            guard !content.isEmpty else { return nil }
            switch message.role {
            case .user:
                return "User: \(content)"
            case .assistant:
                return "Assistant: \(friendlyAgentOutput(content))"
            case .system:
                return "System: \(content)"
            case .tool:
                return "Tool: \(content)"
            }
        }
        if !recentHistory.isEmpty {
            lines.append("- Recent parent turns:\n\(recentHistory.joined(separator: "\n\n"))")
        }
        return lines.joined(separator: "\n")
    }

    nonisolated private static func followUpContextArtifacts(
        in artifacts: [Artifact],
        parent: AgentRun,
        workItem: WorkItem?
    ) -> [Artifact] {
        artifacts
            .filter { artifact in
                if let workItem {
                    return artifact.workItemId == workItem.id
                }
                return artifact.runId == parent.id
            }
            .sorted { lhs, rhs in
                let lhsParent = lhs.runId == parent.id
                let rhsParent = rhs.runId == parent.id
                if lhsParent != rhsParent { return lhsParent }
                let lhsRank = followUpArtifactStatusRank(lhs.status)
                let rhsRank = followUpArtifactStatusRank(rhs.status)
                if lhsRank != rhsRank { return lhsRank < rhsRank }
                return lhs.createdAt > rhs.createdAt
            }
            .prefix(4)
            .map { $0 }
    }

    nonisolated private static func followUpContextKnowledgeCards(
        in cards: [KnowledgeCard],
        artifacts: [Artifact],
        workItem: WorkItem?
    ) -> [KnowledgeCard] {
        let artifactIds = Set(artifacts.map(\.id))
        let workItemLabels = Set([
            workItem?.id.rawValue,
            workItem?.title,
            workItem?.jira?.key
        ].compactMap { $0?.gitTrimmed.nilIfEmpty })
        guard !artifactIds.isEmpty || !workItemLabels.isEmpty else { return [] }

        return cards
            .filter { card in
                if !artifactIds.isEmpty,
                   !artifactIds.isDisjoint(with: Set(card.artifactRefs)) {
                    return true
                }
                if !workItemLabels.isEmpty,
                   card.sourceRefs.contains(where: { ref in
                       workItemLabels.contains(ref.label.gitTrimmed)
                           || workItemLabels.contains(ref.uri?.gitTrimmed ?? "")
                   }) {
                    return true
                }
                return false
            }
            .sorted { lhs, rhs in
                if lhs.confidence != rhs.confidence { return lhs.confidence > rhs.confidence }
                return lhs.updatedAt > rhs.updatedAt
            }
            .prefix(3)
            .map { $0 }
    }

    nonisolated private static func followUpArtifactStatusRank(_ status: ArtifactStatus) -> Int {
        switch status {
        case .failed:
            return 0
        case .verified:
            return 1
        case .ready:
            return 2
        case .draft:
            return 3
        case .superseded:
            return 4
        }
    }

    nonisolated private static func followUpArtifactContextLine(_ artifact: Artifact) -> String {
        let title = artifact.title.firstLineFallback("Output")
        var line = "- [\(artifact.kind.rawValue)/\(artifact.status.rawValue)] \(title)"
        let provenance = compactedSideChatContext(artifact.provenance, limit: 220)
        if !provenance.isEmpty {
            line.append(" - \(provenance)")
        }
        if let uri = artifact.uri.gitTrimmed.nilIfEmpty {
            line.append(" - \(uri)")
        }
        return line
    }

    nonisolated private static func followUpKnowledgeContextLine(_ card: KnowledgeCard) -> String {
        let title = card.title.firstLineFallback("Knowledge")
        let tags = card.tags.isEmpty ? "" : " [\(card.tags.prefix(4).joined(separator: ","))]"
        var line = "- \(title)\(tags)"
        let body = compactedSideChatContext(card.body, limit: 240)
        if !body.isEmpty {
            line.append(" - \(body)")
        }
        return line
    }

    nonisolated private static func compactedSideChatContext(_ value: String, limit: Int) -> String {
        let compacted = value
            .components(separatedBy: .newlines)
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
            .joined(separator: "\n")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        guard compacted.count > limit else { return compacted }
        return "\(compacted.prefix(limit))..."
    }

    nonisolated private static func evidenceArtifactStatus(for state: RunState) -> ArtifactStatus {
        switch state {
        case .completed:
            return .ready
        case .failed, .cancelled, .stale:
            return .failed
        default:
            return .draft
        }
    }

    nonisolated private static func evidenceProvenance(run: AgentRun, output: String) -> String {
        let previewLimit = 220
        let flattened = output
            .components(separatedBy: .newlines)
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
            .joined(separator: " ")
        let preview = flattened.count > previewLimit
            ? "\(flattened.prefix(previewLimit))..."
            : flattened
        return "Captured from \(run.state.rawValue) chat output: \(preview)"
    }

    nonisolated private static func evidenceSourceRefs(
        run: AgentRun,
        workspace: Workspace?,
        workItem: WorkItem?
    ) -> [SourceRef] {
        var refs: [SourceRef] = [
            SourceRef(
                kind: "chat-run",
                label: run.promptSnapshot.firstLineFallback("Chat"),
                uri: "pikiclaw://runs/\(run.id.rawValue)"
            )
        ]
        if let workspace {
            refs.append(SourceRef(kind: "workspace", label: workspace.name, uri: workspace.pathDisplay))
        }
        if let workItem {
            refs.append(SourceRef(kind: "work-item", label: workItem.title, uri: "pikiclaw://work-items/\(workItem.id.rawValue)"))
            refs.append(contentsOf: workItem.sourceRefs)
        }
        refs.append(contentsOf: run.contextRefs.map { ref in
            SourceRef(kind: ref.kind, label: ref.label, uri: ref.uri)
        })
        return dedupedSourceRefs(refs)
    }

    nonisolated private static func obsidianRepoDirectory(root: URL?, workspace: Workspace?) -> URL {
        let base = root ?? FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Documents", isDirectory: true)
            .appendingPathComponent("Obsidian Vault", isDirectory: true)
        let workspaceSlug = (workspace?.name ?? "pikiclaw").skillSlug
        return base
            .appendingPathComponent("repo", isDirectory: true)
            .appendingPathComponent(workspaceSlug, isDirectory: true)
    }

    nonisolated private static func knowledgeNoteFileName(for artifact: Artifact) -> String {
        let shortId = String(artifact.id.rawValue.prefix(8)).skillSlug
        let title = artifact.title.skillSlug
        return "\(shortDateString())-\(title)-\(shortId).md"
    }

    nonisolated private static func knowledgeNoteMarkdown(
        artifact: Artifact,
        workspace: Workspace?,
        workItem: WorkItem?,
        run: AgentRun?
    ) -> String {
        let refs = dedupedSourceRefs(artifact.sourceRefs + (workItem?.sourceRefs ?? []))
        let refLines = refs.isEmpty
            ? "- No source refs captured."
            : refs.map { ref in
                let suffix = ref.uri.map { " \($0)" } ?? ""
                return "- [\(ref.kind)] \(ref.label)\(suffix)"
            }.joined(separator: "\n")
        let provenance = artifact.provenance.gitTrimmed.isEmpty
            ? "No provenance captured."
            : artifact.provenance.gitTrimmed
        let workItemLine = workItem.map { "\($0.title) (\($0.state.rawValue))" } ?? "None"
        let runLine = run.map { "\($0.promptSnapshot.firstLineFallback("Chat")) (\($0.state.rawValue))" } ?? "None"

        return """
        ---
        title: "\(artifact.title.replacingOccurrences(of: "\"", with: "'"))"
        source: pikiclaw
        artifact_id: "\(artifact.id.rawValue)"
        workspace_id: "\(artifact.workspaceId.rawValue)"
        work_item_id: "\(artifact.workItemId?.rawValue ?? "")"
        run_id: "\(artifact.runId?.rawValue ?? "")"
        created: "\(isoDateString())"
        ---

        # \(artifact.title)

        ## Summary
        \(provenance)

        ## Context
        - Workspace: \(workspace?.name ?? artifact.workspaceId.rawValue)
        - Work item: \(workItemLine)
        - Source chat: \(runLine)
        - Artifact kind: \(artifact.kind.rawValue)
        - Artifact status: \(artifact.status.rawValue)
        - Artifact URI: \(artifact.uri)

        ## Source refs
        \(refLines)

        ## Next use
        Reuse this note only as source-grounded evidence. Verify the current repo state before turning it into implementation claims.
        """
    }

    nonisolated private static func knowledgeSourceRefs(
        artifact: Artifact,
        workspace: Workspace?,
        workItem: WorkItem?,
        run: AgentRun?,
        noteURL: URL
    ) -> [SourceRef] {
        var refs = [
            SourceRef(kind: "artifact", label: artifact.id.rawValue, uri: artifact.uri),
            SourceRef(kind: "obsidian", label: noteURL.lastPathComponent, uri: noteURL.path)
        ]
        if let workspace {
            refs.append(SourceRef(kind: "workspace", label: workspace.name, uri: workspace.pathDisplay))
        }
        if let workItem {
            refs.append(SourceRef(kind: "work-item", label: workItem.title, uri: "pikiclaw://work-items/\(workItem.id.rawValue)"))
            refs.append(contentsOf: workItem.sourceRefs)
        }
        if let run {
            refs.append(SourceRef(kind: "chat-run", label: run.promptSnapshot.firstLineFallback("Chat"), uri: "pikiclaw://runs/\(run.id.rawValue)"))
        }
        refs.append(contentsOf: artifact.sourceRefs)
        return dedupedSourceRefs(refs)
    }

    nonisolated private static func knowledgeCardBody(
        artifact: Artifact,
        workItem: WorkItem?,
        run: AgentRun?,
        noteURL: URL
    ) -> String {
        let provenance = artifact.provenance.gitTrimmed.isEmpty
            ? "Saved from a Pikiclaw output artifact."
            : artifact.provenance.gitTrimmed
        let target = workItem?.title.firstLineFallback("Work item")
            ?? run?.promptSnapshot.firstLineFallback("Chat")
            ?? artifact.title.firstLineFallback("Output")
        return """
        \(provenance)

        Target: \(target)
        Note: \(noteURL.path)
        """
    }

    nonisolated private static func knowledgeTags(for artifact: Artifact, workItem: WorkItem?) -> [String] {
        var tags = ["pikiclaw", "output", artifact.kind.rawValue]
        if let workItem {
            tags.append(sourceTypeTag(workItem.sourceType))
            if workItem.jira != nil { tags.append("jira") }
        }
        return Array(Set(tags)).sorted()
    }

    nonisolated private static func sourceTypeTag(_ sourceType: WorkItemSourceType) -> String {
        switch sourceType {
        case .manualPrompt: return "manual"
        case .todo: return "todo"
        case .jira: return "jira"
        case .note: return "note"
        case .chatSelection: return "chat"
        case .git: return "git"
        case .fileEvidence: return "file"
        case .scheduledAutomation: return "automation"
        case .connectorImport: return "connector"
        case .voiceDelegation: return "voice"
        case .goal: return "goal"
        }
    }

    nonisolated private static func shortDateString(_ date: Date = Date()) -> String {
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter.string(from: date)
    }

    nonisolated private static func isoDateString(_ date: Date = Date()) -> String {
        ISO8601DateFormatter().string(from: date)
    }

    private func selectedWorkspace(id: EntityID?) -> Workspace? {
        if let id {
            return snapshot.workspaces.first(where: { $0.id == id })
        }
        return snapshot.workspaces.first
    }

    private func selectedWorkItem(id: EntityID?, workspaceId: EntityID?) -> WorkItem? {
        if let id,
           let item = snapshot.workItems.first(where: { $0.id == id }) {
            if let workspaceId, item.workspaceId != workspaceId {
                return nil
            }
            return item
        }

        return snapshot.workItems
            .filter { item in
                if let workspaceId, item.workspaceId != workspaceId { return false }
                return Self.isLaunchContextCandidate(item)
            }
            .sorted(by: Self.shouldPreferLaunchContext(_:over:))
            .first
    }

    private func launchPrompt(
        from prompt: String,
        workspace: Workspace?,
        workItem: WorkItem?,
        permissionMode: PermissionMode? = nil,
        userInput: String? = nil
    ) -> String {
        let project = workspace?.name ?? "current project"
        let path = workspace?.pathDisplay ?? "unknown"
        let branch = workspace?.currentBranch?.gitTrimmed.nilIfEmpty ?? "unknown"
        let currentDirectory = workspace.flatMap { terminalCurrentDirectory(for: $0) } ?? path
        let workItemTitle = workItem?.title ?? "none"
        let rendered = prompt
            .replacingOccurrences(of: "{project}", with: project)
            .replacingOccurrences(of: "{workspacePath}", with: path)
            .replacingOccurrences(of: "{branch}", with: branch)
            .replacingOccurrences(of: "{cwd}", with: currentDirectory)
            .replacingOccurrences(of: "{workItem}", with: workItemTitle)
            .gitTrimmed
        let guarded = Self.promptWithPermissionGuard(rendered, permissionMode: permissionMode)
        let userBlock = Self.userProvidedContextBlock(userInput)
        let context = launchContextBlock(workspace: workspace, workItem: workItem)
        return [guarded, userBlock, context]
            .filter { !$0.isEmpty }
            .joined(separator: "\n\n")
    }

    nonisolated private static func userProvidedContextBlock(_ value: String?) -> String {
        let trimmed = value?.gitTrimmed ?? ""
        guard !trimmed.isEmpty else { return "" }
        return """
        User-provided context:
        \(trimmed)
        """
    }

    private func normalizedAssistantUserInput(_ value: String?) -> String? {
        let trimmed = value?.gitTrimmed ?? ""
        guard !trimmed.isEmpty else { return nil }
        if trimmed == lastStagedAssistantPrompt?.gitTrimmed {
            return lastStagedAssistantUserInput
        }
        return trimmed
    }

    private func normalizedJiraUserInput(_ value: String?) -> String? {
        let trimmed = value?.gitTrimmed ?? ""
        guard !trimmed.isEmpty else { return nil }
        if trimmed == lastStagedJiraPrompt?.gitTrimmed {
            return lastStagedJiraUserInput
        }
        return trimmed
    }

    nonisolated private static func promptWithPermissionGuard(
        _ prompt: String,
        permissionMode: PermissionMode?
    ) -> String {
        guard let guardText = assistantPermissionGuard(for: permissionMode) else {
            return prompt
        }
        return [prompt.gitTrimmed, guardText]
            .filter { !$0.isEmpty }
            .joined(separator: "\n\n")
    }

    nonisolated private static func assistantPermissionGuard(for mode: PermissionMode?) -> String? {
        guard mode == .readOnly else { return nil }
        return """
        Permission guard:
        - Read-only task: inspect, analyze, and report only.
        - Do not edit files, stage or commit changes, install tools, change credentials, update external systems, or run destructive commands.
        - If a fix is needed, describe the smallest proposed change and ask before editing.
        """
    }

    private func launchContextBlock(workspace: Workspace?, workItem: WorkItem?) -> String {
        var lines = ["Context:"]
        if let workspace {
            lines.append("- Workspace: \(workspace.name)")
            lines.append("- Path: \(workspace.pathDisplay)")
            if let branch = workspace.currentBranch?.gitTrimmed, !branch.isEmpty {
                lines.append("- Branch: \(branch)")
            }
            lines.append("- cwd: \(terminalCurrentDirectory(for: workspace) ?? workspace.pathDisplay)")
            if let gitChanges = gitChangesContextLine(for: workspace) {
                lines.append(gitChanges)
            }
            if let gitDiff = gitDiffSummaryContextLine(for: workspace) {
                lines.append(gitDiff)
            }
        } else {
            lines.append("- Workspace: current project")
        }
        if let skills = skillInventoryContextLine() {
            lines.append(skills)
        }
        lines.append(contentsOf: macOSBuildDisciplineContextLines(for: workspace))

        if let workItem {
            lines.append("- Work item: \(workItem.title)")
            lines.append("- Work item state: \(workItem.state.rawValue)")
            lines.append("- Source: \(workItem.sourceType.rawValue)")
            if workItem.priority != 0 {
                lines.append("- Priority: \(workItem.priority)")
            }
            if let dueAt = workItem.dueAt {
                lines.append("- Due: \(dueAt.formatted(date: .abbreviated, time: .omitted))")
            }
            if let currentRunId = workItem.currentRunId {
                lines.append("- Current run: \(currentRunId.rawValue)")
            }
            if let key = workItem.jira?.key.gitTrimmed, !key.isEmpty {
                lines.append("- Jira: \(key)")
            }
            if let jira = workItem.jira {
                let jiraDetail = [
                    jira.status.map { "status \($0)" },
                    jira.assignee.map { "assignee \($0)" },
                    jira.priority.map { "priority \($0)" },
                    jira.issueType.map { "type \($0)" },
                    jira.sprint.map { "sprint \($0)" },
                    jira.remoteUpdatedAt.map { "updated \($0)" }
                ]
                    .compactMap { $0?.gitTrimmed }
                    .filter { !$0.isEmpty }
                    .joined(separator: ", ")
                if !jiraDetail.isEmpty {
                    lines.append("- Jira detail: \(jiraDetail)")
                }
            }
            let acceptance = workItem.acceptanceCriteria
                .map { $0.gitTrimmed }
                .filter { !$0.isEmpty }
                .prefix(3)
                .joined(separator: "; ")
            if !acceptance.isEmpty {
                lines.append("- Acceptance: \(acceptance)")
            }
            let brief = workItem.description.firstLineFallback("")
            if !brief.isEmpty {
                lines.append("- Brief: \(brief)")
            }
            if let sourceRefs = sourceRefContextLine(title: "Source refs", refs: workItem.sourceRefs) {
                lines.append(sourceRefs)
            }
            if let externalRefs = sourceRefContextLine(title: "External refs", refs: workItem.externalRefs) {
                lines.append(externalRefs)
            }
        }
        lines.append(contentsOf: evidenceContextLines(workspace: workspace, workItem: workItem))
        if let runsLine = recentRunsContextLine(workspace: workspace, workItem: workItem) {
            lines.append(runsLine)
        }

        return lines.joined(separator: "\n")
    }

    private func macOSBuildDisciplineContextLines(for workspace: Workspace?) -> [String] {
        guard let workspace else { return [] }
        let workspaceURL = URL(fileURLWithPath: workspace.pathDisplay, isDirectory: true)
        let macOSPackagePath = workspaceURL
            .appendingPathComponent("apps/macos", isDirectory: true)
            .path
        let packagePath = workspaceURL.appendingPathComponent("Package.swift").path
        let isMacOSPackageRoot = workspaceURL.lastPathComponent == "macos"
            && workspaceURL.deletingLastPathComponent().lastPathComponent == "apps"
            && FileManager.default.fileExists(atPath: packagePath)
        let isPikiclawWorkspace = workspace.pathDisplay.localizedCaseInsensitiveContains("pikiclaw")
        guard Self.directoryExists(macOSPackagePath) || isMacOSPackageRoot || isPikiclawWorkspace else {
            return []
        }

        let buildCommand = isMacOSPackageRoot ? "./scripts/build-app.sh" : "./apps/macos/scripts/build-app.sh"
        return [
            "- Build discipline: many chats may edit this repo concurrently; run focused tests per chat, but use \(buildCommand) for full macOS app rebuilds so requests coalesce instead of competing for SwiftPM .build locks.",
            "- Avoid launching parallel `swift build`, `swift test`, or build-app jobs in apps/macos unless a lock wait is intentional."
        ]
    }

    private func gitChangesContextLine(for workspace: Workspace) -> String? {
        guard let output = try? Self.gitOutput(["status", "--short"], in: workspace.pathDisplay) else {
            return nil
        }
        let changes = output
            .split(whereSeparator: \.isNewline)
            .map { String($0).gitTrimmed }
            .filter { !$0.isEmpty }
        guard !changes.isEmpty else {
            return "- Git changes: clean"
        }
        let preview = changes.prefix(6).joined(separator: "; ")
        let suffix = changes.count > 6 ? "; +\(changes.count - 6) more" : ""
        return "- Git changes: \(changes.count) file\(changes.count == 1 ? "" : "s"): \(preview)\(suffix)"
    }

    private func gitDiffSummaryContextLine(for workspace: Workspace) -> String? {
        let staged = (try? Self.gitOutput(["diff", "--cached", "--shortstat"], in: workspace.pathDisplay))?
            .gitTrimmed
            .nilIfEmpty
        let unstaged = (try? Self.gitOutput(["diff", "--shortstat"], in: workspace.pathDisplay))?
            .gitTrimmed
            .nilIfEmpty
        let parts = [
            staged.map { "staged \($0)" },
            unstaged.map { "unstaged \($0)" }
        ].compactMap { $0 }
        guard !parts.isEmpty else { return nil }
        return "- Git diff: \(parts.joined(separator: "; "))"
    }

    private func skillInventoryContextLine() -> String? {
        let skills = snapshot.capabilities
            .filter { $0.kind == .skill }
            .sorted { lhs, rhs in
                let left = Self.skillInventoryPriority(lhs)
                let right = Self.skillInventoryPriority(rhs)
                if left != right { return left < right }
                return lhs.name.localizedCaseInsensitiveCompare(rhs.name) == .orderedAscending
            }
            .prefix(5)
            .map { capability -> String in
                let command = Self.skillInventoryCommand(for: capability)
                let state = capability.configState.gitTrimmed.nilIfEmpty
                    ?? capability.healthState.rawValue
                return "\(command) (\(capability.name), \(state))"
            }
        guard !skills.isEmpty else { return nil }
        return "- Available skills: \(skills.joined(separator: "; "))"
    }

    nonisolated private static func skillInventoryPriority(_ capability: Capability) -> Int {
        let lower = capability.name.lowercased()
        if isLogTraceSkillName(lower) { return 0 }
        if lower.contains("clickhouse") { return 1 }
        if lower.contains("ch sql") { return 2 }
        if lower.contains("superpower") { return 3 }
        if lower.contains("draw") || lower.contains("diagram") { return 4 }
        if capability.configState == "ready" { return 10 }
        return 20
    }

    nonisolated private static func skillInventoryCommand(for capability: Capability) -> String {
        let lower = capability.name.lowercased()
        if isLogTraceSkillName(lower) {
            return "/logtrace"
        }
        if lower.contains("clickhouse") || lower.contains("ch sql") {
            return "/clickhouse"
        }
        return "/sk_\(skillInventorySlug(capability.name))"
    }

    nonisolated private static func isLogTraceSkillName(_ lowercasedName: String) -> Bool {
        lowercasedName.contains("logtrace")
            || lowercasedName.contains("log tracer")
            || lowercasedName.contains("trace")
            || lowercasedName.contains("iva")
    }

    nonisolated private static func skillInventorySlug(_ value: String) -> String {
        var result = ""
        var previousWasSeparator = false
        for scalar in value.lowercased().unicodeScalars {
            if CharacterSet.alphanumerics.contains(scalar) {
                result.unicodeScalars.append(scalar)
                previousWasSeparator = false
            } else if !previousWasSeparator {
                result.append("_")
                previousWasSeparator = true
            }
        }
        let trimmed = result.trimmingCharacters(in: CharacterSet(charactersIn: "_"))
        return trimmed.isEmpty ? "skill" : trimmed
    }

    private func evidenceContextLines(workspace: Workspace?, workItem: WorkItem?) -> [String] {
        let artifacts = relevantArtifacts(workspace: workspace, workItem: workItem)
        let cards = relevantKnowledgeCards(for: artifacts, workItem: workItem, workspace: workspace)
        var lines: [String] = []
        if let outputLine = artifactContextLine(artifacts) {
            lines.append(outputLine)
        }
        if let decisionLine = decisionSignalsContextLine(artifacts) {
            lines.append(decisionLine)
        }
        if let actionableLine = actionableNotesContextLine(artifacts) {
            lines.append(actionableLine)
        }
        if let validationLine = validationEvidenceContextLine(artifacts) {
            lines.append(validationLine)
        }
        if let refsLine = artifactRefsContextLine(artifacts) {
            lines.append(refsLine)
        }
        if let commandsLine = pendingCommandsContextLine(artifacts) {
            lines.append(commandsLine)
        }
        if let cardLine = knowledgeCardContextLine(cards) {
            lines.append(cardLine)
        }
        return lines
    }

    private func relevantArtifacts(workspace: Workspace?, workItem: WorkItem?) -> [Artifact] {
        snapshot.artifacts
            .filter { artifact in
                if let workItem {
                    return artifact.workItemId == workItem.id
                }
                if let workspace {
                    return artifact.workspaceId == workspace.id
                }
                return false
            }
            .sorted { lhs, rhs in
                if lhs.status == .ready, rhs.status != .ready { return true }
                if lhs.status != .ready, rhs.status == .ready { return false }
                return lhs.createdAt > rhs.createdAt
            }
            .prefix(4)
            .map { $0 }
    }

    private func relevantKnowledgeCards(
        for artifacts: [Artifact],
        workItem: WorkItem?,
        workspace: Workspace?
    ) -> [KnowledgeCard] {
        let artifactIds = Set(artifacts.map(\.id))
        let workItemLabels = Set([
            workItem?.id.rawValue,
            workItem?.title,
            workItem?.jira?.key
        ].compactMap { $0?.gitTrimmed.nilIfEmpty })
        let workspaceLabels = Set([
            workspace?.id.rawValue,
            workspace?.name
        ].compactMap { $0?.gitTrimmed.nilIfEmpty })

        return snapshot.knowledgeCards
            .filter { card in
                if !artifactIds.isDisjoint(with: Set(card.artifactRefs)) { return true }
                if !workItemLabels.isEmpty,
                   card.sourceRefs.contains(where: { ref in
                       workItemLabels.contains(ref.label.gitTrimmed)
                           || workItemLabels.contains(ref.uri?.gitTrimmed ?? "")
                   }) {
                    return true
                }
                if !workspaceLabels.isEmpty,
                   card.sourceRefs.contains(where: { ref in
                       workspaceLabels.contains(ref.label.gitTrimmed)
                           || workspaceLabels.contains(ref.uri?.gitTrimmed ?? "")
                   }) {
                    return true
                }
                return false
            }
            .sorted { lhs, rhs in
                if lhs.confidence != rhs.confidence { return lhs.confidence > rhs.confidence }
                return lhs.updatedAt > rhs.updatedAt
            }
            .prefix(3)
            .map { $0 }
    }

    private func artifactContextLine(_ artifacts: [Artifact]) -> String? {
        let values = artifacts
            .map { artifact -> String in
                let uri = artifact.uri.gitTrimmed
                let suffix = uri.isEmpty ? "" : " (\(uri))"
                return "\(artifact.kind.rawValue) \(artifact.status.rawValue): \(artifact.title.firstLineFallback("Output"))\(suffix)"
            }
            .filter { !$0.isEmpty }
            .prefix(3)
            .joined(separator: "; ")
        guard !values.isEmpty else { return nil }
        return "- Relevant outputs: \(values)"
    }

    private func artifactRefsContextLine(_ artifacts: [Artifact]) -> String? {
        let values = artifacts
            .compactMap { artifact -> String? in
                let uri = artifact.uri.gitTrimmed
                guard !uri.isEmpty else { return nil }
                return "\(artifact.title.firstLineFallback("Output")) (\(uri))"
            }
            .prefix(3)
            .joined(separator: "; ")
        guard !values.isEmpty else { return nil }
        return "- Artifact refs: \(values)"
    }

    private func decisionSignalsContextLine(_ artifacts: [Artifact]) -> String? {
        let values = artifacts
            .flatMap(Self.decisionSignals(from:))
        let deduped = Self.dedupedContextValues(values)
            .prefix(4)
            .joined(separator: "; ")
        guard !deduped.isEmpty else { return nil }
        return "- Decision signals: \(deduped)"
    }

    private func actionableNotesContextLine(_ artifacts: [Artifact]) -> String? {
        let values = artifacts
            .flatMap(Self.actionableNotes(from:))
        let deduped = Self.dedupedContextValues(values)
            .prefix(4)
            .joined(separator: "; ")
        guard !deduped.isEmpty else { return nil }
        return "- Actionable notes: \(deduped)"
    }

    private func validationEvidenceContextLine(_ artifacts: [Artifact]) -> String? {
        let values = artifacts
            .flatMap(Self.validationEvidence(from:))
        let deduped = Self.dedupedContextValues(values)
            .prefix(4)
            .joined(separator: "; ")
        guard !deduped.isEmpty else { return nil }
        return "- Validation evidence: \(deduped)"
    }

    private func pendingCommandsContextLine(_ artifacts: [Artifact]) -> String? {
        let values = artifacts
            .flatMap(Self.pendingCommands(from:))
        let deduped = Self.dedupedContextValues(values)
            .prefix(4)
            .joined(separator: "; ")
        guard !deduped.isEmpty else { return nil }
        return "- Pending commands: \(deduped)"
    }

    nonisolated private static func decisionSignals(from artifact: Artifact) -> [String] {
        let lines = artifact.provenance
            .split(whereSeparator: \.isNewline)
            .map { strippedContextHeadingPrefix(strippedContextListPrefix(String($0))) }
            .filter { !$0.isEmpty }
        var signals: [String] = []
        var index = 0

        while index < lines.count {
            let line = lines[index]
            if let signal = decisionSignal(from: line) {
                signals.append(signal)
                index += 1
                continue
            }
            if let label = decisionSectionLabel(from: line) {
                var body: [String] = []
                var nextIndex = index + 1
                while nextIndex < lines.count, body.count < 3 {
                    let next = lines[nextIndex]
                    if looksLikeDecisionBoundary(next) {
                        break
                    }
                    body.append(compactedContextLine(next))
                    nextIndex += 1
                }
                if !body.isEmpty {
                    signals.append("\(label): \(body.joined(separator: " | "))")
                    index = nextIndex
                    continue
                }
            }
            if let inferred = inferredDecisionSignal(from: line) {
                signals.append(inferred)
            }
            index += 1
        }

        return signals
    }

    nonisolated private static func actionableNotes(from artifact: Artifact) -> [String] {
        let lines = artifact.provenance
            .split(whereSeparator: \.isNewline)
            .map { strippedContextHeadingPrefix(strippedContextListPrefix(String($0))) }
            .filter { !$0.isEmpty }
        var notes: [String] = []
        var index = 0

        while index < lines.count {
            let line = lines[index]
            if let note = actionableNote(from: line) {
                notes.append(note)
                index += 1
                continue
            }
            if let label = actionableSectionLabel(from: line) {
                var body: [String] = []
                var nextIndex = index + 1
                while nextIndex < lines.count, body.count < 3 {
                    let next = lines[nextIndex]
                    if looksLikeActionableBoundary(next) {
                        break
                    }
                    body.append(compactedContextLine(next))
                    nextIndex += 1
                }
                if !body.isEmpty {
                    notes.append("\(label): \(body.joined(separator: " | "))")
                    index = nextIndex
                    continue
                }
            }
            if let inferred = inferredActionableNote(from: line) {
                notes.append(inferred)
            }
            index += 1
        }

        return notes
    }

    nonisolated private static func validationEvidence(from artifact: Artifact) -> [String] {
        artifact.provenance
            .split(whereSeparator: \.isNewline)
            .compactMap { validationEvidence(from: String($0)) }
    }

    nonisolated private static func validationEvidence(from line: String) -> String? {
        let stripped = strippedContextHeadingPrefix(strippedContextListPrefix(line))
        let lower = stripped.lowercased()
        let isValidationField: Bool
        if let (field, _) = labeledContextBody(from: stripped) {
            let normalized = normalizedContextField(field)
            isValidationField = normalized == "validation"
                || normalized == "verification"
                || normalized == "validation command"
                || normalized == "verification command"
        } else {
            isValidationField = false
        }
        guard isValidationField
            || lower.contains("validation")
            || lower.contains("test")
            || lower.contains("build")
            || lower.contains("check") else {
            return nil
        }

        let result = validationResult(from: stripped)
        if let command = validationCommand(from: stripped) {
            if let result {
                return "\(command) (\(result))"
            }
            return isValidationField ? command : nil
        }
        guard let result else { return nil }
        return "\(compactedContextLine(stripped)) (\(result))"
    }

    nonisolated private static func validationCommand(from line: String) -> String? {
        let stripped = strippedContextHeadingPrefix(strippedContextListPrefix(line))
        let body: String
        if let (field, value) = labeledContextBody(from: stripped),
           ["validation", "verification", "validation command", "verification command"].contains(normalizedContextField(field)) {
            body = value
        } else {
            body = stripped
        }
        for candidate in backtickValues(in: body) + [body] {
            guard let command = validationCommandValue(candidate) else { continue }
            return command
        }
        return nil
    }

    nonisolated private static func validationCommandValue(_ value: String) -> String? {
        var command = value
            .gitTrimmed
            .trimmingCharacters(in: CharacterSet(charactersIn: "\"'`"))
        let lower = command.lowercased()
        for marker in validationResultMarkers {
            guard let range = lower.range(of: marker) else { continue }
            command = String(command[..<range.lowerBound]).gitTrimmed
            break
        }
        command = command.trimmingCharacters(in: CharacterSet(charactersIn: "`.,;"))
        guard !command.isEmpty,
              looksLikeContextShellCommand(command) else {
            return nil
        }
        return command
    }

    nonisolated private static func validationResult(from line: String) -> String? {
        let lower = line.lowercased()
        if lower.contains("failed")
            || lower.contains("failure")
            || lower.contains("errored")
            || lower.contains("timed out")
            || lower.contains("timeout")
            || lower.contains("❌") {
            return "failed"
        }
        if lower.contains("passed")
            || lower.contains("succeeded")
            || lower.contains("success")
            || lower.contains("build complete")
            || lower.contains("✅") {
            return "passed"
        }
        return nil
    }

    nonisolated private static func actionableNote(from line: String) -> String? {
        guard let (field, value) = labeledContextBody(from: line) else {
            return nil
        }
        let body = compactedContextLine(value)
        guard let label = actionableLabel(for: field),
              !body.isEmpty else {
            return nil
        }
        return "\(label): \(body)"
    }

    nonisolated private static func actionableSectionLabel(from line: String) -> String? {
        guard line.hasSuffix(":") || line.hasSuffix("：") else { return nil }
        return actionableLabel(for: String(line.dropLast()))
    }

    nonisolated private static func actionableLabel(for value: String) -> String? {
        let normalized = value
            .gitTrimmed
            .lowercased()
            .replacingOccurrences(of: "_", with: " ")
            .replacingOccurrences(of: "-", with: " ")
            .replacingOccurrences(of: "  ", with: " ")
        switch normalized {
        case "blocker", "blockers", "blocked", "blocking", "blocked by":
            return "Blocker"
        case "risk", "risks", "residual risk", "remaining risk":
            return "Risk"
        case "open question", "open questions", "question", "questions":
            return "Open question"
        case "missing input", "missing inputs", "missing info", "missing information":
            return "Missing input"
        case "next", "next action", "next actions", "next step", "next steps",
             "next concrete action", "follow up", "followup", "todo", "to do":
            return "Next action"
        case "validation gap", "verification gap", "test gap":
            return "Validation gap"
        default:
            return nil
        }
    }

    nonisolated private static func inferredActionableNote(from line: String) -> String? {
        for (prefix, label) in actionableLeadPhrases {
            guard line.range(of: prefix, options: [.caseInsensitive, .anchored]) != nil else {
                continue
            }
            let body = compactedContextLine(String(line.dropFirst(prefix.count)))
            guard !body.isEmpty else { continue }
            return "\(label): \(body)"
        }
        return nil
    }

    nonisolated private static func looksLikeActionableBoundary(_ line: String) -> Bool {
        if actionableNote(from: line) != nil || actionableSectionLabel(from: line) != nil {
            return true
        }
        if decisionSignal(from: line) != nil || decisionSectionLabel(from: line) != nil {
            return true
        }
        guard line.hasSuffix(":") || line.hasSuffix("：") else {
            return false
        }
        let heading = String(line.dropLast())
            .gitTrimmed
            .lowercased()
            .replacingOccurrences(of: "_", with: " ")
            .replacingOccurrences(of: "-", with: " ")
        return contextSectionHeadings.contains(heading)
    }

    nonisolated private static func decisionSignal(from line: String) -> String? {
        for separator in [":", "："] {
            guard let range = line.range(of: separator) else { continue }
            let field = String(line[..<range.lowerBound])
            let body = compactedContextLine(String(line[range.upperBound...]))
            guard let label = decisionLabel(for: field),
                  !body.isEmpty else {
                continue
            }
            return "\(label): \(body)"
        }
        return nil
    }

    nonisolated private static func decisionSectionLabel(from line: String) -> String? {
        guard line.hasSuffix(":") || line.hasSuffix("：") else { return nil }
        return decisionLabel(for: String(line.dropLast()))
    }

    nonisolated private static func decisionLabel(for value: String) -> String? {
        let normalized = value
            .gitTrimmed
            .lowercased()
            .replacingOccurrences(of: "_", with: " ")
            .replacingOccurrences(of: "-", with: " ")
            .replacingOccurrences(of: "/", with: " ")
            .replacingOccurrences(of: "  ", with: " ")
        switch normalized {
        case "decision", "ship decision", "merge decision", "go no go", "go or no go":
            return "Decision"
        case "recommendation", "recommend", "recommended next action":
            return "Recommendation"
        case "readiness", "ready", "not ready", "ready not ready", "ready or not ready",
             "merge readiness", "mr readiness", "review readiness":
            return "Readiness"
        case "approval", "approval note", "approval status", "review approval",
             "request changes", "changes requested":
            return "Approval"
        default:
            return nil
        }
    }

    nonisolated private static func inferredDecisionSignal(from line: String) -> String? {
        let lower = line.lowercased()
        if lower.hasPrefix("ready to merge")
            || lower.hasPrefix("not ready to merge")
            || lower.hasPrefix("ready for review")
            || lower.hasPrefix("not ready for review") {
            return "Readiness: \(compactedContextLine(line))"
        }
        if lower.hasPrefix("approve")
            || lower.hasPrefix("approved")
            || lower.hasPrefix("request changes")
            || lower.hasPrefix("changes requested") {
            return "Approval: \(compactedContextLine(line))"
        }
        return nil
    }

    nonisolated private static func looksLikeDecisionBoundary(_ line: String) -> Bool {
        if decisionSignal(from: line) != nil || decisionSectionLabel(from: line) != nil {
            return true
        }
        guard line.hasSuffix(":") || line.hasSuffix("：") else {
            return false
        }
        let heading = String(line.dropLast())
            .gitTrimmed
            .lowercased()
            .replacingOccurrences(of: "_", with: " ")
            .replacingOccurrences(of: "-", with: " ")
        return contextSectionHeadings.contains(heading)
    }

    nonisolated private static func pendingCommands(from artifact: Artifact) -> [String] {
        artifact.provenance
            .split(whereSeparator: \.isNewline)
            .compactMap { pendingCommand(from: String($0)) }
    }

    nonisolated private static func pendingCommand(from line: String) -> String? {
        let stripped = strippedContextListPrefix(line)
        let body: String?
        if stripped.hasPrefix("$ ") || stripped.hasPrefix("❯ ") {
            body = String(stripped.dropFirst(2))
        } else {
            body = pendingCommandBody(from: stripped)
        }
        guard let body else { return nil }
        let candidates = backtickValues(in: body) + [body]
        for candidate in candidates {
            guard let command = pendingCommandValue(candidate) else { continue }
            return command
        }
        return nil
    }

    nonisolated private static func pendingCommandBody(from line: String) -> String? {
        guard let (field, body) = labeledContextBody(from: line),
              pendingCommandLabel(for: field) != nil else {
            return nil
        }
        return body.isEmpty ? nil : body
    }

    nonisolated private static func pendingCommandLabel(for value: String) -> String? {
        let normalized = value
            .gitTrimmed
            .lowercased()
            .replacingOccurrences(of: "_", with: " ")
            .replacingOccurrences(of: "-", with: " ")
        switch normalized {
        case "command", "cmd", "next command", "next cmd", "pending command", "suggested command",
             "run", "try", "retry", "rerun", "re run", "fallback command", "smoke command",
             "manual command", "validation command":
            return "Command"
        default:
            return nil
        }
    }

    nonisolated private static func pendingCommandValue(_ value: String) -> String? {
        var command = value
            .gitTrimmed
            .trimmingCharacters(in: CharacterSet(charactersIn: "\"'`"))
        while let scalar = command.unicodeScalars.last,
              pendingCommandTrailingCharacters.contains(scalar) {
            command = String(command.dropLast()).gitTrimmed
        }
        guard !command.isEmpty,
              looksLikeContextShellCommand(command) else {
            return nil
        }
        return command
    }

    nonisolated private static func strippedContextListPrefix(_ value: String) -> String {
        var text = value.gitTrimmed
        let prefixes = ["- ", "* ", "• ", "> "]
        var stripped = true
        while stripped {
            stripped = false
            for prefix in prefixes where text.hasPrefix(prefix) {
                text = String(text.dropFirst(prefix.count)).gitTrimmed
                stripped = true
            }
        }
        return text
    }

    nonisolated private static func strippedContextHeadingPrefix(_ value: String) -> String {
        var text = value.gitTrimmed
        while text.hasPrefix("#") {
            text = String(text.dropFirst()).gitTrimmed
        }
        return text
    }

    nonisolated private static func labeledContextBody(from line: String) -> (field: String, body: String)? {
        for separator in [":", "："] {
            guard let range = line.range(of: separator) else { continue }
            let field = String(line[..<range.lowerBound])
            let body = String(line[range.upperBound...]).gitTrimmed
            return (field, body)
        }
        return nil
    }

    nonisolated private static func normalizedContextField(_ value: String) -> String {
        value
            .gitTrimmed
            .lowercased()
            .replacingOccurrences(of: "_", with: " ")
            .replacingOccurrences(of: "-", with: " ")
            .replacingOccurrences(of: "  ", with: " ")
    }

    nonisolated private static func compactedContextLine(_ value: String) -> String {
        let compacted = value.gitTrimmed.replacingOccurrences(of: "\n", with: " ")
        let maxLength = 160
        return compacted.count > maxLength ? "\(compacted.prefix(maxLength))..." : compacted
    }

    nonisolated private static func backtickValues(in value: String) -> [String] {
        var values: [String] = []
        var remainder = value[...]
        while let start = remainder.firstIndex(of: "`") {
            let afterStart = remainder.index(after: start)
            guard let end = remainder[afterStart...].firstIndex(of: "`") else { break }
            values.append(String(remainder[afterStart..<end]))
            remainder = remainder[remainder.index(after: end)...]
        }
        return values
    }

    nonisolated private static func looksLikeContextShellCommand(_ command: String) -> Bool {
        guard let executable = contextCommandExecutableToken(command) else {
            return false
        }
        if executable.hasPrefix("./") || executable.hasPrefix("../") {
            return true
        }
        return contextCommandExecutables.contains(executable.lowercased())
    }

    nonisolated private static func contextCommandExecutableToken(_ command: String) -> String? {
        for token in command.split(whereSeparator: { $0.isWhitespace || $0.isNewline }) {
            let value = String(token).trimmingCharacters(in: CharacterSet(charactersIn: ";"))
            guard !value.isEmpty else { continue }
            if looksLikeContextEnvironmentAssignment(value) {
                continue
            }
            return value
        }
        return nil
    }

    nonisolated private static func looksLikeContextEnvironmentAssignment(_ value: String) -> Bool {
        guard let equals = value.firstIndex(of: "=") else { return false }
        let key = value[..<equals]
        guard !key.isEmpty else { return false }
        return key.allSatisfy { character in
            character == "_" || character.isLetter || character.isNumber
        }
    }

    nonisolated private static func dedupedContextValues(_ values: [String]) -> [String] {
        var seen = Set<String>()
        var out: [String] = []
        for value in values {
            let trimmed = value.gitTrimmed
            guard !trimmed.isEmpty, !seen.contains(trimmed) else { continue }
            seen.insert(trimmed)
            out.append(trimmed)
        }
        return out
    }

    nonisolated private static let pendingCommandTrailingCharacters = CharacterSet(charactersIn: ".,;)]}")

    nonisolated private static let validationResultMarkers = [
        " passed", " pass", " succeeded", " success", " failed", " failure",
        " errored", " timed out", " timeout", " ✅", " ❌"
    ]

    nonisolated private static let contextSectionHeadings: Set<String> = [
        "status", "result", "summary", "validation", "tests", "changed files",
        "files changed", "file refs", "source refs", "external refs", "commands",
        "notes", "blockers", "next action", "open question", "risk", "findings",
        "jira update", "mr review comment", "review comment", "expected", "actual",
        "observed", "decision", "recommendation", "readiness", "merge readiness",
        "mr readiness", "ready/not ready", "ready not ready", "ready or not ready",
        "approval", "approval note", "request changes", "changes requested",
        "go/no-go", "go no go", "go or no go", "missing input", "missing inputs",
        "validation gap", "verification gap", "test gap"
    ]

    nonisolated private static let actionableLeadPhrases: [(prefix: String, label: String)] = [
        ("Blocked by ", "Blocker"),
        ("Waiting on ", "Blocker"),
        ("Need ", "Next action"),
        ("Needs ", "Next action")
    ]

    nonisolated private static let contextCommandExecutables: Set<String> = [
        "cd", "codex", "claude", "curl", "git", "gh", "glab", "jira",
        "just", "make", "mycr", "node", "npm", "npx", "pnpm", "python",
        "python3", "pytest", "rg", "swift", "uv", "xcodebuild", "yarn",
        "bun"
    ]

    private func knowledgeCardContextLine(_ cards: [KnowledgeCard]) -> String? {
        let values = cards
            .map { card -> String in
                let body = card.body.firstLineFallback("")
                let tags = card.tags.isEmpty ? "" : " [\(card.tags.prefix(4).joined(separator: ","))]"
                return body.isEmpty
                    ? "\(card.title.firstLineFallback("Knowledge"))\(tags)"
                    : "\(card.title.firstLineFallback("Knowledge"))\(tags): \(body)"
            }
            .filter { !$0.isEmpty }
            .prefix(2)
            .joined(separator: "; ")
        guard !values.isEmpty else { return nil }
        return "- Knowledge cards: \(values)"
    }

    private func recentRunsContextLine(workspace: Workspace?, workItem: WorkItem?) -> String? {
        let values = recentRunsForContext(workspace: workspace, workItem: workItem)
            .map { run -> String in
                let prompt = run.promptSnapshot.firstLineFallback("Run")
                return "\(run.state.rawValue) \(run.id.rawValue): \(prompt)"
            }
        guard !values.isEmpty else { return nil }
        return "- Recent runs: \(values.joined(separator: "; "))"
    }

    private func recentRunsForContext(workspace: Workspace?, workItem: WorkItem?) -> [AgentRun] {
        snapshot.runs
            .filter { run in
                if let workItem {
                    return run.workItemId == workItem.id
                }
                if let workspace {
                    return run.workspaceId == workspace.id
                }
                return false
            }
            .filter { $0.state != .draft }
            .sorted { lhs, rhs in
                let leftPriority = Self.recentRunContextPriority(lhs.state)
                let rightPriority = Self.recentRunContextPriority(rhs.state)
                if leftPriority != rightPriority {
                    return leftPriority < rightPriority
                }
                let leftDate = lhs.endedAt ?? lhs.startedAt ?? .distantPast
                let rightDate = rhs.endedAt ?? rhs.startedAt ?? .distantPast
                return leftDate > rightDate
            }
            .prefix(3)
            .map { $0 }
    }

    nonisolated private static func recentRunContextPriority(_ state: RunState) -> Int {
        switch state {
        case .failed:
            return 0
        case .waitingForUser:
            return 1
        case .running, .starting, .queued, .cancelling:
            return 2
        case .cancelled, .stale:
            return 3
        case .completed:
            return 4
        case .draft:
            return 5
        }
    }

    private func sourceRefContextLine(title: String, refs: [SourceRef]) -> String? {
        let values = refs
            .map(sourceRefContextValue(_:))
            .filter { !$0.isEmpty }
            .prefix(3)
            .joined(separator: "; ")
        guard !values.isEmpty else { return nil }
        return "- \(title): \(values)"
    }

    private func sourceRefContextValue(_ ref: SourceRef) -> String {
        let kind = ref.kind.gitTrimmed
        let label = ref.label.gitTrimmed
        let uri = ref.uri?.gitTrimmed ?? ""
        var value = label.isEmpty ? kind : label
        if value.isEmpty {
            value = uri
        } else if !kind.isEmpty, kind.localizedCaseInsensitiveCompare(label) != .orderedSame {
            value = "\(kind): \(value)"
        }
        if !uri.isEmpty, uri != value {
            value += " (\(uri))"
        }
        return value
    }

    private static func isLaunchContextCandidate(_ item: WorkItem) -> Bool {
        switch item.state {
        case .done, .cancelled, .archived:
            return false
        case .inbox, .planned, .active, .blocked, .review:
            return true
        }
    }

    private static func shouldPreferLaunchContext(_ lhs: WorkItem, over rhs: WorkItem) -> Bool {
        let lhsRank = launchContextRank(lhs.state)
        let rhsRank = launchContextRank(rhs.state)
        if lhsRank != rhsRank { return lhsRank < rhsRank }
        if lhs.priority != rhs.priority { return lhs.priority > rhs.priority }
        if lhs.updatedAt != rhs.updatedAt { return lhs.updatedAt > rhs.updatedAt }
        return lhs.title.localizedStandardCompare(rhs.title) == .orderedAscending
    }

    private static func launchContextRank(_ state: WorkItemState) -> Int {
        switch state {
        case .active:
            return 0
        case .blocked:
            return 1
        case .review:
            return 2
        case .planned:
            return 3
        case .inbox:
            return 4
        case .done, .cancelled, .archived:
            return 5
        }
    }

    private func agentProfile(for kind: NativeAgentKind) -> AgentProfile? {
        snapshot.agentProfiles.first(where: { $0.kind == kind })
            ?? AgentProfile(kind: kind, displayName: kind.displayName, executableName: kind.defaultExecutableName, isEnabled: false)
    }

    private func firstEnabledAgentProfile() -> AgentProfile? {
        snapshot.agentProfiles.first(where: \.isEnabled)
    }

    private func voiceAgentProfile(for plan: VoiceDelegationPlan, profiles: [AgentProfile]) -> AgentProfile? {
        profiles.first(where: { $0.kind == plan.suggestedAgentKind && $0.isEnabled })
            ?? profiles.first(where: \.isEnabled)
    }

    nonisolated private static func voiceConversationPrompt(
        for plan: VoiceDelegationPlan,
        previousTranscript: String
    ) -> String {
        let history = previousTranscript.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !history.isEmpty else { return plan.agentPrompt }
        let cappedHistory = history.count > 3000 ? String(history.suffix(3000)) : history
        return """
        \(plan.agentPrompt)

        Voice Assistant Agent working memory before this turn:
        \(cappedHistory)
        """
    }

    nonisolated private static func appendingVoiceTurn(_ utterance: String, role: String = "user voice", to transcript: String) -> String {
        let trimmed = utterance.trimmingCharacters(in: .whitespacesAndNewlines)
        let turn = voiceConversationTranscriptEntry(role: role, text: trimmed)
        return appendingVoiceTranscriptEntry(turn, to: transcript)
    }

    nonisolated private static func appendingSystemLine(_ line: String, to transcript: String) -> String {
        let entry = voiceConversationTranscriptEntry(role: "system", text: line)
        return appendingVoiceTranscriptEntry(entry, to: transcript)
    }

    nonisolated private static func voiceConversationTranscriptEntry(
        role: String,
        text: String,
        caption: String? = nil
    ) -> String {
        let normalizedRole = role.trimmingCharacters(in: .whitespacesAndNewlines).nilIfEmpty ?? "voice"
        let normalizedCaption = caption?.trimmingCharacters(in: .whitespacesAndNewlines).nilIfEmpty
        let header = normalizedCaption.map { "[\(normalizedRole) · \($0)]" } ?? "[\(normalizedRole)]"
        return "\(header)\n\(text.trimmingCharacters(in: .whitespacesAndNewlines))"
    }

    nonisolated private static func appendingVoiceTranscriptEntry(_ entry: String, to transcript: String) -> String {
        let trimmedEntry = entry.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedEntry.isEmpty else { return transcript }
        let prefix = transcript.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !prefix.isEmpty else { return "\(trimmedEntry)\n" }
        guard !prefix.hasSuffix(trimmedEntry) else { return "\(prefix)\n" }
        return "\(prefix)\n\n\(trimmedEntry)\n"
    }

    nonisolated private static func voiceContextRefs(_ refs: [ContextRef], workspace: Workspace) -> [ContextRef] {
        var next = refs
        if !next.contains(where: { $0.kind == "voice" }) {
            next.insert(ContextRef(kind: "voice", label: "Voice Assistant"), at: 0)
        }
        if !next.contains(where: { $0.kind == "voiceAssistantAgent" }) {
            next.insert(ContextRef(kind: "voiceAssistantAgent", label: "Pikiclaw Voice Assistant"), at: 0)
        }
        if !next.contains(where: { $0.kind == "workspace" && $0.id == workspace.id }) {
            next.append(ContextRef(kind: "workspace", id: workspace.id, label: workspace.name, uri: workspace.pathDisplay))
        }
        return next
    }

    nonisolated static func isActiveExecutionState(_ state: RunState) -> Bool {
        switch state {
        case .queued, .starting, .running, .waitingForUser, .cancelling:
            return true
        case .draft, .completed, .failed, .cancelled, .stale:
            return false
        }
    }

    private func markRunStarted(_ runId: EntityID) {
        runningRunIds.insert(runId)
        isRunning = !runningRunIds.isEmpty
    }

    private func markRunFinished(_ runId: EntityID) {
        runningRunIds.remove(runId)
        isRunning = !runningRunIds.isEmpty
    }

    nonisolated private static func wouldCreateSideChatCycle(
        parentRunId: EntityID,
        childRunId: EntityID,
        runs: [AgentRun]
    ) -> Bool {
        var cursor = runs.first(where: { $0.id == parentRunId })
        var seen = Set<EntityID>()
        while let current = cursor {
            if current.id == childRunId { return true }
            guard let nextParentId = current.sideChatOfRunId else { return false }
            if seen.contains(nextParentId) { return true }
            seen.insert(nextParentId)
            cursor = runs.first(where: { $0.id == nextParentId })
        }
        return false
    }

    nonisolated private static func dedupedRunIds(_ ids: [EntityID]) -> [EntityID] {
        var seen = Set<EntityID>()
        var out: [EntityID] = []
        for id in ids where !seen.contains(id) {
            seen.insert(id)
            out.append(id)
        }
        return out
    }

    nonisolated private static func dedupedSourceRefs(_ refs: [SourceRef]) -> [SourceRef] {
        var seen = Set<String>()
        var out: [SourceRef] = []
        for ref in refs {
            let key = "\(ref.kind)|\(ref.label)|\(ref.uri ?? "")"
            guard !seen.contains(key) else { continue }
            seen.insert(key)
            out.append(ref)
        }
        return out
    }

    private func ensureSelectedAgentIsEnabled() {
        if snapshot.agentProfiles.first(where: { $0.kind == selectedAgentKind })?.isEnabled == true {
            return
        }
        if let firstEnabled = snapshot.agentProfiles.first(where: \.isEnabled) {
            selectedAgentKind = firstEnabled.kind
        }
    }

    private func arguments(for kind: NativeAgentKind, request: AgentLaunchRequest) -> [String] {
        switch kind {
        case .codex:
            return NativeAgentCommandBuilder.codexArguments(for: request)
        case .gemini:
            return NativeAgentCommandBuilder.geminiArguments(for: request)
        case .claude:
            return NativeAgentCommandBuilder.claudeArguments(for: request)
        case .cursor:
            return NativeAgentCommandBuilder.cursorArguments(for: request)
        case .githubCopilot:
            return NativeAgentCommandBuilder.githubCopilotArguments(for: request)
        case .hermes:
            return NativeAgentCommandBuilder.hermesArguments(for: request)
        case .customCLI:
            return NativeAgentCommandBuilder.customCLIArguments(for: request)
        }
    }

    nonisolated private static func orderedBranches(currentBranch: String, branchList: String) -> [String] {
        let localBranches = branchList
            .split(whereSeparator: \.isNewline)
            .map { String($0).gitTrimmed }
            .filter { !$0.isEmpty }

        var ordered: [String] = []
        if !currentBranch.isEmpty && currentBranch != "Detached HEAD" {
            ordered.append(currentBranch)
        }
        for branch in localBranches where !ordered.contains(branch) {
            ordered.append(branch)
        }
        return ordered
    }

    nonisolated private static func gitOutput(_ arguments: [String], in path: String) throws -> String {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/env")
        process.arguments = ["git", "-C", path] + arguments

        let stdout = Pipe()
        let stderr = Pipe()
        process.standardOutput = stdout
        process.standardError = stderr

        try process.run()
        process.waitUntilExit()

        let output = String(data: stdout.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""
        let errorOutput = String(data: stderr.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""

        guard process.terminationStatus == 0 else {
            throw NativeGitError(command: arguments.joined(separator: " "), message: errorOutput.gitTrimmed)
        }
        return output
    }

    nonisolated private static func shellCommandOutput(_ command: String, in path: String) throws -> NativeTerminalCommandResult {
        let workingDirectoryMarker = "__PIKICLAW_TERMINAL_CWD__"
        let wrappedCommand = """
        \(command)
        __pikiclaw_exit_code=$?
        printf '\\n\(workingDirectoryMarker)%s\\n' "$PWD"
        exit $__pikiclaw_exit_code
        """
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/bin/zsh")
        process.arguments = ["-c", wrappedCommand]
        process.currentDirectoryURL = URL(fileURLWithPath: path, isDirectory: true)
        process.environment = terminalExecutionEnvironment()

        let outputPipe = Pipe()
        process.standardOutput = outputPipe
        process.standardError = outputPipe

        try process.run()
        let outputData = outputPipe.fileHandleForReading.readDataToEndOfFile()
        process.waitUntilExit()

        let output = String(data: outputData, encoding: .utf8) ?? ""
        let parsed = splitTerminalOutput(output, marker: workingDirectoryMarker)
        return NativeTerminalCommandResult(
            exitCode: Int(process.terminationStatus),
            output: parsed.output.truncatedTerminalOutput,
            workingDirectory: parsed.workingDirectory
        )
    }

    nonisolated private static func splitTerminalOutput(_ output: String, marker: String) -> (output: String, workingDirectory: String?) {
        guard let markerRange = output.range(of: marker, options: .backwards) else {
            return (output, nil)
        }
        let visibleOutput = String(output[..<markerRange.lowerBound]).trimmingCharacters(in: .newlines)
        let markerSuffix = output[markerRange.upperBound...]
        let workingDirectory = markerSuffix
            .split(whereSeparator: \.isNewline)
            .first
            .map { String($0).gitTrimmed }
            .flatMap { $0.isEmpty ? nil : $0 }
        return (visibleOutput, workingDirectory)
    }

    nonisolated private static func terminalExecutionEnvironment() -> [String: String] {
        var environment = ProcessInfo.processInfo.environment
        let homeDirectory = environment["HOME"] ?? NSHomeDirectory()
        environment["PATH"] = expandedTerminalPath(from: environment["PATH"], homeDirectory: homeDirectory)
        return environment
    }

    nonisolated private static func expandedTerminalPath(from currentPath: String?, homeDirectory: String) -> String {
        var directories = currentPath?
            .split(separator: ":")
            .map(String.init)
            .filter { !$0.isEmpty } ?? []
        directories.append(contentsOf: [
            "/opt/homebrew/bin",
            "/opt/homebrew/sbin",
            "/usr/local/bin",
            "/usr/local/sbin",
            homePath(".local/bin", homeDirectory: homeDirectory),
            homePath(".cargo/bin", homeDirectory: homeDirectory),
            homePath(".asdf/shims", homeDirectory: homeDirectory),
            homePath(".nodenv/shims", homeDirectory: homeDirectory),
            homePath(".volta/bin", homeDirectory: homeDirectory),
            homePath(".bun/bin", homeDirectory: homeDirectory),
            "/usr/bin",
            "/bin",
            "/usr/sbin",
            "/sbin"
        ])
        directories.append(contentsOf: nodeVersionBins(homeDirectory: homeDirectory))

        var seen = Set<String>()
        return directories.filter { seen.insert($0).inserted }.joined(separator: ":")
    }

    nonisolated private static func homePath(_ suffix: String, homeDirectory: String) -> String {
        URL(fileURLWithPath: homeDirectory).appendingPathComponent(suffix).path
    }

    nonisolated private static func nodeVersionBins(homeDirectory: String) -> [String] {
        let root = URL(fileURLWithPath: homeDirectory)
            .appendingPathComponent(".nvm")
            .appendingPathComponent("versions")
            .appendingPathComponent("node")
        guard let entries = try? FileManager.default.contentsOfDirectory(
            at: root,
            includingPropertiesForKeys: [.isDirectoryKey],
            options: [.skipsHiddenFiles]
        ) else {
            return []
        }
        return entries
            .filter { url in
                (try? url.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) == true
            }
            .sorted { $0.lastPathComponent.localizedStandardCompare($1.lastPathComponent) == .orderedDescending }
            .map { $0.appendingPathComponent("bin").path }
    }

    nonisolated private static func directoryExists(_ path: String) -> Bool {
        var isDirectory: ObjCBool = false
        return FileManager.default.fileExists(atPath: path, isDirectory: &isDirectory) && isDirectory.boolValue
    }

    nonisolated private static func shortTerminalPath(_ path: String) -> String {
        let home = FileManager.default.homeDirectoryForCurrentUser.path
        if path == home {
            return "~"
        }
        if path.hasPrefix(home + "/") {
            return "~/" + String(path.dropFirst(home.count + 1))
        }
        return path
    }

    nonisolated private static func syncProjectSkillCapabilities(into snapshot: inout NativeStoreSnapshot) -> Bool {
        var changed = false
        for workspace in snapshot.workspaces {
            let skillsRoot = URL(fileURLWithPath: workspace.pathDisplay, isDirectory: true)
                .appendingPathComponent(".pikiclaw", isDirectory: true)
                .appendingPathComponent("skills", isDirectory: true)
            let skillDirectories = (try? FileManager.default.contentsOfDirectory(
                at: skillsRoot,
                includingPropertiesForKeys: [.isDirectoryKey],
                options: [.skipsHiddenFiles]
            )) ?? []

            for skillDirectory in skillDirectories {
                let values = try? skillDirectory.resourceValues(forKeys: [.isDirectoryKey])
                guard values?.isDirectory == true else { continue }
                let skillName = skillDirectory.lastPathComponent
                let skillFile = skillDirectory.appendingPathComponent("SKILL.md", isDirectory: false)
                guard FileManager.default.fileExists(atPath: skillFile.path) else { continue }

                let metadata = readSkillMetadata(at: skillFile)
                let label = metadata.label?.gitTrimmed
                let requires = metadata.mcpRequires
                let capability = Capability(
                    id: EntityID("capability-skill-\(workspace.id.rawValue.skillSlug)-\(skillName.skillSlug)"),
                    kind: .skill,
                    name: label?.isEmpty == false ? label! : skillName,
                    scope: .workspace,
                    installState: "installed",
                    configState: requires.isEmpty ? "ready" : "requires \(requires.joined(separator: ", ")) MCP",
                    trustLevel: .trusted,
                    healthState: requires.isEmpty ? .healthy : .needsConfiguration
                )
                changed = upsertCapability(capability, into: &snapshot.capabilities) || changed
            }
        }
        return changed
    }

    nonisolated private static func upsertCapability(_ capability: Capability, into capabilities: inout [Capability]) -> Bool {
        if let index = capabilities.firstIndex(where: { $0.id == capability.id }) {
            var updated = capability
            updated.lastUsedAt = capabilities[index].lastUsedAt
            guard capabilities[index] != updated else { return false }
            capabilities[index] = updated
            return true
        }
        capabilities.append(capability)
        return true
    }

    nonisolated private static func readSkillMetadata(at url: URL) -> NativeSkillMetadata {
        guard let content = try? String(contentsOf: url, encoding: .utf8) else {
            return NativeSkillMetadata()
        }
        let label = frontmatterValue("label", in: content)
            ?? frontmatterValue("name", in: content)
            ?? markdownHeading(in: content)
        return NativeSkillMetadata(
            label: label,
            mcpRequires: frontmatterList("mcp_requires", in: content)
        )
    }

    nonisolated private static func frontmatter(in content: String) -> String? {
        guard content.hasPrefix("---") else { return nil }
        let marker = "\n---"
        guard let end = content.dropFirst(3).range(of: marker) else { return nil }
        return String(content[content.index(content.startIndex, offsetBy: 3)..<end.lowerBound])
    }

    nonisolated private static func frontmatterValue(_ key: String, in content: String) -> String? {
        guard let fm = frontmatter(in: content) else { return nil }
        let prefix = "\(key):"
        for line in fm.split(whereSeparator: \.isNewline) {
            let text = String(line).gitTrimmed
            guard text.localizedCaseInsensitiveHasPrefix(prefix) else { continue }
            let value = String(text.dropFirst(prefix.count)).gitTrimmed
            return value.trimmedQuotes
        }
        return nil
    }

    nonisolated private static func frontmatterList(_ key: String, in content: String) -> [String] {
        guard let fm = frontmatter(in: content) else { return [] }
        let lines = fm.split(whereSeparator: \.isNewline).map(String.init)
        let prefix = "\(key):"
        for (index, rawLine) in lines.enumerated() {
            let text = rawLine.gitTrimmed
            guard text.localizedCaseInsensitiveHasPrefix(prefix) else { continue }
            let rest = String(text.dropFirst(prefix.count)).gitTrimmed
            if rest.hasPrefix("[") && rest.hasSuffix("]") {
                return rest.dropFirst().dropLast()
                    .split(separator: ",")
                    .map { String($0).gitTrimmed.trimmedQuotes }
                    .filter { !$0.isEmpty }
            }

            var values: [String] = []
            for nextLine in lines.dropFirst(index + 1) {
                let trimmed = nextLine.gitTrimmed
                if trimmed.hasPrefix("-") {
                    values.append(String(trimmed.dropFirst()).gitTrimmed.trimmedQuotes)
                    continue
                }
                if !trimmed.isEmpty { break }
            }
            return values.filter { !$0.isEmpty }
        }
        return []
    }

    nonisolated private static func markdownHeading(in content: String) -> String? {
        for line in content.split(whereSeparator: \.isNewline) {
            let text = String(line).gitTrimmed
            guard text.hasPrefix("# ") else { continue }
            return String(text.dropFirst(2)).gitTrimmed
        }
        return nil
    }

    private static func launchReplacementApplication() throws {
        let bundleURL = Bundle.main.bundleURL
        if bundleURL.pathExtension == "app" {
            let process = Process()
            process.executableURL = URL(fileURLWithPath: "/usr/bin/open")
            process.arguments = ["-n", bundleURL.path]
            try process.run()
            return
        }

        guard let executableURL = Bundle.main.executableURL else {
            throw NativeRestartError.missingExecutable
        }

        let process = Process()
        process.executableURL = executableURL
        process.arguments = Array(CommandLine.arguments.dropFirst())
        try process.run()
    }
}

private enum NativeRestartError: LocalizedError {
    case missingExecutable

    var errorDescription: String? {
        switch self {
        case .missingExecutable:
            return "Current executable could not be found."
        }
    }
}

private struct NativeTerminalCommandResult: Sendable {
    let exitCode: Int
    let output: String
    let workingDirectory: String?
}

private struct NativeSkillMetadata: Sendable {
    var label: String?
    var mcpRequires: [String] = []
}

private struct NativeGitError: LocalizedError {
    let command: String
    let message: String

    var errorDescription: String? {
        message.isEmpty ? "git \(command) failed" : message
    }

    var isNotGitRepository: Bool {
        message.localizedCaseInsensitiveContains("not a git repository")
    }
}

private extension NativeAgentKind {
    var runnerKind: AgentKind {
        switch self {
        case .claude: return .claude
        case .codex: return .codex
        case .cursor: return .cursor
        case .gemini: return .gemini
        case .githubCopilot: return .githubCopilot
        case .hermes: return .hermes
        case .customCLI: return .customCLI
        }
    }

    var displayName: String {
        switch self {
        case .claude: return "Claude Code"
        case .codex: return "Codex"
        case .cursor: return "Cursor Agent"
        case .gemini: return "Gemini"
        case .githubCopilot: return "GitHub Copilot"
        case .hermes: return "Hermes"
        case .customCLI: return "Custom CLI"
        }
    }

    var defaultExecutableName: String {
        switch self {
        case .claude: return "claude"
        case .codex: return "codex"
        case .cursor: return "cursor-agent"
        case .gemini: return "gemini"
        case .githubCopilot: return "gh"
        case .hermes: return "hermes"
        case .customCLI: return "sh"
        }
    }
}

private extension String {
    var nilIfEmpty: String? {
        isEmpty ? nil : self
    }

    var gitTrimmed: String {
        trimmingCharacters(in: .whitespacesAndNewlines)
    }

    var trimmedQuotes: String {
        let trimmed = gitTrimmed
        guard trimmed.count >= 2 else { return trimmed }
        let first = trimmed.first
        let last = trimmed.last
        if (first == "\"" && last == "\"") || (first == "'" && last == "'") {
            return String(trimmed.dropFirst().dropLast()).gitTrimmed
        }
        return trimmed
    }

    var skillSlug: String {
        let allowed = Set("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-")
        let mapped = map { allowed.contains($0) ? Character(String($0).lowercased()) : "-" }
        let collapsed = String(mapped)
            .split(separator: "-", omittingEmptySubsequences: true)
            .joined(separator: "-")
        return collapsed.isEmpty ? "skill" : collapsed
    }

    func localizedCaseInsensitiveHasPrefix(_ prefix: String) -> Bool {
        range(of: prefix, options: [.anchored, .caseInsensitive], locale: .current) != nil
    }

    func firstLineFallback(_ fallback: String) -> String {
        let first = split(whereSeparator: \.isNewline).first.map(String.init) ?? ""
        let trimmed = first.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? fallback : String(trimmed.prefix(80))
    }

    var truncatedTerminalOutput: String {
        let limit = 24_000
        guard count > limit else { return self }
        let prefixText = prefix(limit)
        return "\(prefixText)\n[output truncated]"
    }
}
