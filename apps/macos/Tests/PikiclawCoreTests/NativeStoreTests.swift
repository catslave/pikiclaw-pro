import Testing
@testable import PikiclawCore

@Test func inMemoryStoreListsSeededCoreObjects() async throws {
    let store = InMemoryNativeStore(seed: .preview())

    let workspaces = try await store.listWorkspaces()
    let workItems = try await store.listWorkItems(workspaceId: workspaces.first?.id)
    let runs = try await store.listRuns(workItemId: workItems.first?.id)
    let artifacts = try await store.listArtifacts(workItemId: workItems.first?.id)

    #expect(workspaces.count == 1)
    #expect(workItems.count == 1)
    #expect(runs.count == 1)
    #expect(artifacts.count == 1)
}

