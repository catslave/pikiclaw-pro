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
    #expect(model.draftPrompt.contains("Solution Output checkpoint"))
    #expect(model.draftPrompt.contains("Ticket boundary, Implementation seam, Change plan, Validation plan, Jira update draft, and Durable outputs"))
    #expect(model.draftPrompt.contains("paste-ready comment"))
    #expect(model.draftPrompt.contains("Run the implementation or investigation from this Work Item"))
    #expect(model.draftPrompt.contains("Coding starts only from the follow-up Coding action"))

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

@Test func jiraFetcherReadsPrivateTokenFileDeclaredByWorkspaceSkill() throws {
    let directory = FileManager.default.temporaryDirectory
        .appendingPathComponent("pikiclaw-jira-skill-\(UUID().uuidString)", isDirectory: true)
    let skillDirectory = directory.appendingPathComponent(".pikiclaw/skills/jira", isDirectory: true)
    let localDirectory = directory.appendingPathComponent(".pikiclaw/local", isDirectory: true)
    try FileManager.default.createDirectory(at: skillDirectory, withIntermediateDirectories: true)
    try FileManager.default.createDirectory(at: localDirectory, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: directory) }

    let skill = """
    # Jira Sync

    - `PIKICLAW_JIRA_ENV_FILE`: `.pikiclaw/local/jira.env`
    - `PIKICLAW_JIRA_ASSIGNEE`: `Michael Yang`
    """
    let privateEnvironment = """
    RC_JIRA_READ_TOKEN=skill-token
    RC_CONFLUENCE_READ_TOKEN=confluence-skill-token
    """
    try skill.data(using: .utf8)!.write(to: skillDirectory.appendingPathComponent("SKILL.md"))
    try privateEnvironment.data(using: .utf8)!.write(to: localDirectory.appendingPathComponent("jira.env"))

    let environment = JiraTicketFetcher.jiraEnvironment(
        base: ["RC_JIRA_READ_TOKEN": "session-token"],
        workspacePath: directory.path,
        loadShellEnvironment: false
    )
    let config = JiraTicketFetcher.mcpConfiguration(environment: environment)

    #expect(environment["RC_JIRA_READ_TOKEN"] == "skill-token")
    #expect(environment["RC_CONFLUENCE_READ_TOKEN"] == "confluence-skill-token")
    #expect(environment["PIKICLAW_JIRA_ASSIGNEE"] == "Michael Yang")
    #expect(config?.headers["jira-read-token"] == "skill-token")
    #expect(config?.headers["confluence-read-token"] == "confluence-skill-token")
}

@Test func jiraFetcherReadsPermanentTicketDirectlyFromWorkspaceSkill() throws {
    let directory = FileManager.default.temporaryDirectory
        .appendingPathComponent("pikiclaw-jira-raw-skill-\(UUID().uuidString)", isDirectory: true)
    let skillDirectory = directory.appendingPathComponent(".pikiclaw/skills/jira", isDirectory: true)
    let localDirectory = directory.appendingPathComponent(".pikiclaw/local", isDirectory: true)
    try FileManager.default.createDirectory(at: skillDirectory, withIntermediateDirectories: true)
    try FileManager.default.createDirectory(at: localDirectory, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: directory) }

    let skill = """
    # Jira Sync

    - `RC_JIRA_READ_TOKEN`: `skill-token`
    - `RC_CONFLUENCE_READ_TOKEN`: `confluence-skill-token`
    - `PIKICLAW_JIRA_ENV_FILE`: `.pikiclaw/local/jira.env`
    """
    let privateEnvironment = """
    RC_JIRA_READ_TOKEN=local-file-token
    RC_CONFLUENCE_READ_TOKEN=confluence-local-file-token
    PIKICLAW_JIRA_API_VERSION=3
    """
    try skill.data(using: .utf8)!.write(to: skillDirectory.appendingPathComponent("SKILL.md"))
    try privateEnvironment.data(using: .utf8)!.write(to: localDirectory.appendingPathComponent("jira.env"))

    let environment = JiraTicketFetcher.jiraEnvironment(
        base: ["RC_JIRA_READ_TOKEN": "session-token"],
        workspacePath: directory.path,
        loadShellEnvironment: false
    )

    let config = JiraTicketFetcher.mcpConfiguration(environment: environment)

    #expect(environment["RC_JIRA_READ_TOKEN"] == "skill-token")
    #expect(environment["RC_CONFLUENCE_READ_TOKEN"] == "confluence-skill-token")
    #expect(environment["PIKICLAW_JIRA_API_VERSION"] == "3")
    #expect(config?.headers["jira-read-token"] == "skill-token")
    #expect(config?.headers["confluence-read-token"] == "confluence-skill-token")
}

