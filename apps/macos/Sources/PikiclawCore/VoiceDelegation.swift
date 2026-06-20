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

public enum VoiceDelegationIntent: String, Codable, Sendable, CaseIterable {
    case delegate
    case status
    case cancel
    case converse
}

public struct VoiceDelegationPlan: Identifiable, Hashable, Codable, Sendable {
    public var id: EntityID
    public var capturedUtterance: String
    public var title: String
    public var agentPrompt: String
    public var suggestedAgentKind: NativeAgentKind
    public var permissionMode: PermissionMode
    public var intent: VoiceDelegationIntent
    public var routeSummary: String
    public var routeConfidence: Double
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
        intent: VoiceDelegationIntent = .delegate,
        routeSummary: String = "Agent delegation",
        routeConfidence: Double = 0.5,
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
        self.intent = intent
        self.routeSummary = routeSummary
        self.routeConfidence = routeConfidence
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
        let intent = suggestedIntent(for: utterance)
        let title = titleFromUtterance(utterance)
        let agent = suggestedAgent(for: utterance, intent: intent, preferred: preferredAgent)
        let criteria = acceptanceCriteria(for: utterance)
        let contextRefs = contextRefsFor(workspace: workspace, recentWorkItem: recentWorkItem)
        let routeSummary = routeSummaryFor(intent: intent, agent: agent, workspace: workspace, recentWorkItem: recentWorkItem)
        let confidence = routeConfidence(for: intent, utterance: utterance, workspace: workspace)
        let prompt = agentPrompt(
            title: title,
            utterance: utterance,
            workspace: workspace,
            intent: intent,
            routeSummary: routeSummary,
            acceptanceCriteria: criteria
        )

