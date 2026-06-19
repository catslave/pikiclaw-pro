import Foundation

public enum VoiceDelegationStage: String, Codable, Sendable, CaseIterable {
    case listening
    case understanding
    case planning
    case running
    case needsUser
    case reporting
    case idle
}

public struct VoiceDelegationPlan: Identifiable, Hashable, Codable, Sendable {
    public var id: EntityID
    public var capturedUtterance: String
    public var title: String
    public var agentPrompt: String
    public var suggestedAgentKind: NativeAgentKind
    public var permissionMode: PermissionMode
    public var acceptanceCriteria: [String]
    public var contextRefs: [ContextRef]
    public var needsConfirmation: Bool
    public var spokenPreview: String
    public var createdAt: Date

    public init(
        id: EntityID = EntityID(),
        capturedUtterance: String,
        title: String,
        agentPrompt: String,
        suggestedAgentKind: NativeAgentKind,
        permissionMode: PermissionMode,
        acceptanceCriteria: [String],
        contextRefs: [ContextRef] = [],
        needsConfirmation: Bool = true,
        spokenPreview: String,
        createdAt: Date = Date()
    ) {
        self.id = id
        self.capturedUtterance = capturedUtterance
        self.title = title
        self.agentPrompt = agentPrompt
        self.suggestedAgentKind = suggestedAgentKind
        self.permissionMode = permissionMode
        self.acceptanceCriteria = acceptanceCriteria
        self.contextRefs = contextRefs
        self.needsConfirmation = needsConfirmation
        self.spokenPreview = spokenPreview
        self.createdAt = createdAt
    }
}

public struct VoiceDelegationReport: Hashable, Codable, Sendable {
    public var headline: String
    public var spokenText: String
    public var tone: String

    public init(headline: String, spokenText: String, tone: String) {
        self.headline = headline
        self.spokenText = spokenText
        self.tone = tone
    }
}

public enum VoiceAssistantPlanner {
    public static func makePlan(
        utterance rawUtterance: String,
        workspace: Workspace?,
        preferredAgent: NativeAgentKind,
        recentWorkItem: WorkItem? = nil
    ) -> VoiceDelegationPlan {
        let utterance = rawUtterance.trimmingCharacters(in: .whitespacesAndNewlines)
        let title = titleFromUtterance(utterance)
        let agent = suggestedAgent(for: utterance, preferred: preferredAgent)
        let criteria = acceptanceCriteria(for: utterance)
        let contextRefs = contextRefsFor(workspace: workspace, recentWorkItem: recentWorkItem)
        let prompt = agentPrompt(
            title: title,
            utterance: utterance,
            workspace: workspace,
            acceptanceCriteria: criteria
        )

        return VoiceDelegationPlan(
            capturedUtterance: utterance,
            title: title,
            agentPrompt: prompt,
            suggestedAgentKind: agent,
            permissionMode: .askBeforeEdit,
            acceptanceCriteria: criteria,
            contextRefs: contextRefs,
            needsConfirmation: true,
            spokenPreview: "I will ask \(agentVoiceName(agent)) to handle \(title) and report back with results, verification, and any blockers."
        )
    }

