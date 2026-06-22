import Foundation
import Testing
@testable import PikiclawCore
@testable import PikiclawMac

@MainActor
@Test func attachSideChatRejectsParentThatAlreadyHasSideChats() async throws {
    let fixture = try makeMultiChatFixture()
    defer { try? FileManager.default.removeItem(at: fixture.directory) }
    let model = NativeAppModel(store: fixture.store)
    await model.reload()

    await model.attachSideChat(parentRunId: fixture.secondParent.id, childRunId: fixture.parent.id)

    let snapshot = try await fixture.store.loadSnapshot()
    let parent = try #require(snapshot.runs.first(where: { $0.id == fixture.parent.id }))
    let child = try #require(snapshot.runs.first(where: { $0.id == fixture.child.id }))
    let secondParent = try #require(snapshot.runs.first(where: { $0.id == fixture.secondParent.id }))

    #expect(parent.sideChatOfRunId == nil)
    #expect(parent.sideChatRunIds == [child.id])
    #expect(child.sideChatOfRunId == parent.id)
    #expect(secondParent.sideChatRunIds.isEmpty)
    #expect(model.statusLine == "Detach this chat's side chats before nesting it")
}

@MainActor
@Test func attachSideChatRejectsSideChatAsParent() async throws {
    let fixture = try makeMultiChatFixture()
    defer { try? FileManager.default.removeItem(at: fixture.directory) }
    let model = NativeAppModel(store: fixture.store)
    await model.reload()

    await model.attachSideChat(parentRunId: fixture.child.id, childRunId: fixture.secondParent.id)

    let snapshot = try await fixture.store.loadSnapshot()
    let child = try #require(snapshot.runs.first(where: { $0.id == fixture.child.id }))
    let secondParent = try #require(snapshot.runs.first(where: { $0.id == fixture.secondParent.id }))

    #expect(child.sideChatOfRunId == fixture.parent.id)
    #expect(child.sideChatRunIds.isEmpty)
    #expect(secondParent.sideChatOfRunId == nil)
    #expect(model.statusLine == "Side chats cannot contain other chats")
}

@MainActor
@Test func deleteParentChatDetachesSideChats() async throws {
    let fixture = try makeMultiChatFixture()
    defer { try? FileManager.default.removeItem(at: fixture.directory) }
    let model = NativeAppModel(store: fixture.store)
    await model.reload()

    await model.deleteChat(runId: fixture.parent.id)

    let snapshot = try await fixture.store.loadSnapshot()
    let child = try #require(snapshot.runs.first(where: { $0.id == fixture.child.id }))

    #expect(snapshot.runs.contains(where: { $0.id == fixture.parent.id }) == false)
    #expect(child.sideChatOfRunId == nil)
    #expect(child.sideChatRunIds.isEmpty)
    #expect(model.statusLine == "Loaded 0 work item(s)")
}

@MainActor
@Test func inlineSideChatStartsAsEditableDraft() async throws {
    let fixture = try makeMultiChatFixture()
    defer { try? FileManager.default.removeItem(at: fixture.directory) }
    let model = NativeAppModel(store: fixture.store)
    await model.reload()

    let childId = try #require(await model.createInlineSideChat(parentRunId: fixture.secondParent.id))

    let snapshot = try await fixture.store.loadSnapshot()
    let parent = try #require(snapshot.runs.first(where: { $0.id == fixture.secondParent.id }))
    let child = try #require(snapshot.runs.first(where: { $0.id == childId }))

    #expect(parent.sideChatRunIds.contains(child.id))
    #expect(child.sideChatOfRunId == parent.id)
    #expect(child.state == .draft)
    #expect(NativeAppModel.isActiveExecutionState(child.state) == false)
    #expect(child.transcript == "Ready for a focused side chat.")
}

@Test func visibleMultiChatRunsCapsAtFourPanes() {
    let parent = multiChatTestRun(id: "run-parent", title: "Parent")
    let sides = (1...4).map { index in
        multiChatTestRun(id: EntityID("run-side-\(index)"), title: "Side \(index)")
    }

    let visible = nativeVisibleMultiChatRuns(
        parent: parent,
        sideRuns: sides,
        hiddenSideRunIds: [],
        focusedSideRunId: nil
    )

    #expect(visible.map(\.id) == [
        "run-parent",
        "run-side-1",
        "run-side-2",
        "run-side-3"
    ])
}