@Test func jiraFetcherDefaultsJQLToMichaelYangInsteadOfCurrentUser() throws {
    let currentSprint = JiraTicketFetcher.jql(for: .currentSprint, environment: [:])
    let mine = JiraTicketFetcher.jql(for: .mine, environment: [:])
    let override = JiraTicketFetcher.jql(for: .currentSprint, environment: [
        "PIKICLAW_JIRA_ASSIGNEE": "Another User"
    ])

    #expect(currentSprint.contains("assignee = \"Michael Yang\""))
    #expect(currentSprint.contains("sprint in openSprints()"))
    #expect(mine.contains("assignee = \"Michael Yang\""))
    #expect(override.contains("assignee = \"Another User\""))
    #expect(!currentSprint.contains("currentUser()"))
}

@Test func jiraFetcherBuildsJiraCommentWriteBackRequestWithWriteToken() throws {
    let request = try JiraTicketFetcher.jiraCommentRequest(
        issueKey: " IVAS-7200 ",
        comment: "  Reviewed update  ",
        environment: [
            "PIKICLAW_JIRA_BASE_URL": "https://jira.example.com/",
            "PIKICLAW_JIRA_API_VERSION": "3",
            "PIKICLAW_JIRA_WRITE_TOKEN": "write-token",
            "PIKICLAW_JIRA_API_TOKEN": "generic-token",
            "PIKICLAW_JIRA_WRITE_EMAIL": "writer@example.com"
        ]
    )
    let bodyData = try #require(request.httpBody)
    let body = try #require(JSONSerialization.jsonObject(with: bodyData) as? [String: String])
    let credential = Data("writer@example.com:write-token".utf8).base64EncodedString()

    #expect(request.url?.absoluteString == "https://jira.example.com/rest/api/3/issue/IVAS-7200/comment")
    #expect(request.httpMethod == "POST")
    #expect(request.value(forHTTPHeaderField: "Authorization") == "Basic \(credential)")
    #expect(body["body"] == "Reviewed update")
}

@Test func jiraFetcherReportsWriteBackReadinessWithoutLeakingTokens() throws {
    let missing = JiraTicketFetcher.writeBackReadiness(environment: [
        "RC_JIRA_READ_TOKEN": "read-token"
    ])
    let invalid = JiraTicketFetcher.writeBackReadiness(environment: [
        "PIKICLAW_JIRA_BASE_URL": "://bad url",
        "PIKICLAW_JIRA_WRITE_TOKEN": "write-token"
    ])
    let ready = JiraTicketFetcher.writeBackReadiness(environment: [
        "PIKICLAW_JIRA_BASE_URL": "https://jira.example.com",
        "PIKICLAW_JIRA_WRITE_TOKEN": "write-token"
    ])

    #expect(missing.state == .missingConfiguration)
    #expect(missing.missingItems == ["Jira base URL", "write-capable token"])
    #expect(missing.detail.contains("read-token") == false)
    #expect(invalid.state == .invalidBaseURL)
    #expect(invalid.detail.contains("write-token") == false)
    #expect(ready.state == .ready)
    #expect(ready.isReady)
    #expect(ready.detail.contains("write-token") == false)
}

