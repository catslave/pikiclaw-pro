import Foundation
import Testing
@testable import PikiclawCore
@testable import PikiclawMac

@Test func nativeInitialRouteDefaultsToChat() {
    #expect(nativeInitialRoute(environment: [:]) == .chat)
}

@Test func nativeInitialRouteAcceptsMissionControlAliases() {
    #expect(nativeInitialRoute(environment: [
        nativeInitialRouteEnvironmentKey: "mission-control",
    ]) == .missionControl)
    #expect(nativeInitialRoute(environment: [
        nativeInitialRouteEnvironmentKey: "Mission Control",
    ]) == .missionControl)
    #expect(nativeInitialRoute(environment: [
        nativeInitialRouteEnvironmentKey: "missionControl",
    ]) == .missionControl)
}

@Test func nativeInitialRouteIgnoresUnknownValues() {
    #expect(nativeInitialRoute(environment: [
        nativeInitialRouteEnvironmentKey: "unknown-workbench",
    ]) == .chat)
}

@Test func nativeDeferredRouteCommitSkipsStaleDockSelection() {
    #expect(nativeDeferredRouteCommitTarget(requested: .projects, dockRoute: .projects) == .projects)
    #expect(nativeDeferredRouteCommitTarget(requested: .projects, dockRoute: .workItems) == nil)
}

@Test func restoredSettingsWindowPredicateOnlyTargetsBlankSettingsScene() {
    #expect(pikiclawShouldCloseRestoredSettingsWindow(title: pikiclawSettingsWindowTitle, identifier: nil))
    #expect(!pikiclawShouldCloseRestoredSettingsWindow(title: "Pikiclaw", identifier: pikiclawMainWindowIdentifierRaw))
    #expect(!pikiclawShouldCloseRestoredSettingsWindow(title: pikiclawSettingsWindowTitle, identifier: pikiclawMainWindowIdentifierRaw))
    #expect(!pikiclawShouldCloseRestoredSettingsWindow(title: "Other Settings", identifier: nil))
}

@Test func nativeAgentDockActivityCountIncludesLiveAndUnreadCompletedRuns() {
    let liveStates: [RunState] = [.queued, .starting, .running, .waitingForUser, .cancelling]
    var readCompleted = rootViewLaunchRouteTestRun(state: .completed)
    readCompleted.readAt = Date(timeIntervalSince1970: 100)
    let runs = liveStates.map { rootViewLaunchRouteTestRun(state: $0) }
        + [
            rootViewLaunchRouteTestRun(state: .completed),
            readCompleted,
            rootViewLaunchRouteTestRun(state: .failed),
            rootViewLaunchRouteTestRun(state: .cancelled),
            rootViewLaunchRouteTestRun(state: .stale),
            rootViewLaunchRouteTestRun(state: .draft),
        ]

    #expect(nativeAgentDockActivityCount(for: runs) == 6)
}

@Test func conversationFollowUpActionsWaitUntilRunIsNotStreaming() {
    for state in [RunState.queued, .starting, .running, .cancelling] {
        #expect(conversationShouldPrepareFollowUpActions(state: state, isRunning: false) == false)
    }
    #expect(conversationShouldPrepareFollowUpActions(state: .running, isRunning: true) == false)
    #expect(conversationShouldPrepareFollowUpActions(state: .waitingForUser, isRunning: false))
    #expect(conversationShouldPrepareFollowUpActions(state: .completed, isRunning: false))
    #expect(conversationShouldPrepareFollowUpActions(state: .failed, isRunning: false))
}

@Test func interruptedRunStateUsesRetryAttentionTreatment() {
    #expect(runStateDisplayLabel(.stale) == "interrupted")
    #expect(runNeedsRetryAttention(.stale))
    #expect(runNeedsRetryAttention(.failed))
    #expect(runNeedsRetryAttention(.cancelled))
    #expect(!runNeedsRetryAttention(.completed))
    #expect(!runNeedsRetryAttention(.running))
}

