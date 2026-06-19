import Foundation
import Testing
@testable import PikiclawRunner

@Test func executableResolverFindsNvmToolsFromGuiPath() throws {
    let home = URL(fileURLWithPath: NSTemporaryDirectory())
        .appendingPathComponent("pikiclaw-runner-home-\(UUID().uuidString)", isDirectory: true)
    let bin = home
        .appendingPathComponent(".nvm")
        .appendingPathComponent("versions")
        .appendingPathComponent("node")
        .appendingPathComponent("v22.22.3")
        .appendingPathComponent("bin")
    try FileManager.default.createDirectory(at: bin, withIntermediateDirectories: true)

    let executable = bin.appendingPathComponent("pikiclaw-test-agent")
    try "#!/bin/sh\nexit 0\n".write(to: executable, atomically: true, encoding: .utf8)
    try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: executable.path)

    let environment = NativeExecutableResolver.executionEnvironment(
        baseEnvironment: ["PATH": "/usr/bin:/bin", "HOME": home.path],
        homeDirectory: home.path
    )
    let resolved = NativeExecutableResolver.findExecutable(named: "pikiclaw-test-agent", environment: environment)

    #expect(resolved.map { URL(fileURLWithPath: $0).standardizedFileURL.path } == executable.standardizedFileURL.path)
}

@Test func executionEnvironmentKeepsExecutableDirectoryOnPath() {
    let environment = NativeExecutableResolver.environmentIncludingExecutableDirectory(
        "/tmp/tools/codex",
        environment: ["PATH": "/usr/bin:/bin"]
    )

    #expect(environment["PATH"]?.split(separator: ":").first == "/tmp/tools")
}