@Test func jiraFetcherBuildsWorkspaceScopedWriteBackSetupGuide() throws {
    let directory = FileManager.default.temporaryDirectory
        .appendingPathComponent("pikiclaw-jira-writeback-guide-\(UUID().uuidString)", isDirectory: true)
    let skillDirectory = directory.appendingPathComponent(".pikiclaw/skills/jira", isDirectory: true)
    let privateDirectory = directory.appendingPathComponent(".pikiclaw/private", isDirectory: true)
    try FileManager.default.createDirectory(at: skillDirectory, withIntermediateDirectories: true)
    try FileManager.default.createDirectory(at: privateDirectory, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: directory) }

    let skill = """
    # Jira Sync

    - `PIKICLAW_JIRA_ENV_FILE`: `.pikiclaw/private/jira-write.env`
    """
    try skill.data(using: .utf8)!.write(to: skillDirectory.appendingPathComponent("SKILL.md"))

    let readiness = JiraTicketFetcher.writeBackReadiness(environment: [
        "RC_JIRA_READ_TOKEN": "read-token"
    ])
    let guide = JiraTicketFetcher.writeBackSetupGuide(
        workspacePath: directory.path,
        readiness: readiness
    )

    #expect(guide.envFilePath == directory.appendingPathComponent(".pikiclaw/private/jira-write.env").path)
    #expect(guide.envDirectoryPath == privateDirectory.path)
    #expect(guide.revealDirectoryPath == privateDirectory.path)
    #expect(guide.envDirectoryExists)
    #expect(!guide.envFileExists)
    #expect(guide.missingItems == ["Jira base URL", "write-capable token"])
    #expect(guide.summary.contains("Jira base URL"))
    #expect(guide.summary.contains("write-capable token"))
    #expect(guide.summary.contains("read-token") == false)
    #expect(guide.template.contains("PIKICLAW_JIRA_BASE_URL="))
    #expect(guide.template.contains("PIKICLAW_JIRA_WRITE_TOKEN="))
    #expect(guide.template.contains("read-token") == false)
    #expect(guide.template.contains("write-token") == false)
}

@Test func jiraFetcherSetupGuideRevealsNearestExistingDirectoryWithoutCreatingPrivateFolder() throws {
    let directory = FileManager.default.temporaryDirectory
        .appendingPathComponent("pikiclaw-jira-writeback-reveal-\(UUID().uuidString)", isDirectory: true)
    let skillDirectory = directory.appendingPathComponent(".pikiclaw/skills/jira", isDirectory: true)
    let pikiclawDirectory = directory.appendingPathComponent(".pikiclaw", isDirectory: true)
    let privateDirectory = directory.appendingPathComponent(".pikiclaw/private", isDirectory: true)
    try FileManager.default.createDirectory(at: skillDirectory, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: directory) }

    let skill = """
    # Jira Sync

    - `PIKICLAW_JIRA_ENV_FILE`: `.pikiclaw/private/jira-write.env`
    """
    try skill.data(using: .utf8)!.write(to: skillDirectory.appendingPathComponent("SKILL.md"))

    let guide = JiraTicketFetcher.writeBackSetupGuide(
        workspacePath: directory.path,
        readiness: JiraTicketFetcher.writeBackReadiness(environment: [:])
    )

    #expect(guide.envFilePath == privateDirectory.appendingPathComponent("jira-write.env").path)
    #expect(guide.envDirectoryPath == privateDirectory.path)
    #expect(guide.revealDirectoryPath == pikiclawDirectory.path)
    #expect(!guide.envDirectoryExists)
    #expect(!guide.envFileExists)
    #expect(!FileManager.default.fileExists(atPath: privateDirectory.path))
    #expect(guide.template.contains("PIKICLAW_JIRA_WRITE_TOKEN="))
    #expect(guide.template.contains("read-token") == false)
    #expect(guide.template.contains("write-token") == false)
}

