import Foundation

public struct NativeAppSeed: Sendable {
    public var projects: [Project]
    public var workspaces: [Workspace]
    public var workItems: [WorkItem]
    public var runs: [AgentRun]
    public var artifacts: [Artifact]
    public var capabilities: [Capability]
    public var knowledgeCards: [KnowledgeCard]
    public var automations: [Automation]
    public var agentProfiles: [AgentProfile]
    public var providerProfiles: [ProviderProfile]
    public var auditEvents: [AuditEvent]

    public init(
        projects: [Project],
        workspaces: [Workspace],
        workItems: [WorkItem],
        runs: [AgentRun],
        artifacts: [Artifact],
        capabilities: [Capability],
        knowledgeCards: [KnowledgeCard],
        automations: [Automation],
        agentProfiles: [AgentProfile],
        providerProfiles: [ProviderProfile],
        auditEvents: [AuditEvent] = []
    ) {
        self.projects = projects
        self.workspaces = workspaces
        self.workItems = workItems
        self.runs = runs
        self.artifacts = artifacts
        self.capabilities = capabilities
        self.knowledgeCards = knowledgeCards
        self.automations = automations
        self.agentProfiles = agentProfiles
        self.providerProfiles = providerProfiles
        self.auditEvents = auditEvents
    }

