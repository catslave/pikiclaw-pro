import Foundation

public enum JiraTicketCardAction: String, Sendable {
    case attach
    case start
}

public struct JiraTicketWriteBackHistoryEntry: Identifiable, Hashable, Sendable {
    public var id: EntityID
    public var state: String
    public var label: String
    public var signal: String
    public var artifactTitle: String
    public var artifactURI: String?
    public var createdAt: Date
    public var isActionable: Bool

    public init(
        id: EntityID,
        state: String,
        label: String,
        signal: String,
        artifactTitle: String,
        artifactURI: String?,
        createdAt: Date,
        isActionable: Bool
    ) {
        self.id = id
        self.state = state
        self.label = label
        self.signal = signal
        self.artifactTitle = artifactTitle
        self.artifactURI = artifactURI
        self.createdAt = createdAt
        self.isActionable = isActionable
    }

    public var actionTitle: String? {
        switch state.lowercased() {
        case "failed":
            return "Retry"
        case "manual-paste", "manual paste", "manual", "pending":
            return "Post"
        default:
            return nil
        }
    }
}

public struct JiraTicketWriteBackAuditStep: Identifiable, Hashable, Sendable {
    public var id: EntityID
    public var state: String
    public var label: String
    public var signal: String
    public var createdAt: Date
    public var isActionable: Bool

    public init(
        id: EntityID,
        state: String,
        label: String,
        signal: String,
        createdAt: Date,
        isActionable: Bool
    ) {
        self.id = id
        self.state = state
        self.label = label
        self.signal = signal
        self.createdAt = createdAt
        self.isActionable = isActionable
    }
}

public struct JiraTicketEvidenceSummary: Hashable, Sendable {
    public var outputCount: Int
    public var artifactRefCount: Int
    public var pendingCommands: [String]
    public var decisionSignals: [String]
    public var actionableNotes: [String]
    public var validationSignals: [String]
    public var writeBackState: String?
    public var writeBackSignals: [String]

    public init(
        outputCount: Int,
        artifactRefCount: Int,
        pendingCommands: [String],
        decisionSignals: [String] = [],
        actionableNotes: [String] = [],
        validationSignals: [String] = [],
        writeBackState: String? = nil,
        writeBackSignals: [String] = []
    ) {
        self.outputCount = outputCount
        self.artifactRefCount = artifactRefCount
        self.pendingCommands = pendingCommands
        self.decisionSignals = decisionSignals
        self.actionableNotes = actionableNotes
        self.validationSignals = validationSignals
        self.writeBackState = writeBackState
        self.writeBackSignals = writeBackSignals
    }

    public var artifactRefsLabel: String {
        guard artifactRefCount > 0 else { return "None" }
        return "\(artifactRefCount) ref\(artifactRefCount == 1 ? "" : "s")"
    }

    public var pendingCommandsLabel: String {
        guard !pendingCommands.isEmpty else { return "None" }
        return "\(pendingCommands.count) cmd\(pendingCommands.count == 1 ? "" : "s")"
    }

    public var pendingCommandsHelp: String? {
        pendingCommands.isEmpty ? nil : pendingCommands.joined(separator: "\n")
    }

    public var actionSignalCount: Int {
        decisionSignals.count + actionableNotes.count
    }

    public var actionSignalsLabel: String {
        guard actionSignalCount > 0 else { return "None" }
        return "\(actionSignalCount) signal\(actionSignalCount == 1 ? "" : "s")"
    }

    public var actionSignalsHelp: String? {
        let values = decisionSignals + actionableNotes
        return values.isEmpty ? nil : values.joined(separator: "\n")
    }

    public var validationSignalsLabel: String {
        guard !validationSignals.isEmpty else { return "None" }
        return "\(validationSignals.count) check\(validationSignals.count == 1 ? "" : "s")"
    }

    public var validationSignalsHelp: String? {
        validationSignals.isEmpty ? nil : validationSignals.joined(separator: "\n")
    }

    public var hasWriteBackResult: Bool {
        writeBackState != nil || !writeBackSignals.isEmpty
    }

    public var writeBackLabel: String {
        jiraTicketWriteBackDisplayLabel(writeBackState)
    }

    public var writeBackHelp: String? {
        writeBackSignals.isEmpty ? nil : writeBackSignals.joined(separator: "\n")
    }
}

public func jiraTicketEvidenceSummary(artifacts: [Artifact]) -> JiraTicketEvidenceSummary {
    let refs = artifacts
        .map(\.uri)
        .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
        .filter { !$0.isEmpty }
    let commands = dedupedJiraTicketContextValues(artifacts.flatMap(jiraTicketPendingCommands(from:)))
    let decisionSignals = dedupedJiraTicketContextValues(artifacts.flatMap(jiraTicketDecisionSignals(from:)))
    let actionableNotes = dedupedJiraTicketContextValues(artifacts.flatMap(jiraTicketActionableNotes(from:)))
    let validationSignals = dedupedJiraTicketContextValues(artifacts.flatMap(jiraTicketValidationSignals(from:)))
    let writeBackArtifact = jiraTicketLatestWriteBackArtifact(artifacts)
    let writeBackState = writeBackArtifact.flatMap(jiraTicketWriteBackState)
    let writeBackSignals = writeBackArtifact.map { [jiraTicketWriteBackSignalLine($0)] } ?? []
    return JiraTicketEvidenceSummary(
        outputCount: artifacts.count,
        artifactRefCount: refs.count,
        pendingCommands: Array(commands.prefix(4)),
        decisionSignals: Array(decisionSignals.prefix(4)),
        actionableNotes: Array(actionableNotes.prefix(5)),
        validationSignals: Array(validationSignals.prefix(4)),
        writeBackState: writeBackState,
        writeBackSignals: writeBackSignals
    )
}

