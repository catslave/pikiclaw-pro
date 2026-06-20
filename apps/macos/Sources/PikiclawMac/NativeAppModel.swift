import AppKit
import Foundation
import PikiclawCore
import PikiclawRunner

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

    private let store: JSONNativeStore
    private let agentAdapterFactory: @Sendable (AgentDescriptor) -> any AgentAdapter
    @MainActor private static var restartInFlight = false

    init(
        store: JSONNativeStore? = nil,
        agentAdapterFactory: @escaping @Sendable (AgentDescriptor) -> any AgentAdapter = { descriptor in
            ProcessAgentAdapter(descriptor: descriptor)
        }
    ) {
        self.store = store ?? JSONNativeStore()
        self.agentAdapterFactory = agentAdapterFactory
        Task { await reload() }
    }

    var restartBlockedByActiveRun: Bool {
        isRunning || snapshot.runs.contains { run in
            Self.isActiveExecutionState(run.state)
        }
    }

    func reload() async {
        do {
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
    func createInlineSideChat(parentRunId: EntityID) async -> EntityID? {
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
                permissionMode: parent.permissionMode,
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
    func sendMessage(in runId: EntityID, message: String) async -> EntityID? {
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
            run.promptSnapshot = prompt
            run.transcript = ""
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
            promptSnapshot: "Voice Conversation",
            contextRefs: [
                ContextRef(kind: "voice", label: "Voice Assistant"),
                ContextRef(kind: "workspace", id: workspace.id, label: workspace.name, uri: workspace.pathDisplay)
            ],
            transcript: "[voice] Conversation opened.\n"
        )

        do {
            try await store.saveRun(run)
            try await store.appendAuditEvent(AuditEvent(
                kind: .runStateChange,
                actor: "voice-assistant",
                summary: "Opened voice conversation",
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
    func submitVoiceTurn(
        _ plan: VoiceDelegationPlan,
        conversationRunId: EntityID?,
        workspaceId: EntityID?,
        targetWorkItemId: EntityID?,
        preserveActiveRunId: EntityID? = nil
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
                    promptSnapshot: "Voice Conversation"
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
            run.transcript = Self.appendingVoiceTurn(plan.capturedUtterance, to: run.transcript)

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
                summary: "Submitted voice turn to \(profile.displayName)",
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
                SourceRef(kind: "voice", label: "Voice Assistant"),
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
                summary: "Voice delegated \(item.title)",
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
    func run(workItemId: EntityID?) async -> EntityID? {
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
            promptSnapshot: item.description.isEmpty ? item.title : item.description
        )
        activeRunId = run.id

        do {
            try await store.saveRun(run)
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

    private func launchAgentRun(
        _ initialRun: AgentRun,
        profile: AgentProfile,
        workspace: Workspace,
        preserveActiveRunId: EntityID? = nil
    ) async -> EntityID? {
        var run = initialRun
        markRunStarted(run.id)
        do {
            let descriptor = AgentDescriptor(
                id: profile.id,
                kind: profile.kind.runnerKind,
                displayName: profile.displayName,
                executableName: profile.executableName
            )
            let adapter = agentAdapterFactory(descriptor)
            var request = AgentLaunchRequest(
                workspacePath: workspace.pathDisplay,
                prompt: run.promptSnapshot,
                run: run
            )
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
            run.transcript += "\n[completed with exit code \(exitCode)]\n"
            statusLine = run.state == .completed ? "Run completed" : "Run failed"
        case .failed(let message):
            run.endedAt = Date()
            run.state = .failed
            run.transcript += "\n[failed] \(message)\n"
            statusLine = "Run failed"
        }
    }

    private func selectedWorkspace(id: EntityID?) -> Workspace? {
        if let id {
            return snapshot.workspaces.first(where: { $0.id == id })
        }
        return snapshot.workspaces.first
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

        Voice conversation context before this turn:
        \(cappedHistory)
        """
    }

    nonisolated private static func appendingVoiceTurn(_ utterance: String, to transcript: String) -> String {
        let trimmed = utterance.trimmingCharacters(in: .whitespacesAndNewlines)
        let prefix = transcript.trimmingCharacters(in: .whitespacesAndNewlines)
        let turn = "[user voice]\n\(trimmed)\n"
        guard !prefix.isEmpty else { return "\(turn)\n" }
        return "\(prefix)\n\n\(turn)\n"
    }

    nonisolated private static func voiceContextRefs(_ refs: [ContextRef], workspace: Workspace) -> [ContextRef] {
        var next = refs
        if !next.contains(where: { $0.kind == "voice" }) {
            next.insert(ContextRef(kind: "voice", label: "Voice Assistant"), at: 0)
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
