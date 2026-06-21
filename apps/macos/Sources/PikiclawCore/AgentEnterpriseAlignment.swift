import Foundation

public enum AgentEnterpriseCapabilityKey: String, Codable, Sendable, CaseIterable {
    case planReview
    case goalContinuity
    case humanLoop
    case approvalGate
    case issueWorkflow
    case artifacts
    case resume
    case forkWorktree
    case activeSteering
    case mcpTools
    case multimodalArtifacts

    public var title: String {
        switch self {
        case .planReview: return "Plan review"
        case .goalContinuity: return "Goal continuity"
        case .humanLoop: return "Human loop"
        case .approvalGate: return "Approval gate"
        case .issueWorkflow: return "Issue workflow"
        case .artifacts: return "Artifacts"
        case .resume: return "Resume"
        case .forkWorktree: return "Fork / worktree"
        case .activeSteering: return "Active steering"
        case .mcpTools: return "MCP / tools"
        case .multimodalArtifacts: return "Multimodal output"
        }
    }

    public var target: String {
        switch self {
        case .planReview:
            return "Propose, revise, approve, and execute plans from the native workbench."
        case .goalContinuity:
            return "Keep objective state durable across chats, agents, and restarts."
        case .humanLoop:
            return "Let agents ask structured questions without losing the run context."
        case .approvalGate:
            return "Keep command, edit, and tool decisions explicit and auditable."
        case .issueWorkflow:
            return "Turn Jira or issue intake into scoped agent work, evidence, validation, and paste-ready updates."
        case .artifacts:
            return "Attach files, diffs, notes, and decisions to durable Work Items."
        case .resume:
            return "Resume or recover work without restarting from a blank prompt."
        case .forkWorktree:
            return "Branch risky follow-up work into isolated sessions or worktrees."
        case .activeSteering:
            return "Course-correct an active run without losing the current turn."
        case .mcpTools:
            return "Expose governed tools with workspace-aware trust and health."
        case .multimodalArtifacts:
            return "Route images and generated media into the artifact pipeline."
        }
    }
}

public enum AgentEnterpriseCapabilityMode: String, Codable, Sendable, CaseIterable {
    case native
    case portable
    case unsupported
    case missing
    case disabled

    public var label: String {
        switch self {
        case .native: return "Native"
        case .portable: return "Portable"
        case .unsupported: return "Gap"
        case .missing: return "Missing"
        case .disabled: return "Off"
        }
    }

    public var isReady: Bool {
        self == .native || self == .portable
    }
}

public struct AgentEnterpriseCapabilityCell: Hashable, Codable, Sendable {
    public var agentKind: NativeAgentKind
    public var mode: AgentEnterpriseCapabilityMode
    public var summary: String
    public var nextAction: String

    public init(
        agentKind: NativeAgentKind,
        mode: AgentEnterpriseCapabilityMode,
        summary: String,
        nextAction: String
    ) {
        self.agentKind = agentKind
        self.mode = mode
        self.summary = summary
        self.nextAction = nextAction
    }
}

public struct AgentEnterpriseCapabilityRow: Identifiable, Hashable, Codable, Sendable {
    public var id: AgentEnterpriseCapabilityKey { key }
    public var key: AgentEnterpriseCapabilityKey
    public var cells: [AgentEnterpriseCapabilityCell]
    public var readyCount: Int
    public var attentionCount: Int
    public var coverageLabel: String
    public var gapSummary: String
    public var nextAction: String

    public init(
        key: AgentEnterpriseCapabilityKey,
        cells: [AgentEnterpriseCapabilityCell],
        readyCount: Int,
        attentionCount: Int,
        coverageLabel: String,
        gapSummary: String,
        nextAction: String
    ) {
        self.key = key
        self.cells = cells
        self.readyCount = readyCount
        self.attentionCount = attentionCount
        self.coverageLabel = coverageLabel
        self.gapSummary = gapSummary
        self.nextAction = nextAction
    }
}