public func jiraTicketEvidenceSummary(for item: WorkItem, snapshot: NativeStoreSnapshot) -> JiraTicketEvidenceSummary {
    jiraTicketEvidenceSummary(
        artifacts: snapshot.artifacts.filter { $0.workItemId == item.id }
    )
}

public func jiraTicketEvidenceSummariesByWorkItemId(artifacts: [Artifact]) -> [EntityID: JiraTicketEvidenceSummary] {
    var grouped: [EntityID: [Artifact]] = [:]
    for artifact in artifacts {
        guard let workItemId = artifact.workItemId else { continue }
        grouped[workItemId, default: []].append(artifact)
    }
    return grouped.mapValues { artifacts in
        jiraTicketEvidenceSummary(artifacts: artifacts)
    }
}

public func jiraTicketLightEvidenceSummariesByWorkItemId(artifacts: [Artifact]) -> [EntityID: JiraTicketEvidenceSummary] {
    var grouped: [EntityID: (outputs: Int, refs: Int)] = [:]
    for artifact in artifacts {
        guard let workItemId = artifact.workItemId else { continue }
        var value = grouped[workItemId] ?? (outputs: 0, refs: 0)
        value.outputs += 1
        if !artifact.uri.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            value.refs += 1
        }
        grouped[workItemId] = value
    }
    return grouped.mapValues { value in
        JiraTicketEvidenceSummary(
            outputCount: value.outputs,
            artifactRefCount: value.refs,
            pendingCommands: []
        )
    }
}

public func jiraTicketWriteBackHistory(artifacts: [Artifact], limit: Int = 5) -> [JiraTicketWriteBackHistoryEntry] {
    guard limit > 0 else { return [] }
    return Array(jiraTicketSortedWriteBackHistory(artifacts).prefix(limit))
}

public func jiraTicketActionableWriteBackHistory(artifacts: [Artifact], limit: Int = 5) -> [JiraTicketWriteBackHistoryEntry] {
    guard limit > 0 else { return [] }
    return Array(jiraTicketSortedWriteBackHistory(artifacts).filter(\.isActionable).prefix(limit))
}

public func jiraTicketWriteBackAuditTimeline(artifacts: [Artifact], limit: Int = 6) -> [JiraTicketWriteBackAuditStep] {
    guard limit > 0 else { return [] }
    return jiraTicketSortedWriteBackHistory(artifacts)
        .prefix(limit)
        .reversed()
        .map { entry in
            JiraTicketWriteBackAuditStep(
                id: entry.id,
                state: entry.state,
                label: entry.label,
                signal: entry.signal,
                createdAt: entry.createdAt,
                isActionable: entry.isActionable
            )
        }
}

public func jiraTicketQueueItems(from workItems: [WorkItem]) -> [WorkItem] {
    workItems
        .filter { $0.sourceType == .jira }
        .sorted(by: jiraTicketQueuePrecedes)
}

public func jiraTicketCardCandidates(
    from workItems: [WorkItem],
    selectedWorkItemId: EntityID? = nil,
    limit: Int = 5
) -> [WorkItem] {
    let jiraItems = workItems.filter { $0.sourceType == .jira }
    let actionable = jiraItems.filter { $0.state != .done && $0.state != .cancelled && $0.state != .archived }
    let source = actionable.isEmpty ? jiraItems : actionable

    return source.sorted { left, right in
        if left.id == selectedWorkItemId { return true }
        if right.id == selectedWorkItemId { return false }
        let leftRank = jiraTicketCardRank(left)
        let rightRank = jiraTicketCardRank(right)
        if leftRank != rightRank { return leftRank < rightRank }
        if left.priority != right.priority { return left.priority < right.priority }
        return left.updatedAt > right.updatedAt
    }
    .prefix(max(0, limit))
    .map { $0 }
}

public func jiraTicketMatchesQuery(_ item: WorkItem, query: String) -> Bool {
    let needle = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    guard !needle.isEmpty else { return true }

    let terms = needle.split(whereSeparator: \.isWhitespace).map(String.init)
    let fields = [
        item.jira?.key,
        item.jira?.status,
        item.jira?.assignee,
        item.jira?.sprint,
        item.jira?.priority,
        item.jira?.issueType,
        item.jira?.url,
        item.jira?.remoteUpdatedAt,
        item.title,
        item.description
    ]
    let refFields: [String?] = (item.sourceRefs + item.externalRefs).flatMap { ref in
        [ref.kind, ref.label, ref.uri]
    }
    let haystacks = (fields + refFields)
        .compactMap { $0?.lowercased() }

    return terms.allSatisfy { term in
        haystacks.contains { $0.contains(term) }
    }
}