@Test func jiraFetcherDoesNotUseReadTokenForWriteBack() throws {
    do {
        _ = try JiraTicketFetcher.jiraCommentRequest(
            issueKey: "IVAS-7200",
            comment: "Reviewed update",
            environment: [
                "PIKICLAW_JIRA_BASE_URL": "https://jira.example.com",
                "RC_JIRA_READ_TOKEN": "read-token"
            ]
        )
        Issue.record("Expected Jira write-back request to require a write-capable token.")
    } catch JiraTicketFetchError.missingToken {
        return
    } catch {
        Issue.record("Expected missingToken, got \(error).")
    }
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
    let launchDirectory = directory.appendingPathComponent("actual-workspace", isDirectory: true)
    try FileManager.default.createDirectory(at: launchDirectory, withIntermediateDirectories: true)
    let launchWorkspace = Workspace(
        id: "workspace-jira-start-override",
        name: "Jira Start Override",
        pathDisplay: launchDirectory.path,
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
        Decision: not ready to start until saved validation is reviewed.
        Blockers:
        - waiting for Jira write permission.
        Risk: app-wide smoke has not run.
        Validation: swift test --filter JiraNativeWorkflowTests passed
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
        workspaces: [workspace, launchWorkspace],
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
        userInput: "User note: start from the native Jira menu state.",
        workspaceId: launchWorkspace.id
    ))
    let updatedSnapshot = try await store.loadSnapshot()
    let run = try #require(updatedSnapshot.runs.first(where: { $0.id == runId }))
    let updatedItem = try #require(updatedSnapshot.workItems.first(where: { $0.id == item.id }))

    #expect(model.selectedPermissionMode == .askBeforeEdit)
    #expect(run.permissionMode == .askBeforeEdit)
    #expect(run.workspaceId == launchWorkspace.id)
    #expect(updatedItem.workspaceId == launchWorkspace.id)
    #expect(run.promptSnapshot.contains("Jira: IVAS-7777"))
    #expect(run.promptSnapshot.contains("User-provided context:\nUser note: start from the native Jira menu state."))
    #expect(run.promptSnapshot.contains("Path: \(launchDirectory.path)"))
    #expect(run.promptSnapshot.contains("Source References:"))
    #expect(run.promptSnapshot.contains("- chat-run: Prior Jira diagnosis (pikiclaw://runs/run-jira-start-evidence)"))
    #expect(run.promptSnapshot.contains("Acceptance Criteria:"))
    #expect(run.promptSnapshot.contains("Agent receives a complete ticket brief"))
    #expect(run.promptSnapshot.contains("Execution Contract:"))
    #expect(run.promptSnapshot.contains("Solution Output checkpoint"))
    #expect(run.promptSnapshot.contains("Ticket boundary, Implementation seam, Change plan, Validation plan, Jira update draft, and Durable outputs"))
    #expect(run.promptSnapshot.contains("do not mix in unrelated work items"))
    #expect(run.promptSnapshot.contains("Preserve Artifact refs as Evidence"))
    #expect(run.promptSnapshot.contains("Relevant outputs: commandOutputSummary ready: Prior Jira diagnosis"))
    #expect(run.promptSnapshot.contains("Decision signals: Decision: not ready to start until saved validation is reviewed."))
    #expect(run.promptSnapshot.contains("Actionable notes: Blocker: waiting for Jira write permission.; Risk: app-wide smoke has not run."))
    #expect(run.promptSnapshot.contains("Validation evidence: swift test --filter JiraNativeWorkflowTests (passed)"))
    #expect(run.promptSnapshot.contains("Artifact refs: Prior Jira diagnosis (pikiclaw://runs/run-jira-start-evidence/evidence)"))
    #expect(run.promptSnapshot.contains("Pending commands: swift build --product PikiclawMac"))
    #expect(run.promptSnapshot.contains("Knowledge cards: Jira evidence pattern [jira,evidence]: Reuse previous validation notes before changing code."))
    #expect(run.promptSnapshot.contains("Recent runs: failed run-jira-start-failed: First attempt to start native Jira work"))
    #expect(!run.promptSnapshot.contains("Unrelated diagnosis"))
    #expect(!run.promptSnapshot.contains("Should not leak into Jira start prompt"))
    #expect(run.transcript.contains("done"))
}

