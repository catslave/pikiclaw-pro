import Foundation
import Testing
@testable import PikiclawCore
@testable import PikiclawMac
@testable import PikiclawRunner

@MainActor
@Test func nativeModelSyncsJiraTicketsFromConfiguredFile() async throws {
    let directory = FileManager.default.temporaryDirectory
        .appendingPathComponent("pikiclaw-jira-native-\(UUID().uuidString)", isDirectory: true)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    let ticketsURL = directory.appendingPathComponent("tickets.json")
    let stateURL = directory.appendingPathComponent("state.json")
    let payload = """
    {
      "tickets": [
        {
          "key": "IVAS-1234",
          "title": "Fix ticket startup flow",
          "description": "Start work from a Jira menu.",
          "status": "To Do",
          "assignee": "Michael Yang",
          "priority": "High",
          "sprint": "Sprint 42"
        }
      ]
    }
    """
    try payload.data(using: .utf8)!.write(to: ticketsURL)
    setenv("PIKICLAW_JIRA_TICKETS_FILE", ticketsURL.path, 1)
    defer {
        unsetenv("PIKICLAW_JIRA_TICKETS_FILE")
        try? FileManager.default.removeItem(at: directory)
    }

    let store = JSONNativeStore(fileURL: stateURL, seed: .preview())
    let model = NativeAppModel(store: store)
    await model.reload()

    let selected = await model.syncJiraTickets(scope: .currentSprint)
    let snapshot = try await store.loadSnapshot()

    #expect(selected != nil)
    #expect(snapshot.jiraSync?.status == .succeeded)
    #expect(snapshot.workItems.contains { $0.jira?.key == "IVAS-1234" && $0.sourceType == .jira })
    model.selectedPermissionMode = .readOnly
    #expect(model.stageJiraTicketForChat(
        workItemId: selected,
        userInput: "Prior clue: startup fails after Jira sync."
    ) == selected)
    let workspace = model.snapshot.workspaces.first
    #expect(model.selectedPermissionMode == .askBeforeEdit)
    #expect(model.draftPrompt.contains("Jira: IVAS-1234"))
    #expect(model.draftPrompt.contains("User-provided context:\nPrior clue: startup fails after Jira sync."))
    #expect(model.draftPrompt.contains("Workspace: \(workspace?.name ?? "")"))
    #expect(model.draftPrompt.contains("Path: \(workspace?.pathDisplay ?? "")"))
    #expect(model.draftPrompt.contains("Acceptance Criteria:"))
    #expect(model.draftPrompt.contains("Execution Contract:"))
    #expect(model.draftPrompt.contains("Ticket boundary, Implementation seam, Change plan, Validation, Jira update, and Durable outputs"))
    #expect(model.draftPrompt.contains("paste-ready comment"))
    #expect(model.draftPrompt.contains("Run the implementation or investigation from this Work Item"))
    #expect(model.draftPrompt.contains("implement the smallest safe change"))

    let firstJiraPrompt = model.draftPrompt
    #expect(model.stageJiraTicketForChat(workItemId: selected, userInput: firstJiraPrompt) == selected)
    #expect(model.draftPrompt.contains("User-provided context:\nPrior clue: startup fails after Jira sync."))
    #expect(!model.draftPrompt.contains("User-provided context:\nJira: IVAS-1234"))
}

@Test func jiraFetcherUsesRCJiraReadTokenForMCP() throws {
    let config = JiraTicketFetcher.mcpConfiguration(environment: [
        "RC_JIRA_READ_TOKEN": "jira-token",
        "RC_CONFLUENCE_READ_TOKEN": "confluence-token",
        "PIKICLAW_JIRA_MCP_SERVICE_URL": "https://jira-mcp.example/mcp/"
    ])

    #expect(config?.url == "https://jira-mcp.example/mcp/")
    #expect(config?.headers["jira-read-token"] == "jira-token")
    #expect(config?.headers["confluence-read-token"] == "confluence-token")
}