public func jiraTicketAgentBrief(for item: WorkItem, workspace: Workspace? = nil) -> String {
    var lines: [String] = []
    let key = item.jira?.key ?? "Jira"

    lines.append("Jira: \(key)")
    lines.append("Title: \(item.title)")
    if let workspace {
        lines.append("Workspace: \(workspace.name)")
        lines.append("Path: \(workspace.pathDisplay)")
        appendLine("Branch", workspace.currentBranch, to: &lines)
        appendLine("Remote", workspace.gitRemote, to: &lines)
    }
    lines.append("Workflow State: \(item.state.rawValue)")
    appendLine("Jira Status", item.jira?.status, to: &lines)
    appendLine("Type", item.jira?.issueType, to: &lines)
    appendLine("Priority", item.jira?.priority, to: &lines)
    appendLine("Assignee", item.jira?.assignee, to: &lines)
    appendLine("Sprint", item.jira?.sprint, to: &lines)
    appendLine("URL", item.jira?.url, to: &lines)

    appendReferencesSection("Source References:", refs: item.sourceRefs, to: &lines)

    let externalRefs = item.externalRefs.filter { ref in
        guard let uri = ref.uri?.trimmingCharacters(in: .whitespacesAndNewlines), !uri.isEmpty else {
            return false
        }
        return uri != item.jira?.url
    }
    appendReferencesSection("External References:", refs: externalRefs, to: &lines)

    let description = item.description.trimmingCharacters(in: .whitespacesAndNewlines)
    if !description.isEmpty {
        lines.append("")
        lines.append("Description:")
        lines.append(description)
    }

    if !item.acceptanceCriteria.isEmpty {
        lines.append("")
        lines.append("Acceptance Criteria:")
        lines.append(contentsOf: item.acceptanceCriteria.map { "- \($0)" })
    }

    lines.append("")
    lines.append("Execution Contract:")
    lines.append("- Return sections: Ticket boundary, Implementation seam, Change plan, Validation, Jira update, and Durable outputs.")
    lines.append("- Keep acceptance criteria and source evidence tied to this ticket; do not mix in unrelated work items.")
    lines.append("- Preserve Artifact refs as Evidence and treat Pending commands as candidate Validation or Next action until they are run.")
    lines.append("- Include exact validation commands or checks, and separate confirmed facts from guesses.")
    lines.append("- Do not claim Jira was updated unless an external write actually succeeded; otherwise provide a paste-ready comment.")
    lines.append("")
    lines.append("Please inspect the repo, implement the smallest safe change, run focused validation, and summarize the result.")
    return lines.joined(separator: "\n")
}

public struct JiraTicketUpdateDraft: Hashable, Sendable {
    public var title: String
    public var comment: String
    public var statusLines: [String]
    public var evidenceLines: [String]
    public var validationLines: [String]
    public var blockerLines: [String]
    public var nextActionLines: [String]

    public init(
        title: String,
        comment: String,
        statusLines: [String],
        evidenceLines: [String],
        validationLines: [String],
        blockerLines: [String],
        nextActionLines: [String]
    ) {
        self.title = title
        self.comment = comment
        self.statusLines = statusLines
        self.evidenceLines = evidenceLines
        self.validationLines = validationLines
        self.blockerLines = blockerLines
        self.nextActionLines = nextActionLines
    }
}

public enum JiraTicketWriteBackGate: String, Hashable, Sendable, Codable {
    case denied
    case requiresApproval
}

public struct JiraTicketWriteBackPlan: Hashable, Sendable {
    public var issueKey: String
    public var title: String
    public var comment: String
    public var permissionMode: PermissionMode
    public var permissionDecision: PermissionDecision
    public var gate: JiraTicketWriteBackGate
    public var approvalSummary: String
    public var auditSummary: String
    public var denialReason: String?

    public init(
        issueKey: String,
        title: String,
        comment: String,
        permissionMode: PermissionMode,
        permissionDecision: PermissionDecision,
        gate: JiraTicketWriteBackGate,
        approvalSummary: String,
        auditSummary: String,
        denialReason: String? = nil
    ) {
        self.issueKey = issueKey
        self.title = title
        self.comment = comment
        self.permissionMode = permissionMode
        self.permissionDecision = permissionDecision
        self.gate = gate
        self.approvalSummary = approvalSummary
        self.auditSummary = auditSummary
        self.denialReason = denialReason
    }

    public var requiresExplicitApproval: Bool {
        gate == .requiresApproval
    }
}

public func jiraTicketWriteBackPlan(
    for item: WorkItem,
    draft: JiraTicketUpdateDraft,
    permissionMode: PermissionMode
) -> JiraTicketWriteBackPlan {
    let key = jiraTicketNonEmpty(item.jira?.key) ?? "Jira"
    let decision = PermissionPolicy(mode: permissionMode).decision(for: .externalWriteback)
    let title = "Post \(draft.title)"
    let approvalSummary = "Post a \(draft.comment.count)-character Jira comment to \(key)."
    let auditSummary = "Approved Jira write-back for \(key)"

    guard key != "Jira" else {
        return JiraTicketWriteBackPlan(
            issueKey: key,
            title: title,
            comment: draft.comment,
            permissionMode: permissionMode,
            permissionDecision: decision,
            gate: .denied,
            approvalSummary: approvalSummary,
            auditSummary: auditSummary,
            denialReason: "Selected work item has no Jira issue key."
        )
    }

    guard decision != .deny else {
        return JiraTicketWriteBackPlan(
            issueKey: key,
            title: title,
            comment: draft.comment,
            permissionMode: permissionMode,
            permissionDecision: decision,
            gate: .denied,
            approvalSummary: approvalSummary,
            auditSummary: auditSummary,
            denialReason: "External Jira write-back is denied in \(permissionMode.rawValue) mode."
        )
    }

    return JiraTicketWriteBackPlan(
        issueKey: key,
        title: title,
        comment: draft.comment,
        permissionMode: permissionMode,
        permissionDecision: decision,
        gate: .requiresApproval,
        approvalSummary: approvalSummary,
        auditSummary: auditSummary
    )
}