        return VoiceDelegationPlan(
            capturedUtterance: utterance,
            title: title,
            agentPrompt: prompt,
            suggestedAgentKind: agent,
            permissionMode: .askBeforeEdit,
            intent: intent,
            routeSummary: routeSummary,
            routeConfidence: confidence,
            acceptanceCriteria: criteria,
            contextRefs: contextRefs,
            needsConfirmation: intent != .delegate || confidence < 0.68,
            spokenPreview: spokenPreviewFor(intent: intent, agent: agent, title: title, routeSummary: routeSummary)
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
            let summary = spokenTranscriptSummary(run.transcript)
            return VoiceDelegationReport(
                headline: "Needs your input",
                spokenText: summary.isEmpty
                    ? "\(agentVoiceName(plan.suggestedAgentKind)) needs a decision before it can continue."
                    : "\(agentVoiceName(plan.suggestedAgentKind)) needs a decision. \(summary)",
                tone: "attention"
            )
        case .completed:
            let summary = spokenTranscriptSummary(run.transcript)
            return VoiceDelegationReport(
                headline: "Completed",
                spokenText: summary.isEmpty
                    ? "Done. \(agentVoiceName(plan.suggestedAgentKind)) completed \(plan.title). I saved the conversation and the transcript is ready for review."
                    : "Done. \(agentVoiceName(plan.suggestedAgentKind)) completed \(plan.title). \(summary)",
                tone: "done"
            )
        case .failed:
            let summary = spokenTranscriptSummary(run.transcript)
            return VoiceDelegationReport(
                headline: "Run failed",
                spokenText: summary.isEmpty
                    ? "\(agentVoiceName(plan.suggestedAgentKind)) could not finish \(plan.title). I saved the failure output so you can inspect the blocker."
                    : "\(agentVoiceName(plan.suggestedAgentKind)) could not finish \(plan.title). \(summary)",
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

    private static func suggestedIntent(for utterance: String) -> VoiceDelegationIntent {
        let lower = utterance.lowercased()
        let cancelSignals = ["cancel", "stop", "不用", "取消", "停止", "先别", "不要执行"]
        if cancelSignals.contains(where: lower.contains) {
            return .cancel
        }

        let statusSignals = ["status", "progress", "进度", "状态", "怎么样了", "现在到哪", "运行情况"]
        if statusSignals.contains(where: lower.contains) {
            return .status
        }

        let delegateSignals = [
            "help me", "please", "do ", "fix", "build", "implement", "run", "review", "test", "verify",
            "create", "make", "change", "add", "design", "optimize", "improve",
            "帮我", "我想", "希望", "需要", "做一下", "实现", "修复", "检查", "跑一下", "测试", "验证",
            "创建", "生成", "整理", "分析", "查一下", "改成", "调整", "优化", "设计", "重构", "支持"
        ]
        if delegateSignals.contains(where: lower.contains) {
            return .delegate
        }

        return .converse
    }

    private static func suggestedAgent(for utterance: String, intent: VoiceDelegationIntent, preferred: NativeAgentKind) -> NativeAgentKind {
        guard intent == .delegate else { return preferred == .customCLI ? .codex : preferred }
        let lower = utterance.lowercased()
        let codeSignals = [
            "code", "repo", "bug", "fix", "test", "build", "swift", "typescript", "commit", "diff", "pr", "mr",
            "代码", "仓库", "修复", "实现", "测试", "验证", "编译", "提交", "分支", "前端", "后端", "接口"
        ]
        if codeSignals.contains(where: lower.contains) {
            return .codex
        }
        return preferred == .customCLI ? .codex : preferred
    }

    private static func acceptanceCriteria(for utterance: String) -> [String] {
        var criteria = [
            "Clarify the requested outcome before acting when the instruction is ambiguous",
            "Complete the delegated agent run or stop with a clear blocker",
            "Summarize what changed, what was verified, and what still needs attention"
        ]

        let lower = utterance.lowercased()
        if lower.contains("test") || lower.contains("verify") || lower.contains("验证") || lower.contains("测试") {
            criteria.append("Run the narrowest relevant verification available")
        }
        if lower.contains("commit") || lower.contains("push") || lower.contains("提交") {
            criteria.append("Ask before committing, pushing, or writing to external systems")
        }
        if lower.contains("ui") || lower.contains("界面") || lower.contains("设计") || lower.contains("视觉") {
            criteria.append("Check the primary UI path for layout, contrast, and text overflow")
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
        intent: VoiceDelegationIntent,
        routeSummary: String,
        acceptanceCriteria: [String]
    ) -> String {
        let workspaceLine = workspace.map { "- Workspace: \($0.name) (\($0.pathDisplay))" } ?? "- Workspace: use the currently selected project if available"
        let criteriaLines = acceptanceCriteria.map { "- \($0)" }.joined(separator: "\n")
        return """
        Voice delegated request: \(title)

        Route:
        - Intent: \(intent.rawValue)
        - Decision: \(routeSummary)

        User said:
        \(utterance)

        Context:
        \(workspaceLine)

        Acceptance criteria:
        \(criteriaLines)

        Work end-to-end inside the current Pikiclaw workflow. Keep the response concise, include verification, and call out blockers instead of guessing.
        """
    }

    private static func routeSummaryFor(
        intent: VoiceDelegationIntent,
        agent: NativeAgentKind,
        workspace: Workspace?,
        recentWorkItem: WorkItem?
    ) -> String {
        let project = workspace?.name ?? "the selected project"
        switch intent {
        case .delegate:
            if let recentWorkItem {
                return "Continue from \(recentWorkItem.title) in \(project) with \(agentVoiceName(agent))"
            }
            return "Create an agent task in \(project) with \(agentVoiceName(agent))"
        case .status:
            return "Answer from the currently supervised run before starting new work"
        case .cancel:
            return "Keep the voice session conversational and avoid starting a new run"
        case .converse:
            return "Hold the utterance as context until the user gives an actionable task"
        }
    }

    private static func routeConfidence(for intent: VoiceDelegationIntent, utterance: String, workspace: Workspace?) -> Double {
        guard !utterance.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return 0 }
        var confidence = workspace == nil ? 0.54 : 0.72
        switch intent {
        case .delegate:
            confidence += 0.16
        case .status, .cancel:
            confidence += 0.12
        case .converse:
            confidence -= 0.18
        }
        if utterance.count > 22 {
            confidence += 0.06
        }
        return min(0.96, max(0.18, confidence))
    }

    private static func spokenPreviewFor(
        intent: VoiceDelegationIntent,
        agent: NativeAgentKind,
        title: String,
        routeSummary: String
    ) -> String {
        switch intent {
        case .delegate:
            return "I will ask \(agentVoiceName(agent)) to handle \(title) and report back with results, verification, and any blockers."
        case .status:
            return "I will check the current run status first. \(routeSummary)."
        case .cancel:
            return "Okay. I will not start a new agent run from this voice turn."
        case .converse:
            return "I heard you. I will keep this as context until you ask me to act."
        }
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

    private static func spokenTranscriptSummary(_ transcript: String) -> String {
        let cleanedLines = transcript
            .components(separatedBy: .newlines)
            .map { line in
                line
                    .replacingOccurrences(of: "\u{001B}\\[[0-9;]*[A-Za-z]", with: "", options: .regularExpression)
                    .trimmingCharacters(in: .whitespacesAndNewlines)
            }
            .filter { line in
                guard !line.isEmpty else { return false }
                if line.hasPrefix("[tool]") || line.hasPrefix("[artifact]") || line.hasPrefix("[runner failed]") {
                    return false
                }
                return true
            }

        guard !cleanedLines.isEmpty else { return "" }
        let tail = cleanedLines.suffix(4).joined(separator: " ")
        if tail.count <= 220 {
            return tail
        }
        return "\(tail.prefix(220))..."
    }
}
