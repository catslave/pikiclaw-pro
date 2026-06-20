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

private func comparableTerminalPath(_ path: String) -> String {
    let standardized = URL(fileURLWithPath: path).standardizedFileURL.path
    if standardized.hasPrefix("/private/") {
        return String(standardized.dropFirst("/private".count))
    }
    return standardized
}