    public static func preview() -> NativeAppSeed {
        let workspaceId = EntityID("workspace-pikiclaw")
        let projectId = EntityID("project-pikiclaw")
        let workItemId = EntityID("workitem-native-v2")
        let generatedUIWorkItemId = EntityID("workitem-generated-ui-demo")
        let handoffWorkItemId = EntityID("workitem-agent-handoff-demo")
        let runId = EntityID("run-foundation")
        let generatedUIRunId = EntityID("run-generated-ui-demo")
        let handoffCodexRunId = EntityID("run-handoff-demo-codex")
        let handoffClaudeRunId = EntityID("run-handoff-demo-claude")
        let agentProfileId = EntityID("agent-codex")
        let cursorAgentProfileId = EntityID("agent-cursor")
        let copilotAgentProfileId = EntityID("agent-github-copilot")
        let geminiAgentProfileId = EntityID("agent-gemini")
        let hermesAgentProfileId = EntityID("agent-hermes")
        let claudeAgentProfileId = EntityID("agent-claude")
        let providerProfileId = EntityID("provider-openai")

        return NativeAppSeed(
            projects: [
                Project(
                    id: projectId,
                    name: "Pikiclaw Mac Native",
                    workspaceIds: [workspaceId],
                    defaultAgentProfileId: agentProfileId
                )
            ],
            workspaces: [
                Workspace(
                    id: workspaceId,
                    name: "Pikiclaw",
                    pathDisplay: "/Users/michael.yang/Codes/Personal/pikiclaw",
                    currentBranch: "codex/mac-native-v2-foundation",
                    trustState: .trusted,
                    defaultAgentProfileId: agentProfileId
                )
            ],
            workItems: [
                WorkItem(
                    id: workItemId,
                    workspaceId: workspaceId,
                    title: "Build Mac Native v2 foundation",
                    description: "Create the native object model, runner boundary, and workbench shell.",
                    state: .active,
                    priority: 1,
                    acceptanceCriteria: [
                        "Native UI is not backed by WebView",
                        "Core objects are persisted-ready",
                        "Runner boundary is explicit"
                    ],
                    currentRunId: runId
                ),
                WorkItem(
                    id: generatedUIWorkItemId,
                    workspaceId: workspaceId,
                    title: "Verify generated UI rail",
                    description: "Preview generated UI forms, confirmations, and Mission attention in the macOS native shell.",
                    state: .review,
                    priority: 0,
                    acceptanceCriteria: [
                        "Inline generated form shows required-field readiness",
                        "Mission Control surfaces generated UI actions",
                        "Generated UI actions can be continued without typing a reply"
                    ],
                    currentRunId: generatedUIRunId
                ),
                WorkItem(
                    id: handoffWorkItemId,
                    workspaceId: workspaceId,
                    title: "Review cross-agent handoff",
                    description: "Track Codex and Claude evidence before staging the next Gemini handoff.",
                    state: .review,
                    priority: 0,
                    acceptanceCriteria: [
                        "Mission Control shows the cross-agent handoff trail",
                        "Latest evidence jumps to the newest saved output",
                        "Follow-up action preserves governed permission mode"
                    ],
                    currentRunId: handoffClaudeRunId
                ),
                AgentEnterpriseAlignment.goalWorkItem(
                    workspaceId: workspaceId,
                    projectId: projectId
                )
            ],
            runs: [
                AgentRun(
                    id: runId,
                    workItemId: workItemId,
                    workspaceId: workspaceId,
                    agentProfileId: agentProfileId,
                    permissionMode: .askBeforeEdit,
                    state: .completed,
                    startedAt: Date(),
                    endedAt: Date(),
                    promptSnapshot: "Scaffold Pikiclaw Mac Native v2."
                ),
                AgentRun(
                    id: generatedUIRunId,
                    workItemId: generatedUIWorkItemId,
                    workspaceId: workspaceId,
                    agentProfileId: agentProfileId,
                    permissionMode: .askBeforeEdit,
                    state: .completed,
                    startedAt: Date(),
                    endedAt: Date(),
                    promptSnapshot: "Preview Gemini Enterprise-style generated UI.",
                    transcript: """
                    Generated UI preview is ready.
                    ```pikiclaw-ui
                    {
                      "form": {
                        "kind": "form",
                        "title": "Configure validation",
                        "detail": "2 fields",
                        "prompt": "Collect the target agent and validation command before continuing.",
                        "fields": [
                          {
                            "name": "agent",
                            "label": "Agent",
                            "type": "select",
                            "required": true,
                            "value": "codex",
                            "options": ["codex", "claude", "gemini"]
                          },
                          {
                            "name": "validation_command",
                            "label": "Validation command",
                            "type": "text",
                            "required": true,
                            "placeholder": "swift test --package-path apps/macos"
                          }
                        ]
                      },
                      "confirm": {
                        "question": "Stage the generated UI validation follow-up now?",
                        "approveTitle": "Stage",
                        "declineTitle": "Not now",
                        "permissionMode": "askBeforeEdit"
                      }
                    }
                    ```
                    """
                ),
                AgentRun(
                    id: handoffCodexRunId,
                    workItemId: handoffWorkItemId,
                    workspaceId: workspaceId,
                    agentProfileId: agentProfileId,
                    permissionMode: .askBeforeEdit,
                    state: .completed,
                    startedAt: Date(timeIntervalSinceReferenceDate: 812_000_000),
                    endedAt: Date(timeIntervalSinceReferenceDate: 812_000_120),
                    promptSnapshot: "Map the native handoff gap against Codex."
                ),
                AgentRun(
                    id: handoffClaudeRunId,
                    workItemId: handoffWorkItemId,
                    workspaceId: workspaceId,
                    agentProfileId: claudeAgentProfileId,
                    permissionMode: .askBeforeEdit,
                    state: .completed,
                    startedAt: Date(timeIntervalSinceReferenceDate: 812_000_180),
                    endedAt: Date(timeIntervalSinceReferenceDate: 812_000_300),
                    sideChatOfRunId: handoffCodexRunId,
                    promptSnapshot: "Review the Codex handoff notes in Claude style."
                )
            ],
            artifacts: [
                Artifact(
                    workspaceId: workspaceId,
                    workItemId: workItemId,
                    runId: runId,
                    kind: .obsidianNote,
                    title: "Mac Native v2 Blueprint",
                    uri: "/Users/michael.yang/Documents/Obsidian Vault/repo/pikiclaw/2026-06-18-pikiclaw-mac-native-v2-blueprint.md",
                    status: .ready,
                    provenance: "Design blueprint"
                ),
                Artifact(
                    id: "artifact-enterprise-agent-parity-goal",
                    workspaceId: workspaceId,
                    workItemId: AgentEnterpriseAlignment.goalWorkItemId,
                    kind: .obsidianNote,
                    title: "Enterprise Agent Parity Goal",
                    uri: "/Users/michael.yang/Documents/Obsidian Vault/repo/Personal/pikiclaw/mac-native-enterprise-agent-parity-goal.md",
                    status: .ready,
                    provenance: "Goal tracker"
                ),
                Artifact(
                    id: "artifact-handoff-demo-latest-output",
                    workspaceId: workspaceId,
                    workItemId: handoffWorkItemId,
                    runId: handoffClaudeRunId,
                    kind: .verificationResult,
                    title: "New validation after staging",
                    uri: "pikiclaw://artifacts/artifact-handoff-demo-latest-output",
                    status: .ready,
                    provenance: "Latest cross-agent evidence",
                    createdAt: Date(timeIntervalSinceReferenceDate: 812_000_420)
                )
            ],
            capabilities: [
                Capability(
                    id: "capability-skill-workspace-pikiclaw-iva-logtracer",
                    kind: .skill,
                    name: "IVA Log Tracer",
                    scope: .workspace,
                    installState: "installed",
                    configState: "ready",
                    trustLevel: .trusted,
                    healthState: .healthy
                ),
                Capability(
                    id: "capability-skill-workspace-pikiclaw-clickhouse",
                    kind: .skill,
                    name: "ClickHouse Query",
                    scope: .workspace,
                    installState: "installed",
                    configState: "requires clickhouse-lab MCP",
                    trustLevel: .trusted,
                    healthState: .needsConfiguration
                ),
                Capability(
                    id: "capability-skill-global-using-superpowers",
                    kind: .skill,
                    name: "Using Superpowers",
                    scope: .global,
                    installState: "installed",
                    configState: "ready",
                    trustLevel: .trusted,
                    healthState: .healthy
                ),
                Capability(
                    kind: .cliTool,
                    name: "Codex CLI",
                    scope: .workspace,
                    installState: "detected",
                    configState: "configured",
                    trustLevel: .trusted,
                    healthState: .healthy
                ),
                Capability(
                    id: "capability-mcp-gitlab",
                    kind: .mcpServer,
                    name: "GitLab",
                    scope: .global,
                    installState: "available",
                    configState: "pending",
                    trustLevel: .restricted,
                    healthState: .needsConfiguration
                ),
                Capability(
                    id: "capability-mcp-confluence",
                    kind: .mcpServer,
                    name: "Confluence",
                    scope: .global,
                    installState: "available",
                    configState: "pending",
                    trustLevel: .restricted,
                    healthState: .needsConfiguration
                ),
                Capability(
                    kind: .mcpServer,
                    name: "Workspace Tools",
                    scope: .workspace,
                    installState: "planned",
                    configState: "pending",
                    trustLevel: .restricted,
                    healthState: .needsConfiguration
                )
            ],
            knowledgeCards: [
                KnowledgeCard(
                    scope: .workspace,
                    title: "Chat is process; artifacts are value",
                    body: "Pikiclaw Mac should organize around durable work items, runs, artifacts, capabilities, and source-grounded knowledge instead of treating messages as the product center.",
                    sourceRefs: [
                        SourceRef(
                            kind: "obsidian",
                            label: "Mac Native v2 Blueprint",
                            uri: "/Users/michael.yang/Documents/Obsidian Vault/repo/pikiclaw/2026-06-18-pikiclaw-mac-native-v2-blueprint.md"
                        )
                    ],
                    tags: ["product", "architecture"]
                )
            ],
            automations: [
                Automation(
                    workspaceId: workspaceId,
                    kind: .staleRunRecovery,
                    name: "Recover stalled native runs",
                    state: .paused,
                    scheduleDescription: "Manual until runner helper is hardened"
                )
            ],
            agentProfiles: [
                AgentProfile(
                    id: agentProfileId,
                    kind: .codex,
                    displayName: "Codex",
                    executableName: "codex",
                    defaultProviderProfileId: providerProfileId
                ),
                AgentProfile(
                    id: cursorAgentProfileId,
                    kind: .cursor,
                    displayName: "Cursor Agent",
                    executableName: "cursor-agent",
                    defaultProviderProfileId: providerProfileId
                ),
                AgentProfile(
                    id: copilotAgentProfileId,
                    kind: .githubCopilot,
                    displayName: "GitHub Copilot",
                    executableName: "gh",
                    defaultProviderProfileId: providerProfileId
                ),
                AgentProfile(
                    id: geminiAgentProfileId,
                    kind: .gemini,
                    displayName: "Gemini CLI",
                    executableName: "gemini",
                    isEnabled: false
                ),
                AgentProfile(
                    id: hermesAgentProfileId,
                    kind: .hermes,
                    displayName: "Hermes",
                    executableName: "hermes"
                ),
                AgentProfile(
                    id: claudeAgentProfileId,
                    kind: .claude,
                    displayName: "Claude Code",
                    executableName: "claude",
                    isEnabled: false
                )
            ],
            providerProfiles: [
                ProviderProfile(
                    id: providerProfileId,
                    kind: .openAI,
                    displayName: "OpenAI",
                    keychainSecretRef: "provider.openai.default",
                    defaultModel: "gpt-5"
                )
            ],
            auditEvents: [
                AuditEvent(
                    id: "audit-handoff-demo-staged",
                    kind: .runStateChange,
                    actor: "Pikiclaw",
                    summary: "Staged agent handoff to Gemini for Review cross-agent handoff",
                    createdAt: Date(timeIntervalSinceReferenceDate: 812_000_360),
                    runId: handoffClaudeRunId,
                    workItemId: handoffWorkItemId,
                    workspaceId: workspaceId
                )
            ]
        )
    }
}