public enum EnterpriseReadinessKey: String, Codable, Sendable, CaseIterable {
    case agentFleet
    case goalContinuity
    case governance
    case artifacts
    case audit
}

public struct EnterpriseReadinessRow: Identifiable, Hashable, Codable, Sendable {
    public var id: EnterpriseReadinessKey { key }
    public var key: EnterpriseReadinessKey
    public var title: String
    public var value: String
    public var detail: String
    public var ready: Int
    public var attention: Int
    public var nextAction: String

    public init(
        key: EnterpriseReadinessKey,
        title: String,
        value: String,
        detail: String,
        ready: Int,
        attention: Int,
        nextAction: String
    ) {
        self.key = key
        self.title = title
        self.value = value
        self.detail = detail
        self.ready = ready
        self.attention = attention
        self.nextAction = nextAction
    }
}

public struct EnterpriseGoalMissionSummary: Identifiable, Hashable, Codable, Sendable {
    public var id: EntityID { workItemId }
    public var workItemId: EntityID
    public var workspaceId: EntityID
    public var title: String
    public var state: WorkItemState
    public var coverageLabel: String
    public var readyArtifactCount: Int
    public var totalArtifactCount: Int
    public var readinessReady: Int
    public var readinessAttention: Int
    public var capabilityReady: Int
    public var capabilityAttention: Int
    public var nextAction: String

    public init(
        workItemId: EntityID,
        workspaceId: EntityID,
        title: String,
        state: WorkItemState,
        coverageLabel: String,
        readyArtifactCount: Int,
        totalArtifactCount: Int,
        readinessReady: Int,
        readinessAttention: Int,
        capabilityReady: Int,
        capabilityAttention: Int,
        nextAction: String
    ) {
        self.workItemId = workItemId
        self.workspaceId = workspaceId
        self.title = title
        self.state = state
        self.coverageLabel = coverageLabel
        self.readyArtifactCount = readyArtifactCount
        self.totalArtifactCount = totalArtifactCount
        self.readinessReady = readinessReady
        self.readinessAttention = readinessAttention
        self.capabilityReady = capabilityReady
        self.capabilityAttention = capabilityAttention
        self.nextAction = nextAction
    }
}

public enum AgentEnterpriseAlignment {
    public static let focusAgents: [NativeAgentKind] = [.codex, .claude, .gemini]
    public static let goalWorkItemId = EntityID("workitem-agent-enterprise-parity-goal")

    public static func parityRows(snapshot: NativeStoreSnapshot) -> [AgentEnterpriseCapabilityRow] {
        AgentEnterpriseCapabilityKey.allCases.map { key in
            let cells = focusAgents.map { cell(for: $0, key: key, snapshot: snapshot) }
            let ready = cells.filter { $0.mode.isReady }.count
            let attention = cells.count - ready
            let gapCells = cells.filter { !$0.mode.isReady }
            let gapSummary = gapCells.isEmpty
                ? "All focus agents have a visible \(key.title.lowercased()) path."
                : "\(gapCells.map { $0.agentKind.enterpriseLabel }.joined(separator: ", ")) need setup or fallback clarity."
            return AgentEnterpriseCapabilityRow(
                key: key,
                cells: cells,
                readyCount: ready,
                attentionCount: attention,
                coverageLabel: "\(ready)/\(cells.count)",
                gapSummary: gapSummary,
                nextAction: nextAction(for: key, cells: cells)
            )
        }
    }