@Test func nativeArtifactWorkspaceMemoryCardsOnlyIncludesWorkspaceMemoryForArtifact() {
    let workspace = rootViewLaunchRouteTestWorkspace()
    let artifact = rootViewLaunchRouteTestArtifact(
        id: "artifact-memory-output",
        workspaceId: workspace.id
    )
    let matching = KnowledgeCard(
        id: "knowledge-memory-output",
        scope: .workspace,
        title: "Reusable output pattern",
        body: "Use this output as reusable workspace memory.",
        sourceRefs: [
            SourceRef(kind: "workspace", label: workspace.name, uri: workspace.pathDisplay)
        ],
        artifactRefs: [artifact.id],
        createdAt: Date(timeIntervalSince1970: 20),
        updatedAt: Date(timeIntervalSince1970: 20)
    )
    let global = KnowledgeCard(
        id: "knowledge-global-output",
        scope: .global,
        title: "Global memory",
        body: "Should not label this artifact as workspace memory.",
        sourceRefs: [],
        artifactRefs: [artifact.id]
    )
    let unrelated = KnowledgeCard(
        id: "knowledge-unrelated-output",
        scope: .workspace,
        title: "Other output",
        body: "Should not label this artifact.",
        sourceRefs: [],
        artifactRefs: ["artifact-other-output"]
    )
    let snapshot = NativeStoreSnapshot(
        workspaces: [workspace],
        artifacts: [artifact],
        knowledgeCards: [global, unrelated, matching]
    )

    #expect(nativeArtifactWorkspaceMemoryCards(artifact: artifact, snapshot: snapshot).map(\.id.rawValue) == [
        "knowledge-memory-output",
    ])
}

@Test func nativeWorkspaceMemoryCardsFiltersByWorkspaceArtifactAndSourceRefs() {
    let workspace = rootViewLaunchRouteTestWorkspace()
    let otherWorkspace = rootViewLaunchRouteTestWorkspace(
        id: "workspace-other-memory",
        name: "Other Memory",
        pathDisplay: "/tmp/other-memory"
    )
    let artifact = rootViewLaunchRouteTestArtifact(
        id: "artifact-workspace-memory",
        workspaceId: workspace.id
    )
    let otherArtifact = rootViewLaunchRouteTestArtifact(
        id: "artifact-other-memory",
        workspaceId: otherWorkspace.id
    )
    let byArtifact = KnowledgeCard(
        id: "knowledge-by-artifact",
        scope: .workspace,
        title: "Artifact-backed memory",
        body: "Matched through a workspace artifact ref.",
        sourceRefs: [],
        artifactRefs: [artifact.id],
        createdAt: Date(timeIntervalSince1970: 20),
        updatedAt: Date(timeIntervalSince1970: 20)
    )
    let byWorkspaceRef = KnowledgeCard(
        id: "knowledge-by-workspace-ref",
        scope: .workspace,
        title: "Workspace-backed memory",
        body: "Matched through a workspace source ref.",
        sourceRefs: [
            SourceRef(kind: "workspace", label: workspace.name, uri: workspace.pathDisplay)
        ],
        artifactRefs: [],
        createdAt: Date(timeIntervalSince1970: 30),
        updatedAt: Date(timeIntervalSince1970: 30)
    )
    let otherCard = KnowledgeCard(
        id: "knowledge-other-workspace",
        scope: .workspace,
        title: "Other workspace memory",
        body: "Should stay out of this workspace popover.",
        sourceRefs: [
            SourceRef(kind: "workspace", label: otherWorkspace.name, uri: otherWorkspace.pathDisplay)
        ],
        artifactRefs: [otherArtifact.id],
        createdAt: Date(timeIntervalSince1970: 40),
        updatedAt: Date(timeIntervalSince1970: 40)
    )
    let agentScoped = KnowledgeCard(
        id: "knowledge-agent-scoped",
        scope: .agent,
        title: "Agent scoped memory",
        body: "Should not appear in workspace memory.",
        sourceRefs: [
            SourceRef(kind: "workspace", label: workspace.name, uri: workspace.pathDisplay)
        ],
        artifactRefs: [artifact.id],
        createdAt: Date(timeIntervalSince1970: 50),
        updatedAt: Date(timeIntervalSince1970: 50)
    )
    let snapshot = NativeStoreSnapshot(
        workspaces: [workspace, otherWorkspace],
        artifacts: [artifact, otherArtifact],
        knowledgeCards: [byArtifact, otherCard, agentScoped, byWorkspaceRef]
    )

    #expect(nativeWorkspaceMemoryCards(snapshot: snapshot, workspace: workspace).map(\.id.rawValue) == [
        "knowledge-by-workspace-ref",
        "knowledge-by-artifact",
    ])
}

