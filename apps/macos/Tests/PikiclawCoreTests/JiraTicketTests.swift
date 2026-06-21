import Foundation
import Testing
@testable import PikiclawCore

@Test func jiraPayloadParserReadsJiraRestIssues() throws {
    let payload = """
    {
      "issues": [
        {
          "key": "IVAS-1234",
          "fields": {
            "summary": "Fix ticket startup flow",
            "description": "Start work from a Jira menu.",
            "status": { "name": "In Progress" },
            "assignee": { "displayName": "Michael Yang" },
            "priority": { "name": "High" },
            "issuetype": { "name": "Story" },
            "updated": "2026-06-20T08:00:00.000+0000"
          }
        }
      ]
    }
    """.data(using: .utf8)!

    let tickets = try JiraTicketPayloadParser.decodeTickets(from: payload, baseURL: "https://jira.example.com")

    #expect(tickets.count == 1)
    #expect(tickets[0].key == "IVAS-1234")
    #expect(tickets[0].title == "Fix ticket startup flow")
    #expect(tickets[0].status == "In Progress")
    #expect(tickets[0].url == "https://jira.example.com/browse/IVAS-1234")
}

@Test func nativeSnapshotAppliesJiraTicketsAsDurableWorkItems() {
    let workspaceId = EntityID("workspace-test")
    let projectId = EntityID("project-test")
    let ticket = JiraTicket(
        key: "IVAS-1234",
        title: "Fix ticket startup flow",
        description: "Start work from a Jira menu.",
        url: "https://jira.example.com/browse/IVAS-1234",
        status: "To Do",
        assignee: "Michael Yang",
        priority: "High",
        issueType: "Story",
        sprint: "Sprint 42"
    )
    var snapshot = NativeStoreSnapshot(workspaces: [
        Workspace(id: workspaceId, name: "Test", pathDisplay: "/tmp/test")
    ])

    let first = snapshot.applyJiraTickets([ticket], workspaceId: workspaceId, projectId: projectId)
    let second = snapshot.applyJiraTickets([ticket], workspaceId: workspaceId, projectId: projectId)

    #expect(first.created == 1)
    #expect(second.created == 0)
    #expect(snapshot.workItems.count == 1)
    #expect(snapshot.workItems[0].sourceType == .jira)
    #expect(snapshot.workItems[0].jira?.key == "IVAS-1234")
    #expect(snapshot.workItems[0].state == .planned)
    #expect(snapshot.workItems[0].externalRefs.first?.uri == "https://jira.example.com/browse/IVAS-1234")
}

@Test func jiraTicketCardCandidatesPrioritizeSelectedAndActionableTickets() {
    let workspaceId = EntityID("workspace-test")
    let selected = WorkItem(
        id: EntityID("jira-selected"),
        workspaceId: workspaceId,
        title: "IVAS-2: Selected",
        sourceType: .jira,
        state: .planned,
        jira: JiraWorkItemFields(key: "IVAS-2")
    )
    let blocked = WorkItem(
        id: EntityID("jira-blocked"),
        workspaceId: workspaceId,
        title: "IVAS-1: Blocked",
        sourceType: .jira,
        state: .blocked,
        jira: JiraWorkItemFields(key: "IVAS-1")
    )
    let done = WorkItem(
        id: EntityID("jira-done"),
        workspaceId: workspaceId,
        title: "IVAS-3: Done",
        sourceType: .jira,
        state: .done,
        jira: JiraWorkItemFields(key: "IVAS-3")
    )

    let candidates = jiraTicketCardCandidates(
        from: [done, blocked, selected],
        selectedWorkItemId: selected.id
    )

    #expect(candidates.map(\.id) == [selected.id, blocked.id])
}