    public static func readinessRows(snapshot: NativeStoreSnapshot) -> [EnterpriseReadinessRow] {
        let focusProfiles = focusAgents.compactMap { kind in
            snapshot.agentProfiles.first(where: { $0.kind == kind })
        }
        let enabledFocus = focusProfiles.filter(\.isEnabled)
        let healthyFocus = focusProfiles.filter { profile in
            agentCapability(for: profile, snapshot: snapshot)?.healthState == .healthy
        }
        let goal = snapshot.workItems.first(where: { $0.id == goalWorkItemId })
        let trustedCapabilities = snapshot.capabilities.filter { $0.trustLevel == .trusted && $0.healthState == .healthy }
        let reviewArtifacts = snapshot.artifacts.filter { $0.status == .ready }
        let auditEvents = snapshot.auditEvents

        return [
            EnterpriseReadinessRow(
                key: .agentFleet,
                title: "Agent fleet",
                value: "\(healthyFocus.count)/\(focusAgents.count)",
                detail: "\(enabledFocus.count) enabled across Codex, Claude, and Gemini.",
                ready: healthyFocus.count,
                attention: max(0, focusAgents.count - healthyFocus.count),
                nextAction: healthyFocus.count == focusAgents.count
                    ? "Keep runtime health visible in Agent Studio."
                    : "Detect, login, or enable the missing focus agents."
            ),
            EnterpriseReadinessRow(
                key: .goalContinuity,
                title: "Goal continuity",
                value: goal?.state.rawValue.capitalized ?? "Missing",
                detail: goal?.title ?? "No enterprise parity goal is present in native state.",
                ready: goal == nil ? 0 : 1,
                attention: goal == nil ? 1 : 0,
                nextAction: goal == nil
                    ? "Restore the native enterprise alignment goal."
                    : "Use this Work Item as the durable objective for parity work."
            ),
            EnterpriseReadinessRow(
                key: .governance,
                title: "Governed tools",
                value: "\(trustedCapabilities.count)",
                detail: "\(snapshot.capabilities.count) capabilities tracked with health and trust.",
                ready: trustedCapabilities.count,
                attention: snapshot.capabilities.filter { $0.healthState != .healthy || $0.trustLevel != .trusted }.count,
                nextAction: "Clear unhealthy, unauthenticated, or restricted tools before high-risk runs."
            ),
            EnterpriseReadinessRow(
                key: .artifacts,
                title: "Artifacts",
                value: "\(reviewArtifacts.count)",
                detail: "\(snapshot.workItems.count) Work Items can receive durable outputs.",
                ready: reviewArtifacts.count,
                attention: reviewArtifacts.isEmpty ? 1 : 0,
                nextAction: "Attach parity audit outputs to the enterprise goal Work Item."
            ),
            EnterpriseReadinessRow(
                key: .audit,
                title: "Audit trail",
                value: "\(auditEvents.count)",
                detail: "Workspace, branch, and approval events stay reviewable.",
                ready: auditEvents.isEmpty ? 0 : 1,
                attention: auditEvents.isEmpty ? 1 : 0,
                nextAction: "Prefer native actions that append audit events before mutating state."
            )
        ]
    }

    public static func missionSummary(snapshot: NativeStoreSnapshot) -> EnterpriseGoalMissionSummary? {
        guard let goal = snapshot.workItems.first(where: { $0.id == goalWorkItemId }) else {
            return nil
        }
        let readiness = readinessRows(snapshot: snapshot)
        let parity = parityRows(snapshot: snapshot)
        let readinessReady = readiness.reduce(0) { $0 + $1.ready }
        let readinessAttention = readiness.reduce(0) { $0 + $1.attention }
        let capabilityReady = parity.reduce(0) { $0 + $1.readyCount }
        let capabilityAttention = parity.reduce(0) { $0 + $1.attentionCount }
        let totalCapabilities = max(1, capabilityReady + capabilityAttention)
        let artifacts = snapshot.artifacts.filter { $0.workItemId == goal.id }
        let readyArtifacts = artifacts.filter { $0.status == .ready || $0.status == .verified }
        let nextAction = readiness.first(where: { $0.attention > 0 })?.nextAction
            ?? parity.first(where: { $0.attentionCount > 0 })?.nextAction
            ?? goal.acceptanceCriteria.first
            ?? "Continue the enterprise parity audit and attach the result to this goal."

        return EnterpriseGoalMissionSummary(
            workItemId: goal.id,
            workspaceId: goal.workspaceId,
            title: goal.title,
            state: goal.state,
            coverageLabel: "\(capabilityReady)/\(totalCapabilities)",
            readyArtifactCount: readyArtifacts.count,
            totalArtifactCount: artifacts.count,
            readinessReady: readinessReady,
            readinessAttention: readinessAttention,
            capabilityReady: capabilityReady,
            capabilityAttention: capabilityAttention,
            nextAction: nextAction
        )
    }