@Test func jiraFetcherParsesMCPJiraSearchTextResult() throws {
    let result: [String: Any] = [
        "content": [
            [
                "type": "text",
                "text": """
                {
                  "issues": [
                    {
                      "key": "IVAS-4321",
                      "fields": {
                        "summary": "Wire native Jira puller",
                        "description": "Use the existing RC Jira MCP service.",
                        "status": { "name": "In Progress" },
                        "assignee": { "displayName": "Michael Yang" },
                        "priority": { "name": "High" },
                        "issuetype": { "name": "Story" }
                      }
                    }
                  ]
                }
                """
            ]
        ]
    ]

    let data = try JiraTicketFetcher.jiraPayloadData(fromMCPResult: result)
    let tickets = try JiraTicketPayloadParser.decodeTickets(from: data, baseURL: "https://jira.example.com")

    #expect(tickets.count == 1)
    #expect(tickets[0].key == "IVAS-4321")
    #expect(tickets[0].title == "Wire native Jira puller")
    #expect(tickets[0].status == "In Progress")
}


@MainActor
@Test func startingJiraTicketUsesAgentBriefAsRunPrompt() async throws {
    let directory = FileManager.default.temporaryDirectory
        .appendingPathComponent("pikiclaw-jira-start-\(UUID().uuidString)", isDirectory: true)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: directory) }

    let workspace = Workspace(
        id: "workspace-jira-start",
        name: "Jira Start",
        pathDisplay: directory.path,
        trustState: .trusted
    )
    let agent = AgentProfile(
        id: "agent-codex-jira-start",
        kind: .codex,
        displayName: "Codex",
        executableName: "codex",
        isEnabled: true
    )
    let item = WorkItem(
        id: "jira-ivas-7777",
        workspaceId: workspace.id,
        title: "IVAS-7777: Start from menu bar",
        description: "Use native Jira context for immediate agent kickoff.",
        sourceType: .jira,
        sourceRefs: [
            SourceRef(kind: "chat-run", label: "Prior Jira diagnosis", uri: "pikiclaw://runs/run-jira-start-evidence")
        ],
        state: .planned,
        acceptanceCriteria: ["Agent receives a complete ticket brief"],
        jira: JiraWorkItemFields(
            key: "IVAS-7777",
            url: "https://jira.example.com/browse/IVAS-7777",
            status: "To Do",
            priority: "High"
        )
    )
    let artifact = Artifact(
        id: "artifact-jira-start-evidence",
        workspaceId: workspace.id,
        workItemId: item.id,
        runId: "run-jira-start-evidence",
        kind: .commandOutputSummary,
        title: "Prior Jira diagnosis",
        uri: "pikiclaw://runs/run-jira-start-evidence/evidence",
        status: .ready,
        provenance: """
        Captured previous startup-flow analysis.
        Next command: `swift build --product PikiclawMac`
        """,
        createdAt: Date(timeIntervalSince1970: 20)
    )
    let unrelatedArtifact = Artifact(
        id: "artifact-jira-start-unrelated",
        workspaceId: workspace.id,
        workItemId: "other-ticket",
        kind: .commandOutputSummary,
        title: "Unrelated diagnosis",
        uri: "pikiclaw://runs/unrelated/evidence",
        status: .ready,
        provenance: "Should stay out of this ticket prompt.",
        createdAt: Date(timeIntervalSince1970: 30)
    )
    let card = KnowledgeCard(
        id: "knowledge-jira-start",
        scope: .workspace,
        title: "Jira evidence pattern",
        body: "Reuse previous validation notes before changing code.",
        sourceRefs: [
            SourceRef(kind: "jira", label: "IVAS-7777", uri: "https://jira.example.com/browse/IVAS-7777")
        ],
        artifactRefs: [artifact.id],
        tags: ["jira", "evidence"],
        confidence: 0.9,
        createdAt: Date(timeIntervalSince1970: 40),
        updatedAt: Date(timeIntervalSince1970: 40)
    )
    let failedRun = AgentRun(
        id: "run-jira-start-failed",
        workItemId: item.id,
        workspaceId: workspace.id,
        agentProfileId: agent.id,
        permissionMode: .askBeforeEdit,
        state: .failed,
        startedAt: Date(timeIntervalSince1970: 50),
        endedAt: Date(timeIntervalSince1970: 60),
        promptSnapshot: "First attempt to start native Jira work"
    )
    let unrelatedRun = AgentRun(
        id: "run-jira-start-unrelated",
        workItemId: "other-ticket",
        workspaceId: workspace.id,
        agentProfileId: agent.id,
        permissionMode: .askBeforeEdit,
        state: .failed,
        promptSnapshot: "Should not leak into Jira start prompt"
    )
    let seed = NativeAppSeed(
        projects: [],
        workspaces: [workspace],
        workItems: [item],
        runs: [failedRun, unrelatedRun],
        artifacts: [artifact, unrelatedArtifact],
        capabilities: [],
        knowledgeCards: [card],
        automations: [],
        agentProfiles: [agent],
        providerProfiles: []
    )
    let store = JSONNativeStore(fileURL: directory.appendingPathComponent("state.json"), seed: seed)
    let model = NativeAppModel(
        store: store,
        agentAdapterFactory: { descriptor in
            MockAgentAdapter(descriptor: descriptor, output: ["done\n"])
        }
    )
    await model.reload()
    model.selectedPermissionMode = .readOnly

    let runId = try #require(await model.startJiraTicketFromChat(
        workItemId: item.id,
        userInput: "User note: start from the native Jira menu state."
    ))
    let run = try #require((try await store.loadSnapshot()).runs.first(where: { $0.id == runId }))

    #expect(model.selectedPermissionMode == .askBeforeEdit)
    #expect(run.permissionMode == .askBeforeEdit)
    #expect(run.promptSnapshot.contains("Jira: IVAS-7777"))
    #expect(run.promptSnapshot.contains("User-provided context:\nUser note: start from the native Jira menu state."))
    #expect(run.promptSnapshot.contains("Path: \(directory.path)"))
    #expect(run.promptSnapshot.contains("Source References:"))
    #expect(run.promptSnapshot.contains("- chat-run: Prior Jira diagnosis (pikiclaw://runs/run-jira-start-evidence)"))
    #expect(run.promptSnapshot.contains("Acceptance Criteria:"))
    #expect(run.promptSnapshot.contains("Agent receives a complete ticket brief"))
    #expect(run.promptSnapshot.contains("Execution Contract:"))
    #expect(run.promptSnapshot.contains("Ticket boundary, Implementation seam, Change plan, Validation, Jira update, and Durable outputs"))
    #expect(run.promptSnapshot.contains("do not mix in unrelated work items"))
    #expect(run.promptSnapshot.contains("Preserve Artifact refs as Evidence"))
    #expect(run.promptSnapshot.contains("Relevant outputs: commandOutputSummary ready: Prior Jira diagnosis"))
    #expect(run.promptSnapshot.contains("Artifact refs: Prior Jira diagnosis (pikiclaw://runs/run-jira-start-evidence/evidence)"))
    #expect(run.promptSnapshot.contains("Pending commands: swift build --product PikiclawMac"))
    #expect(run.promptSnapshot.contains("Knowledge cards: Jira evidence pattern [jira,evidence]: Reuse previous validation notes before changing code."))
    #expect(run.promptSnapshot.contains("Recent runs: failed run-jira-start-failed: First attempt to start native Jira work"))
    #expect(!run.promptSnapshot.contains("Unrelated diagnosis"))
    #expect(!run.promptSnapshot.contains("Should not leak into Jira start prompt"))
    #expect(run.transcript.contains("done"))
}