@Test func nativeRunOutputArtifactsIncludesRunIdAndChatRunSourceRefsOnly() {
    let run = AgentRun(
        id: "run-output-owner",
        workspaceId: "workspace-memory",
        agentProfileId: "agent-test",
        state: .completed,
        promptSnapshot: "Produce output"
    )
    var runArtifact = rootViewLaunchRouteTestArtifact(
        id: "artifact-run-output",
        workspaceId: run.workspaceId
    )
    runArtifact.runId = run.id
    runArtifact.createdAt = Date(timeIntervalSince1970: 20)
    var sourceRefArtifact = rootViewLaunchRouteTestArtifact(
        id: "artifact-source-ref-output",
        workspaceId: run.workspaceId
    )
    sourceRefArtifact.sourceRefs = [
        SourceRef(kind: "chat-run", label: "Produce output", uri: "pikiclaw://runs/run-output-owner")
    ]
    sourceRefArtifact.createdAt = Date(timeIntervalSince1970: 30)
    var unrelated = rootViewLaunchRouteTestArtifact(
        id: "artifact-unrelated-output",
        workspaceId: run.workspaceId
    )
    unrelated.runId = "run-other-output"
    unrelated.sourceRefs = [
        SourceRef(kind: "chat-run", label: "Other output", uri: "pikiclaw://runs/run-other-output")
    ]
    unrelated.createdAt = Date(timeIntervalSince1970: 40)
    let snapshot = NativeStoreSnapshot(
        runs: [run],
        artifacts: [runArtifact, sourceRefArtifact, unrelated]
    )

    #expect(nativeRunOutputArtifacts(run: run, snapshot: snapshot).map(\.id.rawValue) == [
        "artifact-source-ref-output",
        "artifact-run-output",
    ])
}

@Test func nativeDeepLinkParsesMissionControlTargets() throws {
    let mission = try #require(URL(string: "pikiclaw://mission-control"))
    let outputReview = try #require(URL(string: "pikiclaw://mission-control/output-review"))
    let latestEvidence = try #require(URL(string: "pikiclaw://mission-control/latest-evidence"))
    let latestEvidenceForWorkItem = try #require(URL(string: "pikiclaw://mission-control/latest-evidence/workitem-native-v2"))
    let latestEvidenceForWorkItemPath = try #require(URL(string: "pikiclaw://mission-control/latest-evidence/work-items/workitem-native-v2"))

    #expect(nativeDeepLinkDestination(for: mission) == .route(.missionControl))
    #expect(nativeDeepLinkDestination(for: outputReview) == .missionOutputReview)
    #expect(nativeDeepLinkDestination(for: latestEvidence) == .missionLatestEvidence(workItemId: nil))
    #expect(nativeDeepLinkDestination(for: latestEvidenceForWorkItem) == .missionLatestEvidence(workItemId: "workitem-native-v2"))
    #expect(nativeDeepLinkDestination(for: latestEvidenceForWorkItemPath) == .missionLatestEvidence(workItemId: "workitem-native-v2"))
}

@Test func nativeDeepLinkParsesEvidenceTargets() throws {
    let run = try #require(URL(string: "pikiclaw://runs/run-foundation/evidence"))
    let workItem = try #require(URL(string: "pikiclaw:///work-items/workitem-native-v2"))
    let artifact = try #require(URL(string: "pikiclaw://artifacts/artifact-enterprise-agent-parity-goal"))

    #expect(nativeDeepLinkDestination(for: run) == .run(runId: "run-foundation", focus: .evidence))
    #expect(nativeDeepLinkDestination(for: workItem) == .workItem("workitem-native-v2"))
    #expect(nativeDeepLinkDestination(for: artifact) == .artifact("artifact-enterprise-agent-parity-goal"))
}

@Test func missionOutputReviewLinksUseNativeDeepLinkTargets() {
    let target = ArtifactReviewMissionTarget(
        artifactId: "artifact-enterprise-agent-parity-goal",
        workspaceId: "workspace-default",
        workItemId: "workitem-native-v2",
        sourceRunId: "run-foundation",
        kind: .needsFollowUp,
        title: "Agent review summary",
        workItemTitle: "Improve native Mission Control",
        createdAt: Date(timeIntervalSince1970: 1_720_000_000)
    )

    #expect(nativeMissionOutputReviewURL == "pikiclaw://mission-control/output-review")
    #expect(artifactMissionReviewDismissedRef().uri == nativeMissionOutputReviewURL)
    #expect(artifactReviewMissionTargetURL(target) == "pikiclaw://artifacts/artifact-enterprise-agent-parity-goal")
}

@Test func nativeDeepLinkParsesJiraWriteBackTargets() throws {
    let writeBack = try #require(URL(string: "pikiclaw://jira/IVAS-123/write-back"))

    #expect(nativeDeepLinkDestination(for: writeBack) == .jiraWriteBack(issueKey: "IVAS-123"))
}