    public static func goalWorkItem(workspaceId: EntityID, projectId: EntityID? = nil, createdAt: Date = Date()) -> WorkItem {
        WorkItem(
            id: goalWorkItemId,
            workspaceId: workspaceId,
            projectId: projectId,
            title: "Align Mac Native with Codex, Claude, and Gemini Enterprise",
            description: """
            Make the macOS native client feel like an enterprise-grade agent workbench: comparable runtime choices, durable goal state, governed tools, reviewable artifacts, and clear audit surfaces.
            """,
            sourceType: .goal,
            sourceRefs: [
                SourceRef(kind: "product", label: "Codex"),
                SourceRef(kind: "product", label: "Claude Code"),
                SourceRef(kind: "product", label: "Gemini Enterprise")
            ],
            state: .active,
            priority: 0,
            acceptanceCriteria: [
                "Codex, Claude, and Gemini are visible as comparable agent runtimes",
                "Agent Studio shows parity gaps, readiness, and setup actions",
                "Goal, approval, artifact, MCP/tool, resume, and steering capabilities are tracked",
                "Enterprise governance signals are visible before high-risk agent runs",
                "Progress is recorded in the Obsidian repo goal note"
            ],
            createdAt: createdAt,
            updatedAt: createdAt,
            externalRefs: [
                SourceRef(
                    kind: "obsidian",
                    label: "Enterprise parity goal",
                    uri: "/Users/michael.yang/Documents/Obsidian Vault/repo/Personal/pikiclaw/mac-native-enterprise-agent-parity-goal.md"
                )
            ]
        )
    }

    private static func cell(
        for agentKind: NativeAgentKind,
        key: AgentEnterpriseCapabilityKey,
        snapshot: NativeStoreSnapshot
    ) -> AgentEnterpriseCapabilityCell {
        guard let profile = snapshot.agentProfiles.first(where: { $0.kind == agentKind }) else {
            return AgentEnterpriseCapabilityCell(
                agentKind: agentKind,
                mode: .missing,
                summary: "Profile is missing from the native catalog.",
                nextAction: "Add the \(agentKind.enterpriseLabel) profile."
            )
        }
        guard profile.isEnabled else {
            return AgentEnterpriseCapabilityCell(
                agentKind: agentKind,
                mode: .disabled,
                summary: "Profile exists but is disabled.",
                nextAction: "Enable \(profile.displayName) when the local CLI is installed."
            )
        }

        let base = baseCapability(agentKind: agentKind, key: key)
        guard let capability = agentCapability(for: profile, snapshot: snapshot) else {
            return AgentEnterpriseCapabilityCell(
                agentKind: agentKind,
                mode: base.mode == .native ? .portable : base.mode,
                summary: "\(base.summary) Runtime health has not been detected yet.",
                nextAction: "Run Detect or Test in Agent Studio."
            )
        }
        guard capability.healthState == .healthy else {
            return AgentEnterpriseCapabilityCell(
                agentKind: agentKind,
                mode: base.mode == .unsupported ? .unsupported : .missing,
                summary: "\(base.summary) Current health: \(capability.healthState.rawValue).",
                nextAction: "Fix \(capability.configState) before relying on this path."
            )
        }
        return base
    }

