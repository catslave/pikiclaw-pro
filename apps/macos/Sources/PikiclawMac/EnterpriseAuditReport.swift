import Foundation
import PikiclawCore

enum EnterpriseAuditReportLinkKind: String, Equatable, Sendable {
    case goal
    case handoffEvidence
    case outputReview
    case jiraWriteBack
    case runEvidence
}

struct EnterpriseAuditReportLink: Identifiable, Equatable, Sendable {
    var kind: EnterpriseAuditReportLinkKind
    var label: String
    var uri: String
    var detail: String

    var id: String {
        "\(kind.rawValue):\(uri)"
    }
}

struct EnterpriseAuditReport: Equatable, Sendable {
    var title: String
    var generatedAt: Date
    var evidenceLinks: [EnterpriseAuditReportLink]
    var markdown: String
}

func enterpriseAuditReport(
    snapshot: NativeStoreSnapshot,
    generatedAt: Date = Date(),
    linkLimit: Int = 5
) -> EnterpriseAuditReport {
    let title = "Pikiclaw Enterprise Agent Audit"
    let readinessRows = AgentEnterpriseAlignment.readinessRows(snapshot: snapshot)
    let parityRows = AgentEnterpriseAlignment.parityRows(snapshot: snapshot)
    let summary = AgentEnterpriseAlignment.missionSummary(snapshot: snapshot)
    let links = enterpriseAuditReportLinks(snapshot: snapshot, limit: linkLimit)
    let generatedLabel = enterpriseAuditReportTimestamp(generatedAt)

    var lines: [String] = [
        "# \(title)",
        "",
        "Generated: \(generatedLabel)",
        ""
    ]

    if let summary {
        let goalLink = enterpriseAuditMarkdownLink(
            "Open goal",
            "pikiclaw://work-items/\(summary.workItemId.rawValue)"
        )
        lines.append(contentsOf: [
            "## Goal",
            "",
            "- \(summary.title)",
            "- State: \(summary.state.rawValue)",
            "- Capability coverage: \(summary.coverageLabel)",
            "- Evidence: \(summary.readyArtifactCount)/\(summary.totalArtifactCount) ready",
            "- Next action: \(summary.nextAction)",
            "- Native link: \(goalLink)",
            ""
        ])
    }

    lines.append(contentsOf: [
        "## Readiness",
        ""
    ])
    for row in readinessRows {
        lines.append("- \(row.title): \(row.value) - \(row.detail) Next: \(row.nextAction)")
    }

    lines.append(contentsOf: [
        "",
        "## Parity Gaps",
        ""
    ])
    let gapRows = parityRows.filter { $0.attentionCount > 0 }
    if gapRows.isEmpty {
        lines.append("- No parity gaps in the current native snapshot.")
    } else {
        for row in gapRows.prefix(linkLimit) {
            lines.append("- \(row.key.title): \(row.coverageLabel) - \(row.gapSummary) Next: \(row.nextAction)")
        }
    }

    lines.append(contentsOf: [
        "",
        "## Evidence Links",
        ""
    ])
    if links.isEmpty {
        lines.append("- No native evidence links are available in the current snapshot.")
    } else {
        for group in EnterpriseAuditReportLinkKind.allCasesForReport {
            let groupedLinks = links.filter { $0.kind == group }
            guard !groupedLinks.isEmpty else { continue }
            lines.append("### \(enterpriseAuditReportLinkGroupTitle(group))")
            for link in groupedLinks {
                let detail = link.detail.gitTrimmedForEnterpriseReport
                let suffix = detail.isEmpty ? "" : " - \(detail)"
                lines.append("- \(enterpriseAuditMarkdownLink(link.label, link.uri))\(suffix)")
            }
            lines.append("")
        }
        if lines.last == "" {
            lines.removeLast()
        }
    }

    return EnterpriseAuditReport(
        title: title,
        generatedAt: generatedAt,
        evidenceLinks: links,
        markdown: lines.joined(separator: "\n")
    )
}

private func enterpriseAuditReportLinks(
    snapshot: NativeStoreSnapshot,
    limit: Int
) -> [EnterpriseAuditReportLink] {
    guard limit > 0 else { return [] }
    var links: [EnterpriseAuditReportLink] = []

    if let summary = AgentEnterpriseAlignment.missionSummary(snapshot: snapshot) {
        links.append(EnterpriseAuditReportLink(
            kind: .goal,
            label: "Enterprise parity goal",
            uri: "pikiclaw://work-items/\(summary.workItemId.rawValue)",
            detail: summary.nextAction
        ))
    }

    links.append(contentsOf: missionAgentHandoffTrailItems(snapshot: snapshot, limit: limit).map { item in
        EnterpriseAuditReportLink(
            kind: .handoffEvidence,
            label: "Latest handoff evidence: \(item.title.firstLineForEnterpriseReport("work item"))",
            uri: missionAgentHandoffLatestEvidenceURL(item),
            detail: item.handoffLatestEvidenceIdentityBadge
                ?? item.handoffLatestEvidenceSourceLabel
                ?? item.handoffStateLabel
        )
    })

    let outputTargets = artifactReviewMissionTargets(snapshot: snapshot, limit: limit)
    if !outputTargets.isEmpty {
        links.append(EnterpriseAuditReportLink(
            kind: .outputReview,
            label: "Mission output review",
            uri: nativeMissionOutputReviewURL,
            detail: "\(outputTargets.count) target(s)"
        ))
    }
    links.append(contentsOf: outputTargets.map { target in
        EnterpriseAuditReportLink(
            kind: .outputReview,
            label: "Output review: \(target.title.firstLineForEnterpriseReport("output"))",
            uri: artifactReviewMissionTargetURL(target),
            detail: "\(target.kind.title) - \(target.workItemTitle.firstLineForEnterpriseReport("work item"))"
        )
    })

    links.append(contentsOf: enterpriseAuditJiraWriteBackLinks(snapshot: snapshot, limit: limit))
    links.append(contentsOf: enterpriseAuditRunEvidenceLinks(snapshot: snapshot, limit: limit))

    return enterpriseAuditDedupedLinks(links)
}