@MainActor
@Test func jiraWriteBackRequiresApprovalBeforePosting() async throws {
    let directory = FileManager.default.temporaryDirectory
        .appendingPathComponent("pikiclaw-jira-writeback-\(UUID().uuidString)", isDirectory: true)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: directory) }

    let workspace = Workspace(
        id: "workspace-jira-writeback",
        name: "Jira Writeback",
        pathDisplay: directory.path,
        trustState: .trusted
    )
    let item = WorkItem(
        id: "jira-writeback-item",
        workspaceId: workspace.id,
        title: "IVAS-7200: Post reviewed update",
        sourceType: .jira,
        state: .review,
        jira: JiraWorkItemFields(
            key: "IVAS-7200",
            url: "https://jira.example.com/browse/IVAS-7200",
            status: "In Review"
        )
    )
    let seed = NativeAppSeed(
        projects: [],
        workspaces: [workspace],
        workItems: [item],
        runs: [],
        artifacts: [],
        capabilities: [],
        knowledgeCards: [],
        automations: [],
        agentProfiles: [],
        providerProfiles: []
    )
    let store = JSONNativeStore(fileURL: directory.appendingPathComponent("state.json"), seed: seed)
    let model = NativeAppModel(store: store)
    await model.reload()

    model.selectedPermissionMode = .readOnly
    let denied = try #require(model.jiraWriteBackPlan(workItemId: item.id))
    #expect(denied.gate == .denied)
    #expect(denied.permissionDecision == .deny)

    model.selectedPermissionMode = .askBeforeEdit
    let staged = try #require(model.jiraWriteBackPlan(workItemId: item.id))
    #expect(staged.gate == .requiresApproval)
    #expect(staged.requiresExplicitApproval)

    let posted = await model.postJiraWriteBack(workItemId: item.id, approved: false)
    let snapshot = try await store.loadSnapshot()

    #expect(!posted)
    #expect(snapshot.auditEvents.isEmpty)
    #expect(model.statusLine == "Jira write-back needs explicit approval")
    #expect(!model.jiraWriteBackIsPosting)

    let localConfig = directory.appendingPathComponent(".pikiclaw/local", isDirectory: true)
    try FileManager.default.createDirectory(at: localConfig, withIntermediateDirectories: true)
    try """
    PIKICLAW_JIRA_BASE_URL=://bad url
    PIKICLAW_JIRA_WRITE_TOKEN=write-token
    PIKICLAW_JIRA_WRITE_EMAIL=writer@example.com
    """.write(to: localConfig.appendingPathComponent("jira.env"), atomically: true, encoding: .utf8)

    let failed = await model.postJiraWriteBack(workItemId: item.id, approved: true)
    let failedSnapshot = try await store.loadSnapshot()
    let failureArtifact = try #require(failedSnapshot.artifacts.first { artifact in
        artifact.sourceRefs.contains(SourceRef(kind: "jira-write-back", label: "failed", uri: "https://jira.example.com/browse/IVAS-7200"))
    })

    #expect(!failed)
    #expect(failureArtifact.title == "Jira write-back failed: IVAS-7200")
    #expect(failureArtifact.status == .failed)
    #expect(failureArtifact.provenance.contains("Jira write-back: Failed IVAS-7200"))
    #expect(failedSnapshot.auditEvents.contains { $0.summary.contains("Jira write-back failed for IVAS-7200") })
    #expect(model.statusLine.contains("Jira write-back failed"))
    #expect(!model.jiraWriteBackIsPosting)
}