@Test func jiraTicketCardCandidatesPreferHigherPriorityWithinSameState() {
    let workspaceId = EntityID("workspace-test")
    let highPriority = WorkItem(
        id: EntityID("jira-high"),
        workspaceId: workspaceId,
        title: "IVAS-1: High",
        sourceType: .jira,
        state: .planned,
        priority: 1,
        updatedAt: Date(timeIntervalSince1970: 10),
        jira: JiraWorkItemFields(key: "IVAS-1", priority: "High")
    )
    let lowPriority = WorkItem(
        id: EntityID("jira-low"),
        workspaceId: workspaceId,
        title: "IVAS-2: Low",
        sourceType: .jira,
        state: .planned,
        priority: 3,
        updatedAt: Date(timeIntervalSince1970: 20),
        jira: JiraWorkItemFields(key: "IVAS-2", priority: "Low")
    )

    let candidates = jiraTicketCardCandidates(from: [lowPriority, highPriority])

    #expect(candidates.map(\.id) == [highPriority.id, lowPriority.id])
}

@Test func jiraTicketQueueItemsSortsForDailyTriage() {
    let workspaceId = EntityID("workspace-test")
    let manual = WorkItem(
        id: EntityID("manual"),
        workspaceId: workspaceId,
        title: "Manual",
        sourceType: .manualPrompt,
        state: .active
    )
    let active = WorkItem(
        id: EntityID("jira-active"),
        workspaceId: workspaceId,
        title: "IVAS-1: Active",
        sourceType: .jira,
        state: .active,
        priority: 3,
        updatedAt: Date(timeIntervalSince1970: 10),
        jira: JiraWorkItemFields(key: "IVAS-1")
    )
    let blocked = WorkItem(
        id: EntityID("jira-blocked"),
        workspaceId: workspaceId,
        title: "IVAS-2: Blocked",
        sourceType: .jira,
        state: .blocked,
        priority: 2,
        updatedAt: Date(timeIntervalSince1970: 20),
        jira: JiraWorkItemFields(key: "IVAS-2")
    )
    let plannedHigh = WorkItem(
        id: EntityID("jira-planned-high"),
        workspaceId: workspaceId,
        title: "IVAS-3: Planned High",
        sourceType: .jira,
        state: .planned,
        priority: 1,
        updatedAt: Date(timeIntervalSince1970: 30),
        jira: JiraWorkItemFields(key: "IVAS-3")
    )
    let plannedLow = WorkItem(
        id: EntityID("jira-planned-low"),
        workspaceId: workspaceId,
        title: "IVAS-4: Planned Low",
        sourceType: .jira,
        state: .planned,
        priority: 3,
        updatedAt: Date(timeIntervalSince1970: 40),
        jira: JiraWorkItemFields(key: "IVAS-4")
    )

    let items = jiraTicketQueueItems(from: [plannedLow, manual, plannedHigh, active, blocked])

    #expect(items.map(\.id) == [blocked.id, active.id, plannedHigh.id, plannedLow.id])
}