@Test func missionFocusedLaneKeyboardCommandContractIsStable() {
    #expect(Notification.Name.pikiclawOpenFocusedMissionLane.rawValue == "PikiclawOpenFocusedMissionLane")
    #expect(Notification.Name.pikiclawFocusNextMissionLane.rawValue == "PikiclawFocusNextMissionLane")
    #expect(Notification.Name.pikiclawFocusPreviousMissionLane.rawValue == "PikiclawFocusPreviousMissionLane")
    #expect(missionOpenFocusedLaneCommandTitle == "Open Focused Mission Lane")
    #expect(missionOpenFocusedLaneShortcutLabel == "Cmd-Opt-Return")
    #expect(missionOpenFocusedLaneUnavailableStatus == "No Mission lane is pinned")
    #expect(missionFocusNextLaneCommandTitle == "Focus Next Mission Lane")
    #expect(missionFocusPreviousLaneCommandTitle == "Focus Previous Mission Lane")
    #expect(missionFocusNextLaneShortcutLabel == "Cmd-Opt-]")
    #expect(missionFocusPreviousLaneShortcutLabel == "Cmd-Opt-[")
    #expect(missionFocusLaneShortcutHint == "Cmd-Opt-[ / ]")
    #expect(missionFocusLaneUnavailableStatus == "No Mission lane target is available")
    #expect(Notification.Name.pikiclawStageFocusedGeneratedUIAction.rawValue == "PikiclawStageFocusedGeneratedUIAction")
    #expect(generatedUIStageFocusedActionCommandTitle == "Stage Focused Generated UI Action")
    #expect(generatedUIStageFocusedActionShortcutLabel == "Cmd-Opt-S")
    #expect(generatedUIStageFocusedActionUnavailableStatus == "No focused generated UI action is open")
}

@Test func nativeDeepLinkIgnoresUnsupportedSchemes() throws {
    let url = try #require(URL(string: "https://pikiclaw.local/mission-control"))

    #expect(nativeDeepLinkDestination(for: url) == nil)
}

@Test func nativeNotificationDeepLinkPayloadRoundTripsSupportedLinks() throws {
    let url = try #require(URL(string: "pikiclaw://mission-control/latest-evidence/workitem-native-v2"))
    let userInfo = pikiclawNotificationDeepLinkUserInfo(url: url)

    #expect(pikiclawNotificationDeepLinkURL(from: userInfo) == url)
    #expect(pikiclawNotificationDeepLinkURL(from: [
        pikiclawNotificationDeepLinkUserInfoKey: url,
    ]) == url)
    #expect(pikiclawNotificationDeepLinkURL(from: [
        pikiclawNotificationDeepLinkUserInfoKey: "https://pikiclaw.local/mission-control",
    ]) == nil)
    #expect(pikiclawNotificationDeepLinkURL(from: [
        "other": url.absoluteString,
    ]) == nil)
}

@Test func previewSeedShowsAgentHandoffTrailInMissionControl() throws {
    let snapshot = NativeStoreSnapshot(seed: .preview())
    let item = try #require(missionAgentHandoffTrailItems(snapshot: snapshot).first {
        $0.workItemId == "workitem-agent-handoff-demo"
    })

    #expect(item.title == "Review cross-agent handoff")
    #expect(item.agentKinds == [.codex, .claude])
    #expect(item.handoffState == .staged)
    #expect(item.handoffFreshness == .stale)
    #expect(item.handoffLatestEvidenceSource == .output)
    #expect(item.handoffLatestEvidenceRefId == "artifact-handoff-demo-latest-output")
    #expect(missionAgentHandoffLatestEvidenceDestination(item) == .outputs(artifactId: "artifact-handoff-demo-latest-output"))
    #expect(missionAgentHandoffLatestEvidenceURL(item) == "pikiclaw://mission-control/latest-evidence/workitem-agent-handoff-demo")
}

private func rootViewLaunchRouteTestRun(state: RunState) -> AgentRun {
    AgentRun(
        workspaceId: "workspace-test",
        agentProfileId: "agent-test",
        state: state,
        promptSnapshot: "Test run"
    )
}

private func rootViewLaunchRouteTestWorkspace(
    id: EntityID = "workspace-memory",
    name: String = "Memory Workspace",
    pathDisplay: String = "/tmp/memory-workspace"
) -> Workspace {
    Workspace(
        id: id,
        name: name,
        pathDisplay: pathDisplay,
        trustState: .trusted
    )
}

private func rootViewLaunchRouteTestArtifact(
    id: EntityID,
    workspaceId: EntityID
) -> Artifact {
    Artifact(
        id: id,
        workspaceId: workspaceId,
        kind: .commandOutputSummary,
        title: "Reusable output",
        uri: "pikiclaw://artifacts/\(id.rawValue)",
        status: .ready,
        provenance: "Captured reusable output."
    )
}