    private static func baseCapability(
        agentKind: NativeAgentKind,
        key: AgentEnterpriseCapabilityKey
    ) -> AgentEnterpriseCapabilityCell {
        switch (agentKind, key) {
        case (.codex, .planReview):
            return native(agentKind, "Plan/review loops are first-class in Codex-style coding tasks.", "Keep plan gates visible before long-running edits.")
        case (.codex, .goalContinuity):
            return native(agentKind, "Codex can own explicit objectives while Pikiclaw persists the Work Item.", "Tie the active goal to run history and artifacts.")
        case (.codex, .humanLoop):
            return native(agentKind, "Structured user-input pauses map cleanly to Pikiclaw's human loop.", "Surface questions in the same native answer tray.")
        case (.codex, .approvalGate):
            return native(agentKind, "Approval and sandbox modes are part of the launch boundary.", "Expose permission mode before every run.")
        case (.codex, .issueWorkflow):
            return native(agentKind, "Jira tickets can launch Codex with scoped briefs, evidence, validation, and paste-ready updates.", "Keep Copy Update and run evidence visible in the Jira workbench.")
        case (.codex, .artifacts):
            return native(agentKind, "Code diffs, files, reviews, and generated media can become artifacts.", "Attach outputs to the selected Work Item.")
        case (.codex, .resume):
            return native(agentKind, "Session and workspace context can be recovered through the native run model.", "Keep resume near chat history.")
        case (.codex, .forkWorktree):
            return portable(agentKind, "Use Pikiclaw branch/worktree handoff until a native fork contract is verified.", "Queue isolated follow-up work from Mission Control.")
        case (.codex, .activeSteering):
            return native(agentKind, "Active turn steering maps to the native run control surface.", "Show steering only while a live channel exists.")
        case (.codex, .mcpTools):
            return native(agentKind, "MCP servers are part of the Codex tool surface.", "Show MCP health beside launch context.")
        case (.codex, .multimodalArtifacts):
            return native(agentKind, "Images and screenshots can be used as input/output artifacts.", "Route media into the artifact review pane.")

        case (.claude, .planReview):
            return native(agentKind, "Plan mode and approval-before-execution map well to native workflow launch.", "Keep the plan approval state visible.")
        case (.claude, .goalContinuity):
            return portable(agentKind, "Claude can follow an objective, while Pikiclaw persists the goal lifecycle.", "Use the Work Item as the source of truth.")
        case (.claude, .humanLoop):
            return portable(agentKind, "Questions can be normalized into Pikiclaw's answer surface.", "Convert asks into structured native prompts.")
        case (.claude, .approvalGate):
            return native(agentKind, "Permission modes and hooks support governed execution.", "Mirror permission mode in the native launch boundary.")
        case (.claude, .issueWorkflow):
            return portable(agentKind, "Claude issue work can use Pikiclaw's Jira Work Item, brief, and update-draft layer.", "Keep ticket evidence outside transcript text.")
        case (.claude, .artifacts):
            return portable(agentKind, "Claude outputs should be captured into Pikiclaw artifacts.", "Save files, plans, and decisions outside transcript text.")
        case (.claude, .resume):
            return native(agentKind, "Session continuity can map to native run history.", "Keep Claude sessions tied to Work Items.")
        case (.claude, .forkWorktree):
            return native(agentKind, "Claude-style forks are a strong match for isolated follow-up work.", "Pair forked work with branch/worktree metadata.")
        case (.claude, .activeSteering):
            return portable(agentKind, "Pikiclaw can offer stop/steer/retry even when driver steering differs.", "Expose driver-specific controls only after verification.")
        case (.claude, .mcpTools):
            return native(agentKind, "MCP is a core Claude Code extension path.", "Track project MCP trust and auth.")
        case (.claude, .multimodalArtifacts):
            return portable(agentKind, "Capture generated or referenced media as Pikiclaw artifacts.", "Keep multimodal output reviewable.")

        case (.gemini, .planReview):
            return portable(agentKind, "Gemini Enterprise-style agents can be wrapped by Pikiclaw workflow plans.", "Use native workflow recipes as the plan surface.")
        case (.gemini, .goalContinuity):
            return portable(agentKind, "Pikiclaw should own durable goals across Gemini-backed agents.", "Keep goal lifecycle in Work Items.")
        case (.gemini, .humanLoop):
            return portable(agentKind, "Human loop questions should be normalized by Pikiclaw.", "Route asks through the native answer tray.")
        case (.gemini, .approvalGate):
            return portable(agentKind, "Enterprise governance can be represented by Pikiclaw permission and audit layers.", "Record approvals as audit events.")
        case (.gemini, .issueWorkflow):
            return portable(agentKind, "Gemini Enterprise-style issue workflows can land in the same Jira Work Item and update draft.", "Use native issue workflow as the durable control plane.")
        case (.gemini, .artifacts):
            return portable(agentKind, "Enterprise agent outputs should land in the artifact model.", "Attach generated deliverables to Work Items.")
        case (.gemini, .resume):
            return portable(agentKind, "Pikiclaw can provide cross-surface resume around Gemini sessions.", "Persist session references when available.")
        case (.gemini, .forkWorktree):
            return portable(agentKind, "Use Pikiclaw worktree handoff for isolated Gemini follow-up.", "Promote branch isolation into the goal workflow.")
        case (.gemini, .activeSteering):
            return unsupported(agentKind, "No verified native active-turn steering contract is modeled yet.", "Treat steering as stop/retry until verified.")
        case (.gemini, .mcpTools):
            return portable(agentKind, "Tool governance should be surfaced through Pikiclaw's capability registry.", "Keep tool health and policy in Agent Studio.")
        case (.gemini, .multimodalArtifacts):
            return portable(agentKind, "Gemini-generated media should use Pikiclaw artifact routing.", "Store media outputs with provenance.")

        default:
            return unsupported(agentKind, "No enterprise parity rule is defined for this agent.", "Add a focused capability rule.")
        }
    }

