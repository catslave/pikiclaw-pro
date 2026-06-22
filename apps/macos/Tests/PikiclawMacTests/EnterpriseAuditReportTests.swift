import Foundation
import Testing
@testable import PikiclawCore
@testable import PikiclawMac

@Test func enterpriseAuditReportIncludesPreviewNativeEvidenceLinks() throws {
    let snapshot = NativeStoreSnapshot(seed: .preview())
    let report = enterpriseAuditReport(
        snapshot: snapshot,
        generatedAt: Date(timeIntervalSince1970: 0)
    )

    #expect(report.title == "Pikiclaw Enterprise Agent Audit")
    #expect(report.markdown.contains("Generated: 1970-01-01T00:00:00Z"))
    #expect(report.markdown.contains("## Readiness"))
    #expect(report.markdown.contains("## Parity Gaps"))
    #expect(report.markdown.contains("## Evidence Links"))
    #expect(report.evidenceLinks.contains {
        $0.kind == .goal
            && $0.uri == "pikiclaw://work-items/workitem-agent-enterprise-parity-goal"
    })
    #expect(report.evidenceLinks.contains {
        $0.kind == .handoffEvidence
            && $0.uri == "pikiclaw://mission-control/latest-evidence/workitem-agent-handoff-demo"
    })
    #expect(report.evidenceLinks.contains {
        $0.kind == .outputReview
            && $0.uri == nativeMissionOutputReviewURL
    })
    #expect(report.evidenceLinks.contains {
        $0.kind == .outputReview
            && $0.uri == "pikiclaw://artifacts/artifact-enterprise-agent-parity-goal"
    })
    #expect(report.evidenceLinks.contains {
        $0.kind == .runEvidence
            && $0.uri == "pikiclaw://runs/run-handoff-demo-claude/evidence"
    })
    #expect(report.markdown.contains("[Latest handoff evidence: Review cross-agent handoff](pikiclaw://mission-control/latest-evidence/workitem-agent-handoff-demo)"))
    #expect(report.markdown.contains("[Mission output review](pikiclaw://mission-control/output-review)"))
}

@Test func enterpriseAuditReportEmitsNativeJiraWriteBackLinks() throws {
    let workspaceId = EntityID("workspace-report-jira")
    let jiraItemId = EntityID("jira-ivas-7200")
    let workspace = Workspace(
        id: workspaceId,
        name: "Report Jira",
        pathDisplay: "/tmp/report-jira",
        trustState: .trusted
    )
    let goal = AgentEnterpriseAlignment.goalWorkItem(workspaceId: workspaceId)
    let jiraItem = WorkItem(
        id: jiraItemId,
        workspaceId: workspaceId,
        title: "IVAS-7200 Fix write-back audit",
        sourceType: .jira,
        state: .active,
        jira: JiraWorkItemFields(
            key: "IVAS-7200",
            url: "https://jira.example.com/browse/IVAS-7200",
            status: "In Progress"
        )
    )
    let writeBackArtifact = Artifact(
        id: "artifact-report-jira-writeback",
        workspaceId: workspaceId,
        workItemId: jiraItemId,
        kind: .commandOutputSummary,
        title: "Jira write-back failed: IVAS-7200",
        uri: "https://jira.example.com/browse/IVAS-7200",
        status: .failed,
        provenance: "Jira write-back: Failed IVAS-7200; retry or paste the draft manually.",
        createdAt: Date(timeIntervalSince1970: 10),
        sourceRefs: [
            SourceRef(
                kind: "jira-write-back",
                label: "failed",
                uri: "https://jira.example.com/browse/IVAS-7200"
            )
        ]
    )
    let snapshot = NativeStoreSnapshot(
        workspaces: [workspace],
        workItems: [goal, jiraItem],
        artifacts: [writeBackArtifact],
        agentProfiles: [
            AgentProfile(
                id: "agent-codex-report",
                kind: .codex,
                displayName: "Codex",
                executableName: "codex"
            )
        ]
    )

    let report = enterpriseAuditReport(
        snapshot: snapshot,
        generatedAt: Date(timeIntervalSince1970: 0)
    )

    let writeBackLink = try #require(report.evidenceLinks.first {
        $0.kind == .jiraWriteBack
    })
    #expect(writeBackLink.label == "Jira write-back Failed: IVAS-7200")
    #expect(writeBackLink.uri == "pikiclaw://jira/IVAS-7200/write-back")
    #expect(writeBackLink.detail.contains("Failed IVAS-7200"))
    #expect(report.markdown.contains("[Jira write-back Failed: IVAS-7200](pikiclaw://jira/IVAS-7200/write-back)"))
    #expect(!report.markdown.contains("](https://jira.example.com/browse/IVAS-7200)"))
}