@Test func visibleMultiChatRunsKeepsFocusedSideWithinFourPanes() {
    let parent = multiChatTestRun(id: "run-parent", title: "Parent")
    let sides = (1...4).map { index in
        multiChatTestRun(id: EntityID("run-side-\(index)"), title: "Side \(index)")
    }

    let visible = nativeVisibleMultiChatRuns(
        parent: parent,
        sideRuns: sides,
        hiddenSideRunIds: [],
        focusedSideRunId: "run-side-4"
    )

    #expect(visible.map(\.id) == [
        "run-parent",
        "run-side-1",
        "run-side-2",
        "run-side-4"
    ])
}

@Test func visibleMultiChatRunsKeepsActiveSideWithinFourPanes() {
    let parent = multiChatTestRun(id: "run-parent", title: "Parent")
    var sides = (1...4).map { index in
        multiChatTestRun(id: EntityID("run-side-\(index)"), title: "Side \(index)")
    }
    sides[3].sideChatOfRunId = parent.id

    let focusedSideRunId = nativeEffectiveFocusedSideRunId(
        activeRun: sides[3],
        focusedSideRunId: nil
    )
    let visible = nativeVisibleMultiChatRuns(
        parent: parent,
        sideRuns: sides,
        hiddenSideRunIds: [],
        focusedSideRunId: focusedSideRunId
    )

    #expect(focusedSideRunId == "run-side-4")
    #expect(visible.map(\.id) == [
        "run-parent",
        "run-side-1",
        "run-side-2",
        "run-side-4"
    ])
}

@Test func temporaryPaneOpeningDeDuplicatesWithoutCappingWindowLayout() {
    let duplicated = nativeTemporaryPaneRunIdsAfterOpening(
        existing: ["run-one", "run-two"],
        opening: "run-one",
        activeRunId: "run-parent"
    )
    let uncapped = nativeTemporaryPaneRunIdsAfterOpening(
        existing: ["run-one", "run-two", "run-three"],
        opening: "run-four",
        activeRunId: "run-parent"
    )

    #expect(duplicated == ["run-two", "run-one"])
    #expect(uncapped == ["run-one", "run-two", "run-three", "run-four"])
}

@Test func temporaryPaneOpeningCanStillApplyExplicitCap() {
    let capped = nativeTemporaryPaneRunIdsAfterOpening(
        existing: ["run-one", "run-two", "run-three"],
        opening: "run-four",
        activeRunId: "run-parent",
        maxPanes: 4
    )

    #expect(capped == ["run-two", "run-three", "run-four"])
}

@Test func temporaryPaneClosingRemovesOnlyClosedPaneAndKeepsFocusUseful() {
    let focusedClosed = nativeTemporaryPaneStateAfterClosing(
        existing: ["run-one", "run-two", "run-three"],
        closing: "run-two",
        focusedRunId: "run-two"
    )
    let backgroundClosed = nativeTemporaryPaneStateAfterClosing(
        existing: ["run-one", "run-two", "run-three"],
        closing: "run-one",
        focusedRunId: "run-three"
    )

    #expect(focusedClosed.runIds == ["run-one", "run-three"])
    #expect(focusedClosed.focusedRunId == "run-three")
    #expect(backgroundClosed.runIds == ["run-two", "run-three"])
    #expect(backgroundClosed.focusedRunId == "run-three")
}

@Test func temporaryPaneLayoutPreservesFocusedSideChat() {
    let parent = multiChatTestRun(id: "run-parent", title: "Parent")
    let sides = (1...3).map { index in
        multiChatTestRun(id: EntityID("run-side-\(index)"), title: "Side \(index)")
    }
    let temporary = multiChatTestRun(id: "run-temporary", title: "Temporary")

    let panes = nativeVisibleTemporaryMultiChatPanes(
        parent: parent,
        sideRuns: sides,
        hiddenSideRunIds: [],
        focusedSideRunId: "run-side-3",
        temporaryRuns: [temporary],
        focusedTemporaryRunId: temporary.id
    )

    #expect(panes.map(\.id) == [
        "run-parent",
        "run-side-3",
        "run-temporary",
        "run-side-1",
        "run-side-2"
    ])
    #expect(panes.map(\.role) == [.primary, .side, .temporary, .side, .side])
}