private func enterpriseAuditJiraWriteBackLinks(
    snapshot: NativeStoreSnapshot,
    limit: Int
) -> [EnterpriseAuditReportLink] {
    var links: [EnterpriseAuditReportLink] = []
    for item in jiraTicketQueueItems(from: snapshot.workItems).prefix(limit) {
        let artifacts = workItemOutputs(for: item, snapshot: snapshot)
        let entries = jiraTicketWriteBackHistory(artifacts: artifacts, limit: 2)
        let issueKey = item.jira?.key ?? item.title.firstLineForEnterpriseReport(item.id.rawValue)
        for entry in entries {
            links.append(EnterpriseAuditReportLink(
                kind: .jiraWriteBack,
                label: "Jira write-back \(entry.label): \(issueKey)",
                uri: enterpriseAuditNativeJiraWriteBackURL(issueKey: issueKey, artifactURI: entry.artifactURI),
                detail: entry.signal
            ))
        }
    }
    return links
}

private func enterpriseAuditRunEvidenceLinks(
    snapshot: NativeStoreSnapshot,
    limit: Int
) -> [EnterpriseAuditReportLink] {
    let profilesById = Dictionary(uniqueKeysWithValues: snapshot.agentProfiles.map { ($0.id, $0) })
    let focusProfileIds = Set(snapshot.agentProfiles
        .filter { AgentEnterpriseAlignment.focusAgents.contains($0.kind) }
        .map(\.id))
    let workItemsById = Dictionary(uniqueKeysWithValues: snapshot.workItems.map { ($0.id, $0) })

    return snapshot.runs
        .filter { run in
            run.workItemId == AgentEnterpriseAlignment.goalWorkItemId
                || focusProfileIds.contains(run.agentProfileId)
        }
        .sorted {
            enterpriseAuditRunDate($0) > enterpriseAuditRunDate($1)
        }
        .prefix(limit)
        .map { run in
            let agent = profilesById[run.agentProfileId]?.kind.enterpriseLabel ?? "Agent"
            let workItemTitle = run.workItemId.flatMap { workItemsById[$0]?.title.firstLineForEnterpriseReport("work item") } ?? "chat"
            return EnterpriseAuditReportLink(
                kind: .runEvidence,
                label: "Run evidence: \(run.promptSnapshot.firstLineForEnterpriseReport(workItemTitle))",
                uri: "pikiclaw://runs/\(run.id.rawValue)/evidence",
                detail: "\(agent) - \(run.state.rawValue)"
            )
        }
}

private func enterpriseAuditNativeJiraWriteBackURL(issueKey: String, artifactURI: String?) -> String {
    if let artifactURI,
       artifactURI.lowercased().hasPrefix("pikiclaw://") {
        return artifactURI
    }
    return "pikiclaw://jira/\(issueKey)/write-back"
}

private func enterpriseAuditRunDate(_ run: AgentRun) -> Date {
    run.endedAt ?? run.startedAt ?? .distantPast
}

private func enterpriseAuditDedupedLinks(_ links: [EnterpriseAuditReportLink]) -> [EnterpriseAuditReportLink] {
    var seen = Set<String>()
    var output: [EnterpriseAuditReportLink] = []
    for link in links {
        let key = "\(link.kind.rawValue):\(link.uri)"
        guard !seen.contains(key) else { continue }
        seen.insert(key)
        output.append(link)
    }
    return output
}

private func enterpriseAuditMarkdownLink(_ label: String, _ uri: String) -> String {
    "[\(label.replacingOccurrences(of: "]", with: "\\]"))](\(uri))"
}

private func enterpriseAuditReportTimestamp(_ date: Date) -> String {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime]
    return formatter.string(from: date)
}

private func enterpriseAuditReportLinkGroupTitle(_ kind: EnterpriseAuditReportLinkKind) -> String {
    switch kind {
    case .goal: return "Goal"
    case .handoffEvidence: return "Cross-agent handoffs"
    case .outputReview: return "Output review"
    case .jiraWriteBack: return "Jira write-back"
    case .runEvidence: return "Run evidence"
    }
}

private extension EnterpriseAuditReportLinkKind {
    static let allCasesForReport: [EnterpriseAuditReportLinkKind] = [
        .goal,
        .handoffEvidence,
        .outputReview,
        .jiraWriteBack,
        .runEvidence
    ]
}

private extension String {
    var gitTrimmedForEnterpriseReport: String {
        trimmingCharacters(in: .whitespacesAndNewlines)
    }

    func firstLineForEnterpriseReport(_ fallback: String) -> String {
        let first = split(whereSeparator: \.isNewline).first.map(String.init) ?? ""
        let trimmed = first.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? fallback : trimmed
    }
}
