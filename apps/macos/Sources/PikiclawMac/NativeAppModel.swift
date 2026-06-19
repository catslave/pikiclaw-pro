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
    @Published var activeRunId: EntityID?
    @Published var branchOptionsByWorkspace: [EntityID: [String]] = [:]
    @Published var branchStatusByWorkspace: [EntityID: String] = [:]

    private let store: JSONNativeStore
    @MainActor private static var restartInFlight = false

    init(store: JSONNativeStore? = nil) {
        self.store = store ?? JSONNativeStore()
        Task { await reload() }
    }

    var restartBlockedByActiveRun: Bool {
        isRunning || snapshot.runs.contains { run in
            switch run.state {
            case .queued, .starting, .running, .waitingForUser, .cancelling:
                return true
            case .completed, .failed, .cancelled, .stale:
                return false
            }
        }
    }

    func reload() async {
        do {
            snapshot = try await store.loadSnapshot()
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
        } catch {
            branchStatusByWorkspace[workspace.id] = "Branch lookup failed: \(error.localizedDescription)"
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
            try await store.deleteRun(id: runId)
            if activeRunId == runId {
                activeRunId = nil
            }
            statusLine = "Chat deleted"
            await reload()
        } catch {
            statusLine = "Delete chat failed: \(error.localizedDescription)"
        }
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

        isRunning = true
        statusLine = "Starting \(profile.displayName)"

        var run = AgentRun(
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

            let descriptor = AgentDescriptor(
                id: profile.id,
                kind: profile.kind.runnerKind,
                displayName: profile.displayName,
                executableName: profile.executableName
            )
            let adapter = ProcessAgentAdapter(descriptor: descriptor)
            var request = AgentLaunchRequest(
                workspacePath: launchWorkspace.pathDisplay,
                prompt: run.promptSnapshot,
                run: run
            )
            request.arguments = arguments(for: profile.kind, request: request)

            for try await event in adapter.start(request) {
                apply(event, to: &run)
                try await store.saveRun(run)
                await reload()
            }
        } catch {
            run.state = .failed
            run.endedAt = Date()
            run.transcript += "\n[runner failed] \(error.localizedDescription)\n"
            try? await store.saveRun(run)
            statusLine = "Run failed: \(error.localizedDescription)"
        }

        isRunning = false
        await reload()
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
        case .githubCopilot:
            return ["copilot", "suggest", request.prompt]
        case .claude, .cursor, .hermes, .customCLI:
            return [request.prompt]
        }
    }

    private static func orderedBranches(currentBranch: String, branchList: String) -> [String] {
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

    private static func gitOutput(_ arguments: [String], in path: String) throws -> String {
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

private struct NativeGitError: LocalizedError {
    let command: String
    let message: String

    var errorDescription: String? {
        message.isEmpty ? "git \(command) failed" : message
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

    func firstLineFallback(_ fallback: String) -> String {
        let first = split(whereSeparator: \.isNewline).first.map(String.init) ?? ""
        let trimmed = first.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? fallback : String(trimmed.prefix(80))
    }
}
