import Testing
@testable import PikiclawCore
@testable import PikiclawRunner

@Test func codexArgumentsMapPermissionMode() {
    let request = launchRequest(permissionMode: .readOnly)
    let args = NativeAgentCommandBuilder.codexArguments(for: request)

    #expect(args == [
        "--ask-for-approval", "never",
        "exec",
        "--json",
        "--color", "never",
        "--sandbox", "read-only",
        "-C", "/tmp/project",
        "-"
    ])
}

@Test func geminiArgumentsMapAutopilotToYolo() {
    let request = launchRequest(permissionMode: .autopilot)
    let args = NativeAgentCommandBuilder.geminiArguments(for: request)

    #expect(args.contains("--prompt"))
    #expect(args.contains("hello"))
    #expect(args.contains("yolo"))
}

@Test func geminiArgumentsAvoidInteractiveApprovalForEdits() {
    let request = launchRequest(permissionMode: .askBeforeEdit)
    let args = NativeAgentCommandBuilder.geminiArguments(for: request)

    #expect(args.contains("auto_edit"))
}

@Test func claudeArgumentsUsePrintMode() {
    let request = launchRequest(permissionMode: .readOnly)
    let args = NativeAgentCommandBuilder.claudeArguments(for: request)

    #expect(args == [
        "--print",
        "--output-format", "text",
        "--permission-mode", "plan",
        "hello"
    ])
}

@Test func cursorArgumentsUseHeadlessWorkspaceMode() {
    let request = launchRequest(permissionMode: .autopilot)
    let args = NativeAgentCommandBuilder.cursorArguments(for: request)

    #expect(args.contains("--print"))
    #expect(args.contains("--trust"))
    #expect(args.contains("--workspace"))
    #expect(args.contains("/tmp/project"))
    #expect(args.contains("--yolo"))
    #expect(args.last == "hello")
}

@Test func githubCopilotArgumentsUsePromptMode() {
    let request = launchRequest(permissionMode: .readOnly)
    let args = NativeAgentCommandBuilder.githubCopilotArguments(for: request)

    #expect(args.starts(with: ["copilot"]))
    #expect(args.contains("--no-ask-user"))
    #expect(args.contains("--plan"))
    #expect(args.contains("-C"))
    #expect(args.contains("/tmp/project"))
    #expect(Array(args.suffix(2)) == ["-p", "hello"])
}

@Test func hermesArgumentsUseSingleQueryMode() {
    let request = launchRequest(permissionMode: .autopilot)
    let args = NativeAgentCommandBuilder.hermesArguments(for: request)

    #expect(args == [
        "chat",
        "--quiet",
        "--source", "pikiclaw-native",
        "--query", "hello",
        "--yolo"
    ])
}

private func launchRequest(permissionMode: PermissionMode = .askBeforeEdit) -> AgentLaunchRequest {
    let run = AgentRun(
        workspaceId: "workspace",
        agentProfileId: "agent",
        permissionMode: permissionMode,
        promptSnapshot: "hello"
    )
    return AgentLaunchRequest(workspacePath: "/tmp/project", prompt: "hello", run: run)
}
