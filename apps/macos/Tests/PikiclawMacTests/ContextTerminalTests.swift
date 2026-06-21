import Foundation
import Testing
@testable import PikiclawCore
@testable import PikiclawMac

@MainActor
@Test func contextTerminalKeepsWorkingDirectoryAfterCd() async throws {
    let root = URL(fileURLWithPath: NSTemporaryDirectory())
        .appendingPathComponent("pikiclaw-terminal-\(UUID().uuidString)", isDirectory: true)
        .resolvingSymlinksInPath()
    let child = root.appendingPathComponent("child", isDirectory: true)
    try FileManager.default.createDirectory(at: child, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: root) }

    let store = JSONNativeStore(fileURL: root.appendingPathComponent("state.json"))
    let model = NativeAppModel(store: store)
    let workspace = Workspace(name: "child", pathDisplay: child.path, trustState: .trusted)

    await model.runTerminalCommand("pwd", workspace: workspace)
    #expect(model.terminalCurrentDirectory(for: workspace).map(comparableTerminalPath) == comparableTerminalPath(child.path))

    await model.runTerminalCommand("cd ..", workspace: workspace)
    #expect(model.terminalCurrentDirectory(for: workspace).map(comparableTerminalPath) == comparableTerminalPath(root.path))

    await model.runTerminalCommand("pwd", workspace: workspace)
    #expect(model.terminalCurrentDirectory(for: workspace).map(comparableTerminalPath) == comparableTerminalPath(root.path))
}

@MainActor
@Test func contextTerminalCanStageTranscriptForChat() async throws {
    let root = URL(fileURLWithPath: NSTemporaryDirectory())
        .appendingPathComponent("pikiclaw-terminal-stage-\(UUID().uuidString)", isDirectory: true)
        .resolvingSymlinksInPath()
    try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: root) }

    let store = JSONNativeStore(fileURL: root.appendingPathComponent("state.json"))
    let model = NativeAppModel(store: store)
    let workspace = Workspace(
        name: "Terminal Stage",
        pathDisplay: root.path,
        currentBranch: "codex/native-terminal-stage",
        trustState: .trusted
    )
    let item = WorkItem(
        workspaceId: workspace.id,
        title: "Investigate terminal output",
        sourceType: .manualPrompt
    )
    let run = AgentRun(
        workspaceId: workspace.id,
        agentProfileId: "agent-codex",
        state: .failed,
        promptSnapshot: "Fix failing native terminal flow"
    )

    #expect(!model.stageTerminalTranscriptForChat(workspace: workspace, workItem: item))
    await model.runTerminalCommand("pwd", workspace: workspace)

    #expect(model.stageTerminalTranscriptForChat(
        workspace: workspace,
        workItem: item,
        activeRun: run,
        agentKind: .codex,
        permissionMode: .askBeforeEdit
    ))
    #expect(model.draftPrompt.contains("Terminal follow-up: Investigate terminal output"))
    #expect(model.draftPrompt.contains("Workspace: Terminal Stage"))
    #expect(model.draftPrompt.contains("Path: \(root.path)"))
    #expect(model.draftPrompt.contains("Target Agent: codex"))
    #expect(model.draftPrompt.contains("Permission Mode: askBeforeEdit"))
    #expect(model.draftPrompt.contains("Work Item: Investigate terminal output"))
    #expect(model.draftPrompt.contains("Active Chat: Fix failing native terminal flow"))
    #expect(model.draftPrompt.contains("Run State: failed"))
    #expect(model.draftPrompt.contains("Terminal Output:"))
    #expect(model.draftPrompt.contains(root.path))
}

@MainActor
@Test func contextTerminalStagesOnlyRecentLongTranscriptForChat() async throws {
    let root = URL(fileURLWithPath: NSTemporaryDirectory())
        .appendingPathComponent("pikiclaw-terminal-long-\(UUID().uuidString)", isDirectory: true)
    try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: root) }

    let model = NativeAppModel(store: JSONNativeStore(fileURL: root.appendingPathComponent("state.json")))
    let workspace = Workspace(name: "Long Terminal", pathDisplay: root.path, trustState: .trusted)
    model.terminalTranscript = "drop-this-prefix\n" + String(repeating: "x", count: 6_200) + "\nkeep-this-tail"

    #expect(model.stageTerminalTranscriptForChat(workspace: workspace))
    #expect(model.draftPrompt.contains("Terminal follow-up: Long Terminal"))
    #expect(model.draftPrompt.contains("Terminal Output (truncated to the last 6000 characters):"))
    #expect(!model.draftPrompt.contains("drop-this-prefix"))
    #expect(model.draftPrompt.contains("keep-this-tail"))
}

@Test func contextTerminalSuggestionsPreferMacNativeValidationCommands() throws {
    let root = URL(fileURLWithPath: NSTemporaryDirectory())
        .appendingPathComponent("pikiclaw-terminal-suggestions-\(UUID().uuidString)", isDirectory: true)
    let macOSPackage = root.appendingPathComponent("apps/macos", isDirectory: true)
    try FileManager.default.createDirectory(at: macOSPackage, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: root) }

    let workspace = Workspace(name: "Pikiclaw", pathDisplay: root.path, trustState: .trusted)
    let suggestions = NativeAppModel.terminalSuggestions(for: workspace)

    #expect(suggestions.contains("cd apps/macos && swift test"))
    #expect(suggestions.contains("./apps/macos/scripts/build-app.sh"))
    #expect(!suggestions.contains("pwd"))
    #expect(!suggestions.contains("npm test"))
}

@Test func contextTerminalSuggestionsWorkWhenWorkspaceIsMacNativePackage() throws {
    let root = URL(fileURLWithPath: NSTemporaryDirectory())
        .appendingPathComponent("pikiclaw-terminal-package-\(UUID().uuidString)", isDirectory: true)
    let macOSPackage = root.appendingPathComponent("apps/macos", isDirectory: true)
    try FileManager.default.createDirectory(at: macOSPackage, withIntermediateDirectories: true)
    try Data().write(to: macOSPackage.appendingPathComponent("Package.swift"))
    defer { try? FileManager.default.removeItem(at: root) }

    let workspace = Workspace(name: "macos", pathDisplay: macOSPackage.path, trustState: .trusted)
    let suggestions = NativeAppModel.terminalSuggestions(for: workspace)

    #expect(suggestions.contains("swift test"))
    #expect(suggestions.contains("./scripts/build-app.sh"))
    #expect(!suggestions.contains("cd apps/macos && swift test"))
}

@Test func contextTerminalSuggestionsFallBackForGenericWorkspace() {
    let workspace = Workspace(name: "Generic", pathDisplay: "/tmp/generic-workspace", trustState: .trusted)

    #expect(NativeAppModel.terminalSuggestions(for: workspace) == ["pwd", "ls", "git status --short"])
    #expect(NativeAppModel.terminalSuggestions(for: nil) == ["pwd", "ls", "git status --short"])
}

private func comparableTerminalPath(_ path: String) -> String {
    let standardized = URL(fileURLWithPath: path).standardizedFileURL.path
    if standardized.hasPrefix("/private/") {
        return String(standardized.dropFirst("/private".count))
    }
    return standardized
}