@Test func temporaryPaneLayoutCanShowMoreThanFourPanesForScrolling() {
    let parent = multiChatTestRun(id: "run-parent", title: "Parent")
    let temporaryRuns = (1...4).map { index in
        multiChatTestRun(id: EntityID("run-temporary-\(index)"), title: "Temporary \(index)")
    }

    let panes = nativeVisibleTemporaryMultiChatPanes(
        parent: parent,
        sideRuns: [],
        hiddenSideRunIds: [],
        focusedSideRunId: nil,
        temporaryRuns: temporaryRuns,
        focusedTemporaryRunId: nil
    )

    #expect(panes.map(\.id) == [
        "run-parent",
        "run-temporary-1",
        "run-temporary-2",
        "run-temporary-3",
        "run-temporary-4"
    ])
}

@Test func multiChatGridKeepsUpToFourPanesInsideOneScreen() {
    #expect(nativeMultiChatGridColumnCount(for: 2) == 2)
    #expect(nativeMultiChatGridRowsPerScreen(for: 2) == 1)
    #expect(nativeMultiChatGridRowsPerScreen(for: 3) == 2)
    #expect(nativeMultiChatGridRowsPerScreen(for: 4) == 2)
    #expect(nativeMultiChatGridRowsPerScreen(for: 5) == 2)
    #expect(nativeMultiChatPaneHeight(containerHeight: 1000, paneCount: 2, spacing: 12) == 1000)
    #expect(nativeMultiChatPaneHeight(containerHeight: 1000, paneCount: 3, spacing: 12) == 494)
}

private struct MultiChatFixture {
    let directory: URL
    let store: JSONNativeStore
    let parent: AgentRun
    let child: AgentRun
    let secondParent: AgentRun
}

private func multiChatTestRun(id: EntityID, title: String) -> AgentRun {
    AgentRun(
        id: id,
        workspaceId: "workspace-multi-chat",
        agentProfileId: "agent-codex",
        state: .completed,
        promptSnapshot: title
    )
}

private func makeMultiChatFixture() throws -> MultiChatFixture {
    let directory = URL(fileURLWithPath: NSTemporaryDirectory())
        .appendingPathComponent("pikiclaw-multi-chat-\(UUID().uuidString)", isDirectory: true)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)

    let workspace = Workspace(
        id: "workspace-multi-chat",
        name: "Multi Chat",
        pathDisplay: directory.path,
        trustState: .trusted
    )
    let agent = AgentProfile(
        id: "agent-codex",
        kind: .codex,
        displayName: "Codex",
        executableName: "codex",
        isEnabled: true
    )
    let child = AgentRun(
        id: "run-child",
        workspaceId: workspace.id,
        agentProfileId: agent.id,
        state: .completed,
        startedAt: Date(timeIntervalSince1970: 2),
        sideChatOfRunId: "run-parent",
        promptSnapshot: "Side chat"
    )
    let parent = AgentRun(
        id: "run-parent",
        workspaceId: workspace.id,
        agentProfileId: agent.id,
        state: .completed,
        startedAt: Date(timeIntervalSince1970: 3),
        sideChatRunIds: [child.id],
        promptSnapshot: "Parent chat"
    )
    let secondParent = AgentRun(
        id: "run-second-parent",
        workspaceId: workspace.id,
        agentProfileId: agent.id,
        state: .completed,
        startedAt: Date(timeIntervalSince1970: 1),
        promptSnapshot: "Second parent"
    )
    let seed = NativeAppSeed(
        projects: [],
        workspaces: [workspace],
        workItems: [],
        runs: [parent, child, secondParent],
        artifacts: [],
        capabilities: [],
        knowledgeCards: [],
        automations: [],
        agentProfiles: [agent],
        providerProfiles: []
    )
    let store = JSONNativeStore(fileURL: directory.appendingPathComponent("state.json"), seed: seed)

    return MultiChatFixture(
        directory: directory,
        store: store,
        parent: parent,
        child: child,
        secondParent: secondParent
    )
}