@Test func jiraTicketEvidenceSummaryKeepsRefsAndPendingCommandsVisible() {
    let workspaceId = EntityID("workspace-test")
    let artifacts = [
        Artifact(
            id: EntityID("artifact-ready"),
            workspaceId: workspaceId,
            workItemId: EntityID("jira-1"),
            kind: .commandOutputSummary,
            title: "Prior validation",
            uri: "pikiclaw://runs/run-validation/evidence",
            status: .ready,
            provenance: """
            Captured useful validation context.
            Decision: not ready to close until validation is posted.
            Blockers:
            - waiting for Jira write permission.
            Risk: full app smoke has not run.
            Validation: swift test --filter JiraTicketTests passed
            Next command: `swift test --filter ChatMessageHistoryTests`
            Next command: `swift test --filter ChatMessageHistoryTests`
            """
        ),
        Artifact(
            id: EntityID("artifact-note"),
            workspaceId: workspaceId,
            workItemId: EntityID("jira-1"),
            kind: .obsidianNote,
            title: "Knowledge note",
            uri: "/Users/michael.yang/Documents/Obsidian Vault/repo/pikiclaw/note.md",
            status: .ready,
            provenance: "Suggested command: `PIKICLAW_DEV_FOREGROUND=1 npm run dev`"
        ),
        Artifact(
            id: EntityID("artifact-empty-uri"),
            workspaceId: workspaceId,
            workItemId: EntityID("jira-1"),
            kind: .commandOutputSummary,
            title: "Plain summary",
            uri: "",
            status: .draft,
            provenance: "Next command: inspect this manually"
        )
    ]

    let summary = jiraTicketEvidenceSummary(artifacts: artifacts)

    #expect(summary.outputCount == 3)
    #expect(summary.artifactRefCount == 2)
    #expect(summary.artifactRefsLabel == "2 refs")
    #expect(summary.pendingCommandsLabel == "2 cmds")
    #expect(summary.pendingCommands == [
        "swift test --filter ChatMessageHistoryTests",
        "PIKICLAW_DEV_FOREGROUND=1 npm run dev"
    ])
    #expect(summary.pendingCommandsHelp == "swift test --filter ChatMessageHistoryTests\nPIKICLAW_DEV_FOREGROUND=1 npm run dev")
    #expect(summary.decisionSignals == [
        "Decision: not ready to close until validation is posted."
    ])
    #expect(summary.actionableNotes == [
        "Blocker: waiting for Jira write permission.",
        "Risk: full app smoke has not run."
    ])
    #expect(summary.validationSignals == [
        "swift test --filter JiraTicketTests (passed)"
    ])
    #expect(summary.actionSignalCount == 3)
    #expect(summary.actionSignalsLabel == "3 signals")
    #expect(summary.validationSignalsLabel == "1 check")
    #expect(summary.actionSignalsHelp == """
    Decision: not ready to close until validation is posted.
    Blocker: waiting for Jira write permission.
    Risk: full app smoke has not run.
    """)
    #expect(summary.validationSignalsHelp == "swift test --filter JiraTicketTests (passed)")

    let item = WorkItem(
        id: EntityID("jira-1"),
        workspaceId: workspaceId,
        title: "Ticket with saved evidence",
        sourceType: .jira,
        state: .active
    )
    let unrelated = Artifact(
        id: EntityID("artifact-other-ticket"),
        workspaceId: workspaceId,
        workItemId: EntityID("jira-2"),
        kind: .commandOutputSummary,
        title: "Other ticket output",
        uri: "pikiclaw://runs/other/evidence",
        status: .ready,
        provenance: "Next command: `swift test --filter OtherTicketTests`"
    )
    let snapshot = NativeStoreSnapshot(seed: NativeAppSeed(
        projects: [],
        workspaces: [],
        workItems: [item],
        runs: [],
        artifacts: artifacts + [unrelated],
        capabilities: [],
        knowledgeCards: [],
        automations: [],
        agentProfiles: [],
        providerProfiles: []
    ))
    let scoped = jiraTicketEvidenceSummary(for: item, snapshot: snapshot)

    #expect(scoped.outputCount == 3)
    #expect(scoped.artifactRefCount == 2)
    #expect(scoped.pendingCommands == summary.pendingCommands)
    #expect(scoped.actionableNotes == summary.actionableNotes)
    #expect(scoped.validationSignals == summary.validationSignals)
    #expect(!scoped.pendingCommands.contains("swift test --filter OtherTicketTests"))
}

@Test func jiraTicketAgentBriefIncludesActionableTicketContext() {
    let item = WorkItem(
        id: EntityID("jira-brief"),
        workspaceId: EntityID("workspace-test"),
        title: "Fix native menu kickoff",
        description: "Let the menu bar hand an agent a ready-to-run ticket brief.",
        sourceType: .jira,
        sourceRefs: [
            SourceRef(kind: "chat-run", label: "Prior triage", uri: "pikiclaw://runs/run-source"),
            SourceRef(kind: "obsidian", label: "Validation note")
        ],
        state: .planned,
        acceptanceCriteria: [
            "Brief includes the Jira key",
            "Brief includes validation guidance"
        ],
        externalRefs: [
            SourceRef(kind: "gitlab", label: "Merge Request", uri: "https://gitlab.example.com/pikiclaw/mr/12"),
            SourceRef(kind: "jira", label: "Duplicate Jira", uri: "https://jira.example.com/browse/IVAS-5555")
        ],
        jira: JiraWorkItemFields(
            key: "IVAS-5555",
            url: "https://jira.example.com/browse/IVAS-5555",
            status: "To Do",
            assignee: "Michael Yang",
            priority: "High",
            issueType: "Story",
            sprint: "Sprint 42"
        )
    )

    let workspace = Workspace(
        id: EntityID("workspace-test"),
        name: "pikiclaw",
        pathDisplay: "/Users/michael.yang/Codes/Personal/pikiclaw",
        gitRemote: "git@github.com:multica-ai/pikiclaw.git",
        currentBranch: "codex/mac-native-v2-foundation"
    )

    let brief = jiraTicketAgentBrief(for: item, workspace: workspace)

    #expect(brief.contains("Jira: IVAS-5555"))
    #expect(brief.contains("Title: Fix native menu kickoff"))
    #expect(brief.contains("Workspace: pikiclaw"))
    #expect(brief.contains("Path: /Users/michael.yang/Codes/Personal/pikiclaw"))
    #expect(brief.contains("Branch: codex/mac-native-v2-foundation"))
    #expect(brief.contains("URL: https://jira.example.com/browse/IVAS-5555"))
    #expect(brief.contains("Source References:"))
    #expect(brief.contains("- chat-run: Prior triage (pikiclaw://runs/run-source)"))
    #expect(brief.contains("- obsidian: Validation note"))
    #expect(brief.contains("External References:"))
    #expect(brief.contains("- gitlab: Merge Request (https://gitlab.example.com/pikiclaw/mr/12)"))
    #expect(!brief.contains("Duplicate Jira"))
    #expect(brief.contains("- Brief includes the Jira key"))
    #expect(brief.contains("Execution Contract:"))
    #expect(brief.contains("Ticket boundary, Implementation seam, Change plan, Validation, Jira update, and Durable outputs"))
    #expect(brief.contains("do not mix in unrelated work items"))
    #expect(brief.contains("Preserve Artifact refs as Evidence"))
    #expect(brief.contains("Pending commands as candidate Validation or Next action"))
    #expect(brief.contains("paste-ready comment"))
    #expect(brief.contains("run focused validation"))
}

@Test func jiraTicketUpdateDraftBuildsPasteReadyCommentFromEvidence() {
    let workspace = Workspace(
        id: EntityID("workspace-test"),
        name: "pikiclaw",
        pathDisplay: "/Users/michael.yang/Codes/Personal/pikiclaw"
    )
    let agent = AgentProfile(
        id: EntityID("agent-codex"),
        kind: .codex,
        displayName: "Codex",
        executableName: "codex",
        isEnabled: true
    )
    let item = WorkItem(
        id: EntityID("jira-update"),
        workspaceId: workspace.id,
        title: "Polish native Jira queue",
        sourceType: .jira,
        state: .review,
        jira: JiraWorkItemFields(
            key: "IVAS-7000",
            url: "https://jira.example.com/browse/IVAS-7000",
            status: "In Review"
        )
    )
    let run = AgentRun(
        id: EntityID("run-jira-update"),
        workItemId: item.id,
        workspaceId: workspace.id,
        agentProfileId: agent.id,
        state: .completed,
        startedAt: Date(timeIntervalSince1970: 10),
        endedAt: Date(timeIntervalSince1970: 20),
        promptSnapshot: "Work on IVAS-7000"
    )
    let artifact = Artifact(
        id: EntityID("artifact-jira-update"),
        workspaceId: workspace.id,
        workItemId: item.id,
        runId: run.id,
        kind: .commandOutputSummary,
        title: "Focused validation",
        uri: "pikiclaw://runs/run-jira-update/evidence",
        status: .ready,
        provenance: """
        Decision: ready for review after focused validation.
        Validation: `swift test --filter JiraTicketTests` passed
        Blocker: waiting for Jira write permission.
        Next command: `swift build --product PikiclawMac`
        """
    )
    let snapshot = NativeStoreSnapshot(seed: NativeAppSeed(
        projects: [],
        workspaces: [workspace],
        workItems: [item],
        runs: [run],
        artifacts: [artifact],
        capabilities: [],
        knowledgeCards: [],
        automations: [],
        agentProfiles: [agent],
        providerProfiles: []
    ))

    let draft = jiraTicketUpdateDraft(for: item, snapshot: snapshot)

    #expect(draft.title == "IVAS-7000 update")
    #expect(draft.statusLines.contains("IVAS-7000: Polish native Jira queue"))
    #expect(draft.statusLines.contains("Pikiclaw state: review"))
    #expect(draft.statusLines.contains("Jira status: In Review"))
    #expect(draft.statusLines.contains("Latest run: completed via Codex (run-jira-update)"))
    #expect(draft.statusLines.contains("Decision: ready for review after focused validation."))
    #expect(draft.evidenceLines.contains("1 output captured; 1 ref linked."))
    #expect(draft.evidenceLines.contains("Focused validation: pikiclaw://runs/run-jira-update/evidence"))
    #expect(draft.validationLines == ["swift test --filter JiraTicketTests (passed)"])
    #expect(draft.blockerLines == ["Blocker: waiting for Jira write permission."])
    #expect(draft.nextActionLines == ["Run or review: swift build --product PikiclawMac"])
    #expect(draft.comment.contains("Status:\n- IVAS-7000: Polish native Jira queue"))
    #expect(draft.comment.contains("Evidence:\n- 1 output captured; 1 ref linked."))
    #expect(draft.comment.contains("Validation:\n- swift test --filter JiraTicketTests (passed)"))
    #expect(draft.comment.contains("Blockers:\n- Blocker: waiting for Jira write permission."))
    #expect(draft.comment.contains("Next action:\n- Run or review: swift build --product PikiclawMac"))
}

@Test func jiraTicketMatchesQueryCoversOperationalFields() {
    let item = WorkItem(
        id: EntityID("jira-search"),
        workspaceId: EntityID("workspace-test"),
        title: "IVAS-6000: Polish Jira queue",
        description: "Make native filtering useful during triage.",
        sourceType: .jira,
        sourceRefs: [
            SourceRef(kind: "chat-run", label: "Agent silence triage", uri: "pikiclaw://runs/run-silence")
        ],
        externalRefs: [
            SourceRef(kind: "gitlab", label: "Merge Request", uri: "https://gitlab.example.com/pikiclaw/mr/6000")
        ],
        jira: JiraWorkItemFields(
            key: "IVAS-6000",
            url: "https://jira.example.com/browse/IVAS-6000",
            status: "In Progress",
            assignee: "Michael Yang",
            priority: "High",
            issueType: "Story",
            sprint: "Sprint 42"
        )
    )

    #expect(jiraTicketMatchesQuery(item, query: "high"))
    #expect(jiraTicketMatchesQuery(item, query: "story"))
    #expect(jiraTicketMatchesQuery(item, query: "browse/IVAS-6000"))
    #expect(jiraTicketMatchesQuery(item, query: "triage"))
    #expect(jiraTicketMatchesQuery(item, query: "high story michael"))
    #expect(jiraTicketMatchesQuery(item, query: "merge 6000"))
    #expect(jiraTicketMatchesQuery(item, query: "gitlab"))
    #expect(jiraTicketMatchesQuery(item, query: "silence"))
    #expect(jiraTicketMatchesQuery(item, query: "run-silence"))
    #expect(!jiraTicketMatchesQuery(item, query: "release blocker"))
    #expect(!jiraTicketMatchesQuery(item, query: "high blocker"))
}