public func jiraTicketUpdateDraft(
    for item: WorkItem,
    snapshot: NativeStoreSnapshot,
    workspace explicitWorkspace: Workspace? = nil
) -> JiraTicketUpdateDraft {
    let key = jiraTicketNonEmpty(item.jira?.key) ?? "Jira"
    let artifacts = snapshot.artifacts
        .filter { $0.workItemId == item.id }
        .sorted { $0.createdAt > $1.createdAt }
    let summary = jiraTicketEvidenceSummary(artifacts: artifacts)
    let runs = snapshot.runs
        .filter { $0.workItemId == item.id }
        .sorted { jiraTicketRunSortTime($0) > jiraTicketRunSortTime($1) }
    let latestRun = runs.first
    let workspace = explicitWorkspace ?? snapshot.workspaces.first { $0.id == item.workspaceId }
    let agentName = latestRun.flatMap { run in
        snapshot.agentProfiles.first(where: { $0.id == run.agentProfileId })?.displayName
    }

    var statusLines = [
        "\(key): \(item.title)",
        "Pikiclaw state: \(item.state.rawValue)"
    ]
    if let jiraStatus = jiraTicketNonEmpty(item.jira?.status) {
        statusLines.append("Jira status: \(jiraStatus)")
    }
    if let latestRun {
        let agentPart = agentName.map { " via \($0)" } ?? ""
        statusLines.append("Latest run: \(latestRun.state.rawValue)\(agentPart) (\(latestRun.id.rawValue))")
    }
    if let workspace {
        statusLines.append("Workspace: \(workspace.name) (\(workspace.pathDisplay))")
    }
    statusLines.append(contentsOf: summary.decisionSignals)

    var evidenceLines: [String] = []
    if summary.outputCount > 0 {
        evidenceLines.append("\(summary.outputCount) output\(summary.outputCount == 1 ? "" : "s") captured; \(summary.artifactRefsLabel) linked.")
    } else {
        evidenceLines.append("No durable outputs captured yet.")
    }
    evidenceLines.append(contentsOf: jiraTicketArtifactReferenceLines(artifacts: artifacts))
    let branchResolutionLines = jiraTicketBranchResolutionLines(artifacts: artifacts)
    let writeBackLines = jiraTicketWriteBackLines(artifacts: artifacts)
    evidenceLines.append(contentsOf: branchResolutionLines.evidence)
    evidenceLines.append(contentsOf: writeBackLines.evidence)

    var validationLines = summary.validationSignals
    validationLines.append(contentsOf: branchResolutionLines.validation)
    if validationLines.isEmpty {
        validationLines.append("No validation captured yet.")
    }

    var blockerLines = summary.actionableNotes
    blockerLines.append(contentsOf: branchResolutionLines.blockers)
    blockerLines.append(contentsOf: writeBackLines.blockers)
    if blockerLines.isEmpty, let latestRun, latestRun.state == .failed || latestRun.state == .waitingForUser {
        blockerLines.append("Latest run is \(latestRun.state.rawValue); inspect the run transcript before closing.")
    }
    if blockerLines.isEmpty {
        blockerLines.append("None captured.")
    }

    let nextActionLines = jiraTicketNextActionLines(
        item: item,
        summary: summary,
        latestRun: latestRun,
        branchResolutionLines: branchResolutionLines,
        writeBackLines: writeBackLines
    )

    let comment = [
        "Jira update: \(key)",
        jiraTicketUpdateSection("Status", statusLines),
        jiraTicketUpdateSection("Evidence", evidenceLines),
        jiraTicketUpdateSection("Validation", validationLines),
        jiraTicketUpdateSection("Blockers", blockerLines),
        jiraTicketUpdateSection("Next action", nextActionLines)
    ].joined(separator: "\n\n")

    return JiraTicketUpdateDraft(
        title: "\(key) update",
        comment: comment,
        statusLines: statusLines,
        evidenceLines: evidenceLines,
        validationLines: validationLines,
        blockerLines: blockerLines,
        nextActionLines: nextActionLines
    )
}

private func jiraTicketRunSortTime(_ run: AgentRun) -> Date {
    run.endedAt ?? run.startedAt ?? .distantPast
}

private func jiraTicketArtifactReferenceLines(artifacts: [Artifact]) -> [String] {
    artifacts
        .compactMap { artifact -> String? in
            guard let uri = jiraTicketNonEmpty(artifact.uri) else { return nil }
            return "\(artifact.title): \(uri)"
        }
        .prefix(5)
        .map { String($0) }
}

private struct JiraTicketBranchResolutionLines {
    var evidence: [String] = []
    var validation: [String] = []
    var blockers: [String] = []
    var nextActions: [String] = []
}

private struct JiraTicketWriteBackLines {
    var evidence: [String] = []
    var blockers: [String] = []
    var nextActions: [String] = []
}

