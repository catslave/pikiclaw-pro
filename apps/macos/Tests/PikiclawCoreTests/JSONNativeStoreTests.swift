import Foundation
import Testing
@testable import PikiclawCore

@Test func jsonNativeStorePersistsWorkspace() async throws {
    let dir = URL(fileURLWithPath: NSTemporaryDirectory())
        .appendingPathComponent("pikiclaw-json-store-\(UUID().uuidString)", isDirectory: true)
    let file = dir.appendingPathComponent("state.json")
    let store = JSONNativeStore(fileURL: file)
    let workspace = Workspace(name: "Temp", pathDisplay: "/tmp/temp", trustState: .trusted)

    try await store.saveWorkspace(workspace)

    let reloaded = JSONNativeStore(fileURL: file)
    let workspaces = try await reloaded.listWorkspaces()
    #expect(workspaces.contains(where: { $0.id == workspace.id && $0.pathDisplay == "/tmp/temp" }))
}

@Test func jsonNativeStoreMigratesAgentProfilesAndAvailability() async throws {
    let dir = URL(fileURLWithPath: NSTemporaryDirectory())
        .appendingPathComponent("pikiclaw-json-store-\(UUID().uuidString)", isDirectory: true)
    let file = dir.appendingPathComponent("state.json")
    try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)

    let oldSnapshot = NativeStoreSnapshot(
        agentProfiles: [
            AgentProfile(
                id: "agent-codex",
                kind: .codex,
                displayName: "Codex",
                executableName: "codex"
            )
        ],
        agentAvailabilityPolicyVersion: nil
    )
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
    encoder.dateEncodingStrategy = .iso8601
    try encoder.encode(oldSnapshot).write(to: file, options: .atomic)

    let store = JSONNativeStore(fileURL: file, seed: .preview())
    let migrated = try await store.loadSnapshot()
    let profiles = Dictionary(uniqueKeysWithValues: migrated.agentProfiles.map { ($0.kind, $0) })

    #expect(profiles[.codex]?.isEnabled == true)
    #expect(profiles[.cursor] != nil)
    #expect(profiles[.githubCopilot] != nil)
    #expect(profiles[.hermes] != nil)
    #expect(profiles[.gemini]?.isEnabled == false)
    #expect(profiles[.claude]?.isEnabled == false)
    #expect(migrated.agentAvailabilityPolicyVersion == 1)
}