    private static func nextAction(
        for key: AgentEnterpriseCapabilityKey,
        cells: [AgentEnterpriseCapabilityCell]
    ) -> String {
        if let blocked = cells.first(where: { !$0.mode.isReady }) {
            return blocked.nextAction
        }
        return key.target
    }

    private static func agentCapability(for profile: AgentProfile, snapshot: NativeStoreSnapshot) -> Capability? {
        snapshot.capabilities.first { capability in
            capability.name.localizedCaseInsensitiveContains(profile.displayName)
                || profile.displayName.localizedCaseInsensitiveContains(capability.name.replacingOccurrences(of: " CLI", with: ""))
                || capability.name.localizedCaseInsensitiveContains(profile.executableName)
        }
    }

    private static func native(_ agentKind: NativeAgentKind, _ summary: String, _ nextAction: String) -> AgentEnterpriseCapabilityCell {
        AgentEnterpriseCapabilityCell(agentKind: agentKind, mode: .native, summary: summary, nextAction: nextAction)
    }

    private static func portable(_ agentKind: NativeAgentKind, _ summary: String, _ nextAction: String) -> AgentEnterpriseCapabilityCell {
        AgentEnterpriseCapabilityCell(agentKind: agentKind, mode: .portable, summary: summary, nextAction: nextAction)
    }

    private static func unsupported(_ agentKind: NativeAgentKind, _ summary: String, _ nextAction: String) -> AgentEnterpriseCapabilityCell {
        AgentEnterpriseCapabilityCell(agentKind: agentKind, mode: .unsupported, summary: summary, nextAction: nextAction)
    }
}

public extension NativeAgentKind {
    var enterpriseLabel: String {
        switch self {
        case .codex: return "Codex"
        case .claude: return "Claude"
        case .gemini: return "Gemini"
        case .cursor: return "Cursor"
        case .githubCopilot: return "Copilot"
        case .hermes: return "Hermes"
        case .customCLI: return "Custom CLI"
        }
    }
}