private func jiraTicketBranchResolutionLines(artifacts: [Artifact]) -> JiraTicketBranchResolutionLines {
    var lines = JiraTicketBranchResolutionLines()
    for artifact in artifacts {
        guard let resolution = jiraTicketArtifactResolution(artifact) else { continue }
        let title = jiraTicketFirstLine(artifact.title, fallback: "Output")
        let artifactRef = jiraTicketNonEmpty(artifact.uri).map { " artifact \($0)" } ?? ""
        let branchRef = jiraTicketNonEmpty(resolution.branchURI).map { " via branch \($0)" } ?? ""
        let decision = jiraTicketArtifactResolutionDecisionLine(artifact)
        switch resolution.label {
        case "resolved":
            lines.evidence.append("Branch resolved: \(title)\(artifactRef)\(branchRef).")
            lines.validation.append(decision ?? "Branch review resolved \(title).")
        case "blocked":
            lines.blockers.append(decision ?? "Branch review blocked \(title)\(artifactRef)\(branchRef).")
            lines.nextActions.append("Resolve blocked branch for \(title)\(branchRef) before posting completion.")
        case "needs-follow-up":
            lines.nextActions.append(decision ?? "Follow up on branch review for \(title)\(artifactRef)\(branchRef).")
        default:
            continue
        }
    }
    return lines
}

private func jiraTicketWriteBackLines(artifacts: [Artifact]) -> JiraTicketWriteBackLines {
    var lines = JiraTicketWriteBackLines()
    for artifact in artifacts {
        guard let state = jiraTicketWriteBackState(artifact) else { continue }
        let title = jiraTicketFirstLine(artifact.title, fallback: "Jira write-back")
        let artifactRef = jiraTicketNonEmpty(artifact.uri).map { " artifact \($0)" } ?? ""
        let detail = jiraTicketWriteBackDetailLine(artifact)
        switch state {
        case "posted":
            lines.evidence.append(detail ?? "Jira write-back posted: \(title)\(artifactRef).")
            lines.nextActions.append("Jira write-back already posted; only post another update if new evidence changed.")
        case "failed":
            lines.blockers.append(detail ?? "Jira write-back failed: \(title)\(artifactRef).")
            lines.nextActions.append("Fix Jira write-back failure, then retry or paste the draft manually.")
        default:
            continue
        }
    }
    return lines
}

private func jiraTicketLatestWriteBackArtifact(_ artifacts: [Artifact]) -> Artifact? {
    artifacts
        .filter { jiraTicketWriteBackState($0) != nil }
        .sorted { $0.createdAt > $1.createdAt }
        .first
}

private func jiraTicketSortedWriteBackHistory(_ artifacts: [Artifact]) -> [JiraTicketWriteBackHistoryEntry] {
    artifacts
        .compactMap(jiraTicketWriteBackHistoryEntry(_:))
        .sorted { left, right in
            if left.createdAt != right.createdAt {
                return left.createdAt > right.createdAt
            }
            return left.artifactTitle < right.artifactTitle
        }
}

private func jiraTicketWriteBackHistoryEntry(_ artifact: Artifact) -> JiraTicketWriteBackHistoryEntry? {
    guard let state = jiraTicketWriteBackState(artifact) else { return nil }
    return JiraTicketWriteBackHistoryEntry(
        id: artifact.id,
        state: state,
        label: jiraTicketWriteBackDisplayLabel(state),
        signal: jiraTicketWriteBackSignalLine(artifact),
        artifactTitle: jiraTicketFirstLine(artifact.title, fallback: "Jira write-back"),
        artifactURI: jiraTicketNonEmpty(artifact.uri),
        createdAt: artifact.createdAt,
        isActionable: jiraTicketWriteBackStateNeedsAction(state)
    )
}

private func jiraTicketWriteBackSignalLine(_ artifact: Artifact) -> String {
    if let detail = jiraTicketWriteBackDetailLine(artifact) {
        return detail
    }
    let state = jiraTicketWriteBackState(artifact) ?? "unknown"
    let title = jiraTicketFirstLine(artifact.title, fallback: "Jira write-back")
    let artifactRef = jiraTicketNonEmpty(artifact.uri).map { " artifact \($0)" } ?? ""
    return "Jira write-back \(state): \(title)\(artifactRef)."
}

private func jiraTicketWriteBackDisplayLabel(_ state: String?) -> String {
    guard let state = jiraTicketNonEmpty(state) else { return "None" }
    switch state.lowercased() {
    case "posted":
        return "Posted"
    case "failed":
        return "Failed"
    case "manual-paste", "manual paste", "manual":
        return "Manual paste"
    case "pending":
        return "Pending"
    default:
        return state
    }
}

private func jiraTicketWriteBackStateNeedsAction(_ state: String) -> Bool {
    switch state.lowercased() {
    case "failed", "manual-paste", "manual paste", "manual", "pending":
        return true
    default:
        return false
    }
}

private func jiraTicketArtifactResolution(_ artifact: Artifact) -> (label: String, branchURI: String?)? {
    guard let ref = artifact.sourceRefs.last(where: { $0.kind == "artifact-resolution" }),
          let label = jiraTicketNonEmpty(ref.label) else {
        return nil
    }
    return (label, ref.uri)
}

private func jiraTicketWriteBackState(_ artifact: Artifact) -> String? {
    guard let ref = artifact.sourceRefs.last(where: { $0.kind == "jira-write-back" }),
          let label = jiraTicketNonEmpty(ref.label) else {
        return nil
    }
    return label
}

private func jiraTicketWriteBackDetailLine(_ artifact: Artifact) -> String? {
    let line = artifact.provenance
        .split(whereSeparator: \.isNewline)
        .map(String.init)
        .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
        .last { line in
            line.hasPrefix("Jira write-back:")
                || line.hasPrefix("Jira 写回")
                || line.hasPrefix("Jira写回")
        }
    guard let line else { return nil }
    if line.hasPrefix("Jira write-back:") {
        return line
    }
    return "Jira write-back: \(line)"
}

