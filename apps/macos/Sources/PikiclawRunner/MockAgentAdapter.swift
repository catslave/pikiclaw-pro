import Foundation
import PikiclawCore

public struct MockAgentAdapter: AgentAdapter {
    public let descriptor: AgentDescriptor
    private let output: [String]

    public init(
        descriptor: AgentDescriptor = AgentDescriptor(kind: .codex, displayName: "Codex", executableName: "codex"),
        output: [String] = ["Planning native foundation", "Scaffolding core objects", "Ready"]
    ) {
        self.descriptor = descriptor
        self.output = output
    }

    public func detect() async -> AgentDetection {
        AgentDetection(isAvailable: true, executablePath: "/usr/bin/true", authState: "mock", detail: "Mock adapter")
    }

    public func start(_ request: AgentLaunchRequest) -> AsyncThrowingStream<RunnerEvent, Error> {
        AsyncThrowingStream { continuation in
            continuation.yield(.stateChanged(.running))
            for line in output {
                continuation.yield(.output(line))
            }
            continuation.yield(.completed(exitCode: 0))
            continuation.finish()
        }
    }
}