    public static func report(for plan: VoiceDelegationPlan, run: AgentRun?) -> VoiceDelegationReport {
        guard let run else {
            return VoiceDelegationReport(
                headline: "Ready to delegate",
                spokenText: plan.spokenPreview,
                tone: "idle"
            )
        }

        switch run.state {
        case .queued, .starting:
            return VoiceDelegationReport(
                headline: "Starting \(agentVoiceName(plan.suggestedAgentKind))",
                spokenText: "I prepared the chat window and \(agentVoiceName(plan.suggestedAgentKind)) is starting now.",
                tone: "active"
            )
        case .running:
            return VoiceDelegationReport(
                headline: "Agent is working",
                spokenText: "\(agentVoiceName(plan.suggestedAgentKind)) is working on \(plan.title). I am watching the run and will report when it finishes.",
                tone: "active"
            )
        case .waitingForUser:
            return VoiceDelegationReport(
                headline: "Needs your input",
                spokenText: "\(agentVoiceName(plan.suggestedAgentKind)) needs a decision before it can continue.",
                tone: "attention"
            )
        case .completed:
            return VoiceDelegationReport(
                headline: "Completed",
                spokenText: "Done. \(agentVoiceName(plan.suggestedAgentKind)) completed \(plan.title). I saved the conversation and the transcript is ready for review.",
                tone: "done"
            )
        case .failed:
            return VoiceDelegationReport(
                headline: "Run failed",
                spokenText: "\(agentVoiceName(plan.suggestedAgentKind)) could not finish \(plan.title). I saved the failure output so you can inspect the blocker.",
                tone: "failed"
            )
        case .cancelling, .cancelled:
            return VoiceDelegationReport(
                headline: "Cancelled",
                spokenText: "I stopped the delegated run for \(plan.title).",
                tone: "failed"
            )
        case .stale:
            return VoiceDelegationReport(
                headline: "Stale run",
                spokenText: "The delegated run for \(plan.title) looks stale. It may need a fresh retry.",
                tone: "attention"
            )
        }
    }

    private static func titleFromUtterance(_ utterance: String) -> String {
        let firstLine = utterance
            .split(whereSeparator: \.isNewline)
            .first
            .map(String.init)?
            .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        guard !firstLine.isEmpty else { return "Voice delegated task" }
        return String(firstLine.prefix(72))
    }

    private static func suggestedAgent(for utterance: String, preferred: NativeAgentKind) -> NativeAgentKind {
        let lower = utterance.lowercased()
        let codeSignals = ["code", "repo", "bug", "fix", "test", "build", "swift", "typescript", "commit", "diff", "pr", "mr"]
        if codeSignals.contains(where: lower.contains) {
            return preferred == .customCLI ? .codex : preferred
        }
        return preferred
    }

    private static func acceptanceCriteria(for utterance: String) -> [String] {
        var criteria = [
            "Clarify the requested outcome before acting when the instruction is ambiguous",
            "Complete the delegated agent run or stop with a clear blocker",
            "Summarize what changed, what was verified, and what still needs attention"
        ]

        let lower = utterance.lowercased()
        if lower.contains("test") || lower.contains("verify") || lower.contains("验证") {
            criteria.append("Run the narrowest relevant verification available")
        }
        if lower.contains("commit") || lower.contains("push") || lower.contains("提交") {
            criteria.append("Ask before committing, pushing, or writing to external systems")
        }
        return criteria
    }

    private static func contextRefsFor(workspace: Workspace?, recentWorkItem: WorkItem?) -> [ContextRef] {
        var refs: [ContextRef] = []
        if let workspace {
            refs.append(ContextRef(kind: "workspace", id: workspace.id, label: workspace.name, uri: workspace.pathDisplay))
        }
        if let recentWorkItem {
            refs.append(ContextRef(kind: "workItem", id: recentWorkItem.id, label: recentWorkItem.title))
        }
        return refs
    }

    private static func agentPrompt(
        title: String,
        utterance: String,
        workspace: Workspace?,
        acceptanceCriteria: [String]
    ) -> String {
        let workspaceLine = workspace.map { "- Workspace: \($0.name) (\($0.pathDisplay))" } ?? "- Workspace: use the currently selected project if available"
        let criteriaLines = acceptanceCriteria.map { "- \($0)" }.joined(separator: "\n")
        return """
        Voice delegated request: \(title)

        User said:
        \(utterance)

        Context:
        \(workspaceLine)

        Acceptance criteria:
        \(criteriaLines)

        Work end-to-end inside the current Pikiclaw workflow. Keep the response concise, include verification, and call out blockers instead of guessing.
        """
    }

    private static func agentVoiceName(_ kind: NativeAgentKind) -> String {
        switch kind {
        case .claude: return "Claude"
        case .codex: return "Codex"
        case .cursor: return "Cursor"
        case .gemini: return "Gemini"
        case .githubCopilot: return "Copilot"
        case .hermes: return "Hermes"
        case .customCLI: return "the selected agent"
        }
    }
}