private func jiraTicketArtifactResolutionDecisionLine(_ artifact: Artifact) -> String? {
    artifact.provenance
        .split(whereSeparator: \.isNewline)
        .map(String.init)
        .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
        .last { $0.hasPrefix("Branch decision:") }
}

private func jiraTicketNextActionLines(
    item: WorkItem,
    summary: JiraTicketEvidenceSummary,
    latestRun: AgentRun?,
    branchResolutionLines: JiraTicketBranchResolutionLines = JiraTicketBranchResolutionLines(),
    writeBackLines: JiraTicketWriteBackLines = JiraTicketWriteBackLines()
) -> [String] {
    if !writeBackLines.nextActions.isEmpty {
        return writeBackLines.nextActions
    }
    if !branchResolutionLines.nextActions.isEmpty {
        return branchResolutionLines.nextActions
    }
    if !summary.pendingCommands.isEmpty {
        return summary.pendingCommands.map { "Run or review: \($0)" }
    }
    if let latestRun, latestRun.state == .failed || latestRun.state == .waitingForUser {
        return ["Resolve the latest run state before posting this ticket as complete."]
    }
    switch item.state {
    case .blocked:
        return ["Resolve the captured blocker, then rerun or update the ticket owner."]
    case .review:
        return ["Review outputs and validation, then post this update or request follow-up."]
    case .done:
        return ["Post the final Jira update only if external write-back has not already happened."]
    case .active:
        return ["Continue implementation from the latest Pikiclaw run and attach new evidence."]
    case .planned, .inbox:
        return ["Start the ticket from Pikiclaw or attach missing source context."]
    case .cancelled, .archived:
        return ["Keep this ticket closed unless Jira is reopened."]
    }
}

private func jiraTicketUpdateSection(_ title: String, _ values: [String]) -> String {
    let lines = values
        .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
        .filter { !$0.isEmpty }
    guard !lines.isEmpty else {
        return "\(title):\n- None captured."
    }
    return ([ "\(title):" ] + lines.map { "- \($0)" }).joined(separator: "\n")
}

private func jiraTicketNonEmpty(_ value: String?) -> String? {
    guard let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines), !trimmed.isEmpty else {
        return nil
    }
    return trimmed
}

private func jiraTicketFirstLine(_ value: String, fallback: String) -> String {
    value
        .split(whereSeparator: \.isNewline)
        .map(String.init)
        .first
        .flatMap(jiraTicketNonEmpty(_:))
        ?? fallback
}

private func appendLine(_ label: String, _ value: String?, to lines: inout [String]) {
    guard let value = value?.trimmingCharacters(in: .whitespacesAndNewlines), !value.isEmpty else { return }
    lines.append("\(label): \(value)")
}

private func appendReferencesSection(_ title: String, refs: [SourceRef], to lines: inout [String]) {
    let values = refs.compactMap(referenceLine(_:))
    guard !values.isEmpty else { return }
    lines.append("")
    lines.append(title)
    lines.append(contentsOf: values)
}

private func referenceLine(_ ref: SourceRef) -> String? {
    let kind = ref.kind.trimmingCharacters(in: .whitespacesAndNewlines)
    let label = ref.label.trimmingCharacters(in: .whitespacesAndNewlines)
    let uri = ref.uri?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    var value = label.isEmpty ? kind : label
    if value.isEmpty {
        value = uri
    } else if !kind.isEmpty, kind.localizedCaseInsensitiveCompare(label) != .orderedSame {
        value = "\(kind): \(value)"
    }
    if !uri.isEmpty, uri != value {
        value += " (\(uri))"
    }
    guard !value.isEmpty else { return nil }
    return "- \(value)"
}

private func jiraTicketPendingCommands(from artifact: Artifact) -> [String] {
    artifact.provenance
        .split(whereSeparator: \.isNewline)
        .compactMap { jiraTicketPendingCommand(from: String($0)) }
}

private func jiraTicketDecisionSignals(from artifact: Artifact) -> [String] {
    artifact.provenance
        .split(whereSeparator: \.isNewline)
        .compactMap { jiraTicketDecisionSignal(from: String($0)) }
}

private func jiraTicketDecisionSignal(from line: String) -> String? {
    let stripped = strippedJiraTicketHeadingPrefix(strippedJiraTicketListPrefix(line))
    guard let (field, body) = jiraTicketLabeledBody(from: stripped),
          let label = jiraTicketDecisionLabel(for: field),
          !body.isEmpty else {
        return nil
    }
    return "\(label): \(compactedJiraTicketEvidenceLine(body))"
}

private func jiraTicketDecisionLabel(for value: String) -> String? {
    let normalized = normalizedJiraTicketField(value)
    switch normalized {
    case "decision":
        return "Decision"
    case "readiness", "merge readiness", "go no go", "go/no go", "go/no-go":
        return "Readiness"
    case "approval", "approve":
        return "Approval"
    case "request changes", "changes requested":
        return "Request changes"
    default:
        return nil
    }
}

private func jiraTicketActionableNotes(from artifact: Artifact) -> [String] {
    var notes: [String] = []
    var activeSectionLabel: String?

    for rawLine in artifact.provenance.split(whereSeparator: \.isNewline).map(String.init) {
        if let (label, body) = jiraTicketActionableField(from: rawLine) {
            if body.isEmpty {
                activeSectionLabel = label
            } else {
                notes.append("\(label): \(compactedJiraTicketEvidenceLine(body))")
                activeSectionLabel = nil
            }
            continue
        }

        guard let sectionLabel = activeSectionLabel else { continue }
        let stripped = strippedJiraTicketHeadingPrefix(strippedJiraTicketListPrefix(rawLine))
        guard !stripped.isEmpty else { continue }
        if jiraTicketLooksLikeListItem(rawLine) {
            notes.append("\(sectionLabel): \(compactedJiraTicketEvidenceLine(stripped))")
        } else {
            activeSectionLabel = nil
        }
    }

    return notes
}

