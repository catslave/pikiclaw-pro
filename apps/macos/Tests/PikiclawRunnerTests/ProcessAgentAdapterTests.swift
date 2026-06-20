import Foundation
import Testing
@testable import PikiclawCore
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

@Test func processAgentAdapterClosesStdinWhenNoInputIsProvided() async throws {
    let executable = try makeStdinEchoAgent()
    let request = makeLaunchRequest(executable: executable)
    let adapter = ProcessAgentAdapter(
        descriptor: AgentDescriptor(kind: .customCLI, displayName: "stdin echo", executableName: executable.path)
    )

    let events = try await collectEventsWithTimeout(from: adapter, request: request)

    #expect(events.contains(.stateChanged(.running)))
    #expect(events.contains(.output("stdin=<>\n")))
    #expect(events.last == .completed(exitCode: 0))
}

@Test func processAgentAdapterWritesAndClosesProvidedStdin() async throws {
    let executable = try makeStdinEchoAgent()
    let request = makeLaunchRequest(executable: executable, stdinText: "hello from stdin")
    let adapter = ProcessAgentAdapter(
        descriptor: AgentDescriptor(kind: .customCLI, displayName: "stdin echo", executableName: executable.path)
    )

    let events = try await collectEventsWithTimeout(from: adapter, request: request)

    #expect(events.contains(.output("stdin=<hello from stdin>\n")))
    #expect(events.last == .completed(exitCode: 0))
}

private struct ProcessAgentAdapterTimeout: Error {}

private func collectEventsWithTimeout(
    from adapter: ProcessAgentAdapter,
    request: AgentLaunchRequest
) async throws -> [RunnerEvent] {
    try await withThrowingTaskGroup(of: [RunnerEvent].self) { group in
        group.addTask {
            var events: [RunnerEvent] = []
            for try await event in adapter.start(request) {
                events.append(event)
            }
            return events
        }

        group.addTask {
            try await Task.sleep(nanoseconds: 2_000_000_000)
            throw ProcessAgentAdapterTimeout()
        }

        let events = try await group.next() ?? []
        group.cancelAll()
        return events
    }
}

private func makeLaunchRequest(executable: URL, stdinText: String? = nil) -> AgentLaunchRequest {
    let run = AgentRun(
        workspaceId: "workspace",
        agentProfileId: "agent",
        promptSnapshot: "prompt"
    )
    return AgentLaunchRequest(
        workspacePath: executable.deletingLastPathComponent().path,
        prompt: "prompt",
        run: run,
        stdinText: stdinText
    )
}

private func makeStdinEchoAgent() throws -> URL {
    let root = URL(fileURLWithPath: NSTemporaryDirectory())
        .appendingPathComponent("pikiclaw-stdin-agent-\(UUID().uuidString)", isDirectory: true)
    try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    let executable = root.appendingPathComponent("stdin-agent")
    try """
    #!/bin/sh
    input="$(cat)"
    printf 'stdin=<%s>\\n' "$input"
    """.write(to: executable, atomically: true, encoding: .utf8)
    try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: executable.path)
    return executable
}
