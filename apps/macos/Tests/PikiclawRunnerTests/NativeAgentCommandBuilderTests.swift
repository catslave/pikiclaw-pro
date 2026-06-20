import Testing
@testable import PikiclawCore
@testable import PikiclawRunner

@Test func codexArgumentsMapPermissionMode() {
    let run = AgentRun(
        workspaceId: "workspace",
        agentProfileId: "agent",
        permissionMode: .readOnly,
        promptSnapshot: "hello"
    )
    let request = AgentLaunchRequest(workspacePath: "/tmp/project", prompt: "hello", run: run)
    let args = NativeAgentCommandBuilder.codexArguments(for: request)

    #expect(args == [
        "--ask-for-approval", "never",
        "exec",
        "--color", "never",
        "--sandbox", "read-only",
        "-C", "/tmp/project",
        "hello"
    ])
}

@Test func geminiArgumentsMapAutopilotToYolo() {
    let run = AgentRun(
        workspaceId: "workspace",
        agentProfileId: "agent",
        permissionMode: .autopilot,
        promptSnapshot: "hello"
    )
    let request = AgentLaunchRequest(workspacePath: "/tmp/project", prompt: "hello", run: run)
    let args = NativeAgentCommandBuilder.geminiArguments(for: request)

    #expect(args.contains("--prompt"))
    #expect(args.contains("hello"))
    #expect(args.contains("yolo"))
}