private func jiraTicketActionableField(from line: String) -> (label: String, body: String)? {
    let stripped = strippedJiraTicketHeadingPrefix(strippedJiraTicketListPrefix(line))
    guard let (field, body) = jiraTicketLabeledBody(from: stripped),
          let label = jiraTicketActionableLabel(for: field) else {
        return nil
    }
    return (label, body)
}

private func jiraTicketActionableLabel(for value: String) -> String? {
    switch normalizedJiraTicketField(value) {
    case "blocker", "blockers", "blocked", "blocking", "blocked by":
        return "Blocker"
    case "risk", "risks", "residual risk", "remaining risk":
        return "Risk"
    case "open question", "open questions", "question", "questions":
        return "Open question"
    case "missing input", "missing inputs", "missing info", "missing information":
        return "Missing input"
    case "next", "next action", "next actions", "next step", "next steps", "follow up", "followup", "todo", "to do":
        return "Next action"
    case "validation gap", "verification gap", "test gap":
        return "Validation gap"
    default:
        return nil
    }
}

private func jiraTicketValidationSignals(from artifact: Artifact) -> [String] {
    artifact.provenance
        .split(whereSeparator: \.isNewline)
        .compactMap { jiraTicketValidationSignal(from: String($0)) }
}

private func jiraTicketValidationSignal(from line: String) -> String? {
    let stripped = strippedJiraTicketHeadingPrefix(strippedJiraTicketListPrefix(line))
    let lower = stripped.lowercased()
    let isValidationField: Bool
    if let labeled = jiraTicketLabeledBody(from: stripped) {
        let field = normalizedJiraTicketField(labeled.field)
        isValidationField = field == "validation"
            || field == "validation command"
            || field == "verification"
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

    let result = jiraTicketValidationResult(from: stripped)
    if let command = jiraTicketValidationCommand(from: stripped) {
        if let result {
            return "\(command) (\(result))"
        }
        return isValidationField ? command : nil
    }
    guard let result else { return nil }
    return "\(compactedJiraTicketEvidenceLine(stripped)) (\(result))"
}

private func jiraTicketValidationCommand(from line: String) -> String? {
    let stripped = strippedJiraTicketHeadingPrefix(strippedJiraTicketListPrefix(line))
    let body: String
    if let (field, value) = jiraTicketLabeledBody(from: stripped),
       normalizedJiraTicketField(field) == "validation" {
        body = value
    } else {
        body = stripped
    }
    for candidate in jiraTicketBacktickValues(in: body) + [body] {
        guard let command = jiraTicketValidationCommandValue(candidate) else { continue }
        return command
    }
    return nil
}

private func jiraTicketValidationCommandValue(_ value: String) -> String? {
    var command = value
        .trimmingCharacters(in: .whitespacesAndNewlines)
        .trimmingCharacters(in: CharacterSet(charactersIn: "\"'`"))
    let lower = command.lowercased()
    let resultMarkers = [
        " passed", " pass", " succeeded", " success", " failed", " failure",
        " errored", " timed out", " timeout", " ✅", " ❌"
    ]
    for marker in resultMarkers {
        guard let range = lower.range(of: marker) else { continue }
        command = String(command[..<range.lowerBound]).trimmingCharacters(in: .whitespacesAndNewlines)
        break
    }
    command = command.trimmingCharacters(in: CharacterSet(charactersIn: "`.,;"))
    guard !command.isEmpty,
          jiraTicketLooksLikeShellCommand(command) else {
        return nil
    }
    return command
}

private func jiraTicketValidationResult(from line: String) -> String? {
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

private func jiraTicketPendingCommand(from line: String) -> String? {
    let stripped = strippedJiraTicketListPrefix(line)
    let body: String?
    if stripped.hasPrefix("$ ") || stripped.hasPrefix("❯ ") {
        body = String(stripped.dropFirst(2))
    } else {
        body = jiraTicketPendingCommandBody(from: stripped)
    }
    guard let body else { return nil }
    let candidates = jiraTicketBacktickValues(in: body) + [body]
    for candidate in candidates {
        guard let command = jiraTicketPendingCommandValue(candidate) else { continue }
        return command
    }
    return nil
}

private func jiraTicketPendingCommandBody(from line: String) -> String? {
    for separator in [":", "："] {
        guard let range = line.range(of: separator) else { continue }
        let field = String(line[..<range.lowerBound])
        guard jiraTicketPendingCommandLabel(for: field) != nil else { continue }
        let body = String(line[range.upperBound...]).trimmingCharacters(in: .whitespacesAndNewlines)
        return body.isEmpty ? nil : body
    }
    return nil
}

private func jiraTicketPendingCommandLabel(for value: String) -> String? {
    let normalized = value
        .trimmingCharacters(in: .whitespacesAndNewlines)
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

private func jiraTicketPendingCommandValue(_ value: String) -> String? {
    var command = value
        .trimmingCharacters(in: .whitespacesAndNewlines)
        .trimmingCharacters(in: CharacterSet(charactersIn: "\"'`"))
    while let scalar = command.unicodeScalars.last,
          jiraTicketPendingCommandTrailingCharacters.contains(scalar) {
        command = String(command.dropLast()).trimmingCharacters(in: .whitespacesAndNewlines)
    }
    guard !command.isEmpty,
          jiraTicketLooksLikeShellCommand(command) else {
        return nil
    }
    return command
}

private func strippedJiraTicketListPrefix(_ value: String) -> String {
    var text = value.trimmingCharacters(in: .whitespacesAndNewlines)
    let prefixes = ["- ", "* ", "• ", "> "]
    var stripped = true
    while stripped {
        stripped = false
        for prefix in prefixes where text.hasPrefix(prefix) {
            text = String(text.dropFirst(prefix.count)).trimmingCharacters(in: .whitespacesAndNewlines)
            stripped = true
        }
    }
    return text
}

private func strippedJiraTicketHeadingPrefix(_ value: String) -> String {
    var text = value.trimmingCharacters(in: .whitespacesAndNewlines)
    while text.hasPrefix("#") {
        text = String(text.dropFirst()).trimmingCharacters(in: .whitespacesAndNewlines)
    }
    return text
}

private func jiraTicketLooksLikeListItem(_ value: String) -> Bool {
    let text = value.trimmingCharacters(in: .whitespacesAndNewlines)
    return text.hasPrefix("- ") || text.hasPrefix("* ") || text.hasPrefix("• ")
}

private func jiraTicketLabeledBody(from line: String) -> (field: String, body: String)? {
    for separator in [":", "："] {
        guard let range = line.range(of: separator) else { continue }
        let field = String(line[..<range.lowerBound])
        let body = String(line[range.upperBound...]).trimmingCharacters(in: .whitespacesAndNewlines)
        return (field, body)
    }
    return nil
}

private func normalizedJiraTicketField(_ value: String) -> String {
    value
        .trimmingCharacters(in: .whitespacesAndNewlines)
        .lowercased()
        .replacingOccurrences(of: "_", with: " ")
        .replacingOccurrences(of: "-", with: " ")
        .replacingOccurrences(of: "  ", with: " ")
}

private func compactedJiraTicketEvidenceLine(_ value: String) -> String {
    let compacted = value.trimmingCharacters(in: .whitespacesAndNewlines)
        .replacingOccurrences(of: "\n", with: " ")
    let maxLength = 160
    return compacted.count > maxLength ? "\(compacted.prefix(maxLength))..." : compacted
}

private func jiraTicketBacktickValues(in value: String) -> [String] {
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

private func jiraTicketLooksLikeShellCommand(_ command: String) -> Bool {
    guard let executable = jiraTicketCommandExecutableToken(command) else {
        return false
    }
    if executable.hasPrefix("./") || executable.hasPrefix("../") {
        return true
    }
    return jiraTicketCommandExecutables.contains(executable.lowercased())
}

private func jiraTicketCommandExecutableToken(_ command: String) -> String? {
    for token in command.split(whereSeparator: { $0.isWhitespace || $0.isNewline }) {
        let value = String(token).trimmingCharacters(in: CharacterSet(charactersIn: ";"))
        guard !value.isEmpty else { continue }
        if jiraTicketLooksLikeEnvironmentAssignment(value) {
            continue
        }
        return value
    }
    return nil
}

private func jiraTicketLooksLikeEnvironmentAssignment(_ value: String) -> Bool {
    guard let equals = value.firstIndex(of: "=") else { return false }
    let key = value[..<equals]
    guard !key.isEmpty else { return false }
    return key.allSatisfy { character in
        character == "_" || character.isLetter || character.isNumber
    }
}

private func dedupedJiraTicketContextValues(_ values: [String]) -> [String] {
    var seen = Set<String>()
    var out: [String] = []
    for value in values {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, !seen.contains(trimmed) else { continue }
        seen.insert(trimmed)
        out.append(trimmed)
    }
    return out
}

private let jiraTicketPendingCommandTrailingCharacters = CharacterSet(charactersIn: ".,;)]}")

private let jiraTicketCommandExecutables: Set<String> = [
    "cd", "codex", "claude", "curl", "git", "gh", "glab", "jira",
    "just", "make", "mycr", "node", "npm", "npx", "pnpm", "python",
    "python3", "pytest", "rg", "swift", "uv", "xcodebuild", "yarn",
    "bun"
]

private func jiraTicketQueuePrecedes(_ left: WorkItem, _ right: WorkItem) -> Bool {
    let leftBucket = jiraTicketQueueBucket(left)
    let rightBucket = jiraTicketQueueBucket(right)
    if leftBucket != rightBucket { return leftBucket < rightBucket }
    let leftRank = jiraTicketCardRank(left)
    let rightRank = jiraTicketCardRank(right)
    if leftRank != rightRank { return leftRank < rightRank }
    if left.priority != right.priority { return left.priority < right.priority }
    return left.updatedAt > right.updatedAt
}

private func jiraTicketQueueBucket(_ item: WorkItem) -> Int {
    switch item.state {
    case .active, .blocked, .review:
        return 0
    case .planned, .inbox:
        return 1
    case .done, .cancelled, .archived:
        return 2
    }
}

private func jiraTicketCardRank(_ item: WorkItem) -> Int {
    switch item.state {
    case .blocked: return 0
    case .active: return 1
    case .review: return 2
    case .planned: return 3
    case .inbox: return 4
    case .done: return 5
    case .cancelled: return 6
    case .archived: return 7
    }
}
