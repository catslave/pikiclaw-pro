import Foundation
import Testing
@testable import PikiclawCore
@testable import PikiclawMac
@testable import PikiclawRunner

@MainActor
@Test func startingChatPublishesStreamingStateBeforeCompletion() async throws {
    let directory = URL(fileURLWithPath: NSTemporaryDirectory())
        .appendingPathComponent("pikiclaw-chat-fast-stream-\(UUID().uuidString)", isDirectory: true)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: directory) }

    let workspace = Workspace(
        id: "workspace-fast-stream",
        name: "Fast Stream",
        pathDisplay: directory.path,
        trustState: .trusted
    )
    let agent = AgentProfile(
        id: "agent-fast-stream",
        kind: .codex,
        displayName: "Codex",
        executableName: "codex",
        isEnabled: true
    )
    let item = WorkItem(
        id: "workitem-fast-stream",
        workspaceId: workspace.id,
        title: "Fast streaming chat",
        description: "Start quickly and stream transparently",
        sourceType: .manualPrompt,
        state: .active
    )
    let seed = NativeAppSeed(
        projects: [],
        workspaces: [workspace],
        workItems: [item],
        runs: [],
        artifacts: [],
        capabilities: [],
        knowledgeCards: [],
        automations: [],
        agentProfiles: [agent],
        providerProfiles: []
    )
    let store = JSONNativeStore(fileURL: directory.appendingPathComponent("state.json"), seed: seed)
    let probe = StreamingRunProbe()
    let model = NativeAppModel(
        store: store,
        agentAdapterFactory: { descriptor in
            StreamingRunProbeAdapter(descriptor: descriptor, probe: probe)
        }
    )
    await model.reload()

    let task = Task { @MainActor in
        await model.run(workItemId: item.id)
    }
    await probe.waitForFirstOutput()

    var streamingRun: AgentRun?
    for _ in 0..<50 {
        streamingRun = model.snapshot.runs.first(where: { $0.workItemId == item.id })
        if streamingRun?.state == .running,
           streamingRun?.transcript.contains("first token") == true {
            break
        }
        try await Task.sleep(nanoseconds: 10_000_000)
    }

    let visibleRun = try #require(streamingRun)
    #expect(visibleRun.state == .running)
    #expect(visibleRun.transcript.contains("first token"))
    #expect(model.statusLine == "Streaming output")

    probe.finish(exitCode: 0)
    let runId = try #require(await task.value)
    let finished = try #require((try await store.loadSnapshot()).runs.first(where: { $0.id == runId }))
    #expect(finished.state == .completed)
    #expect(finished.transcript.contains("first token"))
    #expect(model.statusLine == "Run completed")
}

@Test func runOutputFlushThrottlesOnlyDenseOutputEvents() {
    let first = Date(timeIntervalSince1970: 100)
    let recent = Date(timeIntervalSince1970: 100.05)
    let later = Date(timeIntervalSince1970: 100.25)

    #expect(NativeAppModel.shouldFlushRunEventForUI(
        .output("first token"),
        now: first,
        lastOutputFlushAt: .distantPast,
        outputFlushInterval: 0.20
    ))
    #expect(NativeAppModel.shouldFlushRunEventForUI(
        .output("second token"),
        now: recent,
        lastOutputFlushAt: first,
        outputFlushInterval: 0.20
    ) == false)
    #expect(NativeAppModel.shouldFlushRunEventForUI(
        .output("later token"),
        now: later,
        lastOutputFlushAt: first,
        outputFlushInterval: 0.20
    ))
    #expect(NativeAppModel.shouldFlushRunEventForUI(
        .completed(exitCode: 0),
        now: recent,
        lastOutputFlushAt: first,
        outputFlushInterval: 0.20
    ))
}

@MainActor
@Test func completingWorkItemChatAutoCapturesOutputArtifact() async throws {
    let directory = URL(fileURLWithPath: NSTemporaryDirectory())
        .appendingPathComponent("pikiclaw-chat-auto-output-\(UUID().uuidString)", isDirectory: true)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: directory) }

    let workspace = Workspace(
        id: "workspace-chat-auto-output",
        name: "Chat Auto Output",
        pathDisplay: directory.path,
        trustState: .trusted
    )
    let agent = AgentProfile(
        id: "agent-chat-auto-output",
        kind: .codex,
        displayName: "Codex",
        executableName: "codex",
        isEnabled: true
    )
    let item = WorkItem(
        id: "workitem-chat-auto-output",
        workspaceId: workspace.id,
        title: "IVAS-9010: Save agent plan output",
        sourceType: .jira,
        sourceRefs: [
            SourceRef(kind: "jira", label: "IVAS-9010", uri: "https://jira.example/browse/IVAS-9010")
        ],
        state: .active,
        jira: JiraWorkItemFields(key: "IVAS-9010", status: "In Progress")
    )
    let seed = NativeAppSeed(
        projects: [],
        workspaces: [workspace],
        workItems: [item],
        runs: [],
        artifacts: [],
        capabilities: [],
        knowledgeCards: [],
        automations: [],
        agentProfiles: [agent],
        providerProfiles: []
    )
    let store = JSONNativeStore(fileURL: directory.appendingPathComponent("state.json"), seed: seed)
    let model = NativeAppModel(
        store: store,
        agentAdapterFactory: { descriptor in
            MockAgentAdapter(
                descriptor: descriptor,
                output: ["Implementation plan:\n- Move conclusions into Outputs.\n- Keep chat focused on conversation.\n"]
            )
        }
    )
    await model.reload()

    let runId = try #require(await model.run(workItemId: item.id, promptOverride: "Draft the plan"))

    let snapshot = try await store.loadSnapshot()
    let artifact = try #require(snapshot.artifacts.first { artifact in
        artifact.runId == runId
            && artifact.workItemId == item.id
            && artifact.kind == .commandOutputSummary
    })

    #expect(model.statusLine == "Run completed")
    #expect(artifact.status == .ready)
    #expect(artifact.title == "Evidence: IVAS-9010: Save agent plan output")
    #expect(artifact.provenance.contains("Implementation plan"))
    #expect(artifact.sourceRefs.contains(SourceRef(kind: "jira", label: "IVAS-9010", uri: "https://jira.example/browse/IVAS-9010")))
}

@MainActor
@Test func startingCodexChatCapturesNativeSessionRefFromThreadEvent() async throws {
    let directory = URL(fileURLWithPath: NSTemporaryDirectory())
        .appendingPathComponent("pikiclaw-chat-thread-capture-\(UUID().uuidString)", isDirectory: true)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: directory) }

    let workspace = Workspace(
        id: "workspace-chat-thread-capture",
        name: "Chat Thread Capture",
        pathDisplay: directory.path,
        trustState: .trusted
    )
    let agent = AgentProfile(
        id: "agent-chat-thread-capture",
        kind: .codex,
        displayName: "Codex",
        executableName: "codex",
        isEnabled: true
    )
    let item = WorkItem(
        id: "workitem-chat-thread-capture",
        workspaceId: workspace.id,
        title: "Capture Codex thread id",
        sourceType: .manualPrompt,
        state: .active
    )
    let seed = NativeAppSeed(
        projects: [],
        workspaces: [workspace],
        workItems: [item],
        runs: [],
        artifacts: [],
        capabilities: [],
        knowledgeCards: [],
        automations: [],
        agentProfiles: [agent],
        providerProfiles: []
    )
    let store = JSONNativeStore(fileURL: directory.appendingPathComponent("state.json"), seed: seed)
    let model = NativeAppModel(
        store: store,
        agentAdapterFactory: { descriptor in
            MockAgentAdapter(
                descriptor: descriptor,
                output: [
                    "{\"type\":\"thread.started\",\"thread_id\":\"019eed67-c4fb-7812-8584-84500b29fd4a\"}\n",
                    "{\"type\":\"item.completed\",\"item\":{\"id\":\"item_0\",\"type\":\"agent_message\",\"text\":\"ready\"}}\n"
                ]
            )
        }
    )
    await model.reload()

    let runId = try #require(await model.run(workItemId: item.id, promptOverride: "Start a session"))

    let run = try #require((try await store.loadSnapshot()).runs.first(where: { $0.id == runId }))
    #expect(run.nativeSessionRef == "019eed67-c4fb-7812-8584-84500b29fd4a")
}

@MainActor
@Test func startingAnotherChatDoesNotWaitForActiveRunToFinish() async throws {
    let directory = URL(fileURLWithPath: NSTemporaryDirectory())
        .appendingPathComponent("pikiclaw-chat-parallel-\(UUID().uuidString)", isDirectory: true)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: directory) }

    let workspace = Workspace(
        id: "workspace-parallel-chat",
        name: "Parallel Chat",
        pathDisplay: directory.path,
        trustState: .trusted
    )
    let agent = AgentProfile(
        id: "agent-parallel-chat",
        kind: .codex,
        displayName: "Codex",
        executableName: "codex",
        isEnabled: true
    )
    let firstItem = WorkItem(
        id: "workitem-parallel-first",
        workspaceId: workspace.id,
        title: "First chat",
        description: "Keep streaming",
        sourceType: .manualPrompt,
        state: .active
    )
    let secondItem = WorkItem(
        id: "workitem-parallel-second",
        workspaceId: workspace.id,
        title: "Second chat",
        description: "Start without waiting",
        sourceType: .manualPrompt,
        state: .active
    )
    let seed = NativeAppSeed(
        projects: [],
        workspaces: [workspace],
        workItems: [firstItem, secondItem],
        runs: [],
        artifacts: [],
        capabilities: [],
        knowledgeCards: [],
        automations: [],
        agentProfiles: [agent],
        providerProfiles: []
    )
    let store = JSONNativeStore(fileURL: directory.appendingPathComponent("state.json"), seed: seed)
    let probe = StreamingRunProbe()
    let model = NativeAppModel(
        store: store,
        agentAdapterFactory: { descriptor in
            StreamingRunProbeAdapter(descriptor: descriptor, probe: probe)
        }
    )
    await model.reload()

    let firstTask = Task { @MainActor in
        await model.run(workItemId: firstItem.id)
    }
    await probe.waitForFirstOutput()

    let secondTask = Task { @MainActor in
        await model.run(workItemId: secondItem.id)
    }
    var activeWorkItemIds = Set<EntityID>()
    let expectedActiveWorkItemIds: Set<EntityID> = [firstItem.id, secondItem.id]
    for _ in 0..<50 {
        if probe.emittedOutputCount >= 2 {
            activeWorkItemIds = Set(
                model.snapshot.runs
                    .filter { $0.state == .running }
                    .compactMap(\.workItemId)
            )
            if activeWorkItemIds == expectedActiveWorkItemIds { break }
        }
        try await Task.sleep(nanoseconds: 10_000_000)
    }

    #expect(probe.emittedOutputCount == 2)
    #expect(activeWorkItemIds == expectedActiveWorkItemIds)

    probe.finishAll(exitCode: 0)
    let firstRunId = try #require(await firstTask.value)
    let secondRunId = try #require(await secondTask.value)
    #expect(firstRunId != secondRunId)
}

@MainActor
@Test func sendingNextChatMessagePreservesPreviousTurnInHistory() async throws {
    let directory = URL(fileURLWithPath: NSTemporaryDirectory())
        .appendingPathComponent("pikiclaw-chat-history-\(UUID().uuidString)", isDirectory: true)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: directory) }

    let workspace = Workspace(
        id: "workspace-chat-history",
        name: "Chat History",
        pathDisplay: directory.path,
        trustState: .trusted
    )
    let agent = AgentProfile(
        id: "agent-codex-history",
        kind: .codex,
        displayName: "Codex",
        executableName: "codex",
        isEnabled: true
    )
    let run = AgentRun(
        id: "run-chat-history",
        workspaceId: workspace.id,
        agentProfileId: agent.id,
        state: .completed,
        endedAt: Date(timeIntervalSince1970: 10),
        promptSnapshot: "first question",
        transcript: "first answer\n[completed with exit code 0]\n"
    )
    let seed = NativeAppSeed(
        projects: [],
        workspaces: [workspace],
        workItems: [],
        runs: [run],
        artifacts: [],
        capabilities: [],
        knowledgeCards: [],
        automations: [],
        agentProfiles: [agent],
        providerProfiles: []
    )
    let store = JSONNativeStore(fileURL: directory.appendingPathComponent("state.json"), seed: seed)
    let model = NativeAppModel(
        store: store,
        agentAdapterFactory: { descriptor in
            MockAgentAdapter(descriptor: descriptor, output: ["second answer\n"])
        }
    )
    await model.reload()

    let sentRunId = try #require(await model.sendMessage(in: run.id, message: "second question"))

    #expect(sentRunId == run.id)
    let updated = try #require((try await store.loadSnapshot()).runs.first(where: { $0.id == run.id }))
    #expect(updated.promptSnapshot == "second question")
    #expect(updated.transcript.contains("second answer"))
    #expect(updated.messages.map(\.role) == [.user, .assistant])
    #expect(updated.messages[0].content == "first question")
    #expect(updated.messages[1].content.contains("first answer"))
}

@MainActor
@Test func sendingMessageWhileRunIsActiveQueuesNextTurn() async throws {
    let directory = URL(fileURLWithPath: NSTemporaryDirectory())
        .appendingPathComponent("pikiclaw-chat-queue-active-\(UUID().uuidString)", isDirectory: true)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: directory) }

    let workspace = Workspace(
        id: "workspace-chat-queue-active",
        name: "Chat Queue Active",
        pathDisplay: directory.path,
        trustState: .trusted
    )
    let agent = AgentProfile(
        id: "agent-chat-queue-active",
        kind: .codex,
        displayName: "Codex",
        executableName: "codex",
        isEnabled: true
    )
    let run = AgentRun(
        id: "run-chat-queue-active",
        workspaceId: workspace.id,
        agentProfileId: agent.id,
        state: .running,
        startedAt: Date(timeIntervalSince1970: 10),
        promptSnapshot: "first question",
        transcript: "working\n"
    )
    let seed = NativeAppSeed(
        projects: [],
        workspaces: [workspace],
        workItems: [],
        runs: [run],
        artifacts: [],
        capabilities: [],
        knowledgeCards: [],
        automations: [],
        agentProfiles: [agent],
        providerProfiles: []
    )
    let store = JSONNativeStore(fileURL: directory.appendingPathComponent("state.json"), seed: seed)
    let model = NativeAppModel(store: store)
    await model.reload()

    let sentRunId = try #require(await model.sendMessage(
        in: run.id,
        message: "second question",
        permissionMode: .readOnly
    ))

    #expect(sentRunId == run.id)
    let updated = try #require((try await store.loadSnapshot()).runs.first(where: { $0.id == run.id }))
    #expect(updated.promptSnapshot == "first question")
    #expect(updated.transcript == "working\n")
    #expect(updated.queuedMessages.count == 1)
    #expect(updated.queuedMessages.first?.content == "second question")
    #expect(updated.queuedMessages.first?.permissionMode == .readOnly)
    #expect(model.statusLine == "1 message(s) queued")
}

@MainActor
@Test func queuedChatMessageStartsAfterActiveRunCompletes() async throws {
    let directory = URL(fileURLWithPath: NSTemporaryDirectory())
        .appendingPathComponent("pikiclaw-chat-queue-drain-\(UUID().uuidString)", isDirectory: true)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: directory) }

    let workspace = Workspace(
        id: "workspace-chat-queue-drain",
        name: "Chat Queue Drain",
        pathDisplay: directory.path,
        trustState: .trusted
    )
    let agent = AgentProfile(
        id: "agent-chat-queue-drain",
        kind: .codex,
        displayName: "Codex",
        executableName: "codex",
        isEnabled: true
    )
    let item = WorkItem(
        id: "workitem-chat-queue-drain",
        workspaceId: workspace.id,
        title: "Queued chat",
        description: "first question",
        sourceType: .manualPrompt,
        state: .active
    )
    let seed = NativeAppSeed(
        projects: [],
        workspaces: [workspace],
        workItems: [item],
        runs: [],
        artifacts: [],
        capabilities: [],
        knowledgeCards: [],
        automations: [],
        agentProfiles: [agent],
        providerProfiles: []
    )
    let store = JSONNativeStore(fileURL: directory.appendingPathComponent("state.json"), seed: seed)
    let probe = StreamingRunProbe()
    let model = NativeAppModel(
        store: store,
        agentAdapterFactory: { descriptor in
            StreamingRunProbeAdapter(descriptor: descriptor, probe: probe)
        }
    )
    await model.reload()

    let task = Task { @MainActor in
        await model.run(workItemId: item.id)
    }
    await probe.waitForFirstOutput()
    let activeRun = try #require(model.snapshot.runs.first(where: { $0.workItemId == item.id }))

    _ = try #require(await model.sendMessage(
        in: activeRun.id,
        message: "second question",
        permissionMode: .readOnly
    ))
    let queued = try #require((try await store.loadSnapshot()).runs.first(where: { $0.id == activeRun.id }))
    #expect(queued.queuedMessages.map(\.content) == ["second question"])

    probe.finish(exitCode: 0)
    await probe.waitForOutputCount(2)
    probe.finish(exitCode: 0)

    let drainedRunId = try #require(await task.value)
    #expect(drainedRunId == activeRun.id)
    let final = try #require((try await store.loadSnapshot()).runs.first(where: { $0.id == activeRun.id }))
    #expect(final.state == .completed)
    #expect(final.promptSnapshot == "second question")
    #expect(final.permissionMode == .readOnly)
    #expect(final.queuedMessages.isEmpty)
    #expect(final.messages.first?.role == .user)
    #expect(final.messages.first?.content == "first question")
    #expect(final.messages.dropFirst().first?.role == .assistant)
    #expect(final.messages.dropFirst().first?.content.contains("first token") == true)
}

@MainActor
@Test func rerunningChatPreservesPreviousAttemptInHistory() async throws {
    let directory = URL(fileURLWithPath: NSTemporaryDirectory())
        .appendingPathComponent("pikiclaw-chat-rerun-\(UUID().uuidString)", isDirectory: true)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: directory) }

    let workspace = Workspace(
        id: "workspace-chat-rerun",
        name: "Chat Rerun",
        pathDisplay: directory.path,
        trustState: .trusted
    )
    let agent = AgentProfile(
        id: "agent-codex-rerun",
        kind: .codex,
        displayName: "Codex",
        executableName: "codex",
        isEnabled: true
    )
    let run = AgentRun(
        id: "run-chat-rerun",
        workspaceId: workspace.id,
        agentProfileId: agent.id,
        state: .failed,
        endedAt: Date(timeIntervalSince1970: 10),
        promptSnapshot: "same question",
        transcript: "first failed answer\n[completed with exit code 1]\n"
    )
    let seed = NativeAppSeed(
        projects: [],
        workspaces: [workspace],
        workItems: [],
        runs: [run],
        artifacts: [],
        capabilities: [],
        knowledgeCards: [],
        automations: [],
        agentProfiles: [agent],
        providerProfiles: []
    )
    let store = JSONNativeStore(fileURL: directory.appendingPathComponent("state.json"), seed: seed)
    let model = NativeAppModel(
        store: store,
        agentAdapterFactory: { descriptor in
            MockAgentAdapter(descriptor: descriptor, output: ["second answer\n"])
        }
    )
    await model.reload()

    let rerunId = try #require(await model.rerunChat(runId: run.id))

    #expect(rerunId == run.id)
    let updated = try #require((try await store.loadSnapshot()).runs.first(where: { $0.id == run.id }))
    #expect(updated.promptSnapshot == "same question")
    #expect(updated.transcript.contains("second answer"))
    #expect(updated.messages.map(\.role) == [.user, .assistant])
    #expect(updated.messages.count == 2)
    let firstMessage = try #require(updated.messages.first)
    let secondMessage = try #require(updated.messages.dropFirst().first)
    #expect(firstMessage.content == "same question")
    #expect(secondMessage.content.contains("first failed answer"))
}

@MainActor
@Test func sendingNextChatMessagePassesHistoryToAgent() async throws {
    let directory = URL(fileURLWithPath: NSTemporaryDirectory())
        .appendingPathComponent("pikiclaw-chat-history-prompt-\(UUID().uuidString)", isDirectory: true)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: directory) }

    let workspace = Workspace(
        id: "workspace-chat-history-prompt",
        name: "Chat History Prompt",
        pathDisplay: directory.path,
        trustState: .trusted
    )
    let agent = AgentProfile(
        id: "agent-codex-history-prompt",
        kind: .codex,
        displayName: "Codex",
        executableName: "codex",
        isEnabled: true
    )
    let run = AgentRun(
        id: "run-chat-history-prompt",
        workspaceId: workspace.id,
        agentProfileId: agent.id,
        state: .completed,
        endedAt: Date(timeIntervalSince1970: 10),
        promptSnapshot: "first question",
        transcript: "first answer\n[completed with exit code 0]\n"
    )
    let seed = NativeAppSeed(
        projects: [],
        workspaces: [workspace],
        workItems: [],
        runs: [run],
        artifacts: [],
        capabilities: [],
        knowledgeCards: [],
        automations: [],
        agentProfiles: [agent],
        providerProfiles: []
    )
    let store = JSONNativeStore(fileURL: directory.appendingPathComponent("state.json"), seed: seed)
    let capture = PromptCapture()
    let model = NativeAppModel(
        store: store,
        agentAdapterFactory: { descriptor in
            CapturingAgentAdapter(descriptor: descriptor, capture: capture)
        }
    )
    await model.reload()

    _ = try #require(await model.sendMessage(in: run.id, message: "second question"))

    let prompt = try #require(capture.prompts.last)
    #expect(prompt.contains("Conversation so far:"))
    #expect(prompt.contains("User: first question"))
    #expect(prompt.contains("Assistant: first answer"))
    #expect(prompt.contains("User: second question"))
}

@MainActor
@Test func sendingCodexNextMessageResumesNativeSessionWithCurrentPromptOnly() async throws {
    let directory = URL(fileURLWithPath: NSTemporaryDirectory())
        .appendingPathComponent("pikiclaw-chat-native-resume-\(UUID().uuidString)", isDirectory: true)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: directory) }

    let workspace = Workspace(
        id: "workspace-chat-native-resume",
        name: "Chat Native Resume",
        pathDisplay: directory.path,
        trustState: .trusted
    )
    let agent = AgentProfile(
        id: "agent-codex-native-resume",
        kind: .codex,
        displayName: "Codex",
        executableName: "codex",
        isEnabled: true
    )
    let run = AgentRun(
        id: "run-chat-native-resume",
        workspaceId: workspace.id,
        agentProfileId: agent.id,
        state: .completed,
        endedAt: Date(timeIntervalSince1970: 10),
        nativeSessionRef: "019eed67-c4fb-7812-8584-84500b29fd4a",
        promptSnapshot: "first question",
        transcript: "first answer\n[completed with exit code 0]\n"
    )
    let seed = NativeAppSeed(
        projects: [],
        workspaces: [workspace],
        workItems: [],
        runs: [run],
        artifacts: [],
        capabilities: [],
        knowledgeCards: [],
        automations: [],
        agentProfiles: [agent],
        providerProfiles: []
    )
    let store = JSONNativeStore(fileURL: directory.appendingPathComponent("state.json"), seed: seed)
    let capture = PromptCapture()
    let model = NativeAppModel(
        store: store,
        agentAdapterFactory: { descriptor in
            CapturingAgentAdapter(descriptor: descriptor, capture: capture)
        }
    )
    await model.reload()

    _ = try #require(await model.sendMessage(in: run.id, message: "second question"))

    #expect(capture.prompts.last == "second question")
    #expect(capture.stdinTexts.last == "second question")
    #expect(capture.arguments.last == [
        "--ask-for-approval", "never",
        "--sandbox", "workspace-write",
        "-C", directory.path,
        "exec",
        "resume",
        "--json",
        "019eed67-c4fb-7812-8584-84500b29fd4a",
        "-"
    ])
    let updated = try #require((try await store.loadSnapshot()).runs.first(where: { $0.id == run.id }))
    #expect(updated.nativeSessionRef == "019eed67-c4fb-7812-8584-84500b29fd4a")
}

@MainActor
@Test func sendingFollowUpReplyCanOverrideRunPermission() async throws {
    let directory = URL(fileURLWithPath: NSTemporaryDirectory())
        .appendingPathComponent("pikiclaw-chat-follow-up-permission-\(UUID().uuidString)", isDirectory: true)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: directory) }

    let workspace = Workspace(
        id: "workspace-chat-follow-up-permission",
        name: "Chat Follow-up Permission",
        pathDisplay: directory.path,
        trustState: .trusted
    )
    let agent = AgentProfile(
        id: "agent-chat-follow-up-permission",
        kind: .codex,
        displayName: "Codex",
        executableName: "codex",
        isEnabled: true
    )
    let run = AgentRun(
        id: "run-chat-follow-up-permission",
        workspaceId: workspace.id,
        agentProfileId: agent.id,
        permissionMode: .autopilot,
        state: .completed,
        endedAt: Date(timeIntervalSince1970: 10),
        promptSnapshot: "implement the Jira sync fix",
        transcript: "implementation completed\n[completed with exit code 0]\n"
    )
    let seed = NativeAppSeed(
        projects: [],
        workspaces: [workspace],
        workItems: [],
        runs: [run],
        artifacts: [],
        capabilities: [],
        knowledgeCards: [],
        automations: [],
        agentProfiles: [agent],
        providerProfiles: []
    )
    let store = JSONNativeStore(fileURL: directory.appendingPathComponent("state.json"), seed: seed)
    let capture = PromptCapture()
    let model = NativeAppModel(
        store: store,
        agentAdapterFactory: { descriptor in
            CapturingAgentAdapter(descriptor: descriptor, capture: capture)
        }
    )
    await model.reload()

    let sentRunId = try #require(await model.sendMessage(
        in: run.id,
        message: "Review this as a read-only follow-up.",
        permissionMode: .readOnly
    ))

    #expect(sentRunId == run.id)
    let updated = try #require((try await store.loadSnapshot()).runs.first(where: { $0.id == run.id }))
    #expect(updated.permissionMode == .readOnly)
    #expect(updated.promptSnapshot == "Review this as a read-only follow-up.")
    #expect(capture.permissionModes.last == .readOnly)
}

@Test func chatRunFollowUpActionsPrioritizeFailureAndJiraNextSteps() {
    let longLead = String(repeating: "Preparing Jira sync context. ", count: 24)
    let assistantOutput = """
    \(longLead)
    Steps to reproduce:
    - Open native Jira queue
    - Sync current sprint
    Observed: queue sync failed after Jira MCP search
    Expected: Queue keeps Jira tickets visible or records a sync blocker
    Root cause: Jira MCP search failure is surfaced only as terminal output.
    Likely seam: Native Jira sync result mapping drops blocker context before work items render.
    Impact: current sprint queue can look empty while sync is blocked.
    Proposed fix: persist a sync blocker artifact before clearing candidates.
    error: queue sync failed after Jira MCP search
    Process exited with code 1
    """
    let run = AgentRun(
        id: "run-follow-up",
        workspaceId: "workspace-follow-up",
        agentProfileId: "agent-follow-up",
        state: .failed,
        promptSnapshot: "Fix Jira queue",
        transcript: assistantOutput
    )
    let workItem = WorkItem(
        id: "workitem-follow-up",
        workspaceId: "workspace-follow-up",
        title: "Repair native Jira queue",
        sourceType: .jira,
        sourceRefs: [
            SourceRef(kind: "chat-run", label: "Prior queue triage", uri: "pikiclaw://runs/run-queue-triage"),
            SourceRef(kind: "obsidian", label: "Queue sync note")
        ],
        state: .active,
        acceptanceCriteria: [
            "Queue sync keeps Jira tickets visible",
            "Follow-up actions preserve source evidence"
        ],
        externalRefs: [
            SourceRef(kind: "gitlab", label: "Queue MR", uri: "https://gitlab.example.com/pikiclaw/mr/901")
        ],
        jira: JiraWorkItemFields(key: "IVAS-9001", status: "In Progress")
    )

    let actions = chatRunFollowUpActions(
        run: run,
        workItem: workItem,
        assistantText: assistantOutput
    )

    #expect(actions.map(\.id) == ["bug-analysis", "mr-review", "validation", "jira-update"])
    #expect(actions[0].prompt.contains("Analyze this run as a bug"))
    #expect(actions[0].detail == "Read-only triage")
    #expect(actions[0].permissionMode == .readOnly)
    #expect(actions[0].prompt.contains("Output contract:"))
    #expect(actions[0].prompt.contains("Confirmed facts, likely seam, smallest safe fix, focused validation, and missing input"))
    #expect(actions[0].prompt.contains("Read-only follow-up"))
    #expect(actions[1].prompt.contains("code-review stance"))
    #expect(actions[1].detail == "Read-only review")
    #expect(actions[1].permissionMode == .readOnly)
    #expect(actions[1].prompt.contains("findings, open questions, verification gaps, and ready/not-ready"))
    #expect(actions[1].prompt.contains("Put findings first, ordered by severity"))
    #expect(actions[1].prompt.contains("Read-only follow-up"))
    #expect(actions[2].prompt.contains("narrowest useful test"))
    #expect(actions[2].detail == "Validate only")
    #expect(actions[2].permissionMode == .askBeforeEdit)
    #expect(actions[2].prompt.contains("check run, result, evidence, and next action"))
    #expect(actions[2].prompt.contains("Do not modify implementation in this validation pass"))
    #expect(actions[2].prompt.contains("Ask-before-edit follow-up"))
    #expect(actions[2].prompt.contains("Ask before editing files"))
    #expect(actions[2].prompt.contains("Keep validation evidence separate from proposed fixes"))
    #expect(actions[3].prompt.contains("Jira-ready update"))
    #expect(actions[3].detail == "Read-only update")
    #expect(actions[3].permissionMode == .readOnly)
    #expect(actions[3].prompt.contains("paste-ready Jira comment with Status, Evidence, Validation, Blockers, and Next action"))
    #expect(actions[3].prompt.contains("Read-only follow-up"))
    #expect(actions.allSatisfy { $0.prompt.contains("Run context:") })
    #expect(actions[1].prompt.contains("- Original prompt: Fix Jira queue"))
    #expect(actions[1].prompt.contains("- State: failed"))
    #expect(actions[1].prompt.contains("- Jira: IVAS-9001 · In Progress"))
    #expect(actions[1].prompt.contains("- Acceptance: Queue sync keeps Jira tickets visible; Follow-up actions preserve source evidence"))
    #expect(actions[1].prompt.contains("- Source refs: chat-run: Prior queue triage (pikiclaw://runs/run-queue-triage); obsidian: Queue sync note"))
    #expect(actions[1].prompt.contains("- External refs: gitlab: Queue MR (https://gitlab.example.com/pikiclaw/mr/901)"))
    #expect(actions[0].prompt.contains("Reproduction notes:"))
    #expect(actions[0].prompt.contains("Steps: Open native Jira queue | Sync current sprint"))
    #expect(actions[0].prompt.contains("Observed: queue sync failed after Jira MCP search"))
    #expect(actions[0].prompt.contains("Expected: Queue keeps Jira tickets visible or records a sync blocker"))
    #expect(actions[3].prompt.contains("Steps: Open native Jira queue | Sync current sprint"))
    #expect(actions[3].prompt.contains("Expected: Queue keeps Jira tickets visible or records a sync blocker"))
    #expect(actions[0].prompt.contains("Diagnosis notes:"))
    #expect(actions[0].prompt.contains("Root cause: Jira MCP search failure is surfaced only as terminal output."))
    #expect(actions[0].prompt.contains("Likely seam: Native Jira sync result mapping drops blocker context before work items render."))
    #expect(actions[0].prompt.contains("Impact: current sprint queue can look empty while sync is blocked."))
    #expect(actions[0].prompt.contains("Fix path: persist a sync blocker artifact before clearing candidates."))
    #expect(actions[3].prompt.contains("Likely seam: Native Jira sync result mapping drops blocker context before work items render."))
    #expect(actions[3].prompt.contains("Fix path: persist a sync blocker artifact before clearing candidates."))
    #expect(actions[0].prompt.contains("Failure signals:"))
    #expect(actions[0].prompt.contains("error: queue sync failed after Jira MCP search"))
    #expect(actions[0].prompt.contains("Process exited with code 1"))
    #expect(actions.allSatisfy { $0.prompt.contains("Prior queue triage") })
}

@Test func chatRunFollowUpActionsStayHiddenForSimpleStatusAnswer() {
    let assistantOutput = "Agent: 当前没有 active goal，数量是 0。"
    let run = AgentRun(
        id: "run-simple-goal-count",
        workspaceId: "workspace-simple-goal-count",
        agentProfileId: "agent-simple-goal-count",
        state: .completed,
        promptSnapshot: "当前有多少个 goal",
        transcript: assistantOutput
    )
    let workItem = WorkItem(
        id: "workitem-simple-goal-count",
        workspaceId: "workspace-simple-goal-count",
        title: "当前有多少个 goal",
        description: "当前有多少个 goal",
        sourceType: .manualPrompt,
        state: .active
    )

    let actions = chatRunFollowUpActions(
        run: run,
        workItem: workItem,
        assistantText: assistantOutput
    )
    let confirmedStatusOutput = "Confirmed no active goal is active."

    #expect(actions.isEmpty)
    #expect(chatCanCaptureEvidence(run: run, assistantText: assistantOutput) == false)
    #expect(chatCanCaptureEvidence(run: run, assistantText: confirmedStatusOutput) == false)
}

@Test func chatRunFollowUpActionsGenerateContinueButtonWhenAgentAsks() {
    let assistantOutput = """
    I finished the first pass and found the likely implementation seam.
    I can continue with the next scoped implementation step. Would you like me to continue?
    """
    let run = AgentRun(
        id: "run-follow-up-continue",
        workspaceId: "workspace-follow-up",
        agentProfileId: "agent-follow-up",
        state: .completed,
        promptSnapshot: "Improve native generative UI",
        transcript: assistantOutput
    )
    let workItem = WorkItem(
        id: "workitem-follow-up-continue",
        workspaceId: "workspace-follow-up",
        title: "Add generative UI actions",
        sourceType: .manualPrompt,
        state: .active
    )

    let actions = chatRunFollowUpActions(
        run: run,
        workItem: workItem,
        assistantText: assistantOutput
    )

    #expect(actions.map { $0.id } == ["continue", "mr-review", "validation", "capture-evidence"])
    #expect(actions[0].title == "Continue")
    #expect(actions[0].detail == "Continue turn")
    #expect(actions[0].permissionMode == PermissionMode.askBeforeEdit)
    #expect(actions[0].isGeneratedUI)
    #expect(actions[0].generatedUIRole == .continuation)
    #expect(actions[1].isGeneratedUI == false)
    #expect(actions[0].prompt.contains("The assistant asked whether to continue"))
    #expect(actions[0].prompt.contains("Do not restart from scratch"))
    #expect(actions[0].prompt.contains("without asking the user to type \"continue\""))
    #expect(actions[0].prompt.contains("Generated UI contract:"))
    #expect(actions[0].prompt.contains("emit a fenced `pikiclaw-ui` JSON block"))
}

@Test func chatRunFollowUpActionsGenerateConfirmationButtonsWhenAgentAsksForApproval() {
    let assistantOutput = """
    I prepared a reusable evidence summary for this generated UI run.
    Should I save this evidence to Obsidian?
    """
    let run = AgentRun(
        id: "run-follow-up-confirmation",
        workspaceId: "workspace-follow-up",
        agentProfileId: "agent-follow-up",
        state: .completed,
        promptSnapshot: "Prepare generated UI evidence",
        transcript: assistantOutput
    )
    let workItem = WorkItem(
        id: "workitem-follow-up-confirmation",
        workspaceId: "workspace-follow-up",
        title: "Make approval prompts clickable",
        sourceType: .manualPrompt,
        state: .active
    )

    let actions = chatRunFollowUpActions(
        run: run,
        workItem: workItem,
        assistantText: assistantOutput
    )

    #expect(actions.map(\.id) == ["confirm-approve-1", "confirm-decline-1", "mr-review", "validation"])
    #expect(actions[0].title == "Save")
    #expect(actions[0].detail == "Generated confirm")
    #expect(actions[0].isGeneratedUI)
    #expect(actions[0].generatedUIRole == .confirmationApprove)
    #expect(actions[0].permissionMode == .askBeforeEdit)
    #expect(actions[0].prompt.contains("Should I save this evidence to Obsidian?"))
    #expect(actions[0].prompt.contains("explicit approval for the asked path"))
    #expect(actions[0].prompt.contains("Do not ask the user to type yes, no, approve, skip, or continue"))
    #expect(actions[1].title == "Not now")
    #expect(actions[1].detail == "Generated confirm")
    #expect(actions[1].isGeneratedUI)
    #expect(actions[1].generatedUIRole == .confirmationDecline)
    #expect(actions[1].permissionMode == .readOnly)
    #expect(actions[1].prompt.contains("explicit choice not to take the asked path"))
    #expect(actions[2].isGeneratedUI == false)
}

@Test func chatRunFollowUpActionsTreatContinuePostPromptAsConfirmation() {
    let assistantOutput = """
    Jira update:
    Status: validation passed and ready to post.
    Evidence: focused follow-up tests passed.
    Should I continue by posting this Jira update to IVAS-9053?
    """
    let run = AgentRun(
        id: "run-follow-up-confirmation-jira-post",
        workspaceId: "workspace-follow-up",
        agentProfileId: "agent-follow-up",
        state: .completed,
        promptSnapshot: "Prepare IVAS-9053 Jira update",
        transcript: assistantOutput
    )
    let workItem = WorkItem(
        id: "workitem-follow-up-confirmation-jira-post",
        workspaceId: "workspace-follow-up",
        title: "Post ready Jira update",
        sourceType: .jira,
        state: .review,
        jira: JiraWorkItemFields(key: "IVAS-9053", status: "In Review")
    )

    let actions = chatRunFollowUpActions(
        run: run,
        workItem: workItem,
        assistantText: assistantOutput
    )

    #expect(actions.map(\.id) == ["confirm-approve-1", "confirm-decline-1", "validation", "jira-update"])
    #expect(actions[0].title == "Post")
    #expect(actions[0].permissionMode == .askBeforeEdit)
    #expect(actions[0].prompt.contains("Should I continue by posting this Jira update to IVAS-9053?"))
    #expect(actions[0].prompt.contains("explicit approval for the asked path"))
    #expect(actions[0].prompt.contains("Do not ask the user to type yes, no, approve, skip, or continue"))
    #expect(actions[1].title == "Not now")
    #expect(actions[2].title == "Validate")
    #expect(actions[3].title == "Jira")
    #expect(actions[3].prompt.contains("Ticket refs: IVAS-9053"))
}

@Test func chatRunFollowUpActionsTreatContinueJiraUpdatePromptAsPostConfirmation() {
    let assistantOutput = """
    Jira update:
    Status: validation passed and summary is ready.
    Should I continue by updating Jira with this validation summary?
    """
    let run = AgentRun(
        id: "run-follow-up-confirmation-jira-update",
        workspaceId: "workspace-follow-up",
        agentProfileId: "agent-follow-up",
        state: .completed,
        promptSnapshot: "Prepare IVAS-9056 Jira update",
        transcript: assistantOutput
    )
    let workItem = WorkItem(
        id: "workitem-follow-up-confirmation-jira-update",
        workspaceId: "workspace-follow-up",
        title: "Post validation summary to Jira",
        sourceType: .jira,
        state: .review,
        jira: JiraWorkItemFields(key: "IVAS-9056", status: "In Review")
    )

    let actions = chatRunFollowUpActions(
        run: run,
        workItem: workItem,
        assistantText: assistantOutput
    )

    #expect(actions.map(\.id) == ["confirm-approve-1", "confirm-decline-1", "validation", "jira-update"])
    #expect(actions[0].title == "Post")
    #expect(actions[0].permissionMode == .askBeforeEdit)
    #expect(actions[0].prompt.contains("Should I continue by updating Jira with this validation summary?"))
    #expect(actions[0].prompt.contains("explicit approval for the asked path"))
    #expect(actions[1].title == "Not now")
    #expect(actions[3].title == "Jira")
    #expect(actions[3].prompt.contains("Ticket refs: IVAS-9056"))
}

@Test func chatRunFollowUpActionsTreatChineseJiraPostPromptAsConfirmation() {
    let assistantOutput = """
    Jira 更新：
    Status: validation passed.
    是否继续发布这个 Jira 更新到 IVAS-9060？
    """
    let run = AgentRun(
        id: "run-follow-up-confirmation-chinese-jira-post",
        workspaceId: "workspace-follow-up",
        agentProfileId: "agent-follow-up",
        state: .completed,
        promptSnapshot: "准备 IVAS-9060 Jira 更新",
        transcript: assistantOutput
    )
    let workItem = WorkItem(
        id: "workitem-follow-up-confirmation-chinese-jira-post",
        workspaceId: "workspace-follow-up",
        title: "Post Chinese Jira update",
        sourceType: .jira,
        state: .review,
        jira: JiraWorkItemFields(key: "IVAS-9060", status: "In Review")
    )

    let actions = chatRunFollowUpActions(
        run: run,
        workItem: workItem,
        assistantText: assistantOutput
    )

    #expect(actions.map(\.id) == ["confirm-approve-1", "confirm-decline-1", "validation", "jira-update"])
    #expect(actions[0].title == "Post")
    #expect(actions[0].generatedUIRole == .confirmationApprove)
    #expect(actions[0].permissionMode == .askBeforeEdit)
    #expect(actions[0].prompt.contains("是否继续发布这个 Jira 更新到 IVAS-9060？"))
    #expect(actions[1].generatedUIRole == .confirmationDecline)
    #expect(actions[3].title == "Jira")
    #expect(actions[3].prompt.contains("Ticket refs: IVAS-9060"))
}

@Test func chatRunFollowUpActionsKeepPlainJiraContinueAsContinue() {
    let assistantOutput = """
    Jira: IVAS-9054
    Status: I found the likely queue sync seam and can keep narrowing it.
    Should I continue with the Jira investigation?
    """
    let run = AgentRun(
        id: "run-follow-up-plain-jira-continue",
        workspaceId: "workspace-follow-up",
        agentProfileId: "agent-follow-up",
        state: .completed,
        promptSnapshot: "Investigate IVAS-9054 Jira queue",
        transcript: assistantOutput
    )
    let workItem = WorkItem(
        id: "workitem-follow-up-plain-jira-continue",
        workspaceId: "workspace-follow-up",
        title: "Continue Jira investigation",
        sourceType: .jira,
        state: .active,
        jira: JiraWorkItemFields(key: "IVAS-9054", status: "In Progress")
    )

    let actions = chatRunFollowUpActions(
        run: run,
        workItem: workItem,
        assistantText: assistantOutput
    )

    #expect(actions.map(\.id) == ["continue", "mr-review", "validation", "jira-update"])
    #expect(actions[0].title == "Continue")
    #expect(actions[0].prompt.contains("Treat this click as approval to continue"))
    #expect(actions[0].prompt.contains("Should I continue with the Jira investigation?"))
    #expect(actions[0].prompt.contains("generated confirmation") == false)
    #expect(actions[3].title == "Jira")
    #expect(actions[3].prompt.contains("Ticket refs: IVAS-9054"))
}

@Test func chatRunFollowUpActionsKeepJiraParserUpdatePromptAsContinue() {
    let assistantOutput = """
    Status: I found the parser seam that keeps Jira queue rows stale.
    Should I continue by updating the Jira parser implementation?
    """
    let run = AgentRun(
        id: "run-follow-up-jira-parser-continue",
        workspaceId: "workspace-follow-up",
        agentProfileId: "agent-follow-up",
        state: .completed,
        promptSnapshot: "Improve Jira parser implementation",
        transcript: assistantOutput
    )
    let workItem = WorkItem(
        id: "workitem-follow-up-jira-parser-continue",
        workspaceId: "workspace-follow-up",
        title: "Improve Jira parser",
        sourceType: .jira,
        state: .active,
        jira: JiraWorkItemFields(key: "IVAS-9057", status: "In Progress")
    )

    let actions = chatRunFollowUpActions(
        run: run,
        workItem: workItem,
        assistantText: assistantOutput
    )

    #expect(actions.map(\.id) == ["continue", "mr-review", "validation", "jira-update"])
    #expect(actions[0].title == "Continue")
    #expect(actions[0].prompt.contains("Treat this click as approval to continue"))
    #expect(actions[0].prompt.contains("Should I continue by updating the Jira parser implementation?"))
    #expect(actions[0].prompt.contains("generated confirmation") == false)
    #expect(actions[3].prompt.contains("Ticket refs: IVAS-9057"))
}

@Test func chatRunFollowUpActionsTreatContinueJiraCommentPromptAsPostConfirmation() {
    let assistantOutput = """
    Jira update:
    Status: validation passed and comment draft is ready.
    Should I continue by adding a Jira comment to IVAS-9055?
    """
    let run = AgentRun(
        id: "run-follow-up-confirmation-jira-comment",
        workspaceId: "workspace-follow-up",
        agentProfileId: "agent-follow-up",
        state: .completed,
        promptSnapshot: "Prepare IVAS-9055 Jira comment",
        transcript: assistantOutput
    )
    let workItem = WorkItem(
        id: "workitem-follow-up-confirmation-jira-comment",
        workspaceId: "workspace-follow-up",
        title: "Post Jira comment",
        sourceType: .jira,
        state: .review,
        jira: JiraWorkItemFields(key: "IVAS-9055", status: "In Review")
    )

    let actions = chatRunFollowUpActions(
        run: run,
        workItem: workItem,
        assistantText: assistantOutput
    )

    #expect(actions.map(\.id) == ["confirm-approve-1", "confirm-decline-1", "validation", "jira-update"])
    #expect(actions[0].title == "Post")
    #expect(actions[0].permissionMode == .askBeforeEdit)
    #expect(actions[0].prompt.contains("Should I continue by adding a Jira comment to IVAS-9055?"))
    #expect(actions[1].title == "Not now")
    #expect(actions[3].title == "Jira")
    #expect(actions[3].prompt.contains("Ticket refs: IVAS-9055"))
}

@Test func chatRunFollowUpActionsKeepPlainCommentContinueAsContinue() {
    let assistantOutput = """
    Status: I found confusing inline code comments around the follow-up parser.
    Should I continue by checking those comments against the implementation?
    """
    let run = AgentRun(
        id: "run-follow-up-plain-comment-continue",
        workspaceId: "workspace-follow-up",
        agentProfileId: "agent-follow-up",
        state: .completed,
        promptSnapshot: "Inspect parser comments",
        transcript: assistantOutput
    )

    let actions = chatRunFollowUpActions(
        run: run,
        workItem: nil,
        assistantText: assistantOutput
    )

    #expect(actions.map(\.id) == ["continue", "mr-review", "validation", "capture-evidence"])
    #expect(actions[0].title == "Continue")
    #expect(actions[0].prompt.contains("Treat this click as approval to continue"))
    #expect(actions[0].prompt.contains("Should I continue by checking those comments against the implementation?"))
}

@Test func chatRunFollowUpActionsTreatContinueMRReviewFeedbackPromptAsPostConfirmation() {
    let assistantOutput = """
    MR review feedback:
    Ready to paste into the merge request review.
    Should I continue by adding the MR review feedback?
    """
    let run = AgentRun(
        id: "run-follow-up-confirmation-mr-feedback",
        workspaceId: "workspace-follow-up",
        agentProfileId: "agent-follow-up",
        state: .completed,
        promptSnapshot: "Prepare MR review feedback",
        transcript: assistantOutput
    )

    let actions = chatRunFollowUpActions(
        run: run,
        workItem: nil,
        assistantText: assistantOutput
    )

    #expect(actions.map(\.id) == ["confirm-approve-1", "confirm-decline-1", "mr-review", "validation"])
    #expect(actions[0].title == "Post")
    #expect(actions[0].permissionMode == .askBeforeEdit)
    #expect(actions[0].prompt.contains("Should I continue by adding the MR review feedback?"))
    #expect(actions[0].prompt.contains("explicit approval for the asked path"))
    #expect(actions[1].title == "Not now")
    #expect(actions[2].title == "Review")
}

@Test func chatRunFollowUpActionsTreatChineseContinueMRReviewFeedbackPromptAsPostConfirmation() {
    let assistantOutput = """
    MR 评审意见：
    可以粘贴到合并请求评审里。
    是否继续添加 MR 评审意见？
    """
    let run = AgentRun(
        id: "run-follow-up-confirmation-chinese-mr-feedback",
        workspaceId: "workspace-follow-up",
        agentProfileId: "agent-follow-up",
        state: .completed,
        promptSnapshot: "准备 MR 评审意见",
        transcript: assistantOutput
    )

    let actions = chatRunFollowUpActions(
        run: run,
        workItem: nil,
        assistantText: assistantOutput
    )

    #expect(actions.map(\.id) == ["confirm-approve-1", "confirm-decline-1", "mr-review", "validation"])
    #expect(actions[0].title == "Post")
    #expect(actions[0].generatedUIRole == .confirmationApprove)
    #expect(actions[0].permissionMode == .askBeforeEdit)
    #expect(actions[0].prompt.contains("是否继续添加 MR 评审意见？"))
    #expect(actions[1].generatedUIRole == .confirmationDecline)
    #expect(actions[2].title == "Review")
}

@Test func chatRunFollowUpActionsKeepAddressMRReviewFeedbackAsContinue() {
    let assistantOutput = """
    MR review feedback:
    The code needs a nil guard before it is ready.
    Should I continue by addressing the MR review feedback in code?
    """
    let run = AgentRun(
        id: "run-follow-up-mr-feedback-code",
        workspaceId: "workspace-follow-up",
        agentProfileId: "agent-follow-up",
        state: .completed,
        promptSnapshot: "Address MR review feedback",
        transcript: assistantOutput
    )

    let actions = chatRunFollowUpActions(
        run: run,
        workItem: nil,
        assistantText: assistantOutput
    )

    #expect(actions.map(\.id) == ["continue", "mr-review", "validation", "capture-evidence"])
    #expect(actions[0].title == "Continue")
    #expect(actions[0].prompt.contains("Treat this click as approval to continue"))
    #expect(actions[0].prompt.contains("Should I continue by addressing the MR review feedback in code?"))
    #expect(actions[0].prompt.contains("generated confirmation") == false)
}

@Test func chatRunFollowUpActionsTreatContinueCreateMergeRequestPromptAsConfirmation() {
    let assistantOutput = """
    Status: implementation and focused validation are ready.
    MR draft: Title, summary, validation, and residual risk are prepared.
    Should I continue by creating a merge request for these changes?
    """
    let run = AgentRun(
        id: "run-follow-up-confirmation-mr-create",
        workspaceId: "workspace-follow-up",
        agentProfileId: "agent-follow-up",
        state: .completed,
        promptSnapshot: "Prepare native MR",
        transcript: assistantOutput
    )

    let actions = chatRunFollowUpActions(
        run: run,
        workItem: nil,
        assistantText: assistantOutput
    )

    #expect(actions.map(\.id) == ["confirm-approve-1", "confirm-decline-1", "mr-review", "validation"])
    #expect(actions[0].title == "Create")
    #expect(actions[0].permissionMode == .askBeforeEdit)
    #expect(actions[0].prompt.contains("Should I continue by creating a merge request for these changes?"))
    #expect(actions[0].prompt.contains("explicit approval for the asked path"))
    #expect(actions[0].prompt.contains("Do not ask the user to type yes, no, approve, skip, or continue"))
    #expect(actions[1].title == "Not now")
    #expect(actions[2].title == "Review")
    #expect(actions[3].title == "Validate")
}

@Test func chatRunFollowUpActionsRecognizeKeepGoingAndProceedPrompts() {
    let assistantOutput = """
    Status: ready for the next implementation pass
    Next command: `swift test --filter ChatMessageHistoryTests`
    Want me to keep going with the follow-up cleanup? 要不要继续？
    """
    let run = AgentRun(
        id: "run-follow-up-keep-going",
        workspaceId: "workspace-follow-up",
        agentProfileId: "agent-follow-up",
        state: .completed,
        promptSnapshot: "Tighten native follow-up flows",
        transcript: assistantOutput
    )
    let workItem = WorkItem(
        id: "workitem-follow-up-keep-going",
        workspaceId: "workspace-follow-up",
        title: "Make Continue preserve next actions",
        sourceType: .manualPrompt,
        state: .active
    )

    let actions = chatRunFollowUpActions(
        run: run,
        workItem: workItem,
        assistantText: assistantOutput
    )

    #expect(actions.map { $0.id } == ["continue", "command-1", "mr-review", "validation"])
    #expect(actions[0].prompt.contains("Treat this click as approval to continue"))
    #expect(actions[0].prompt.contains("Do not ask another meta-confirmation"))
    #expect(actions[0].prompt.contains("highest-signal pending item"))
    #expect(actions[0].prompt.contains("Next commands:"))
    #expect(actions[0].prompt.contains("swift test --filter ChatMessageHistoryTests"))
    #expect(actions[1].title == "Validate")
    #expect(actions[1].detail == "Generated command")
    #expect(actions[1].permissionMode == .askBeforeEdit)
    #expect(actions[1].prompt.contains("Generated command:"))
    #expect(actions[1].prompt.contains("swift test --filter ChatMessageHistoryTests"))
}

@Test func chatRunFollowUpActionsKeepGenericChineseContinuePromptAsContinue() {
    let assistantOutput = """
    当前状态已总结。
    是否继续？
    """
    let run = AgentRun(
        id: "run-follow-up-generic-chinese-continue",
        workspaceId: "workspace-follow-up",
        agentProfileId: "agent-follow-up",
        state: .completed,
        promptSnapshot: "继续普通总结",
        transcript: assistantOutput
    )

    let actions = chatRunFollowUpActions(
        run: run,
        workItem: nil,
        assistantText: assistantOutput
    )

    #expect(actions.map(\.id) == ["continue", "mr-review", "validation", "capture-evidence"])
    #expect(actions[0].title == "Continue")
    #expect(actions[0].generatedUIRole == .continuation)
    #expect(actions[0].prompt.contains("Treat this click as approval to continue"))
    #expect(actions[0].prompt.contains("是否继续？"))
    #expect(actions.contains(where: { $0.id == "confirm-approve-1" }) == false)
}

@Test func chatRunFollowUpActionsDoNotGenerateRunForValidationEvidenceOnly() {
    let assistantOutput = """
    Status: focused validation completed.
    Validation: swift test --filter ChatMessageHistoryTests passed
    """
    let run = AgentRun(
        id: "run-follow-up-validation-evidence-only",
        workspaceId: "workspace-follow-up",
        agentProfileId: "agent-follow-up",
        state: .completed,
        promptSnapshot: "Check native follow-up parser",
        transcript: assistantOutput
    )

    let actions = chatRunFollowUpActions(
        run: run,
        workItem: nil,
        assistantText: assistantOutput
    )

    #expect(actions.contains(where: { $0.id.hasPrefix("command-") }) == false)
    #expect(actions[0].prompt.contains("Validation evidence:"))
    #expect(actions[0].prompt.contains("swift test --filter ChatMessageHistoryTests (passed)"))
}

@Test func chatRunFollowUpActionsDoNotGenerateRunForPassedValidationCommand() {
    let assistantOutput = """
    Status: focused validation completed.
    Validation command: `swift test --filter ChatMessageHistoryTests` passed
    """
    let run = AgentRun(
        id: "run-follow-up-passed-validation-command",
        workspaceId: "workspace-follow-up",
        agentProfileId: "agent-follow-up",
        state: .completed,
        promptSnapshot: "Verify native follow-up parser",
        transcript: assistantOutput
    )

    let actions = chatRunFollowUpActions(
        run: run,
        workItem: nil,
        assistantText: assistantOutput
    )

    #expect(actions.contains(where: { $0.id.hasPrefix("command-") }) == false)
    #expect(actions[0].prompt.contains("Validation evidence:"))
    #expect(actions[0].prompt.contains("swift test --filter ChatMessageHistoryTests (passed)"))
    #expect(actions[0].prompt.contains("Next commands:") == false)
}

@Test func chatRunFollowUpActionsGenerateValidateActionForPendingValidationCommand() {
    let assistantOutput = """
    Status: implementation is ready for a focused check.
    Validation command: `swift test --filter ChatMessageHistoryTests`
    """
    let run = AgentRun(
        id: "run-follow-up-pending-validation-command",
        workspaceId: "workspace-follow-up",
        agentProfileId: "agent-follow-up",
        state: .completed,
        promptSnapshot: "Validate native follow-up command parsing",
        transcript: assistantOutput
    )

    let actions = chatRunFollowUpActions(
        run: run,
        workItem: nil,
        assistantText: assistantOutput
    )

    #expect(actions.map(\.id) == ["command-1", "mr-review", "validation", "capture-evidence"])
    #expect(actions[0].title == "Validate")
    #expect(actions[0].detail == "Generated command")
    #expect(actions[0].permissionMode == .askBeforeEdit)
    #expect(actions[0].prompt.contains("Generated command:"))
    #expect(actions[0].prompt.contains("swift test --filter ChatMessageHistoryTests"))
    #expect(actions[0].prompt.contains("Next commands:"))
    #expect(actions[0].prompt.contains("Validation evidence:") == false)
}

@Test func chatRunFollowUpActionsPrioritizeValidationForChineseCleanReviewWithNextCommand() {
    let assistantOutput = """
    MR 评审意见：
    无阻塞问题；残余风险是手动 smoke。
    Next command: `swift build --product PikiclawMac`
    """
    let run = AgentRun(
        id: "run-follow-up-chinese-clean-review",
        workspaceId: "workspace-follow-up",
        agentProfileId: "agent-follow-up",
        state: .completed,
        promptSnapshot: "Validate clean Chinese MR review",
        transcript: assistantOutput
    )

    let actions = chatRunFollowUpActions(
        run: run,
        workItem: nil,
        assistantText: assistantOutput
    )
    let validationIndex = actions.firstIndex(where: { $0.id == "validation" }) ?? Int.max
    let reviewIndex = actions.firstIndex(where: { $0.id == "mr-review" }) ?? Int.max
    let validation = actions.first(where: { $0.id == "validation" })

    #expect(validationIndex < reviewIndex)
    #expect(validation?.prompt.contains("Prefer a relevant Next command") == true)
    #expect(validation?.prompt.contains("swift build --product PikiclawMac") == true)
    #expect(validation?.prompt.contains("Review findings:") == true)
    #expect(validation?.prompt.contains("无阻塞问题；残余风险是手动 smoke。") == true)
}

@Test func chatRunFollowUpActionsSurfaceBugForChineseDiagnosisWithNextCommand() {
    let assistantOutput = """
    问题分析：
    复现步骤：
    - 打开 Jira ticket 后点击 Start。
    实际结果：没有创建 ticket chat。
    预期结果：应该进入右侧工作区并创建 run。
    根因：detailTab 没有传入 Jira 工作区。
    修复方案：把 detailTab 绑定到 JiraWorkQueueView。
    Next command: `swift test --package-path apps/macos --filter JiraNativeWorkflowTests`
    """
    let run = AgentRun(
        id: "run-follow-up-chinese-diagnosis",
        workspaceId: "workspace-follow-up",
        agentProfileId: "agent-follow-up",
        state: .completed,
        promptSnapshot: "继续中文 bug 分析",
        transcript: assistantOutput
    )

    let actions = chatRunFollowUpActions(
        run: run,
        workItem: nil,
        assistantText: assistantOutput
    )

    #expect(actions.map(\.id) == ["bug-analysis", "command-1", "mr-review", "validation"])
    #expect(actions[0].title == "Bug")
    #expect(actions[0].prompt.contains("Reproduction notes:"))
    #expect(actions[0].prompt.contains("Steps: 打开 Jira ticket 后点击 Start。"))
    #expect(actions[0].prompt.contains("Actual: 没有创建 ticket chat。"))
    #expect(actions[0].prompt.contains("Expected: 应该进入右侧工作区并创建 run。"))
    #expect(actions[0].prompt.contains("Diagnosis notes:"))
    #expect(actions[0].prompt.contains("Root cause: detailTab 没有传入 Jira 工作区。"))
    #expect(actions[0].prompt.contains("Fix path: 把 detailTab 绑定到 JiraWorkQueueView。"))
    #expect(actions[1].title == "Validate")
    #expect(actions[1].prompt.contains("swift test --package-path apps/macos --filter JiraNativeWorkflowTests"))
}

@Test func chatRunFollowUpActionsKeepJiraVisibleWithContinueAndMultipleSignals() {
    let assistantOutput = """
    Jira: IVAS-9044
    Skill /logtrace failed because IVA_LOGTRACER_ENV_FILE is missing.
    conversationId=p-v-generative-ui
    error: validation failed before Jira update
    I can continue with the next fix. 是否继续？
    """
    let run = AgentRun(
        id: "run-follow-up-continue-jira",
        workspaceId: "workspace-follow-up",
        agentProfileId: "agent-follow-up",
        state: .failed,
        promptSnapshot: "Repair generative UI Jira flow",
        transcript: assistantOutput
    )
    let workItem = WorkItem(
        id: "workitem-follow-up-continue-jira",
        workspaceId: "workspace-follow-up",
        title: "Repair generative UI Jira flow",
        sourceType: .jira,
        state: .active,
        jira: JiraWorkItemFields(key: "IVAS-9044", status: "In Progress")
    )

    let actions = chatRunFollowUpActions(
        run: run,
        workItem: workItem,
        assistantText: assistantOutput
    )

    #expect(actions.map(\.id) == ["continue", "skill-hardening", "bug-analysis", "jira-update"])
    #expect(actions[0].prompt.contains("Treat this click as approval to continue"))
    #expect(actions[1].prompt.contains("Harden the skill path"))
    #expect(actions[3].prompt.contains("Jira-ready update"))
    #expect(actions[3].prompt.contains("Ticket refs: IVAS-9044"))
}

@Test func chatRunFollowUpActionsPreserveJiraWriteBackFailureInJiraPrompt() {
    let assistantOutput = """
    Jira write-back: Failed IVAS-9050; retry or paste the draft manually.
    Jira update:
    Status: implementation complete; write-back failed before posting.
    Evidence: focused tests passed.
    Next action: fix Jira write-back configuration, then retry or paste manually.
    """
    let run = AgentRun(
        id: "run-follow-up-jira-writeback-failed",
        workspaceId: "workspace-follow-up",
        agentProfileId: "agent-follow-up",
        state: .completed,
        promptSnapshot: "Post IVAS-9050 Jira update",
        transcript: assistantOutput
    )

    let actions = chatRunFollowUpActions(
        run: run,
        workItem: nil,
        assistantText: assistantOutput
    )
    let jira = actions.first(where: { $0.id == "jira-update" })

    #expect(actions.map(\.id) == ["jira-update", "mr-review", "validation"])
    #expect(jira?.id == "jira-update")
    #expect(jira?.prompt.contains("If Jira write-back failed or is still pending") == true)
    #expect(jira?.prompt.contains("do not claim the update was posted") == true)
    #expect(jira?.prompt.contains("Jira write-back:") == true)
    #expect(jira?.prompt.contains("Jira write-back: Failed IVAS-9050; retry or paste the draft manually.") == true)
    #expect(jira?.prompt.contains("Ticket refs: IVAS-9050") == true)
}

@Test func chatRunFollowUpActionsPreserveChineseJiraWriteBackFailureInJiraPrompt() {
    let assistantOutput = """
    Jira 写回失败：IVAS-9062 缺少 token，需要重试或手动粘贴草稿。
    Jira 更新：
    Status: implementation complete; write-back failed before posting.
    Evidence: focused tests passed.
    Next action: 修复 Jira 写回配置，然后重试或手动粘贴。
    """
    let run = AgentRun(
        id: "run-follow-up-chinese-jira-writeback-failed",
        workspaceId: "workspace-follow-up",
        agentProfileId: "agent-follow-up",
        state: .completed,
        promptSnapshot: "发布 IVAS-9062 Jira 更新",
        transcript: assistantOutput
    )

    let actions = chatRunFollowUpActions(
        run: run,
        workItem: nil,
        assistantText: assistantOutput
    )
    let jira = actions.first(where: { $0.id == "jira-update" })

    #expect(actions.map(\.id) == ["jira-update", "mr-review", "validation"])
    #expect(jira?.prompt.contains("If Jira write-back failed or is still pending") == true)
    #expect(jira?.prompt.contains("Jira write-back: Jira 写回失败：IVAS-9062 缺少 token，需要重试或手动粘贴草稿。") == true)
    #expect(jira?.prompt.contains("Ticket refs: IVAS-9062") == true)
}

@Test func chatRunFollowUpActionsInferJiraWriteBackFailureWithoutStandardPrefix() {
    let assistantOutput = """
    Jira update:
    Status: implementation complete; write-back failed before posting.
    Evidence: focused tests passed.
    Next action: retry or paste manually into IVAS-9051.
    """
    let run = AgentRun(
        id: "run-follow-up-jira-writeback-inferred",
        workspaceId: "workspace-follow-up",
        agentProfileId: "agent-follow-up",
        state: .completed,
        promptSnapshot: "Post IVAS-9051 Jira update",
        transcript: assistantOutput
    )

    let actions = chatRunFollowUpActions(
        run: run,
        workItem: nil,
        assistantText: assistantOutput
    )
    let jira = actions.first(where: { $0.id == "jira-update" })

    #expect(actions.map(\.id) == ["jira-update", "mr-review", "validation"])
    #expect(jira?.prompt.contains("Jira write-back: Status: implementation complete; write-back failed before posting.") == true)
    #expect(jira?.prompt.contains("do not claim the update was posted") == true)
    #expect(jira?.prompt.contains("Ticket refs: IVAS-9051") == true)
}

@Test func chatRunFollowUpActionsDoNotPrioritizePostedJiraWriteBack() {
    let assistantOutput = """
    Jira write-back: Posted IVAS-9052 to Jira.
    Validation: swift test --filter ChatMessageHistoryTests passed
    """
    let run = AgentRun(
        id: "run-follow-up-jira-writeback-posted",
        workspaceId: "workspace-follow-up",
        agentProfileId: "agent-follow-up",
        state: .completed,
        promptSnapshot: "Post IVAS-9052 Jira update",
        transcript: assistantOutput
    )

    let actions = chatRunFollowUpActions(
        run: run,
        workItem: nil,
        assistantText: assistantOutput
    )
    let jira = actions.first(where: { $0.id == "jira-update" })

    #expect(actions.map(\.id) == ["mr-review", "validation", "jira-update"])
    #expect(jira?.prompt.contains("Jira write-back: Posted IVAS-9052 to Jira.") == true)
    #expect(jira?.prompt.contains("do not claim the update was posted") == true)
    #expect(jira?.prompt.contains("Ticket refs: IVAS-9052") == true)
}

@Test func chatRunFollowUpActionsDoNotPrioritizeChinesePostedJiraWriteBack() {
    let assistantOutput = """
    Jira 写回已发布：IVAS-9063 已发布到 Jira。
    Validation: focused test passed.
    """
    let run = AgentRun(
        id: "run-follow-up-chinese-jira-writeback-posted",
        workspaceId: "workspace-follow-up",
        agentProfileId: "agent-follow-up",
        state: .completed,
        promptSnapshot: "发布 IVAS-9063 Jira 更新",
        transcript: assistantOutput
    )

    let actions = chatRunFollowUpActions(
        run: run,
        workItem: nil,
        assistantText: assistantOutput
    )
    let jira = actions.first(where: { $0.id == "jira-update" })

    #expect(actions.map(\.id) == ["mr-review", "validation", "jira-update"])
    #expect(jira?.prompt.contains("Jira write-back: Jira 写回已发布：IVAS-9063 已发布到 Jira。") == true)
    #expect(jira?.prompt.contains("Ticket refs: IVAS-9063") == true)
}

@Test func chatRunFollowUpActionsGenerateChoiceButtonsFromMultipleNextSteps() {
    let assistantOutput = """
    I found three useful next paths. Pick one:
    Options:
    A) Implement the native choice rail parser in RootView.
    B) Run the focused ChatMessageHistoryTests validation.
    C) Summarize the evidence for handoff.
    """
    let run = AgentRun(
        id: "run-follow-up-choice-buttons",
        workspaceId: "workspace-follow-up",
        agentProfileId: "agent-follow-up",
        state: .completed,
        promptSnapshot: "Align native generative UI with Gemini Enterprise",
        transcript: assistantOutput
    )
    let workItem = WorkItem(
        id: "workitem-follow-up-choice-buttons",
        workspaceId: "workspace-follow-up",
        title: "Generate clickable next-step choices",
        sourceType: .manualPrompt,
        state: .active
    )

    let actions = chatRunFollowUpActions(
        run: run,
        workItem: workItem,
        assistantText: assistantOutput
    )

    #expect(actions.map(\.id) == ["choice-1", "choice-2", "choice-3", "mr-review"])
    #expect(actions.prefix(3).allSatisfy { $0.isGeneratedUI })
    #expect(actions.prefix(3).map(\.generatedUIRole) == [.choice, .choice, .choice])
    #expect(actions[3].isGeneratedUI == false)
    #expect(actions[0].title == "Implement")
    #expect(actions[0].detail == "Generated choice")
    #expect(actions[0].permissionMode == .askBeforeEdit)
    #expect(actions[0].prompt.contains("Selected choice: Implement the native choice rail parser in RootView."))
    #expect(actions[0].prompt.contains("only the selected UI choice"))
    #expect(actions[0].prompt.contains("Do not take the unselected choices"))
    #expect(actions[1].title == "Validate")
    #expect(actions[1].permissionMode == .askBeforeEdit)
    #expect(actions[1].prompt.contains("Selected choice: Run the focused ChatMessageHistoryTests validation."))
    #expect(actions[2].title == "Summarize")
    #expect(actions[2].permissionMode == .readOnly)
    #expect(actions[2].prompt.contains("Selected choice: Summarize the evidence for handoff."))
}

@Test func chatRunFollowUpActionsGenerateStructuredUIBlocksFromJsonFence() {
    let assistantOutput = """
    The next move is ready.
    ```pikiclaw-ui
    {
      "choices": [
        {
          "title": "Implement",
          "prompt": "Implement the structured UI block parser in RootView.",
          "permissionMode": "askBeforeEdit",
          "symbol": "hammer"
        },
        {
          "title": "Validate",
          "prompt": "Run ChatMessageHistoryTests for the structured UI parser.",
          "permissionMode": "askBeforeEdit",
          "symbol": "testtube.2"
        }
      ],
      "confirm": {
        "question": "Post the generated Jira update draft now?",
        "approveTitle": "Post",
        "declineTitle": "Not now",
        "permissionMode": "askBeforeEdit"
      }
    }
    ```
    """
    let run = AgentRun(
        id: "run-follow-up-structured-ui",
        workspaceId: "workspace-follow-up",
        agentProfileId: "agent-follow-up",
        state: .completed,
        promptSnapshot: "Align native generated UI with Gemini Enterprise",
        transcript: assistantOutput
    )
    let workItem = WorkItem(
        id: "workitem-follow-up-structured-ui",
        workspaceId: "workspace-follow-up",
        title: "Support structured generated UI blocks",
        sourceType: .manualPrompt,
        state: .active
    )

    let actions = chatRunFollowUpActions(
        run: run,
        workItem: workItem,
        assistantText: assistantOutput
    )

    #expect(actions.map(\.id) == [
        "choice-structured-1",
        "choice-structured-2",
        "confirm-approve-structured-1",
        "confirm-decline-structured-1"
    ])
    #expect(actions.map(\.generatedUIRole) == [.choice, .choice, .confirmationApprove, .confirmationDecline])
    #expect(actions[0].title == "Implement")
    #expect(actions[0].permissionMode == .askBeforeEdit)
    #expect(actions[0].prompt.contains("structured generated UI choice"))
    #expect(actions[0].prompt.contains("Structured UI payload: Implement the structured UI block parser in RootView."))
    #expect(actions[2].title == "Post")
    #expect(actions[2].prompt.contains("structured generated UI confirmation"))
    #expect(actions[2].prompt.contains("Post the generated Jira update draft now?"))
    #expect(runFollowUpGeneratedUIShortcut(for: actions[0], in: actions)?.label == "Return")
    #expect(runFollowUpGeneratedUIShortcut(for: actions[3], in: actions)?.label == "Esc")
}

@Test func chatRunFollowUpActionsGenerateStructuredFormFromJsonFence() {
    let assistantOutput = """
    I need two parameters before staging the next run.
    ```pikiclaw-ui
    {
      "form": {
        "kind": "form",
        "title": "Configure run",
        "detail": "2 fields",
        "prompt": "Collect the agent and validation command before continuing.",
        "fields": [
          {
            "name": "agent",
            "label": "Agent",
            "type": "select",
            "required": true,
            "value": "codex",
            "options": ["codex", "claude", "gemini"]
          },
          {
            "name": "validation_command",
            "label": "Validation command",
            "type": "text",
            "required": true,
            "placeholder": "swift test --package-path apps/macos"
          }
        ]
      }
    }
    ```
    """
    let run = AgentRun(
        id: "run-follow-up-structured-form",
        workspaceId: "workspace-follow-up",
        agentProfileId: "agent-follow-up",
        state: .waitingForUser,
        promptSnapshot: "Collect generated UI form input",
        transcript: assistantOutput
    )
    let workItem = WorkItem(
        id: "workitem-follow-up-structured-form",
        workspaceId: "workspace-follow-up",
        title: "Support structured generated UI forms",
        sourceType: .manualPrompt,
        state: .active
    )

    let actions = chatRunFollowUpActions(
        run: run,
        workItem: workItem,
        assistantText: assistantOutput
    )

    #expect(actions.map(\.id) == ["form-structured-1", "mr-review", "validation", "capture-evidence"])
    #expect(actions[0].generatedUIRole == .form)
    #expect(actions[0].title == "Configure run")
    #expect(actions[0].detail == "2 fields")
    #expect(actions[0].permissionMode == .askBeforeEdit)
    #expect(actions[0].prompt.contains("structured generated UI form"))
    #expect(actions[0].prompt.contains("Agent [select, required]; name=agent; value=codex; options=codex | claude | gemini"))
    #expect(actions[0].prompt.contains("Validation command [text, required]; name=validation_command; placeholder=swift test --package-path apps/macos"))
    #expect(actions[0].prompt.contains("If required fields are missing, ask only for those missing fields"))
    #expect(runFollowUpGeneratedUIShortcut(for: actions[0], in: actions)?.label == "Return")
}

@Test func chatRunFollowUpActionsGenerateClarifyFormForMissingInput() {
    let assistantOutput = """
    Analysis paused.
    Missing input: reproduction steps for the native crash.
    Missing input: expected final status after validation.
    Open question: whether the MR needs a manual smoke pass.
    """
    let run = AgentRun(
        id: "run-follow-up-missing-input-clarify",
        workspaceId: "workspace-follow-up",
        agentProfileId: "agent-follow-up",
        state: .completed,
        promptSnapshot: "Triage native crash",
        transcript: assistantOutput
    )

    let actions = chatRunFollowUpActions(
        run: run,
        workItem: nil,
        assistantText: assistantOutput
    )

    #expect(actions.map(\.id) == ["form-clarify-1", "mr-review", "validation", "capture-evidence"])
    #expect(actions[0].title == "Clarify")
    #expect(actions[0].detail == "Missing input")
    #expect(actions[0].symbol == "questionmark.bubble")
    #expect(actions[0].permissionMode == .readOnly)
    #expect(actions[0].generatedUIRole == .form)
    #expect(actions[0].prompt.contains("Missing input 1 [text, required]; placeholder=reproduction steps for the native crash."))
    #expect(actions[0].prompt.contains("Missing input 2 [text, required]; placeholder=expected final status after validation."))
    #expect(actions[0].prompt.contains("Missing input 3 [text, required]") == false)
    #expect(actions[0].prompt.contains("Ask the user only for these missing fields"))
    #expect(actions[0].prompt.contains("Run context:"))
    #expect(actions[0].prompt.contains("- Original prompt: Triage native crash"))
    #expect(runFollowUpGeneratedUIShortcut(for: actions[0], in: actions)?.label == "Return")
}

@Test func chatRunFollowUpActionsGenerateClarifyFormForInputNeededSection() {
    let assistantOutput = """
    Analysis paused.
    Input needed:
    - workspace slug for the Jira sync run.
    - target reviewer for the review notes.
    Open questions:
    - whether to post after validation.
    """
    let run = AgentRun(
        id: "run-follow-up-input-needed-clarify",
        workspaceId: "workspace-follow-up",
        agentProfileId: "agent-follow-up",
        state: .completed,
        promptSnapshot: "Prepare Jira and MR handoff",
        transcript: assistantOutput
    )

    let actions = chatRunFollowUpActions(
        run: run,
        workItem: nil,
        assistantText: assistantOutput
    )

    #expect(actions.map(\.id) == ["form-clarify-1", "mr-review", "validation", "capture-evidence"])
    #expect(actions[0].prompt.contains("Missing input 1 [text, required]; placeholder=workspace slug for the Jira sync run."))
    #expect(actions[0].prompt.contains("Missing input 2 [text, required]; placeholder=target reviewer for the review notes."))
    #expect(actions[0].prompt.contains("Missing input 3 [text, required]") == false)
}

@Test func chatRunFollowUpActionsGenerateClarifyFormForChineseMissingInputSection() {
    let assistantOutput = """
    分析已暂停。
    需要补充：
    - 崩溃前最后一个用户操作。
    - 希望写入 Jira 的最终状态。
    开放问题：
    - 是否等完整 smoke 后再发布评论。
    """
    let run = AgentRun(
        id: "run-follow-up-chinese-missing-input",
        workspaceId: "workspace-follow-up",
        agentProfileId: "agent-follow-up",
        state: .completed,
        promptSnapshot: "整理中文 Jira 更新",
        transcript: assistantOutput
    )

    let actions = chatRunFollowUpActions(
        run: run,
        workItem: nil,
        assistantText: assistantOutput
    )

    #expect(actions.map(\.id) == ["form-clarify-1", "mr-review", "validation", "capture-evidence"])
    #expect(actions[0].generatedUIRole == .form)
    #expect(actions[0].prompt.contains("Missing input 1 [text, required]; placeholder=崩溃前最后一个用户操作。"))
    #expect(actions[0].prompt.contains("Missing input 2 [text, required]; placeholder=希望写入 Jira 的最终状态。"))
    #expect(actions[0].prompt.contains("Missing input 3 [text, required]") == false)
    #expect(actions[0].prompt.contains("Run context:"))
    #expect(actions[0].prompt.contains("- Original prompt: 整理中文 Jira 更新"))
}

@Test func chatRunFollowUpActionsGenerateClarifyFormForChineseMissingInputLeadPhrases() {
    let assistantOutput = """
    分析已暂停。
    还缺：崩溃前最后一个用户操作。
    需要补充：希望写入 Jira 的最终状态。
    开放问题：
    - 是否等完整 smoke 后再发布评论。
    """
    let run = AgentRun(
        id: "run-follow-up-chinese-missing-input-lead",
        workspaceId: "workspace-follow-up",
        agentProfileId: "agent-follow-up",
        state: .completed,
        promptSnapshot: "整理中文 Jira 更新",
        transcript: assistantOutput
    )

    let actions = chatRunFollowUpActions(
        run: run,
        workItem: nil,
        assistantText: assistantOutput
    )

    #expect(actions.map(\.id) == ["form-clarify-1", "mr-review", "validation", "capture-evidence"])
    #expect(actions[0].generatedUIRole == .form)
    #expect(actions[0].prompt.contains("Missing input 1 [text, required]; placeholder=崩溃前最后一个用户操作。"))
    #expect(actions[0].prompt.contains("Missing input 2 [text, required]; placeholder=希望写入 Jira 的最终状态。"))
    #expect(actions[0].prompt.contains("Missing input 3 [text, required]") == false)
}

@Test func chatRunFollowUpActionsKeepJiraVisibleWithMissingInputClarify() {
    let assistantOutput = """
    Missing input: exact user-facing failure screenshot.
    Jira: IVAS-9061
    Next action: collect the screenshot before posting the Jira update.
    """
    let run = AgentRun(
        id: "run-follow-up-missing-input-jira",
        workspaceId: "workspace-follow-up",
        agentProfileId: "agent-follow-up",
        state: .completed,
        promptSnapshot: "Prepare IVAS-9061 update",
        transcript: assistantOutput
    )

    let actions = chatRunFollowUpActions(
        run: run,
        workItem: nil,
        assistantText: assistantOutput
    )

    #expect(actions.map(\.id) == ["form-clarify-1", "bug-analysis", "validation", "jira-update"])
    #expect(actions[0].generatedUIRole == .form)
    #expect(actions[0].prompt.contains("exact user-facing failure screenshot"))
    #expect(actions[1].prompt.contains("Analyze this run as a bug"))
    #expect(actions[3].prompt.contains("Ticket refs: IVAS-9061"))
    #expect(actions[3].prompt.contains("Jira-ready update"))
}

@Test func chatRunFollowUpActionsDoNotAddClarifyFormWhenConfirmationIsReady() {
    let assistantOutput = """
    Missing input: final reviewer approval wording.
    MR review feedback:
    Ready to paste into the merge request review.
    Should I continue by adding the MR review feedback?
    """
    let run = AgentRun(
        id: "run-follow-up-missing-input-confirmation",
        workspaceId: "workspace-follow-up",
        agentProfileId: "agent-follow-up",
        state: .completed,
        promptSnapshot: "Prepare MR review feedback",
        transcript: assistantOutput
    )

    let actions = chatRunFollowUpActions(
        run: run,
        workItem: nil,
        assistantText: assistantOutput
    )

    #expect(actions.map(\.id) == ["confirm-approve-1", "confirm-decline-1", "mr-review", "validation"])
    #expect(actions.contains(where: { $0.id == "form-clarify-1" }) == false)
    #expect(actions[0].title == "Post")
    #expect(actions[0].generatedUIRole == .confirmationApprove)
}

@Test func agentResponsePresentationPromotesStructuredUICardWithoutRawPayload() {
    let assistantOutput = """
    Done.
    ```pikiclaw-ui
    {
      "cards": [
        {
          "title": "Validation",
          "detail": "ChatMessageHistoryTests passed",
          "symbol": "checkmark.seal"
        }
      ]
    }
    ```
    """

    let preview = agentResponsePresentationPreview(text: assistantOutput)

    #expect(preview.finalText == "Done.")
    #expect(preview.finalText.contains("pikiclaw-ui") == false)
    #expect(preview.generativeItems == [
        AgentResponsePresentationPreviewItem(title: "Validation", detail: "ChatMessageHistoryTests passed")
    ])
}

@Test func chatRunFollowUpActionsGenerateCardActionsForToolArtifactAndFileOutput() {
    let assistantOutput = """
    Tool result: swift test --filter ChatMessageHistoryTests
    Artifact: pikiclaw://artifacts/artifact-generative-card
    File: apps/macos/Sources/PikiclawMac/RootView.swift:9400
    Implemented the generated UI rail split.
    """
    let run = AgentRun(
        id: "run-follow-up-generated-cards",
        workspaceId: "workspace-follow-up",
        agentProfileId: "agent-follow-up",
        state: .completed,
        promptSnapshot: "Unify generated UI cards and actions",
        transcript: assistantOutput
    )
    let workItem = WorkItem(
        id: "workitem-follow-up-generated-cards",
        workspaceId: "workspace-follow-up",
        title: "Unify generated output cards",
        sourceType: .manualPrompt,
        state: .active
    )

    let actions = chatRunFollowUpActions(
        run: run,
        workItem: workItem,
        assistantText: assistantOutput
    )

    #expect(actions.map(\.id) == ["tool-card-1", "artifact-card-1", "file-card-1", "save-evidence-1"])
    #expect(actions.map(\.generatedUIRole) == [.toolCard, .artifactCard, .fileCard, .saveEvidence])
    #expect(actions[0].title == "Validate")
    #expect(actions[0].isGeneratedUI)
    #expect(actions[0].permissionMode == .askBeforeEdit)
    #expect(actions[0].prompt.contains("Inspect the generated tool-result card"))
    #expect(actions[0].prompt.contains("swift test --filter ChatMessageHistoryTests"))
    #expect(actions[0].prompt.contains("whether it changes readiness"))
    #expect(actions[1].title == "Artifact")
    #expect(actions[1].isGeneratedUI)
    #expect(actions[1].permissionMode == .readOnly)
    #expect(actions[1].prompt.contains("Inspect the generated artifact card"))
    #expect(actions[1].prompt.contains("pikiclaw://artifacts/artifact-generative-card"))
    #expect(actions[1].prompt.contains("selected artifact card"))
    #expect(actions[2].title == "File")
    #expect(actions[2].isGeneratedUI)
    #expect(actions[2].permissionMode == .readOnly)
    #expect(actions[2].prompt.contains("Inspect the generated file card"))
    #expect(actions[2].prompt.contains("apps/macos/Sources/PikiclawMac/RootView.swift:9400"))
    #expect(actions[2].prompt.contains("Do not edit files in this follow-up"))
    #expect(actions[3].title == "Save")
    #expect(actions[3].isGeneratedUI)
    #expect(actions[3].permissionMode == .askBeforeEdit)
    #expect(actions[3].prompt.contains("Prepare to save the selected generated output cards as durable Pikiclaw evidence"))
    #expect(actions[3].prompt.contains("Tool result: swift test --filter ChatMessageHistoryTests"))
    #expect(actions[3].prompt.contains("Artifact: pikiclaw://artifacts/artifact-generative-card"))
    #expect(actions[3].prompt.contains("File: apps/macos/Sources/PikiclawMac/RootView.swift:9400"))
    #expect(actions[3].prompt.contains("Save Evidence for chat-run evidence"))
    #expect(actions[3].prompt.contains("Save Knowledge note for reusable output artifacts"))
    #expect(actions[3].prompt.contains("Do not write artifacts, Obsidian notes, Jira comments, commits, or external systems until the user explicitly approves"))
}

@Test func chatRunFollowUpActionsGenerateEvidenceActionForSingleGeneratedCard() {
    let assistantOutput = """
    Tool result: codex exec summarize recent work
    Summary: Found reusable evidence for the generated UI handoff.
    """
    let run = AgentRun(
        id: "run-follow-up-generated-evidence-card",
        workspaceId: "workspace-follow-up",
        agentProfileId: "agent-follow-up",
        state: .completed,
        promptSnapshot: "Prepare generated UI evidence",
        transcript: assistantOutput
    )
    let workItem = WorkItem(
        id: "workitem-follow-up-generated-evidence-card",
        workspaceId: "workspace-follow-up",
        title: "Prepare generated evidence card",
        sourceType: .manualPrompt,
        state: .active
    )

    let actions = chatRunFollowUpActions(
        run: run,
        workItem: workItem,
        assistantText: assistantOutput
    )

    #expect(actions.map(\.id) == ["tool-card-1", "save-evidence-1", "mr-review", "validation"])
    #expect(actions[0].title == "Tool")
    #expect(actions[0].isGeneratedUI)
    #expect(actions[0].permissionMode == .readOnly)
    #expect(actions[1].title == "Save")
    #expect(actions[1].isGeneratedUI)
    #expect(actions[1].permissionMode == .askBeforeEdit)
    #expect(actions[1].prompt.contains("Prepare to save the selected generated output cards as durable Pikiclaw evidence"))
    #expect(actions[1].prompt.contains("Tool result: codex exec summarize recent work"))
    #expect(actions[1].prompt.contains("save target"))
    #expect(actions[1].prompt.contains("knowledge-card draft"))
    #expect(actions[1].prompt.contains("Save Knowledge note for reusable output artifacts"))
    #expect(actions[1].prompt.contains("Do not write artifacts, Obsidian notes, Jira comments, commits, or external systems until the user explicitly approves"))
    #expect(actions[2].isGeneratedUI == false)
}

@Test func chatRunFollowUpActionsGenerateKnowledgeNoteActionForSavedObsidianOutput() {
    let assistantOutput = """
    Saved reusable memory from this generated UI run.
    Knowledge note: /Users/michael.yang/Documents/Obsidian Vault/repo/Personal/pikiclaw/generated-ui-save.md
    Summary: Source-grounded generated UI save pattern is ready for reuse.
    """
    let run = AgentRun(
        id: "run-follow-up-generated-knowledge-note",
        workspaceId: "workspace-follow-up",
        agentProfileId: "agent-follow-up",
        state: .completed,
        promptSnapshot: "Review saved generated UI knowledge",
        transcript: assistantOutput
    )
    let workItem = WorkItem(
        id: "workitem-follow-up-generated-knowledge-note",
        workspaceId: "workspace-follow-up",
        title: "Review saved knowledge note",
        sourceType: .manualPrompt,
        state: .active
    )

    let actions = chatRunFollowUpActions(
        run: run,
        workItem: workItem,
        assistantText: assistantOutput
    )

    #expect(actions.map(\.id) == ["knowledge-note-1", "mr-review", "validation", "capture-evidence"])
    #expect(actions[0].title == "Knowledge")
    #expect(actions[0].detail == "Generated note")
    #expect(actions[0].isGeneratedUI)
    #expect(actions[0].permissionMode == .readOnly)
    #expect(actions[0].prompt.contains("Review the saved Obsidian knowledge note"))
    #expect(actions[0].prompt.contains("Obsidian: /Users/michael.yang/Documents/Obsidian Vault/repo/Personal/pikiclaw/generated-ui-save.md"))
    #expect(actions[0].prompt.contains("reusable claim"))
    #expect(actions[0].prompt.contains("source-grounded"))
    #expect(actions[0].prompt.contains("Do not edit files, write Obsidian notes, post to Jira, commit, or change external systems"))
    #expect(actions[1].isGeneratedUI == false)
}

@Test func chatRunFollowUpActionsCompareKnowledgeNoteWithNewEvidence() {
    let assistantOutput = """
    Knowledge note: /Users/michael.yang/Documents/Obsidian Vault/repo/Personal/pikiclaw/generated-ui-save.md
    Tool result: swift test --filter ChatMessageHistoryTests
    Summary: New run evidence confirms the generated UI save pattern.
    """
    let run = AgentRun(
        id: "run-follow-up-knowledge-compare",
        workspaceId: "workspace-follow-up",
        agentProfileId: "agent-follow-up",
        state: .completed,
        promptSnapshot: "Compare saved knowledge against new evidence",
        transcript: assistantOutput
    )
    let workItem = WorkItem(
        id: "workitem-follow-up-knowledge-compare",
        workspaceId: "workspace-follow-up",
        title: "Compare knowledge with latest evidence",
        sourceType: .manualPrompt,
        state: .active
    )

    let actions = chatRunFollowUpActions(
        run: run,
        workItem: workItem,
        assistantText: assistantOutput
    )

    #expect(actions.map(\.id) == ["tool-card-1", "knowledge-compare-1", "save-evidence-1", "mr-review"])
    #expect(actions[0].title == "Validate")
    #expect(actions[0].permissionMode == .askBeforeEdit)
    #expect(actions[1].title == "Compare")
    #expect(actions[1].detail == "Generated review")
    #expect(actions[1].isGeneratedUI)
    #expect(actions[1].generatedUIRole == .knowledgeCompare)
    #expect(actions[1].permissionMode == .readOnly)
    #expect(actions[1].prompt.contains("Compare the saved knowledge note against the new generated evidence"))
    #expect(actions[1].prompt.contains("Knowledge note: Obsidian: /Users/michael.yang/Documents/Obsidian Vault/repo/Personal/pikiclaw/generated-ui-save.md"))
    #expect(actions[1].prompt.contains("New evidence: Tool result: swift test --filter ChatMessageHistoryTests"))
    #expect(actions[1].prompt.contains("matched claims"))
    #expect(actions[1].prompt.contains("contradicted claims"))
    #expect(actions[1].prompt.contains("stale assumptions"))
    #expect(actions[1].prompt.contains("Do not edit files, write Obsidian notes, post to Jira, commit, or change external systems"))
    #expect(actions[2].title == "Save")
    #expect(actions[2].permissionMode == .askBeforeEdit)
    #expect(actions[3].isGeneratedUI == false)
}

@Test func runFollowUpActionGeneratedUIRoleDrivesContractBeyondPrefix() {
    let customChoice = RunFollowUpAction(
        id: "custom-agent-choice",
        title: "Inspect",
        detail: "Generated choice",
        symbol: "sparkles",
        permissionMode: .readOnly,
        generatedUIRole: .choice,
        prompt: "Take the selected generated path."
    )
    let standard = RunFollowUpAction(
        id: "custom-agent-choice",
        title: "Inspect",
        symbol: "sparkles",
        permissionMode: .readOnly,
        prompt: "Take the selected generated path."
    )

    #expect(customChoice.isGeneratedUI)
    #expect(customChoice.generatedUIRole == .choice)
    #expect(customChoice.prompt.contains("selected UI choice"))
    #expect(customChoice.prompt.contains("next clickable choice"))
    #expect(standard.isGeneratedUI == false)
    #expect(standard.generatedUIRole == nil)
    #expect(standard.prompt.contains("Return confirmed facts, recommended next action, and verification evidence."))
}

@Test func generatedUIMissionTargetsSurfacePendingDecisionActionsAcrossRuns() {
    let workspace = Workspace(
        id: "workspace-generated-ui-mission",
        name: "Generated UI Mission",
        pathDisplay: "/tmp/generated-ui-mission",
        trustState: .trusted
    )
    let waitingItem = WorkItem(
        id: "workitem-generated-ui-waiting",
        workspaceId: workspace.id,
        title: "Ship generated UI approval",
        sourceType: .manualPrompt
    )
    let completedItem = WorkItem(
        id: "workitem-generated-ui-completed",
        workspaceId: workspace.id,
        title: "Choose next validation path",
        sourceType: .manualPrompt
    )
    let waitingRun = AgentRun(
        id: "run-generated-ui-waiting",
        workItemId: waitingItem.id,
        workspaceId: workspace.id,
        agentProfileId: "agent-generated-ui",
        state: .waitingForUser,
        startedAt: Date(timeIntervalSince1970: 1_000),
        promptSnapshot: "Ask for approval",
        transcript: """
        ```pikiclaw-ui
        {"confirm":{"kind":"confirm","title":"Deploy","detail":"Release notes are ready","symbol":"paperplane","approveTitle":"Deploy","approvePrompt":"Deploy the prepared update","declineTitle":"Hold","declinePrompt":"Keep the draft pending"}}
        ```
        """
    )
    let completedRun = AgentRun(
        id: "run-generated-ui-completed",
        workItemId: completedItem.id,
        workspaceId: workspace.id,
        agentProfileId: "agent-generated-ui",
        state: .completed,
        startedAt: Date(timeIntervalSince1970: 2_000),
        promptSnapshot: "Offer next steps",
        transcript: """
        Next steps:
        A) Run focused validation.
        B) Update Jira comment.
        """
    )
    let runningRun = AgentRun(
        id: "run-generated-ui-running",
        workspaceId: workspace.id,
        agentProfileId: "agent-generated-ui",
        state: .running,
        startedAt: Date(timeIntervalSince1970: 3_000),
        promptSnapshot: "Still running",
        transcript: "Should I continue?"
    )
    let evidenceOnlyRun = AgentRun(
        id: "run-generated-ui-evidence",
        workspaceId: workspace.id,
        agentProfileId: "agent-generated-ui",
        state: .completed,
        startedAt: Date(timeIntervalSince1970: 4_000),
        promptSnapshot: "Show evidence",
        transcript: "Tool result: swift test --filter ChatMessageHistoryTests"
    )
    let snapshot = NativeStoreSnapshot(
        workspaces: [workspace],
        workItems: [waitingItem, completedItem],
        runs: [completedRun, evidenceOnlyRun, runningRun, waitingRun]
    )

    let targets = generatedUIMissionTargets(snapshot: snapshot, limit: 4)

    #expect(targets.map(\.id) == [
        "run-generated-ui-waiting-confirm-approve-structured-1",
        "run-generated-ui-waiting-confirm-decline-structured-1",
        "run-generated-ui-completed-choice-1",
        "run-generated-ui-completed-choice-2"
    ])
    #expect(targets.map(\.actionTitle) == ["Deploy", "Hold", "Validate", "Jira"])
    #expect(targets.map(\.actionKind) == ["Confirm", "Confirm", "Choice", "Choice"])
    #expect(targets[0].runTitle == "Ship generated UI approval")
    #expect(targets[0].actionDetail == "Structured confirm")
    #expect(targets[0].stageTitle == "Deploy - Structured confirm")
    #expect(targets[0].permissionMode == .askBeforeEdit)
    #expect(targets[0].shortcutLabel == "Return")
    #expect(targets[1].shortcutLabel == "Esc")
    #expect(targets[2].shortcutLabel == "Return")
    #expect(targets.map(\.keepsAttentionWhenOpened) == [true, true, true, true])
    #expect(targets[0].openStatusLine == "Opened Deploy action: Ship generated UI approval; still pending until staged or dismissed")
    #expect(targets[0].actionPrompt.contains("explicit approval"))
    #expect(targets.contains(where: { $0.runId == runningRun.id }) == false)
    #expect(targets.contains(where: { $0.runId == evidenceOnlyRun.id }) == false)
}

@Test func generatedUIMissionTargetsRespectLimit() {
    let workspace = Workspace(
        id: "workspace-generated-ui-limit",
        name: "Generated UI Limit",
        pathDisplay: "/tmp/generated-ui-limit",
        trustState: .trusted
    )
    let run = AgentRun(
        id: "run-generated-ui-limit",
        workspaceId: workspace.id,
        agentProfileId: "agent-generated-ui",
        state: .waitingForUser,
        startedAt: Date(timeIntervalSince1970: 1_000),
        promptSnapshot: "Pick next path",
        transcript: """
        Next steps:
        A) Implement the compact digest.
        B) Run focused validation.
        C) Update the goal note.
        """
    )
    let snapshot = NativeStoreSnapshot(workspaces: [workspace], runs: [run])

    #expect(generatedUIMissionTargets(snapshot: snapshot, limit: 0).isEmpty)
    #expect(generatedUIMissionTargets(snapshot: snapshot, limit: 2).map(\.actionId) == ["choice-1", "choice-2"])
}

@Test func generatedUIMissionTargetsIncludeStructuredForms() throws {
    let workspace = Workspace(
        id: "workspace-generated-ui-form",
        name: "Generated UI Form",
        pathDisplay: "/tmp/generated-ui-form",
        trustState: .trusted
    )
    let run = AgentRun(
        id: "run-generated-ui-form",
        workspaceId: workspace.id,
        agentProfileId: "agent-generated-ui",
        state: .waitingForUser,
        startedAt: Date(timeIntervalSince1970: 1_000),
        promptSnapshot: "Collect form fields",
        transcript: """
        ```pikiclaw-ui
        {"form":{"title":"Configure run","prompt":"Collect parameters.","fields":[{"name":"agent","label":"Agent","type":"select","required":true,"options":["codex","claude"]}]}}
        ```
        """
    )
    let snapshot = NativeStoreSnapshot(workspaces: [workspace], runs: [run])

    let target = try #require(generatedUIMissionTargets(snapshot: snapshot, limit: 1).first)

    #expect(target.id == "run-generated-ui-form-form-structured-1")
    #expect(target.actionTitle == "Configure run")
    #expect(target.actionKind == "Form")
    #expect(target.stageTitle == "Configure run - 1 fields")
    #expect(target.permissionMode == .askBeforeEdit)
    #expect(target.readinessBadgeText == "0/1 ready")
    #expect(target.readinessDetail == "Missing: Agent")
    #expect(target.shortcutLabel == nil)
    #expect(target.missionDetail.contains("Missing: Agent"))
    #expect(target.missionDetail.contains("Collect form fields"))
    #expect(target.actionPrompt.contains("Agent [select, required]; name=agent; options=codex | claude"))
}

@Test func generatedUIMissionTargetsSkipAcknowledgedRuns() {
    let workspace = Workspace(
        id: "workspace-generated-ui-ack",
        name: "Generated UI Ack",
        pathDisplay: "/tmp/generated-ui-ack",
        trustState: .trusted
    )
    var acknowledgedRun = AgentRun(
        id: "run-generated-ui-acknowledged",
        workspaceId: workspace.id,
        agentProfileId: "agent-generated-ui",
        state: .completed,
        startedAt: Date(timeIntervalSince1970: 2_000),
        promptSnapshot: "Already handled",
        transcript: """
        Next steps:
        A) Validate acknowledged output.
        B) Update acknowledged note.
        """
    )
    acknowledgedRun.readAt = Date(timeIntervalSince1970: 2_100)
    let visibleRun = AgentRun(
        id: "run-generated-ui-visible",
        workspaceId: workspace.id,
        agentProfileId: "agent-generated-ui",
        state: .completed,
        startedAt: Date(timeIntervalSince1970: 1_000),
        promptSnapshot: "Needs handling",
        transcript: """
        Next steps:
        A) Validate visible output.
        B) Update visible note.
        """
    )
    let snapshot = NativeStoreSnapshot(workspaces: [workspace], runs: [acknowledgedRun, visibleRun])

    let targets = generatedUIMissionTargets(snapshot: snapshot)

    #expect(targets.map(\.runId) == [visibleRun.id, visibleRun.id])
    #expect(generatedUIMissionRunAcknowledged(acknowledgedRun))
    #expect(generatedUIMissionRunAcknowledged(visibleRun) == false)
}

@MainActor
@Test func markChatReadAcknowledgesGeneratedUIMissionTargets() async throws {
    let directory = URL(fileURLWithPath: NSTemporaryDirectory())
        .appendingPathComponent("pikiclaw-generated-ui-ack-\(UUID().uuidString)", isDirectory: true)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: directory) }

    let workspace = Workspace(
        id: "workspace-generated-ui-mark-read",
        name: "Generated UI Mark Read",
        pathDisplay: directory.path,
        trustState: .trusted
    )
    let run = AgentRun(
        id: "run-generated-ui-mark-read",
        workspaceId: workspace.id,
        agentProfileId: "agent-generated-ui",
        state: .waitingForUser,
        startedAt: Date(timeIntervalSince1970: 1_000),
        promptSnapshot: "Ask for generated UI input",
        transcript: """
        ```pikiclaw-ui
        {"confirm":{"kind":"confirm","title":"Proceed","detail":"Validation is ready","symbol":"checkmark","approveTitle":"Proceed","approvePrompt":"Continue with the selected validation path","declineTitle":"Hold","declinePrompt":"Keep the result pending"}}
        ```
        """
    )
    let seed = NativeAppSeed(
        projects: [],
        workspaces: [workspace],
        workItems: [],
        runs: [run],
        artifacts: [],
        capabilities: [],
        knowledgeCards: [],
        automations: [],
        agentProfiles: [],
        providerProfiles: []
    )
    let store = JSONNativeStore(fileURL: directory.appendingPathComponent("state.json"), seed: seed)
    let model = NativeAppModel(store: store)
    await model.reload()

    #expect(generatedUIMissionTargets(snapshot: model.snapshot).map(\.runId) == [run.id, run.id])
    await model.markChatRead(runId: run.id)

    let snapshot = try await store.loadSnapshot()
    let updatedRun = try #require(snapshot.runs.first(where: { $0.id == run.id }))

    #expect(updatedRun.readAt != nil)
    #expect(generatedUIMissionTargets(snapshot: snapshot).isEmpty)
}

@Test func missionAcknowledgedTrailItemsSummarizeGeneratedUIAndDismissedOutputs() throws {
    let workspace = Workspace(
        id: "workspace-mission-ack-trail",
        name: "Mission Acknowledged Trail",
        pathDisplay: "/tmp/mission-ack-trail",
        trustState: .trusted
    )
    let generatedItem = WorkItem(
        id: "workitem-mission-ack-generated",
        workspaceId: workspace.id,
        title: "Handle generated UI decision",
        sourceType: .manualPrompt
    )
    let outputItem = WorkItem(
        id: "workitem-mission-ack-output",
        workspaceId: workspace.id,
        title: "Review dismissed output",
        sourceType: .manualPrompt
    )
    var acknowledgedRun = AgentRun(
        id: "run-mission-ack-generated",
        workItemId: generatedItem.id,
        workspaceId: workspace.id,
        agentProfileId: "agent-mission-ack",
        state: .completed,
        startedAt: Date(timeIntervalSince1970: 100),
        promptSnapshot: "Generated UI already handled",
        transcript: """
        Next steps:
        A) Run focused validation.
        B) Update the goal note.
        """
    )
    acknowledgedRun.readAt = Date(timeIntervalSince1970: 200)
    let visibleRun = AgentRun(
        id: "run-mission-ack-visible",
        workItemId: generatedItem.id,
        workspaceId: workspace.id,
        agentProfileId: "agent-mission-ack",
        state: .completed,
        startedAt: Date(timeIntervalSince1970: 150),
        promptSnapshot: "Generated UI still visible",
        transcript: """
        Next steps:
        A) Run visible validation.
        B) Update visible note.
        """
    )
    let dismissedArtifact = Artifact(
        id: "artifact-mission-ack-dismissed",
        workspaceId: workspace.id,
        workItemId: outputItem.id,
        runId: acknowledgedRun.id,
        kind: .commandOutputSummary,
        title: "Dismissed saved output",
        uri: "pikiclaw://artifacts/artifact-mission-ack-dismissed",
        status: .ready,
        provenance: "Dismissed from Mission Control",
        createdAt: Date(timeIntervalSince1970: 50),
        sourceRefs: [artifactMissionReviewDismissedRef()]
    )
    let visibleArtifact = Artifact(
        id: "artifact-mission-ack-visible",
        workspaceId: workspace.id,
        workItemId: outputItem.id,
        kind: .commandOutputSummary,
        title: "Visible saved output",
        uri: "pikiclaw://artifacts/artifact-mission-ack-visible",
        status: .ready,
        provenance: "Still in Mission Control",
        createdAt: Date(timeIntervalSince1970: 250)
    )
    let auditEvent = AuditEvent(
        kind: .artifactCreated,
        actor: "user",
        summary: "Dismissed output Dismissed saved output from Mission Control",
        createdAt: Date(timeIntervalSince1970: 300),
        runId: dismissedArtifact.runId,
        workItemId: dismissedArtifact.workItemId,
        workspaceId: dismissedArtifact.workspaceId
    )
    let snapshot = NativeStoreSnapshot(
        workspaces: [workspace],
        workItems: [generatedItem, outputItem],
        runs: [visibleRun, acknowledgedRun],
        artifacts: [visibleArtifact, dismissedArtifact],
        auditEvents: [auditEvent]
    )

    let items = missionAcknowledgedTrailItems(snapshot: snapshot, limit: 4)

    #expect(items.map(\.id) == [
        "output-review-\(dismissedArtifact.id)",
        "generated-ui-\(acknowledgedRun.id)"
    ])
    #expect(items.map(\.kind) == [.outputReview, .generatedUI])
    #expect(items[0].title == "Dismissed saved output")
    #expect(items[0].detail == "Review dismissed output · Ready to review")
    #expect(items[0].createdAt == Date(timeIntervalSince1970: 300))
    #expect(items[0].artifactId == dismissedArtifact.id)
    #expect(items[1].title == "2 actions")
    #expect(items[1].detail == "Handle generated UI decision · Choice")
    #expect(items[1].createdAt == Date(timeIntervalSince1970: 200))
    #expect(items[1].runId == acknowledgedRun.id)
    #expect(items.contains(where: { $0.runId == visibleRun.id }) == false)
    #expect(items.contains(where: { $0.artifactId == visibleArtifact.id }) == false)
    #expect(missionAcknowledgedTrailItems(snapshot: snapshot, limit: 1).map(\.id) == [
        "output-review-\(dismissedArtifact.id)"
    ])
}

@Test func missionAgentHandoffTrailItemsGroupFocusAgentsByWorkItem() throws {
    let workspace = Workspace(
        id: "workspace-mission-handoff",
        name: "Mission Handoff",
        pathDisplay: "/tmp/mission-handoff",
        trustState: .trusted
    )
    let codex = AgentProfile(
        id: "agent-mission-handoff-codex",
        kind: .codex,
        displayName: "Codex",
        executableName: "codex"
    )
    let claude = AgentProfile(
        id: "agent-mission-handoff-claude",
        kind: .claude,
        displayName: "Claude Code",
        executableName: "claude"
    )
    let gemini = AgentProfile(
        id: "agent-mission-handoff-gemini",
        kind: .gemini,
        displayName: "Gemini CLI",
        executableName: "gemini"
    )
    let singleAgent = AgentProfile(
        id: "agent-mission-handoff-hermes",
        kind: .hermes,
        displayName: "Hermes",
        executableName: "hermes"
    )
    let crossItem = WorkItem(
        id: "workitem-mission-handoff-cross",
        workspaceId: workspace.id,
        title: "IVAS-9081: Cross-agent validation",
        sourceType: .jira,
        updatedAt: Date(timeIntervalSince1970: 10)
    )
    let singleItem = WorkItem(
        id: "workitem-mission-handoff-single",
        workspaceId: workspace.id,
        title: "Single agent work",
        sourceType: .manualPrompt,
        updatedAt: Date(timeIntervalSince1970: 20)
    )
    let parent = AgentRun(
        id: "run-mission-handoff-codex",
        workItemId: crossItem.id,
        workspaceId: workspace.id,
        agentProfileId: codex.id,
        state: .completed,
        startedAt: Date(timeIntervalSince1970: 100),
        endedAt: Date(timeIntervalSince1970: 120),
        sideChatRunIds: ["run-mission-handoff-claude"],
        promptSnapshot: "Codex implements the change"
    )
    let claudeBranch = AgentRun(
        id: "run-mission-handoff-claude",
        workItemId: crossItem.id,
        workspaceId: workspace.id,
        agentProfileId: claude.id,
        state: .completed,
        startedAt: Date(timeIntervalSince1970: 200),
        endedAt: Date(timeIntervalSince1970: 220),
        sideChatOfRunId: parent.id,
        promptSnapshot: "Claude reviews the change"
    )
    let geminiRun = AgentRun(
        id: "run-mission-handoff-gemini",
        workItemId: crossItem.id,
        workspaceId: workspace.id,
        agentProfileId: gemini.id,
        state: .completed,
        startedAt: Date(timeIntervalSince1970: 300),
        endedAt: Date(timeIntervalSince1970: 320),
        promptSnapshot: "Gemini summarizes rollout evidence"
    )
    let hermesRun = AgentRun(
        id: "run-mission-handoff-hermes",
        workItemId: singleItem.id,
        workspaceId: workspace.id,
        agentProfileId: singleAgent.id,
        state: .completed,
        startedAt: Date(timeIntervalSince1970: 500),
        endedAt: Date(timeIntervalSince1970: 520),
        promptSnapshot: "Hermes handles unrelated work"
    )
    let codexOutput = Artifact(
        id: "artifact-mission-handoff-codex",
        workspaceId: workspace.id,
        workItemId: crossItem.id,
        runId: parent.id,
        kind: .commandOutputSummary,
        title: "Codex implementation output",
        uri: "pikiclaw://runs/run-mission-handoff-codex/evidence",
        status: .ready,
        provenance: "Implementation output",
        createdAt: Date(timeIntervalSince1970: 130)
    )
    let geminiOutput = Artifact(
        id: "artifact-mission-handoff-gemini",
        workspaceId: workspace.id,
        workItemId: crossItem.id,
        runId: geminiRun.id,
        kind: .markdownReport,
        title: "Gemini rollout summary",
        uri: "pikiclaw://runs/run-mission-handoff-gemini/report",
        status: .ready,
        provenance: "Rollout summary",
        createdAt: Date(timeIntervalSince1970: 400)
    )
    let singleOutput = Artifact(
        id: "artifact-mission-handoff-single",
        workspaceId: workspace.id,
        workItemId: singleItem.id,
        runId: hermesRun.id,
        kind: .commandOutputSummary,
        title: "Single agent output",
        uri: "pikiclaw://runs/run-mission-handoff-hermes/evidence",
        status: .ready,
        provenance: "Single agent output",
        createdAt: Date(timeIntervalSince1970: 600)
    )
    let snapshot = NativeStoreSnapshot(
        workspaces: [workspace],
        workItems: [singleItem, crossItem],
        runs: [hermesRun, geminiRun, claudeBranch, parent],
        artifacts: [singleOutput, codexOutput, geminiOutput],
        agentProfiles: [singleAgent, gemini, claude, codex]
    )

    let items = missionAgentHandoffTrailItems(snapshot: snapshot, limit: 4)

    let item = try #require(items.first)
    #expect(items.count == 1)
    #expect(item.workItemId == crossItem.id)
    #expect(item.workspaceId == workspace.id)
    #expect(item.title == "IVAS-9081: Cross-agent validation")
    #expect(item.agentKinds == [.codex, .claude, .gemini])
    #expect(item.runCount == 3)
    #expect(item.branchCount == 1)
    #expect(item.outputCount == 2)
    #expect(item.updatedAt == Date(timeIntervalSince1970: 400))
    #expect(item.latestRunId == geminiRun.id)
    #expect(item.nextAgentKind == .codex)
    #expect(item.handoffState == .waiting)
    #expect(item.handoffStateLabel == "Waiting Codex")
    #expect(item.handoffFreshness == nil)
    #expect(item.handoffFreshnessLabel == nil)
    #expect(item.handoffStagedAt == nil)
    #expect(item.handoffLatestEvidenceAt == nil)
    #expect(item.handoffLatestEvidenceSource == nil)
    #expect(item.handoffLatestEvidenceSourceLabel == nil)
    #expect(item.handoffLatestEvidenceIdentity == nil)
    #expect(item.handoffLatestEvidenceIdentityLabel == nil)
    #expect(item.handoffLatestEvidenceIdentityBadge == nil)
    #expect(item.handoffLatestEvidenceRefId == nil)
    #expect(missionAgentHandoffLatestEvidenceDestination(item) == .chat(runId: geminiRun.id))
    #expect(item.handoffStageTitle == "Handoff to Codex")
    #expect(item.handoffActionLabel == "Stage handoff to Codex")
    #expect(item.handoffActionSymbol == "arrowshape.turn.up.right")
    #expect(item.detail == "Codex -> Claude -> Gemini · Mission Handoff")
    #expect(missionAgentHandoffTrailItems(snapshot: snapshot, limit: 0).isEmpty)

    let action = missionAgentHandoffFollowUpAction(item)
    #expect(action.id == "agent-handoff")
    #expect(action.title == "Handoff")
    #expect(action.detail == "Next: Codex")
    #expect(action.workflowLabel == "Handoff")
    #expect(action.workflowSummary == "Move context to the next agent with latest evidence")
    #expect(runFollowUpActionHelp(action) == "Handoff: Move context to the next agent with latest evidence - Next: Codex")
    #expect(action.permissionMode == .askBeforeEdit)
    #expect(action.prompt.contains("Target next agent: Codex"))
    #expect(action.prompt.contains("Handoff state: Waiting Codex"))
    #expect(action.prompt.contains("Recovery mode: stage a fresh handoff draft"))
    #expect(action.prompt.contains("Freshness: not staged yet"))
    #expect(action.prompt.contains("Staged at: not available"))
    #expect(action.prompt.contains("Latest evidence at: not available"))
    #expect(action.prompt.contains("Latest evidence source: not available"))
    #expect(action.prompt.contains("Latest evidence identity: not available"))
    #expect(action.prompt.contains("Agents already involved: Codex -> Claude -> Gemini"))
    #expect(action.prompt.contains("Latest run: run-mission-handoff-gemini"))
    #expect(action.prompt.contains("Output contract:"))
    #expect(action.prompt.contains("previous agent evidence"))
    #expect(action.prompt.contains("Permission guard:"))
}

@Test func missionAgentHandoffTrailItemsRecommendMissingFocusAgent() throws {
    let workspace = Workspace(
        id: "workspace-mission-handoff-next",
        name: "Missing Focus Agent",
        pathDisplay: "/tmp/mission-handoff-next",
        trustState: .trusted
    )
    let codex = AgentProfile(
        id: "agent-mission-handoff-next-codex",
        kind: .codex,
        displayName: "Codex",
        executableName: "codex"
    )
    let claude = AgentProfile(
        id: "agent-mission-handoff-next-claude",
        kind: .claude,
        displayName: "Claude Code",
        executableName: "claude"
    )
    let gemini = AgentProfile(
        id: "agent-mission-handoff-next-gemini",
        kind: .gemini,
        displayName: "Gemini CLI",
        executableName: "gemini"
    )
    let workItem = WorkItem(
        id: "workitem-mission-handoff-next",
        workspaceId: workspace.id,
        title: "Partial handoff",
        sourceType: .manualPrompt,
        updatedAt: Date(timeIntervalSince1970: 10)
    )
    let codexRun = AgentRun(
        id: "run-mission-handoff-next-codex",
        workItemId: workItem.id,
        workspaceId: workspace.id,
        agentProfileId: codex.id,
        state: .completed,
        startedAt: Date(timeIntervalSince1970: 100),
        endedAt: Date(timeIntervalSince1970: 120),
        sideChatRunIds: ["run-mission-handoff-next-claude"],
        promptSnapshot: "Codex implements the first pass"
    )
    let claudeRun = AgentRun(
        id: "run-mission-handoff-next-claude",
        workItemId: workItem.id,
        workspaceId: workspace.id,
        agentProfileId: claude.id,
        state: .completed,
        startedAt: Date(timeIntervalSince1970: 200),
        endedAt: Date(timeIntervalSince1970: 220),
        sideChatOfRunId: codexRun.id,
        promptSnapshot: "Claude reviews the first pass"
    )
    let snapshot = NativeStoreSnapshot(
        workspaces: [workspace],
        workItems: [workItem],
        runs: [codexRun, claudeRun],
        agentProfiles: [gemini, claude, codex]
    )

    let item = try #require(missionAgentHandoffTrailItems(snapshot: snapshot).first)
    let action = missionAgentHandoffFollowUpAction(item)

    #expect(item.nextAgentKind == .gemini)
    #expect(item.handoffState == .waiting)
    #expect(item.handoffStateLabel == "Waiting Gemini")
    #expect(item.handoffFreshness == nil)
    #expect(item.handoffFreshnessLabel == nil)
    #expect(item.handoffStagedAt == nil)
    #expect(item.handoffLatestEvidenceAt == nil)
    #expect(item.handoffLatestEvidenceSource == nil)
    #expect(item.handoffLatestEvidenceSourceLabel == nil)
    #expect(item.handoffLatestEvidenceIdentity == nil)
    #expect(item.handoffLatestEvidenceIdentityLabel == nil)
    #expect(item.handoffLatestEvidenceIdentityBadge == nil)
    #expect(item.handoffLatestEvidenceRefId == nil)
    #expect(missionAgentHandoffLatestEvidenceDestination(item) == .chat(runId: claudeRun.id))
    #expect(item.agentKinds == [.codex, .claude])
    #expect(item.branchCount == 1)
    #expect(item.outputCount == 0)
    #expect(item.latestRunId == claudeRun.id)
    #expect(action.detail == "Next: Gemini")
    #expect(action.prompt.contains("Continue the cross-agent handoff for Partial handoff."))
    #expect(action.prompt.contains("Target next agent: Gemini"))
    #expect(action.prompt.contains("Agents already involved: Codex -> Claude"))
    #expect(action.prompt.contains("Work item id: workitem-mission-handoff-next"))
    #expect(action.prompt.contains("Latest run: run-mission-handoff-next-claude"))
    #expect(action.prompt.contains("Latest evidence link: pikiclaw://mission-control/latest-evidence/workitem-mission-handoff-next"))
    #expect(action.prompt.contains("Runs: 2"))
    #expect(action.prompt.contains("Branches: 1"))
    #expect(action.prompt.contains("Outputs: 0"))
    #expect(action.prompt.contains("Handoff detail: Codex -> Claude · Missing Focus Agent"))
}

@Test func missionAgentHandoffTrailItemsTrackStagedAndPickedUpAudit() throws {
    let workspace = Workspace(
        id: "workspace-mission-handoff-audit",
        name: "Handoff Audit",
        pathDisplay: "/tmp/mission-handoff-audit",
        trustState: .trusted
    )
    let codex = AgentProfile(
        id: "agent-mission-handoff-audit-codex",
        kind: .codex,
        displayName: "Codex",
        executableName: "codex"
    )
    let claude = AgentProfile(
        id: "agent-mission-handoff-audit-claude",
        kind: .claude,
        displayName: "Claude Code",
        executableName: "claude"
    )
    let gemini = AgentProfile(
        id: "agent-mission-handoff-audit-gemini",
        kind: .gemini,
        displayName: "Gemini CLI",
        executableName: "gemini"
    )
    let workItem = WorkItem(
        id: "workitem-mission-handoff-audit",
        workspaceId: workspace.id,
        title: "Audited handoff",
        sourceType: .manualPrompt
    )
    let codexRun = AgentRun(
        id: "run-mission-handoff-audit-codex",
        workItemId: workItem.id,
        workspaceId: workspace.id,
        agentProfileId: codex.id,
        state: .completed,
        startedAt: Date(timeIntervalSince1970: 100),
        endedAt: Date(timeIntervalSince1970: 120),
        sideChatRunIds: ["run-mission-handoff-audit-claude"],
        promptSnapshot: "Codex first pass"
    )
    let claudeRun = AgentRun(
        id: "run-mission-handoff-audit-claude",
        workItemId: workItem.id,
        workspaceId: workspace.id,
        agentProfileId: claude.id,
        state: .completed,
        startedAt: Date(timeIntervalSince1970: 200),
        endedAt: Date(timeIntervalSince1970: 220),
        sideChatOfRunId: codexRun.id,
        promptSnapshot: "Claude review"
    )
    let stagedEvent = AuditEvent(
        kind: .permissionDecision,
        actor: "user",
        summary: missionAgentHandoffAuditSummary(nextAgentKind: .gemini, title: workItem.title),
        createdAt: Date(timeIntervalSince1970: 250),
        runId: claudeRun.id,
        workItemId: workItem.id,
        workspaceId: workspace.id
    )
    let stagedSnapshot = NativeStoreSnapshot(
        workspaces: [workspace],
        workItems: [workItem],
        runs: [codexRun, claudeRun],
        agentProfiles: [gemini, claude, codex],
        auditEvents: [stagedEvent]
    )

    let stagedItem = try #require(missionAgentHandoffTrailItems(snapshot: stagedSnapshot).first)
    #expect(stagedItem.nextAgentKind == .gemini)
    #expect(stagedItem.handoffState == .staged)
    #expect(stagedItem.handoffStateLabel == "Staged Gemini")
    #expect(stagedItem.handoffFreshness == .fresh)
    #expect(stagedItem.handoffFreshnessLabel == "Fresh")
    #expect(stagedItem.handoffStagedAt == Date(timeIntervalSince1970: 250))
    #expect(stagedItem.handoffLatestEvidenceAt == Date(timeIntervalSince1970: 220))
    #expect(stagedItem.handoffLatestEvidenceSource == .run)
    #expect(stagedItem.handoffLatestEvidenceSourceLabel == "run evidence")
    #expect(stagedItem.handoffLatestEvidenceIdentity == claudeRun.id.rawValue)
    #expect(stagedItem.handoffLatestEvidenceIdentityLabel == claudeRun.id.rawValue)
    #expect(stagedItem.handoffLatestEvidenceIdentityBadge == "Run: \(claudeRun.id.rawValue)")
    #expect(stagedItem.handoffLatestEvidenceRefId == claudeRun.id)
    #expect(missionAgentHandoffLatestEvidenceDestination(stagedItem) == .chat(runId: claudeRun.id))
    #expect(stagedItem.handoffFreshnessDetail?.contains("no newer evidence") == true)
    #expect(stagedItem.handoffFreshnessDetail?.contains("latest run evidence") == true)
    #expect(stagedItem.handoffFreshnessDetail?.contains(claudeRun.id.rawValue) == true)
    #expect(stagedItem.handoffTimelineDetail.contains("no newer evidence"))
    #expect(stagedItem.handoffStageTitle == "Refresh handoff to Gemini")
    #expect(stagedItem.handoffActionLabel == "Refresh staged handoff to Gemini")
    #expect(stagedItem.handoffActionSymbol == "arrow.clockwise")
    let stagedAction = missionAgentHandoffFollowUpAction(stagedItem)
    #expect(stagedAction.detail == "Refresh: Gemini")
    #expect(stagedAction.symbol == "arrow.clockwise")
    #expect(stagedAction.prompt.contains("Handoff state: Staged Gemini"))
    #expect(stagedAction.prompt.contains("Recovery mode: refresh a staged handoff that has not been picked up"))
    #expect(stagedAction.prompt.contains("Freshness: fresh; no newer run or output evidence has arrived since staging"))
    #expect(stagedAction.prompt.contains("Staged at:"))
    #expect(stagedAction.prompt.contains("Latest evidence at:"))
    #expect(stagedAction.prompt.contains("Latest evidence source: latest run before staging"))
    #expect(stagedAction.prompt.contains("Latest evidence identity: run: \(claudeRun.id.rawValue)"))
    #expect(stagedAction.prompt.contains("Latest evidence link: pikiclaw://mission-control/latest-evidence/workitem-mission-handoff-audit"))
    #expect(stagedAction.prompt.contains("still valid, stale, or blocked"))

    let staleRun = AgentRun(
        id: "run-mission-handoff-audit-new-codex",
        workItemId: workItem.id,
        workspaceId: workspace.id,
        agentProfileId: codex.id,
        state: .completed,
        startedAt: Date(timeIntervalSince1970: 270),
        endedAt: Date(timeIntervalSince1970: 280),
        promptSnapshot: "Codex added evidence after staging"
    )
    var staleRunSnapshot = stagedSnapshot
    staleRunSnapshot.runs.append(staleRun)

    let staleRunItem = try #require(missionAgentHandoffTrailItems(snapshot: staleRunSnapshot).first)
    #expect(staleRunItem.handoffState == .staged)
    #expect(staleRunItem.handoffFreshness == .stale)
    #expect(staleRunItem.handoffLatestEvidenceAt == Date(timeIntervalSince1970: 280))
    #expect(staleRunItem.handoffLatestEvidenceSource == .run)
    #expect(staleRunItem.handoffLatestEvidenceIdentity == staleRun.id.rawValue)
    #expect(staleRunItem.handoffLatestEvidenceIdentityBadge?.hasPrefix("Run: run-mission-handoff-audit-new") == true)
    #expect(staleRunItem.handoffLatestEvidenceRefId == staleRun.id)
    #expect(missionAgentHandoffLatestEvidenceDestination(staleRunItem) == .chat(runId: staleRun.id))
    #expect(staleRunItem.handoffFreshnessDetail?.contains("latest run evidence") == true)
    #expect(staleRunItem.handoffFreshnessDetail?.contains(staleRun.id.rawValue) == true)
    let staleRunAction = missionAgentHandoffFollowUpAction(staleRunItem)
    #expect(staleRunAction.prompt.contains("Latest evidence source: new run after staging"))
    #expect(staleRunAction.prompt.contains("Latest evidence identity: run: \(staleRun.id.rawValue)"))

    let staleOutput = Artifact(
        id: "artifact-mission-handoff-audit-new-output",
        workspaceId: workspace.id,
        workItemId: workItem.id,
        runId: claudeRun.id,
        kind: .commandOutputSummary,
        title: "New validation after staging",
        uri: "pikiclaw://artifacts/artifact-mission-handoff-audit-new-output",
        status: .ready,
        provenance: "New evidence arrived after the staged handoff.",
        createdAt: Date(timeIntervalSince1970: 300)
    )
    var staleSnapshot = stagedSnapshot
    staleSnapshot.artifacts.append(staleOutput)

    let staleItem = try #require(missionAgentHandoffTrailItems(snapshot: staleSnapshot).first)
    #expect(staleItem.handoffState == .staged)
    #expect(staleItem.handoffFreshness == .stale)
    #expect(staleItem.handoffFreshnessLabel == "Stale evidence")
    #expect(staleItem.handoffStagedAt == Date(timeIntervalSince1970: 250))
    #expect(staleItem.handoffLatestEvidenceAt == Date(timeIntervalSince1970: 300))
    #expect(staleItem.handoffLatestEvidenceSource == .output)
    #expect(staleItem.handoffLatestEvidenceSourceLabel == "output evidence")
    #expect(staleItem.handoffLatestEvidenceIdentity == "New validation after staging")
    #expect(staleItem.handoffLatestEvidenceIdentityLabel == "New validation after staging")
    #expect(staleItem.handoffLatestEvidenceIdentityBadge == "Output: New validation after staging")
    #expect(staleItem.handoffLatestEvidenceRefId == staleOutput.id)
    #expect(missionAgentHandoffLatestEvidenceDestination(staleItem) == .outputs(artifactId: staleOutput.id))
    #expect(staleItem.handoffFreshnessDetail?.contains("latest output evidence") == true)
    #expect(staleItem.handoffFreshnessDetail?.contains("New validation after staging") == true)
    #expect(staleItem.handoffTimelineDetail.contains("latest output evidence"))
    #expect(staleItem.handoffStageTitle == "Refresh stale handoff to Gemini")
    #expect(staleItem.handoffActionLabel == "Refresh stale handoff to Gemini")
    let staleAction = missionAgentHandoffFollowUpAction(staleItem)
    #expect(staleAction.detail == "Refresh stale: Gemini")
    #expect(staleAction.prompt.contains("Recovery mode: refresh a stale staged handoff because newer evidence arrived"))
    #expect(staleAction.prompt.contains("Freshness: stale because newer run or output evidence arrived after staging"))
    #expect(staleAction.prompt.contains("Staged at:"))
    #expect(staleAction.prompt.contains("Latest evidence at:"))
    #expect(staleAction.prompt.contains("Latest evidence source: new output after staging"))
    #expect(staleAction.prompt.contains("Latest evidence identity: output: New validation after staging"))
    #expect(staleAction.prompt.contains("what changed"))

    let geminiRun = AgentRun(
        id: "run-mission-handoff-audit-gemini",
        workItemId: workItem.id,
        workspaceId: workspace.id,
        agentProfileId: gemini.id,
        state: .completed,
        startedAt: Date(timeIntervalSince1970: 300),
        endedAt: Date(timeIntervalSince1970: 320),
        promptSnapshot: "Gemini pickup"
    )
    var pickedUpSnapshot = stagedSnapshot
    pickedUpSnapshot.runs.append(geminiRun)

    let pickedUpItem = try #require(missionAgentHandoffTrailItems(snapshot: pickedUpSnapshot).first)
    #expect(pickedUpItem.nextAgentKind == .gemini)
    #expect(pickedUpItem.handoffState == .pickedUp)
    #expect(pickedUpItem.handoffStateLabel == "Picked up Gemini")
    #expect(pickedUpItem.handoffFreshness == nil)
    #expect(pickedUpItem.handoffFreshnessLabel == nil)
    #expect(pickedUpItem.handoffStagedAt == Date(timeIntervalSince1970: 250))
    #expect(pickedUpItem.handoffLatestEvidenceAt == Date(timeIntervalSince1970: 320))
    #expect(pickedUpItem.handoffLatestEvidenceSource == .run)
    #expect(pickedUpItem.handoffLatestEvidenceSourceLabel == "run evidence")
    #expect(pickedUpItem.handoffLatestEvidenceIdentity == geminiRun.id.rawValue)
    #expect(pickedUpItem.handoffLatestEvidenceIdentityLabel == geminiRun.id.rawValue)
    #expect(pickedUpItem.handoffLatestEvidenceIdentityBadge == "Run: \(geminiRun.id.rawValue)")
    #expect(pickedUpItem.handoffLatestEvidenceRefId == geminiRun.id)
    #expect(missionAgentHandoffLatestEvidenceDestination(pickedUpItem) == .chat(runId: geminiRun.id))
    #expect(pickedUpItem.handoffFreshnessDetail?.contains("Picked up after") == true)
    #expect(pickedUpItem.handoffFreshnessDetail?.contains(geminiRun.id.rawValue) == true)
    #expect(pickedUpItem.handoffStageTitle == "Follow up with Gemini")
    #expect(pickedUpItem.handoffActionLabel == "Follow up with Gemini")
    #expect(pickedUpItem.handoffActionSymbol == "arrowshape.turn.up.right.circle")
    let pickedUpAction = missionAgentHandoffFollowUpAction(pickedUpItem)
    #expect(pickedUpAction.detail == "Follow up: Gemini")
    #expect(pickedUpAction.symbol == "arrowshape.turn.up.right.circle")
    #expect(pickedUpAction.prompt.contains("Handoff state: Picked up Gemini"))
    #expect(pickedUpAction.prompt.contains("Recovery mode: follow up after the target agent picked up the handoff"))
    #expect(pickedUpAction.prompt.contains("Freshness: target agent has already picked up this handoff"))
    #expect(pickedUpAction.prompt.contains("Staged at:"))
    #expect(pickedUpAction.prompt.contains("Latest evidence at:"))
    #expect(pickedUpAction.prompt.contains("Latest evidence source: latest run after staging"))
    #expect(pickedUpAction.prompt.contains("Latest evidence identity: run: \(geminiRun.id.rawValue)"))
    #expect(pickedUpAction.prompt.contains("Compare the target agent's latest work"))
}

@MainActor
@Test func recordAgentHandoffStagedPersistsAuditEvent() async throws {
    let directory = URL(fileURLWithPath: NSTemporaryDirectory())
        .appendingPathComponent("pikiclaw-handoff-audit-\(UUID().uuidString)", isDirectory: true)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: directory) }

    let workspace = Workspace(
        id: "workspace-record-handoff-audit",
        name: "Record Handoff Audit",
        pathDisplay: directory.path,
        trustState: .trusted
    )
    let workItem = WorkItem(
        id: "workitem-record-handoff-audit",
        workspaceId: workspace.id,
        title: "Record handoff audit",
        sourceType: .manualPrompt
    )
    let seed = NativeAppSeed(
        projects: [],
        workspaces: [workspace],
        workItems: [workItem],
        runs: [],
        artifacts: [],
        capabilities: [],
        knowledgeCards: [],
        automations: [],
        agentProfiles: [],
        providerProfiles: []
    )
    let store = JSONNativeStore(fileURL: directory.appendingPathComponent("state.json"), seed: seed)
    let model = NativeAppModel(store: store)
    await model.reload()

    #expect(await model.recordAgentHandoffStaged(
        workItemId: workItem.id,
        workspaceId: workspace.id,
        latestRunId: "run-record-handoff-audit-latest",
        nextAgentKind: .gemini,
        title: workItem.title
    ))

    let snapshot = try await store.loadSnapshot()
    let event = try #require(snapshot.auditEvents.last)
    #expect(event.kind == .permissionDecision)
    #expect(event.actor == "user")
    #expect(event.summary == missionAgentHandoffAuditSummary(nextAgentKind: .gemini, title: workItem.title))
    #expect(event.runId == "run-record-handoff-audit-latest")
    #expect(event.workItemId == workItem.id)
    #expect(event.workspaceId == workspace.id)
    #expect(model.statusLine == "Handoff to Gemini staged")
}

@Test func chatRunFollowUpActionsExposeInlineStructuredFormMetadata() throws {
    let assistantOutput = """
    ```pikiclaw-ui
    {"form":{"title":"Configure run","prompt":"Collect parameters.","fields":[{"name":"agent","label":"Agent","type":"select","required":true,"value":"codex","options":["codex","claude","gemini"]},{"name":"validation_command","label":"Validation command","type":"text","required":true,"placeholder":"swift test --package-path apps/macos"}]}}
    ```
    """
    let run = AgentRun(
        id: "run-follow-up-inline-form",
        workspaceId: "workspace-follow-up",
        agentProfileId: "agent-follow-up",
        state: .waitingForUser,
        promptSnapshot: "Configure an enterprise agent run",
        transcript: assistantOutput
    )

    let action = try #require(chatRunFollowUpActions(
        run: run,
        workItem: nil,
        assistantText: assistantOutput
    ).first)
    let form = try #require(action.generatedForm)

    #expect(action.id == "form-structured-1")
    #expect(form.title == "Configure run")
    #expect(form.intent == "Collect parameters.")
    #expect(form.fieldCount == 2)
    #expect(form.requiredFieldCount == 2)
    #expect(form.fields.map(\.key) == ["agent", "validation_command"])
    #expect(form.fields[0].displayLabel == "Agent")
    #expect(form.fields[0].type == "select")
    #expect(form.fields[0].initialValue == "codex")
    #expect(form.fields[0].options == ["codex", "claude", "gemini"])
    #expect(form.fields[1].placeholder == "swift test --package-path apps/macos")

    let initialReadiness = runFollowUpGeneratedFormReadiness(form, values: [:])
    #expect(initialReadiness.requiredCount == 2)
    #expect(initialReadiness.completedRequiredCount == 1)
    #expect(initialReadiness.canSubmit == false)
    #expect(initialReadiness.requiredBadgeText == "1/2 ready")
    #expect(initialReadiness.missingRequiredLabels == ["Validation command"])
    #expect(initialReadiness.missingSummary == "Missing: Validation command")

    let emptyValueReadiness = runFollowUpGeneratedFormReadiness(form, values: [
        "agent": "gemini",
        "validation_command": "   "
    ])
    #expect(emptyValueReadiness.canSubmit == false)
    #expect(emptyValueReadiness.missingRequiredLabels == ["Validation command"])

    let completedReadiness = runFollowUpGeneratedFormReadiness(form, values: [
        "validation_command": "swift test --package-path apps/macos --filter ChatMessageHistoryTests"
    ])
    #expect(completedReadiness.requiredCount == 2)
    #expect(completedReadiness.completedRequiredCount == 2)
    #expect(completedReadiness.canSubmit)
    #expect(completedReadiness.requiredBadgeText == "2/2 ready")
    #expect(completedReadiness.missingSummary == nil)

    let submitted = runFollowUpActionSubmittingGeneratedForm(action, values: [
        "agent": "claude",
        "validation_command": "swift test --package-path apps/macos --filter ChatMessageHistoryTests"
    ])

    #expect(submitted.generatedForm == form)
    #expect(submitted.prompt.contains("Inline form values submitted from generated UI"))
    #expect(submitted.prompt.contains("- Agent: claude"))
    #expect(submitted.prompt.contains("- agent = claude"))
    #expect(submitted.prompt.contains("- validation_command = swift test --package-path apps/macos --filter ChatMessageHistoryTests"))
    #expect(submitted.prompt.contains("Output contract:"))
}

@Test func missionAttentionSummaryCountsGeneratedUIActionsAsAttention() {
    let state = missionAttentionSummaryState(
        activeRuns: 0,
        waitingRuns: 0,
        failedRuns: 0,
        readyEvidenceCount: 2,
        outputReviewAttentionCount: 0,
        generatedUIAttentionCount: 3
    )

    #expect(state.title == "Generated UI actions need input")
    #expect(state.detail == "3 clickable generated UI action(s) are ready across active outputs.")
    #expect(state.status == "ATTENTION")
    #expect(state.symbol == "rectangle.stack.fill")
    #expect(state.tone == .warning)
}

@Test func missionAttentionSummaryPrioritizesWaitingRunsOverGeneratedUIActions() {
    let state = missionAttentionSummaryState(
        activeRuns: 1,
        waitingRuns: 1,
        failedRuns: 0,
        readyEvidenceCount: 0,
        outputReviewAttentionCount: 2,
        generatedUIAttentionCount: 4
    )

    #expect(state.title == "Agent is waiting for input")
    #expect(state.status == "ATTENTION")
    #expect(state.symbol == "exclamationmark.triangle.fill")
    #expect(state.tone == .warning)
}

@Test func runFollowUpGeneratedUIRailGroupsDenseActionsByRole() {
    let actions = [
        RunFollowUpAction(id: "choice-1", title: "Implement", symbol: "hammer", permissionMode: .askBeforeEdit, prompt: "Implement selected path."),
        RunFollowUpAction(id: "form-structured-1", title: "Configure", symbol: "list.bullet.rectangle", permissionMode: .askBeforeEdit, prompt: "Collect fields."),
        RunFollowUpAction(id: "confirm-approve-1", title: "Post", symbol: "paperplane", permissionMode: .askBeforeEdit, prompt: "Approve post."),
        RunFollowUpAction(id: "confirm-decline-1", title: "Not now", symbol: "xmark.circle", permissionMode: .readOnly, prompt: "Decline post."),
        RunFollowUpAction(id: "tool-card-1", title: "Tool", symbol: "terminal", permissionMode: .readOnly, prompt: "Inspect tool."),
        RunFollowUpAction(id: "knowledge-compare-1", title: "Compare", symbol: "arrow.left.arrow.right", permissionMode: .readOnly, prompt: "Compare knowledge.")
    ]

    let groups = runFollowUpGeneratedUIRailActionGroups(actions)

    #expect(groups.map(\.id) == ["choice", "form", "confirm", "evidence", "knowledge"])
    #expect(groups.map(\.title) == ["Choice", "Form", "Confirm", "Evidence", "Knowledge"])
    #expect(groups[0].actions.map(\.id) == ["choice-1"])
    #expect(groups[1].actions.map(\.id) == ["form-structured-1"])
    #expect(groups[2].actions.map(\.id) == ["confirm-approve-1", "confirm-decline-1"])
    #expect(groups[3].actions.map(\.id) == ["tool-card-1"])
    #expect(groups[4].actions.map(\.id) == ["knowledge-compare-1"])
    #expect(runFollowUpGeneratedUIRailShouldGroup(actions))
}

@Test func runFollowUpGeneratedUIRailKeepsTwoSameRoleActionsCompact() {
    let actions = [
        RunFollowUpAction(id: "confirm-approve-1", title: "Save", symbol: "archivebox", permissionMode: .askBeforeEdit, prompt: "Approve save."),
        RunFollowUpAction(id: "confirm-decline-1", title: "Not now", symbol: "xmark.circle", permissionMode: .readOnly, prompt: "Decline save.")
    ]

    let groups = runFollowUpGeneratedUIRailActionGroups(actions)

    #expect(groups.map(\.id) == ["confirm"])
    #expect(groups.first?.actions.map(\.id) == ["confirm-approve-1", "confirm-decline-1"])
    #expect(runFollowUpGeneratedUIRailShouldGroup(actions) == false)
}

@Test func runFollowUpGeneratedUIShortcutMarksDefaultAndCancelActions() {
    let choiceActions = [
        RunFollowUpAction(id: "choice-1", title: "Implement", symbol: "hammer", permissionMode: .askBeforeEdit, prompt: "Implement selected path."),
        RunFollowUpAction(id: "choice-2", title: "Validate", symbol: "testtube.2", permissionMode: .askBeforeEdit, prompt: "Validate selected path.")
    ]
    let confirmActions = [
        RunFollowUpAction(id: "confirm-approve-1", title: "Post", symbol: "paperplane", permissionMode: .askBeforeEdit, prompt: "Approve post."),
        RunFollowUpAction(id: "confirm-decline-1", title: "Not now", symbol: "xmark.circle", permissionMode: .readOnly, prompt: "Decline post.")
    ]
    let formAction = RunFollowUpAction(id: "form-structured-1", title: "Configure", symbol: "list.bullet.rectangle", permissionMode: .askBeforeEdit, prompt: "Collect fields.")
    let requiredForm = RunFollowUpGeneratedForm(
        title: "Configure",
        intent: "Collect fields.",
        fields: [
            RunFollowUpGeneratedFormField(
                id: "field-command",
                name: "command",
                label: "Command",
                type: "text",
                isRequired: true,
                placeholder: "swift test --package-path apps/macos",
                value: "",
                defaultValue: "",
                options: []
            )
        ]
    )
    let gatedFormAction = RunFollowUpAction(
        id: "form-structured-gated",
        title: "Configure",
        symbol: "list.bullet.rectangle",
        permissionMode: .askBeforeEdit,
        generatedForm: requiredForm,
        prompt: "Collect fields."
    )
    let evidenceAction = RunFollowUpAction(id: "tool-card-1", title: "Tool", symbol: "terminal", permissionMode: .readOnly, prompt: "Inspect tool.")

    #expect(runFollowUpGeneratedUIShortcut(for: choiceActions[0], in: choiceActions)?.kind == .defaultAction)
    #expect(runFollowUpGeneratedUIShortcut(for: choiceActions[0], in: choiceActions)?.label == "Return")
    #expect(runFollowUpGeneratedUIShortcut(for: choiceActions[1], in: choiceActions) == nil)
    #expect(runFollowUpGeneratedUIShortcut(for: formAction, in: [formAction])?.kind == .defaultAction)
    #expect(runFollowUpGeneratedUIShortcut(for: formAction, in: [formAction])?.label == "Return")
    #expect(runFollowUpGeneratedUIShortcut(for: formAction, in: choiceActions + [formAction]) == nil)
    #expect(runFollowUpGeneratedUIShortcut(for: gatedFormAction, in: [gatedFormAction], formValues: [:]) == nil)
    #expect(runFollowUpGeneratedUIShortcut(for: gatedFormAction, in: [gatedFormAction], formValues: ["command": "   "]) == nil)
    #expect(runFollowUpGeneratedUIShortcut(for: gatedFormAction, in: [gatedFormAction], formValues: ["command": "swift test --package-path apps/macos"])?.kind == .defaultAction)
    #expect(runFollowUpGeneratedUIShortcut(for: gatedFormAction, in: [gatedFormAction], formValues: ["command": "swift test --package-path apps/macos"])?.label == "Return")
    #expect(runFollowUpGeneratedUIShortcut(for: confirmActions[0], in: confirmActions)?.kind == .defaultAction)
    #expect(runFollowUpGeneratedUIShortcut(for: confirmActions[0], in: confirmActions)?.label == "Return")
    #expect(runFollowUpGeneratedUIShortcut(for: confirmActions[1], in: confirmActions)?.kind == .cancelAction)
    #expect(runFollowUpGeneratedUIShortcut(for: confirmActions[1], in: confirmActions)?.label == "Esc")
    #expect(runFollowUpGeneratedUIShortcut(for: evidenceAction, in: [evidenceAction]) == nil)
}

@Test func runFollowUpGeneratedUIFocusStyleHighlightsReturnTargetOnly() {
    let defaultShortcut = RunFollowUpGeneratedUIShortcut(kind: .defaultAction, label: "Return")
    let cancelShortcut = RunFollowUpGeneratedUIShortcut(kind: .cancelAction, label: "Esc")

    let defaultStyle = runFollowUpGeneratedUIFocusStyle(for: defaultShortcut)
    let cancelStyle = runFollowUpGeneratedUIFocusStyle(for: cancelShortcut)
    let plainStyle = runFollowUpGeneratedUIFocusStyle(for: nil)

    #expect(defaultStyle.isFocused)
    #expect(cancelStyle.isFocused == false)
    #expect(plainStyle.isFocused == false)
    #expect(defaultStyle.chipBackgroundOpacity > cancelStyle.chipBackgroundOpacity)
    #expect(defaultStyle.chipBorderOpacity > cancelStyle.chipBorderOpacity)
    #expect(defaultStyle.chipBorderWidth > cancelStyle.chipBorderWidth)
    #expect(defaultStyle.keyBackgroundOpacity > cancelStyle.keyBackgroundOpacity)
    #expect(defaultStyle.keyTextOpacity > cancelStyle.keyTextOpacity)
    #expect(defaultStyle.shadowOpacity > plainStyle.shadowOpacity)
    #expect(cancelStyle.shadowOpacity == plainStyle.shadowOpacity)
}

@Test func generatedUIActionFocusRequiresRunAndActionMatch() {
    let focus = GeneratedUIActionFocus(runId: "run-generated-ui-focus", actionId: "choice-1")

    #expect(generatedUIActionFocusMatches(focus, runId: "run-generated-ui-focus", actionId: "choice-1"))
    #expect(generatedUIActionFocusMatches(focus, runId: "run-other", actionId: "choice-1") == false)
    #expect(generatedUIActionFocusMatches(focus, runId: "run-generated-ui-focus", actionId: "choice-2") == false)
    #expect(generatedUIActionFocusMatches(nil, runId: "run-generated-ui-focus", actionId: "choice-1") == false)
    #expect(generatedUIActionFocusMatches(focus, runId: nil, actionId: "choice-1") == false)
    #expect(generatedUIActionFocusForRun(focus, runId: "run-generated-ui-focus") == focus)
    #expect(generatedUIActionFocusForRun(focus, runId: "run-other") == nil)
    #expect(generatedUIActionFocusForRun(nil, runId: "run-generated-ui-focus") == nil)
    #expect(generatedUIActionFocusAnchorID(focus) == "generated-ui-action-run-generated-ui-focus-choice-1")
}

@Test func focusedGeneratedUIFollowUpActionResolvesOnlyCurrentGeneratedAction() {
    let assistantOutput = """
    The next step is ready.
    ```pikiclaw-ui
    {
      "choices": [
        {
          "title": "Inspect",
          "prompt": "Inspect the generated UI focus path.",
          "permissionMode": "readOnly"
        },
        {
          "title": "Stage",
          "prompt": "Stage the focused generated UI action.",
          "permissionMode": "askBeforeEdit"
        }
      ]
    }
    ```
    """
    let run = AgentRun(
        id: "run-generated-ui-focus-action",
        workspaceId: "workspace-generated-ui-focus-action",
        agentProfileId: "agent-generated-ui-focus-action",
        state: .completed,
        promptSnapshot: "Open focused generated UI action",
        transcript: assistantOutput
    )
    let workItem = WorkItem(
        id: "workitem-generated-ui-focus-action",
        workspaceId: run.workspaceId,
        title: "Focus generated UI",
        sourceType: .manualPrompt,
        state: .active
    )

    let focused = focusedGeneratedUIFollowUpAction(
        focus: GeneratedUIActionFocus(runId: run.id, actionId: "choice-structured-2"),
        run: run,
        workItem: workItem,
        assistantText: assistantOutput
    )

    #expect(focused?.title == "Stage")
    #expect(focused?.isGeneratedUI == true)
    #expect(focused?.permissionMode == .askBeforeEdit)
    #expect(focused?.prompt.contains("Stage the focused generated UI action.") == true)
    #expect(focusedGeneratedUIFollowUpAction(
        focus: GeneratedUIActionFocus(runId: "run-other", actionId: "choice-structured-2"),
        run: run,
        workItem: workItem,
        assistantText: assistantOutput
    ) == nil)
    #expect(focusedGeneratedUIFollowUpAction(
        focus: GeneratedUIActionFocus(runId: run.id, actionId: "mr-review"),
        run: run,
        workItem: workItem,
        assistantText: "Should I continue?"
    ) == nil)
    #expect(focusedGeneratedUIFollowUpAction(
        focus: nil,
        run: run,
        workItem: workItem,
        assistantText: assistantOutput
    ) == nil)
}

@Test func runFollowUpGeneratedUIFocusStyleHighlightsMissionTarget() {
    let defaultShortcut = RunFollowUpGeneratedUIShortcut(kind: .defaultAction, label: "Return")

    let defaultStyle = runFollowUpGeneratedUIFocusStyle(for: defaultShortcut)
    let missionStyle = runFollowUpGeneratedUIFocusStyle(for: nil, isMissionFocused: true)
    let focusedDefaultStyle = runFollowUpGeneratedUIFocusStyle(for: defaultShortcut, isMissionFocused: true)

    #expect(missionStyle.isFocused)
    #expect(focusedDefaultStyle.isFocused)
    #expect(missionStyle.chipBackgroundOpacity > defaultStyle.chipBackgroundOpacity)
    #expect(missionStyle.chipBorderOpacity > defaultStyle.chipBorderOpacity)
    #expect(missionStyle.chipBorderWidth > defaultStyle.chipBorderWidth)
    #expect(missionStyle.shadowOpacity > defaultStyle.shadowOpacity)
    #expect(focusedDefaultStyle == missionStyle)
}

@Test func chatRunFollowUpActionsPreserveDecisionSignalsForBugReviewAndJira() {
    let assistantOutput = """
    Decision: not ready to merge until retry validation covers the nil workspace case.
    Merge readiness:
    - Blocked on RootView.swift:42 validation gap.
    - Approval can proceed after focused validation is captured.
    Recommendation: fix the nil workspace guard before posting Jira done.
    error: nil workspace crash in native chat follow-up
    Jira: IVAS-9020
    """
    let run = AgentRun(
        id: "run-follow-up-decision-signals",
        workspaceId: "workspace-follow-up",
        agentProfileId: "agent-follow-up",
        state: .failed,
        promptSnapshot: "Review native follow-up crash",
        transcript: assistantOutput
    )
    let workItem = WorkItem(
        id: "workitem-follow-up-decision-signals",
        workspaceId: "workspace-follow-up",
        title: "Repair native follow-up crash",
        sourceType: .jira,
        state: .review,
        jira: JiraWorkItemFields(key: "IVAS-9020", status: "In Review")
    )

    let actions = chatRunFollowUpActions(
        run: run,
        workItem: workItem,
        assistantText: assistantOutput
    )

    #expect(actions.map(\.id) == ["bug-analysis", "mr-review", "validation", "jira-update"])
    #expect(actions[0].prompt.contains("Decision signals:"))
    #expect(actions[0].prompt.contains("Decision: not ready to merge until retry validation covers the nil workspace case."))
    #expect(actions[0].prompt.contains("Readiness: Blocked on RootView.swift:42 validation gap. | Approval can proceed after focused validation is captured."))
    #expect(actions[0].prompt.contains("Recommendation: fix the nil workspace guard before posting Jira done."))
    #expect(actions[0].prompt.contains("Preserve Decision signals as the current triage status"))
    #expect(actions[1].prompt.contains("Decision signals:"))
    #expect(actions[1].prompt.contains("Preserve Decision signals as merge readiness"))
    #expect(actions[1].prompt.contains("preserve decision signals, preserve artifact refs"))
    #expect(actions[1].prompt.contains("Readiness: Blocked on RootView.swift:42 validation gap. | Approval can proceed after focused validation is captured."))
    #expect(actions[3].prompt.contains("decision signals"))
    #expect(actions[3].prompt.contains("Fold Decision signals into Status or Next action"))
    #expect(actions[3].prompt.contains("Recommendation: fix the nil workspace guard before posting Jira done."))
    #expect(actions[3].prompt.contains("Ticket refs: IVAS-9020"))
    #expect(actions[0].prompt.contains("Reproduction notes:") == false)
}

@Test func chatRunFollowUpActionsRouteBlockingReviewDecisionToBugAnalysis() {
    let assistantOutput = """
    MR review comment:
    Request changes: add a nil workspace guard before merge.
    Decision: not ready to merge until focused validation is captured.
    Go/No-go: no-go until `swift test --filter ChatMessageHistoryTests` covers it.
    Jira: IVAS-9021
    """
    let run = AgentRun(
        id: "run-follow-up-blocking-review-decision",
        workspaceId: "workspace-follow-up",
        agentProfileId: "agent-follow-up",
        state: .completed,
        promptSnapshot: "Review native follow-up MR",
        transcript: assistantOutput
    )
    let workItem = WorkItem(
        id: "workitem-follow-up-blocking-review-decision",
        workspaceId: "workspace-follow-up",
        title: "Fix native follow-up review blocker",
        sourceType: .jira,
        state: .review,
        jira: JiraWorkItemFields(key: "IVAS-9021", status: "In Review")
    )

    let actions = chatRunFollowUpActions(
        run: run,
        workItem: workItem,
        assistantText: assistantOutput
    )

    #expect(actions.map(\.id) == ["bug-analysis", "mr-review", "validation", "jira-update"])
    #expect(actions[0].prompt.contains("blocking review decision"))
    #expect(actions[0].prompt.contains("Decision signals:"))
    #expect(actions[0].prompt.contains("Approval: add a nil workspace guard before merge."))
    #expect(actions[0].prompt.contains("Decision: not ready to merge until focused validation is captured."))
    #expect(actions[0].prompt.contains("Decision: no-go until `swift test --filter ChatMessageHistoryTests` covers it."))
    #expect(actions[0].prompt.contains("Failure signals:") == false)
    #expect(actions[1].prompt.contains("Decision signals:"))
    #expect(actions[3].prompt.contains("Ticket refs: IVAS-9021"))
}

@Test func chatRunFollowUpActionsPreserveValidationEvidenceForReviewAndJira() {
    let run = AgentRun(
        id: "run-follow-up-validation-evidence",
        workspaceId: "workspace-follow-up",
        agentProfileId: "agent-follow-up",
        state: .completed,
        promptSnapshot: "Implement native Jira follow-up polish",
        transcript: """
        Implemented native follow-up polish.
        Status: implementation complete; Jira write-back still pending
        Result: ready for MR review after focused tests
        Jira: https://jira.example.com/browse/IVAS-9018.
        MR: [Native follow-up MR](https://gitlab.example.com/pikiclaw/pikiclaw/-/merge_requests/901/diffs)
        Artifact: pikiclaw://artifacts/artifact-follow-up-validation
        Run evidence: `pikiclaw://runs/run-follow-up-validation-evidence/evidence`
        Evidence note: [Obsidian note](obsidian://open?vault=Pikiclaw&file=repo%2Fpikiclaw%2Fsync.md)
        Obsidian export: /Users/michael.yang/Documents/Obsidian Vault/repo/pikiclaw/native-follow-up.md
        Jira update:
        Status: implementation complete; Jira write-back still pending
        Evidence: RootView now preserves status, validation, file refs, and handoff drafts.
        Validation: swift test --filter ChatMessageHistoryTests passed
        Blockers: waiting for Jira write permission
        Next action: paste the validation summary into IVAS-9018
        MR review comment:
        No blocking findings in the follow-up context change; residual risk is manual app smoke.
        Changed files:
        - [RootView.swift](/Users/michael.yang/Codes/Personal/pikiclaw/apps/macos/Sources/PikiclawMac/RootView.swift:6623)
        - `apps/macos/Tests/PikiclawMacTests/ChatMessageHistoryTests.swift:329`
        Validation:
        - `swift test --filter ChatMessageHistoryTests` passed
        - git diff --check passed
        Blockers: waiting for Jira write permission
        Next action: paste the validation summary into IVAS-9018
        Open question: whether the MR needs a voice regression smoke
        Risk: full app smoke was not run
        Next command: `swift build --product PikiclawMac`
        """
    )
    let workItem = WorkItem(
        id: "workitem-follow-up-validation-evidence",
        workspaceId: "workspace-follow-up",
        title: "Preserve validation in Jira update",
        sourceType: .jira,
        state: .review,
        jira: JiraWorkItemFields(key: "IVAS-9018", status: "In Review")
    )

    let actions = chatRunFollowUpActions(
        run: run,
        workItem: workItem,
        assistantText: run.transcript
    )

    #expect(actions.map(\.id) == ["jira-update", "validation", "mr-review"])
    let jiraAction = actions[0]
    let validationAction = actions[1]
    let reviewAction = actions[2]
    #expect(reviewAction.prompt.contains("Validation evidence:"))
    #expect(reviewAction.prompt.contains("swift test --filter ChatMessageHistoryTests (passed)"))
    #expect(reviewAction.prompt.contains("git diff --check (passed)"))
    #expect(reviewAction.prompt.contains("File refs:"))
    #expect(reviewAction.prompt.contains("/Users/michael.yang/Codes/Personal/pikiclaw/apps/macos/Sources/PikiclawMac/RootView.swift:6623"))
    #expect(reviewAction.prompt.contains("apps/macos/Tests/PikiclawMacTests/ChatMessageHistoryTests.swift:329"))
    #expect(reviewAction.prompt.contains("Status summary:"))
    #expect(reviewAction.prompt.contains("Status: implementation complete; Jira write-back still pending"))
    #expect(reviewAction.prompt.contains("Result: ready for MR review after focused tests"))
    #expect(reviewAction.prompt.contains("Progress: Implemented native follow-up polish."))
    #expect(reviewAction.prompt.contains("Handoff drafts:"))
    #expect(reviewAction.prompt.contains("Jira draft: Status: implementation complete; Jira write-back still pending | Evidence: RootView now preserves status, validation, file refs, and handoff drafts."))
    #expect(reviewAction.prompt.contains("MR draft: No blocking findings in the follow-up context change; residual risk is manual app smoke."))
    #expect(reviewAction.prompt.contains("External links:"))
    #expect(reviewAction.prompt.contains("Jira: https://jira.example.com/browse/IVAS-9018"))
    #expect(reviewAction.prompt.contains("MR: https://gitlab.example.com/pikiclaw/pikiclaw/-/merge_requests/901"))
    #expect(reviewAction.prompt.contains("preserve artifact refs as evidence pointers"))
    #expect(reviewAction.prompt.contains("Treat Artifact refs as evidence pointers and Next commands as follow-up candidates"))
    #expect(reviewAction.prompt.contains("Artifact refs:"))
    #expect(reviewAction.prompt.contains("Pikiclaw artifact: pikiclaw://artifacts/artifact-follow-up-validation"))
    #expect(reviewAction.prompt.contains("Pikiclaw run: pikiclaw://runs/run-follow-up-validation-evidence/evidence"))
    #expect(reviewAction.prompt.contains("Obsidian: obsidian://open?vault=Pikiclaw&file=repo%2Fpikiclaw%2Fsync.md"))
    #expect(reviewAction.prompt.contains("Obsidian: /Users/michael.yang/Documents/Obsidian Vault/repo/pikiclaw/native-follow-up.md"))
    #expect(reviewAction.prompt.contains("Ticket refs: IVAS-9018"))
    #expect(reviewAction.prompt.contains("Actionable notes:"))
    #expect(reviewAction.prompt.contains("Blocker: waiting for Jira write permission"))
    #expect(reviewAction.prompt.contains("Next action: paste the validation summary into IVAS-9018"))
    #expect(reviewAction.prompt.contains("Open question: whether the MR needs a voice regression smoke"))
    #expect(reviewAction.prompt.contains("Risk: full app smoke was not run"))
    #expect(reviewAction.prompt.contains("Next commands:"))
    #expect(reviewAction.prompt.contains("swift build --product PikiclawMac"))
    #expect(reviewAction.prompt.contains("swift build --product PikiclawMac (passed)") == false)
    #expect(validationAction.prompt.contains("Prefer a relevant Next command"))
    #expect(validationAction.prompt.contains("Next commands:"))
    #expect(validationAction.prompt.contains("swift build --product PikiclawMac"))
    #expect(jiraAction.prompt.contains("Jira-ready update"))
    #expect(jiraAction.prompt.contains("Preserve artifact refs in Evidence"))
    #expect(jiraAction.prompt.contains("Fold Artifact refs into Evidence and Next commands into Next action"))
    #expect(jiraAction.prompt.contains("swift test --filter ChatMessageHistoryTests (passed)"))
    #expect(jiraAction.prompt.contains("git diff --check (passed)"))
    #expect(jiraAction.prompt.contains("swift build --product PikiclawMac"))
    #expect(jiraAction.prompt.contains("swift build --product PikiclawMac (passed)") == false)
    #expect(jiraAction.prompt.contains("apps/macos/Tests/PikiclawMacTests/ChatMessageHistoryTests.swift:329"))
    #expect(jiraAction.prompt.contains("Status: implementation complete; Jira write-back still pending"))
    #expect(jiraAction.prompt.contains("Result: ready for MR review after focused tests"))
    #expect(jiraAction.prompt.contains("Jira draft: Status: implementation complete; Jira write-back still pending | Evidence: RootView now preserves status, validation, file refs, and handoff drafts."))
    #expect(jiraAction.prompt.contains("MR draft: No blocking findings in the follow-up context change; residual risk is manual app smoke."))
    #expect(jiraAction.prompt.contains("Jira: https://jira.example.com/browse/IVAS-9018"))
    #expect(jiraAction.prompt.contains("MR: https://gitlab.example.com/pikiclaw/pikiclaw/-/merge_requests/901"))
    #expect(jiraAction.prompt.contains("Pikiclaw artifact: pikiclaw://artifacts/artifact-follow-up-validation"))
    #expect(jiraAction.prompt.contains("Obsidian: obsidian://open?vault=Pikiclaw&file=repo%2Fpikiclaw%2Fsync.md"))
    #expect(jiraAction.prompt.contains("Ticket refs: IVAS-9018"))
    #expect(jiraAction.prompt.contains("Blocker: waiting for Jira write permission"))
    #expect(jiraAction.prompt.contains("Next action: paste the validation summary into IVAS-9018"))
}

@Test func chatRunFollowUpActionsGenerateHandoffDraftActionForMRReviewDraft() {
    let output = """
    MR review comment:
    No blocking findings; residual risk is manual app smoke.
    Validation: swift test --filter ChatMessageHistoryTests passed
    """
    let run = AgentRun(
        id: "run-follow-up-mr-handoff-draft",
        workspaceId: "workspace-follow-up",
        agentProfileId: "agent-follow-up",
        state: .completed,
        promptSnapshot: "Prepare MR review draft",
        transcript: output
    )

    let actions = chatRunFollowUpActions(
        run: run,
        workItem: nil,
        assistantText: output
    )

    #expect(actions.map(\.id) == ["handoff-draft-1", "mr-review", "validation", "capture-evidence"])
    #expect(actions[0].title == "Draft")
    #expect(actions[0].detail == "Generated draft")
    #expect(actions[0].symbol == "text.bubble")
    #expect(actions[0].permissionMode == .readOnly)
    #expect(actions[0].isGeneratedUI)
    #expect(actions[0].generatedUIRole == .handoffDraft)
    #expect(actions[0].prompt.contains("Selected handoff draft:"))
    #expect(actions[0].prompt.contains("MR draft: No blocking findings; residual risk is manual app smoke."))
    #expect(actions[0].prompt.contains("final copy-ready text plus the posting boundary"))
    #expect(actions[0].prompt.contains("Do not post to Jira, GitLab, GitHub, MR/PR, commit, push, or write external systems"))
}

@Test func chatRunFollowUpActionsGenerateHandoffDraftActionForChineseMRReviewDraft() {
    let output = """
    MR 评审意见：
    没有阻塞问题；剩余风险是手动 app smoke。
    Validation: swift test --filter ChatMessageHistoryTests passed
    """
    let run = AgentRun(
        id: "run-follow-up-chinese-mr-handoff-draft",
        workspaceId: "workspace-follow-up",
        agentProfileId: "agent-follow-up",
        state: .completed,
        promptSnapshot: "准备中文 MR 评审意见",
        transcript: output
    )

    let actions = chatRunFollowUpActions(
        run: run,
        workItem: nil,
        assistantText: output
    )

    #expect(actions.map(\.id) == ["handoff-draft-1", "mr-review", "validation", "capture-evidence"])
    #expect(actions[0].title == "Draft")
    #expect(actions[0].detail == "Generated draft")
    #expect(actions[0].symbol == "text.bubble")
    #expect(actions[0].generatedUIRole == .handoffDraft)
    #expect(actions[0].prompt.contains("Selected handoff draft:"))
    #expect(actions[0].prompt.contains("MR draft: 没有阻塞问题；剩余风险是手动 app smoke。"))
    #expect(actions[0].prompt.contains("- Original prompt: 准备中文 MR 评审意见"))
    #expect(actions[0].prompt.contains("Do not post to Jira, GitLab, GitHub, MR/PR, commit, push, or write external systems"))
}

@Test func chatRunFollowUpActionsGenerateHandoffDraftActionForJiraDraftWithoutTicket() {
    let output = """
    Jira update:
    Status: validation passed
    Evidence: focused follow-up tests passed
    Validation: swift test --filter ChatMessageHistoryTests passed
    Next action: paste into IVAS-9057 after approval
    """
    let run = AgentRun(
        id: "run-follow-up-jira-handoff-draft",
        workspaceId: "workspace-follow-up",
        agentProfileId: "agent-follow-up",
        state: .completed,
        promptSnapshot: "Prepare IVAS-9057 Jira update",
        transcript: output
    )

    let actions = chatRunFollowUpActions(
        run: run,
        workItem: nil,
        assistantText: output
    )

    #expect(actions.map(\.id) == ["handoff-draft-1", "mr-review", "validation", "jira-update"])
    #expect(actions[0].title == "Jira")
    #expect(actions[0].symbol == "checklist")
    #expect(actions[0].generatedUIRole == .handoffDraft)
    #expect(actions[0].prompt.contains("Jira draft: Status: validation passed | Evidence: focused follow-up tests passed"))
    #expect(actions[0].prompt.contains("ticket keys"))
    #expect(actions[0].prompt.contains("posting boundary"))
    #expect(actions[3].prompt.contains("Ticket refs: IVAS-9057"))
    #expect(actions[3].prompt.contains("what needs to be synced before posting"))
}

@Test func chatRunFollowUpActionsPreserveChineseMRDraftWhenChineseJiraUpdateMustSurface() {
    let output = """
    Jira 更新：
    Status: implementation complete
    Evidence: focused follow-up tests passed
    MR 评审意见：
    没有阻塞问题；剩余风险是手动 smoke。
    Jira: IVAS-9059
    Next action: paste into IVAS-9059 after approval
    """
    let run = AgentRun(
        id: "run-follow-up-chinese-dual-handoff-drafts",
        workspaceId: "workspace-follow-up",
        agentProfileId: "agent-follow-up",
        state: .completed,
        promptSnapshot: "准备 IVAS-9059 中文 Jira 和 MR 交接",
        transcript: output
    )

    let actions = chatRunFollowUpActions(
        run: run,
        workItem: nil,
        assistantText: output
    )

    #expect(actions.map(\.id) == ["handoff-draft-2", "mr-review", "validation", "jira-update"])
    #expect(actions[0].title == "Draft")
    #expect(actions[0].generatedUIRole == .handoffDraft)
    #expect(actions[0].prompt.contains("Selected handoff draft:"))
    #expect(actions[0].prompt.contains("MR draft: 没有阻塞问题；剩余风险是手动 smoke。"))
    #expect(actions[3].prompt.contains("Jira draft: Status: implementation complete | Evidence: focused follow-up tests passed"))
    #expect(actions[3].prompt.contains("MR draft: 没有阻塞问题；剩余风险是手动 smoke。"))
    #expect(actions[3].prompt.contains("Ticket refs: IVAS-9059"))
    #expect(actions.contains(where: { $0.id == "handoff-draft-1" }) == false)
}

@Test func chatRunFollowUpActionsPreserveSecondHandoffDraftWhenJiraUpdateMustSurface() {
    let output = """
    Jira update:
    Status: implementation complete
    Evidence: focused follow-up tests passed
    Validation: swift test --filter ChatMessageHistoryTests passed
    Next action: paste into IVAS-9058 after approval
    MR review comment:
    No blocking findings; residual risk is manual smoke.
    """
    let run = AgentRun(
        id: "run-follow-up-dual-handoff-drafts",
        workspaceId: "workspace-follow-up",
        agentProfileId: "agent-follow-up",
        state: .completed,
        promptSnapshot: "Prepare IVAS-9058 Jira and MR handoff",
        transcript: output
    )

    let actions = chatRunFollowUpActions(
        run: run,
        workItem: nil,
        assistantText: output
    )

    #expect(actions.map(\.id) == ["handoff-draft-2", "mr-review", "validation", "jira-update"])
    #expect(actions[0].title == "Draft")
    #expect(actions[0].generatedUIRole == .handoffDraft)
    #expect(actions[0].prompt.contains("MR draft: No blocking findings; residual risk is manual smoke."))
    #expect(actions[0].prompt.contains("Selected handoff draft:"))
    #expect(actions[3].title == "Jira")
    #expect(actions[3].prompt.contains("Ticket refs: IVAS-9058"))
    #expect(actions[3].prompt.contains("Jira draft: Status: implementation complete | Evidence: focused follow-up tests passed"))
    #expect(actions[3].prompt.contains("MR draft: No blocking findings; residual risk is manual smoke."))
    #expect(actions.contains(where: { $0.id == "handoff-draft-1" }) == false)
}

@Test func chatRunFollowUpActionsDoNotAddHandoffDraftWhenConfirmationIsReady() {
    let output = """
    MR review feedback:
    Ready to paste into the merge request review.
    Should I continue by adding the MR review feedback?
    """
    let run = AgentRun(
        id: "run-follow-up-handoff-draft-confirmation",
        workspaceId: "workspace-follow-up",
        agentProfileId: "agent-follow-up",
        state: .completed,
        promptSnapshot: "Prepare MR review feedback",
        transcript: output
    )

    let actions = chatRunFollowUpActions(
        run: run,
        workItem: nil,
        assistantText: output
    )

    #expect(actions.map(\.id) == ["confirm-approve-1", "confirm-decline-1", "mr-review", "validation"])
    #expect(actions.contains(where: { $0.id == "handoff-draft-1" }) == false)
    #expect(actions[0].title == "Post")
    #expect(actions[0].generatedUIRole == .confirmationApprove)
}

@Test func chatRunFollowUpActionsIncludeLogAnalysisForTraceSignals() {
    let output = """
    error: no audio conversationId=p-v-voice-123 TraceId=0123456789abcdef0123456789abcdef
    Lookup command: /logtrace --env lab region=west accountId=7542904004 conversationId=p-v-voice-123 last=24h
    """
    let run = AgentRun(
        id: "run-follow-up-log-analysis",
        workspaceId: "workspace-follow-up",
        agentProfileId: "agent-follow-up",
        state: .failed,
        promptSnapshot: "Investigate no-audio runtime failure",
        transcript: output
    )
    let workItem = WorkItem(
        id: "workitem-follow-up-log-analysis",
        workspaceId: "workspace-follow-up",
        title: "Trace native no-audio failure",
        sourceType: .jira,
        state: .active,
        jira: JiraWorkItemFields(key: "IVAS-9006", status: "In Progress")
    )

    let actions = chatRunFollowUpActions(
        run: run,
        workItem: workItem,
        assistantText: output
    )

    #expect(actions.map(\.id) == ["bug-analysis", "log-analysis", "skill-hardening", "jira-update"])
    #expect(actions[1].title == "Logs")
    #expect(actions[1].detail == "Read-only trace")
    #expect(actions[1].permissionMode == .readOnly)
    #expect(actions[1].prompt.contains("Keep conversationId, sessionId, traceId, requestId, and taskId distinct"))
    #expect(actions[1].prompt.contains("`/logtrace`"))
    #expect(actions[1].prompt.contains("`/clickhouse`"))
    #expect(actions[1].prompt.contains("conversationId=p-v-voice-123"))
    #expect(actions[1].prompt.contains("IDs checked, timeline/phases, error family, ambiguity, and next lookup"))
    #expect(actions[1].prompt.contains("Include the exact skill command to run next"))
    #expect(actions[1].prompt.contains("Suggested log commands:"))
    #expect(actions[1].prompt.contains("/logtrace env=lab conversationId=p-v-voice-123 last=24h"))
    #expect(actions[1].prompt.contains("/clickhouse show error spans for TraceId=0123456789abcdef0123456789abcdef ConversationId=p-v-voice-123 limit=20"))
    #expect(actions[1].prompt.contains("Environment refs:"))
    #expect(actions[1].prompt.contains("env=lab"))
    #expect(actions[1].prompt.contains("region=west"))
    #expect(actions[1].prompt.contains("accountId=7542904004"))
    #expect(actions[2].prompt.contains("Skill refs: /logtrace"))
    #expect(actions[2].prompt.contains("accountId=7542904004"))
    #expect(actions[3].prompt.contains("accountId=7542904004"))
    #expect(actions[1].prompt.contains("Read-only follow-up"))
    #expect(actions[3].prompt.contains("Jira-ready update"))
}

@Test func chatRunFollowUpActionsGenerateSkillCommandActionForSuggestedLogtraceCommand() {
    let output = """
    Status: log command ready.
    Suggested skill command: `/logtrace env=stage conversationId=p-v-voice-123 last=24h`
    """
    let run = AgentRun(
        id: "run-follow-up-generated-skill-command",
        workspaceId: "workspace-follow-up",
        agentProfileId: "agent-follow-up",
        state: .completed,
        promptSnapshot: "Trace no-audio session",
        transcript: output
    )

    let actions = chatRunFollowUpActions(
        run: run,
        workItem: nil,
        assistantText: output
    )

    #expect(actions.map(\.id) == ["log-analysis", "skill-hardening", "skill-command-1", "mr-review"])
    #expect(actions[2].title == "Trace")
    #expect(actions[2].detail == "Generated command")
    #expect(actions[2].symbol == "waveform.path.ecg")
    #expect(actions[2].permissionMode == .askBeforeEdit)
    #expect(actions[2].isGeneratedUI)
    #expect(actions[2].generatedUIRole == .toolCard)
    #expect(actions[2].prompt.contains("Generated skill command:"))
    #expect(actions[2].prompt.contains("/logtrace env=stage conversationId=p-v-voice-123 last=24h"))
    #expect(actions[2].prompt.contains("keep env/account/session IDs distinct"))
    #expect(actions[2].prompt.contains("exact missing input"))
}

@Test func chatRunFollowUpActionsGenerateSkillCommandActionForChineseSuggestedLogtraceCommand() {
    let output = """
    状态：日志命令已准备。
    建议技能命令：`/logtrace env=stage conversationId=p-v-voice-456 last=24h`
    """
    let run = AgentRun(
        id: "run-follow-up-chinese-generated-skill-command",
        workspaceId: "workspace-follow-up",
        agentProfileId: "agent-follow-up",
        state: .completed,
        promptSnapshot: "追踪中文 no-audio 会话",
        transcript: output
    )

    let actions = chatRunFollowUpActions(
        run: run,
        workItem: nil,
        assistantText: output
    )

    #expect(actions.map(\.id) == ["log-analysis", "skill-hardening", "skill-command-1", "mr-review"])
    #expect(actions[2].title == "Trace")
    #expect(actions[2].detail == "Generated command")
    #expect(actions[2].symbol == "waveform.path.ecg")
    #expect(actions[2].permissionMode == .askBeforeEdit)
    #expect(actions[2].isGeneratedUI)
    #expect(actions[2].generatedUIRole == .toolCard)
    #expect(actions[2].prompt.contains("Generated skill command:"))
    #expect(actions[2].prompt.contains("/logtrace env=stage conversationId=p-v-voice-456 last=24h"))
    #expect(actions[2].prompt.contains("- Original prompt: 追踪中文 no-audio 会话"))
}

@Test func chatRunFollowUpActionsDoNotGenerateSkillCommandActionForBareSkillMentions() {
    let output = """
    Available skills: /logtrace and /clickhouse.
    Use them when an output contains a concrete conversationId or TraceId.
    """
    let run = AgentRun(
        id: "run-follow-up-bare-skill-mentions",
        workspaceId: "workspace-follow-up",
        agentProfileId: "agent-follow-up",
        state: .completed,
        promptSnapshot: "Review available observability skills",
        transcript: output
    )

    let actions = chatRunFollowUpActions(
        run: run,
        workItem: nil,
        assistantText: output
    )

    #expect(actions.map(\.id) == ["log-analysis", "skill-hardening", "mr-review", "validation"])
    #expect(actions.contains(where: { $0.id.hasPrefix("skill-command-") }) == false)
}

@Test func chatRunFollowUpActionsExtractTraceParentNextCommands() {
    let traceParent = "00-4a0031017ceb19eab6d3a39468a20000-0123456789abcdef-01"
    let run = AgentRun(
        id: "run-follow-up-traceparent",
        workspaceId: "workspace-follow-up",
        agentProfileId: "agent-follow-up",
        state: .completed,
        promptSnapshot: "Trace copied span context",
        transcript: "traceparent=\(traceParent)"
    )

    let actions = chatRunFollowUpActions(
        run: run,
        workItem: nil,
        assistantText: "traceparent=\(traceParent)"
    )

    #expect(actions.map(\.id) == ["log-analysis", "mr-review", "validation", "capture-evidence"])
    #expect(actions[0].prompt.contains("Suggested log commands:"))
    #expect(actions[0].prompt.contains("/logtrace env=lab traceId=4a0031017ceb19eab6d3a39468a20000 last=24h"))
    #expect(actions[0].prompt.contains("/clickhouse trace lookup TraceId=4a0031017ceb19eab6d3a39468a20000 limit=20"))
}

@Test func chatRunFollowUpActionsPreserveGitRefsForReview() {
    let output = """
    Branch: codex/mac-native-v2-foundation
    Commit SHA: abc1234def5678
    Findings:
    - [P1] Missing retry validation in RootView.swift:42 before marking the MR ready.
    Validation: swift test passed
    """
    let run = AgentRun(
        id: "run-follow-up-git-refs",
        workspaceId: "workspace-follow-up",
        agentProfileId: "agent-follow-up",
        state: .completed,
        promptSnapshot: "Review branch codex/mac-native-v2-foundation",
        transcript: output
    )

    let actions = chatRunFollowUpActions(
        run: run,
        workItem: nil,
        assistantText: output
    )

    #expect(actions.map(\.id) == ["bug-analysis", "mr-review", "validation", "capture-evidence"])
    #expect(actions[0].prompt.contains("high-severity review finding"))
    #expect(actions[0].prompt.contains("Review findings:"))
    #expect(actions[1].prompt.contains("Git refs:"))
    #expect(actions[1].prompt.contains("branch codex/mac-native-v2-foundation"))
    #expect(actions[1].prompt.contains("commit abc1234def5678"))
    #expect(actions[0].prompt.contains("[P1] Missing retry validation in RootView.swift:42 before marking the MR ready."))
    #expect(actions[1].prompt.contains("Validation evidence:"))
    #expect(actions[1].prompt.contains("swift test"))
}

@Test func chatRunFollowUpActionsIncludeSkillHardeningForSkillSignals() {
    let skillOutput = """
    Skill /logtrace failed because IVA_LOGTRACER_ENV_FILE was missing.
    Inspect .pikiclaw/skills/iva-logtracer/SKILL.md before changing behavior.
    Fallback command: `/clickhouse trace lookup TraceId=0123456789abcdef0123456789abcdef limit=20`
    Next command: `PIKICLAW_DEV_FOREGROUND=1 npm run dev`
    """
    let run = AgentRun(
        id: "run-follow-up-skill-hardening",
        workspaceId: "workspace-follow-up",
        agentProfileId: "agent-follow-up",
        state: .failed,
        promptSnapshot: "Improve /logtrace recovery",
        transcript: skillOutput
    )
    let workItem = WorkItem(
        id: "workitem-follow-up-skill-hardening",
        workspaceId: "workspace-follow-up",
        title: "Harden logtrace skill",
        sourceType: .manualPrompt,
        state: .active
    )

    let actions = chatRunFollowUpActions(
        run: run,
        workItem: workItem,
        assistantText: skillOutput
    )

    #expect(actions.map(\.id) == ["skill-hardening", "bug-analysis", "log-analysis", "skill-command-1"])
    #expect(actions[0].title == "Skill")
    #expect(actions[0].detail == "Ask before edits")
    #expect(actions[0].permissionMode == .askBeforeEdit)
    #expect(actions[0].prompt.contains("Harden the skill path"))
    #expect(actions[0].prompt.contains("inspect its SKILL.md and scripts"))
    #expect(actions[0].prompt.contains("Preserve environment and credential boundaries"))
    #expect(actions[0].prompt.contains("skill path, current failure, invocation improvement, guardrail/doc change, and validation"))
    #expect(actions[0].prompt.contains("Distinguish confirmed SKILL.md/script behavior from proposed edits"))
    #expect(actions[0].prompt.contains("Ask-before-edit follow-up"))
    #expect(actions[0].prompt.contains("Ask before editing files"))
    #expect(actions[0].prompt.contains("Skill refs:"))
    #expect(actions[0].prompt.contains("/logtrace"))
    #expect(actions[0].prompt.contains("/clickhouse"))
    #expect(actions[0].prompt.contains("IVA_LOGTRACER_ENV_FILE"))
    #expect(actions[0].prompt.contains(".pikiclaw/skills/iva-logtracer/SKILL.md"))
    #expect(actions[0].prompt.contains("Next commands:"))
    #expect(actions[0].prompt.contains("PIKICLAW_DEV_FOREGROUND=1 npm run dev"))
    #expect(actions[0].prompt.contains("Validation evidence:") == false)
    #expect(actions[3].title == "Query")
    #expect(actions[3].detail == "Generated command")
    #expect(actions[3].permissionMode == .askBeforeEdit)
    #expect(actions[3].prompt.contains("/clickhouse trace lookup TraceId=0123456789abcdef0123456789abcdef limit=20"))
}

@Test func chatRunFollowUpActionsDoNotPrioritizeSkillForGenericSkillUiFailures() {
    let output = """
    Validation failed in RootView.swift while testing the skill command picker.
    Next command: `swift test --filter ComposerSkillPickerTests`
    """
    let run = AgentRun(
        id: "run-follow-up-skill-ui-validation",
        workspaceId: "workspace-follow-up",
        agentProfileId: "agent-follow-up",
        state: .failed,
        promptSnapshot: "Improve the skill command picker",
        transcript: output
    )

    let actions = chatRunFollowUpActions(
        run: run,
        workItem: nil,
        assistantText: output
    )

    #expect(actions.map(\.id) == ["bug-analysis", "skill-hardening", "command-1", "mr-review"])
    #expect(actions[0].title == "Bug")
    #expect(actions[1].title == "Skill")
    #expect(actions[2].title == "Validate")
    #expect(actions[2].detail == "Generated command")
    #expect(actions[2].permissionMode == .askBeforeEdit)
    #expect(actions[0].prompt.contains("Validation failed in RootView.swift"))
    #expect(actions[1].prompt.contains("skill command picker"))
    #expect(actions[2].prompt.contains("swift test --filter ComposerSkillPickerTests"))
}

@Test func chatRunFollowUpActionsPreserveNamedSkillAliasRefs() {
    let output = """
    chsql failed because CLICKHOUSE_PROFILE is missing.
    Suggested skill command: `/clickhouse show error spans for TraceId=0123456789abcdef0123456789abcdef limit=20`
    """
    let run = AgentRun(
        id: "run-follow-up-chsql-skill-hardening",
        workspaceId: "workspace-follow-up",
        agentProfileId: "agent-follow-up",
        state: .failed,
        promptSnapshot: "Repair chsql recovery",
        transcript: output
    )

    let actions = chatRunFollowUpActions(
        run: run,
        workItem: nil,
        assistantText: output
    )

    #expect(Array(actions.map(\.id).prefix(3)) == ["skill-hardening", "bug-analysis", "log-analysis"])
    #expect(actions[0].prompt.contains("Skill refs: chsql, CLICKHOUSE_PROFILE, /clickhouse"))
    #expect(actions[0].prompt.contains("Suggested log commands:"))
    #expect(actions[0].prompt.contains("/clickhouse show error spans for TraceId=0123456789abcdef0123456789abcdef limit=20"))
    #expect(actions[0].prompt.contains("chsql failed because CLICKHOUSE_PROFILE is missing."))
}

@Test func chatRunFollowUpActionsKeepJiraVisibleWhenSignalsOverflow() {
    let run = AgentRun(
        id: "run-follow-up-overflow",
        workspaceId: "workspace-follow-up",
        agentProfileId: "agent-follow-up",
        state: .failed,
        promptSnapshot: "Debug IVAS-9011 with /logtrace",
        transcript: "Skill /logtrace failed for IVAS-9011 conversationId=p-v-overflow"
    )
    let workItem = WorkItem(
        id: "workitem-follow-up-overflow",
        workspaceId: "workspace-follow-up",
        title: "Overflow follow-up triage",
        sourceType: .manualPrompt,
        state: .active
    )

    let actions = chatRunFollowUpActions(
        run: run,
        workItem: workItem,
        assistantText: "Skill /logtrace failed for IVAS-9011 conversationId=p-v-overflow"
    )

    #expect(actions.map(\.id) == ["skill-hardening", "bug-analysis", "log-analysis", "jira-update"])
    #expect(actions[3].title == "Jira")
    #expect(actions[3].permissionMode == .readOnly)
    #expect(actions[3].prompt.contains("IVAS-9011"))
    #expect(actions.contains(where: { $0.id == "mr-review" }) == false)
}

@Test func runFollowUpStagedContextPreservesActionDetail() {
    let action = RunFollowUpAction(
        id: "skill-hardening",
        title: "Skill",
        symbol: "puzzlepiece.extension",
        permissionMode: .askBeforeEdit,
        prompt: "Harden /logtrace"
    )

    #expect(action.detail == "Ask before edits")
    #expect(action.workflowLabel == "Hardening")
    #expect(action.workflowSummary == "Improve invocation, recovery, guardrails, and validation")
    #expect(runFollowUpStagedLabel(action) == "Skill - Ask before edits")
    #expect(runFollowUpStagedStatus(action) == "Skill follow-up staged - Hardening: Improve invocation, recovery, guardrails, and validation")
    #expect(runFollowUpActionHelp(action) == "Hardening: Improve invocation, recovery, guardrails, and validation - Ask before edits")
}

@Test func chatRunFollowUpActionsExposeEnterpriseWorkflowLabels() throws {
    let output = """
    Skill /logtrace failed for IVAS-9011 conversationId=p-v-overflow.
    MR review comment:
    Request changes: add validation before merge.
    Jira update:
    Status: blocked until validation passes
    Next action: paste update into IVAS-9011 after approval
    Next command: `swift test --filter ChatMessageHistoryTests`
    """
    let run = AgentRun(
        id: "run-follow-up-workflow-labels",
        workspaceId: "workspace-follow-up",
        agentProfileId: "agent-follow-up",
        state: .failed,
        promptSnapshot: "Align native follow-up workflow labels",
        transcript: output
    )
    let workItem = WorkItem(
        id: "workitem-follow-up-workflow-labels",
        workspaceId: "workspace-follow-up",
        title: "Enterprise follow-up clarity",
        sourceType: .jira,
        state: .active,
        jira: JiraWorkItemFields(key: "IVAS-9011", status: "In Progress")
    )

    let actions = chatRunFollowUpActions(
        run: run,
        workItem: workItem,
        assistantText: output
    )

    let actionById = Dictionary(uniqueKeysWithValues: actions.map { ($0.id, $0) })
    #expect(actionById["skill-hardening"]?.workflowLabel == "Hardening")
    #expect(actionById["skill-hardening"]?.workflowSummary == "Improve invocation, recovery, guardrails, and validation")
    #expect(actionById["bug-analysis"]?.workflowLabel == "Triage")
    #expect(actionById["bug-analysis"]?.workflowSummary == "Find cause, seam, smallest fix, and missing input")
    #expect(actionById["jira-update"]?.workflowLabel == "Write-back")
    #expect(actionById["jira-update"]?.workflowSummary == "Prepare status, evidence, validation, blockers, and next action")
    #expect(runFollowUpActionHelp(try #require(actionById["jira-update"])).contains("Write-back: Prepare status, evidence"))

    let reviewAction = RunFollowUpAction(
        id: "mr-review",
        title: "Review",
        symbol: "checkmark.seal",
        permissionMode: .readOnly,
        prompt: "Review current changes."
    )
    #expect(reviewAction.workflowLabel == "MR")
    #expect(reviewAction.workflowSummary == "Review findings, merge readiness, and residual risk")
}

@Test func chatRunFollowUpActionsShowCodingForWorkspaceTaskPlan() throws {
    let output = """
    Goal:
    Keep Redis as a non-blocking dependency for AIR state continuity.

    Implementation plan:
    - Inspect the state continuity helpers.
    - Change the fallback path so Redis loss does not block serving.
    - Run the focused runtime validation.
    """
    let run = AgentRun(
        id: "run-task-coding",
        workspaceId: "workspace-runtime",
        agentProfileId: "agent-codex",
        state: .completed,
        promptSnapshot: "Investigate IVAS-7167",
        transcript: output
    )
    let workspace = Workspace(
        id: "workspace-runtime",
        name: "assistant-runtime-ng",
        pathDisplay: "/tmp/assistant-runtime-ng",
        currentBranch: "main",
        trustState: .trusted,
        workflowConfig: WorkspaceWorkflowConfig(
            branchNamePattern: "{ticket}-{slug}",
            baseBranchName: "main",
            codingPromptTemplate: "CUSTOM CODING {ticket} {suggestedBranch} {baseBranch} {currentBranch}\n{output}\n{context}",
            reviewPromptTemplate: "CUSTOM REVIEW {ticket}"
        )
    )
    let workItem = WorkItem(
        id: "workitem-task-coding",
        workspaceId: workspace.id,
        title: "IVAS-7167: Support Kafka producer failover",
        sourceType: .jira,
        state: .active,
        jira: JiraWorkItemFields(key: "IVAS-7167", status: "Open")
    )

    let actions = chatRunFollowUpActions(
        run: run,
        workItem: workItem,
        workspace: workspace,
        assistantText: output
    )

    let coding = try #require(actions.first { $0.id == "task-coding" })
    #expect(coding.title == "Coding")
    #expect(coding.workflowLabel == "Coding")
    #expect(coding.detail == "Start coding")
    #expect(coding.prompt.contains("CUSTOM CODING IVAS-7167 IVAS-7167-support-kafka-producer-failover main main"))
    #expect(coding.prompt.contains("Implementation plan:"))
    #expect(coding.prompt.contains("- Work item: IVAS-7167: Support Kafka producer failover"))
    #expect(actions.allSatisfy { $0.id != "task-review" })
}

@Test func chatRunFollowUpActionsShowReviewAfterCodingOutput() throws {
    let output = """
    Implementation complete.

    Edited a file: apps/macos/Sources/PikiclawMac/NativeAppModel.swift
    Changed files:
    - apps/macos/Sources/PikiclawMac/NativeAppModel.swift

    Validation:
    swift test --package-path apps/macos --filter NativeAgentCommandBuilderTests passed
    """
    let run = AgentRun(
        id: "run-task-review",
        workspaceId: "workspace-runtime",
        agentProfileId: "agent-codex",
        state: .completed,
        promptSnapshot: "Code IVAS-7167",
        transcript: output
    )
    let workspace = Workspace(
        id: "workspace-runtime",
        name: "assistant-runtime-ng",
        pathDisplay: "/tmp/assistant-runtime-ng",
        currentBranch: "IVAS-7167",
        trustState: .trusted,
        workflowConfig: WorkspaceWorkflowConfig(
            branchNamePattern: "{ticket}",
            baseBranchName: "main",
            codingPromptTemplate: "CUSTOM CODING {ticket}",
            reviewPromptTemplate: "CUSTOM REVIEW {ticket} {workspace}\n{output}"
        )
    )
    let workItem = WorkItem(
        id: "workitem-task-review",
        workspaceId: workspace.id,
        title: "IVAS-7167: Support Kafka producer failover",
        sourceType: .jira,
        state: .active,
        jira: JiraWorkItemFields(key: "IVAS-7167", status: "Open")
    )

    let actions = chatRunFollowUpActions(
        run: run,
        workItem: workItem,
        workspace: workspace,
        assistantText: output
    )

    let review = try #require(actions.first { $0.id == "task-review" })
    #expect(review.title == "Review")
    #expect(review.workflowLabel == "Review")
    #expect(review.detail == "Explain changes")
    #expect(review.permissionMode == .readOnly)
    #expect(review.prompt.contains("CUSTOM REVIEW IVAS-7167 assistant-runtime-ng"))
    #expect(review.prompt.contains("Edited a file: apps/macos/Sources/PikiclawMac/NativeAppModel.swift"))
    #expect(actions.allSatisfy { $0.id != "task-coding" })
}

@Test func chatRunFollowUpActionsKeepGenericEvidenceReadOnly() {
    let run = AgentRun(
        id: "run-follow-up-evidence",
        workspaceId: "workspace-follow-up",
        agentProfileId: "agent-follow-up",
        state: .completed,
        promptSnapshot: "Validate native follow-up actions",
        transcript: "validation passed"
    )
    let workItem = WorkItem(
        id: "workitem-follow-up-evidence",
        workspaceId: "workspace-follow-up",
        title: "Native follow-up polish",
        sourceType: .manualPrompt,
        state: .active
    )

    let actions = chatRunFollowUpActions(
        run: run,
        workItem: workItem,
        assistantText: "validation passed"
    )

    #expect(actions.map(\.id) == ["mr-review", "validation", "capture-evidence"])
    #expect(actions[0].permissionMode == .readOnly)
    #expect(actions[1].permissionMode == .askBeforeEdit)
    #expect(actions[2].permissionMode == .readOnly)
    #expect(actions[2].detail == "Read-only capture")
    #expect(actions[2].prompt.contains("Extract durable evidence"))
    #expect(actions[2].prompt.contains("artifact-ready evidence with Source refs, Outputs, Validation, Blockers, and Next action"))
    #expect(actions[2].prompt.contains("proposed knowledge card only when it has durable reusable value"))
    #expect(actions[2].prompt.contains("Read-only follow-up"))
}

@Test func chatRunFollowUpActionsInferJiraUpdateFromTicketKey() {
    let run = AgentRun(
        id: "run-follow-up-jira-key",
        workspaceId: "workspace-follow-up",
        agentProfileId: "agent-follow-up",
        state: .completed,
        promptSnapshot: "Summarize IVAS-9010 after validation",
        transcript: "Validated IVAS-9010 and found one blocker"
    )
    let workItem = WorkItem(
        id: "workitem-follow-up-jira-key",
        workspaceId: "workspace-follow-up",
        title: "Ad hoc ticket note",
        sourceType: .manualPrompt,
        state: .active
    )

    let actions = chatRunFollowUpActions(
        run: run,
        workItem: workItem,
        assistantText: "Validated IVAS-9010 and found one blocker"
    )

    #expect(actions.map(\.id) == ["mr-review", "validation", "jira-update"])
    #expect(actions[2].permissionMode == .readOnly)
    #expect(actions[2].prompt.contains("Jira-ready update"))
    #expect(actions[2].prompt.contains("ticket key"))
    #expect(actions[2].prompt.contains("what needs to be synced before posting"))
    #expect(actions[2].prompt.contains("IVAS-9010"))
    #expect(actions[2].prompt.contains("Ticket refs: IVAS-9010"))
}

@Test func chatRunFollowUpActionsWaitForTerminalStates() {
    let run = AgentRun(
        id: "run-follow-up-running",
        workspaceId: "workspace-follow-up",
        agentProfileId: "agent-follow-up",
        state: .running,
        promptSnapshot: "Still working",
        transcript: "Thinking..."
    )

    let actions = chatRunFollowUpActions(
        run: run,
        workItem: nil,
        assistantText: "Thinking..."
    )

    #expect(actions.isEmpty)
}

@Test func chatCanCaptureEvidenceWaitsForDurableOutput() {
    let completedRun = AgentRun(
        id: "run-evidence-completed",
        workspaceId: "workspace-evidence",
        agentProfileId: "agent-evidence",
        state: .completed,
        promptSnapshot: "Review Jira sync"
    )
    let runningRun = AgentRun(
        id: "run-evidence-running",
        workspaceId: "workspace-evidence",
        agentProfileId: "agent-evidence",
        state: .running,
        promptSnapshot: "Review Jira sync"
    )

    #expect(chatCanCaptureEvidence(run: completedRun, assistantText: "Validated current sprint sync.") == true)
    #expect(chatCanCaptureEvidence(run: completedRun, assistantText: "No assistant output yet.") == false)
    #expect(chatCanCaptureEvidence(run: completedRun, assistantText: "Reading additional input from stdin...") == false)
    #expect(chatCanCaptureEvidence(run: runningRun, assistantText: "Partial stream") == false)
}

@Test func workItemOutputsSortAndResolveSourceRun() {
    let item = WorkItem(
        id: "workitem-output-actions",
        workspaceId: "workspace-output-actions",
        title: "Make outputs actionable"
    )
    let run = AgentRun(
        id: "run-output-source",
        workItemId: item.id,
        workspaceId: item.workspaceId,
        agentProfileId: "agent-output-source",
        state: .completed,
        promptSnapshot: "Capture evidence"
    )
    let older = Artifact(
        id: "artifact-output-older",
        workspaceId: item.workspaceId,
        workItemId: item.id,
        runId: run.id,
        kind: .commandOutputSummary,
        title: "Older evidence",
        uri: "pikiclaw://runs/run-output-source/evidence",
        status: .ready,
        provenance: "Older",
        createdAt: Date(timeIntervalSince1970: 10)
    )
    let newer = Artifact(
        id: "artifact-output-newer",
        workspaceId: item.workspaceId,
        workItemId: item.id,
        kind: .verificationResult,
        title: "Newer evidence",
        uri: "pikiclaw://runs/run-output-source/evidence",
        status: .verified,
        provenance: "Newer",
        createdAt: Date(timeIntervalSince1970: 20),
        sourceRefs: [
            SourceRef(kind: "chat-run", label: "Capture evidence", uri: "pikiclaw://runs/run-output-source")
        ]
    )
    let snapshot = NativeStoreSnapshot(
        workItems: [item],
        runs: [run],
        artifacts: [older, newer]
    )

    #expect(workItemOutputs(for: item, snapshot: snapshot).map(\.id) == [newer.id, older.id])
    #expect(artifactSourceRun(newer, snapshot: snapshot)?.id == run.id)
    #expect(artifactDisplaySubtitle(newer, sourceRun: run) == "verificationResult - verified - chat completed")
}

@Test func artifactReviewOutputGroupsPrioritizeActionableReviewStates() {
    let unreviewed = Artifact(
        id: "artifact-review-unreviewed",
        workspaceId: "workspace-review-groups",
        kind: .commandOutputSummary,
        title: "Newest unreviewed output",
        uri: "pikiclaw://runs/run-review-groups/unreviewed",
        status: .ready,
        provenance: "Unreviewed output",
        createdAt: Date(timeIntervalSince1970: 40)
    )
    let resolved = Artifact(
        id: "artifact-review-resolved",
        workspaceId: "workspace-review-groups",
        kind: .commandOutputSummary,
        title: "Resolved output",
        uri: "pikiclaw://runs/run-review-groups/resolved",
        status: .verified,
        provenance: "Resolved output",
        createdAt: Date(timeIntervalSince1970: 30),
        sourceRefs: [
            SourceRef(kind: "artifact-resolution", label: ArtifactBranchResolution.resolved.rawValue)
        ]
    )
    let blocked = Artifact(
        id: "artifact-review-blocked",
        workspaceId: "workspace-review-groups",
        kind: .commandOutputSummary,
        title: "Blocked output",
        uri: "pikiclaw://runs/run-review-groups/blocked",
        status: .failed,
        provenance: "Blocked output",
        createdAt: Date(timeIntervalSince1970: 20),
        sourceRefs: [
            SourceRef(kind: "artifact-resolution", label: ArtifactBranchResolution.blocked.rawValue)
        ]
    )
    let followUp = Artifact(
        id: "artifact-review-follow-up",
        workspaceId: "workspace-review-groups",
        kind: .commandOutputSummary,
        title: "Follow-up output",
        uri: "pikiclaw://runs/run-review-groups/follow-up",
        status: .ready,
        provenance: "Follow-up output",
        createdAt: Date(timeIntervalSince1970: 10),
        sourceRefs: [
            SourceRef(kind: "artifact-resolution", label: ArtifactBranchResolution.needsFollowUp.rawValue)
        ]
    )
    let artifacts = [unreviewed, resolved, blocked, followUp]

    let groups = artifactReviewOutputGroups(artifacts)
    let limited = artifactReviewOutputGroups(artifacts, limit: 2)

    #expect(artifactReviewGroupingIsUseful(artifacts))
    #expect(groups.map { $0.kind } == [
        ArtifactReviewGroupKind.blocked,
        ArtifactReviewGroupKind.needsFollowUp,
        ArtifactReviewGroupKind.unreviewed,
        ArtifactReviewGroupKind.resolved
    ])
    #expect(groups.flatMap { $0.artifacts.map { $0.id } } == [blocked.id, followUp.id, unreviewed.id, resolved.id])
    #expect(limited.map { $0.kind } == [
        ArtifactReviewGroupKind.blocked,
        ArtifactReviewGroupKind.needsFollowUp
    ])
    #expect(limited.flatMap { $0.artifacts.map { $0.id } } == [blocked.id, followUp.id])
}

@Test func artifactReviewOutputFiltersKeepDenseRailsActionable() {
    let unreviewed = Artifact(
        id: "artifact-filter-unreviewed",
        workspaceId: "workspace-review-filters",
        kind: .commandOutputSummary,
        title: "Ready evidence",
        uri: "pikiclaw://runs/run-review-filters/unreviewed",
        status: .ready,
        provenance: "Ready output",
        createdAt: Date(timeIntervalSince1970: 40)
    )
    let resolved = Artifact(
        id: "artifact-filter-resolved",
        workspaceId: "workspace-review-filters",
        kind: .commandOutputSummary,
        title: "Resolved evidence",
        uri: "pikiclaw://runs/run-review-filters/resolved",
        status: .verified,
        provenance: "Resolved output",
        createdAt: Date(timeIntervalSince1970: 30),
        sourceRefs: [
            SourceRef(kind: "artifact-resolution", label: ArtifactBranchResolution.resolved.rawValue)
        ]
    )
    let blocked = Artifact(
        id: "artifact-filter-blocked",
        workspaceId: "workspace-review-filters",
        kind: .commandOutputSummary,
        title: "Blocked evidence",
        uri: "pikiclaw://runs/run-review-filters/blocked",
        status: .failed,
        provenance: "Blocked output",
        createdAt: Date(timeIntervalSince1970: 20),
        sourceRefs: [
            SourceRef(kind: "artifact-resolution", label: ArtifactBranchResolution.blocked.rawValue)
        ]
    )
    let followUp = Artifact(
        id: "artifact-filter-follow-up",
        workspaceId: "workspace-review-filters",
        kind: .commandOutputSummary,
        title: "Follow-up evidence",
        uri: "pikiclaw://runs/run-review-filters/follow-up",
        status: .ready,
        provenance: "Follow-up output",
        createdAt: Date(timeIntervalSince1970: 10),
        sourceRefs: [
            SourceRef(kind: "artifact-resolution", label: ArtifactBranchResolution.needsFollowUp.rawValue)
        ]
    )
    let artifacts = [unreviewed, resolved, blocked, followUp]

    let options = artifactReviewOutputFilterOptions(artifacts)
    let actionable = artifactReviewFilteredArtifacts(artifacts, filter: .actionRequired)
    let resolvedOnly = artifactReviewFilteredArtifacts(artifacts, filter: .resolved)
    let actionableGroups = artifactReviewOutputGroups(actionable)

    #expect(artifactReviewFilterIsUseful(artifacts))
    #expect(options.map(\.filter) == [
        ArtifactReviewOutputFilter.actionRequired,
        ArtifactReviewOutputFilter.blocked,
        ArtifactReviewOutputFilter.needsFollowUp,
        ArtifactReviewOutputFilter.unreviewed,
        ArtifactReviewOutputFilter.resolved,
        ArtifactReviewOutputFilter.all
    ])
    #expect(options.map(\.count) == [3, 1, 1, 1, 1, 4])
    #expect(actionable.map(\.id) == [unreviewed.id, blocked.id, followUp.id])
    #expect(resolvedOnly.map(\.id) == [resolved.id])
    #expect(actionableGroups.map(\.kind) == [
        ArtifactReviewGroupKind.blocked,
        ArtifactReviewGroupKind.needsFollowUp,
        ArtifactReviewGroupKind.unreviewed
    ])
}

@Test func artifactReviewMissionSummaryCountsBlockedFollowUpAndReadyOutputs() {
    let ready = Artifact(
        id: "artifact-mission-ready",
        workspaceId: "workspace-review-mission",
        kind: .commandOutputSummary,
        title: "Ready output",
        uri: "pikiclaw://runs/run-review-mission/ready",
        status: .ready,
        provenance: "Ready output"
    )
    let resolved = Artifact(
        id: "artifact-mission-resolved",
        workspaceId: "workspace-review-mission",
        kind: .commandOutputSummary,
        title: "Resolved output",
        uri: "pikiclaw://runs/run-review-mission/resolved",
        status: .verified,
        provenance: "Resolved output",
        sourceRefs: [
            SourceRef(kind: "artifact-resolution", label: ArtifactBranchResolution.resolved.rawValue)
        ]
    )
    let blocked = Artifact(
        id: "artifact-mission-blocked",
        workspaceId: "workspace-review-mission",
        kind: .commandOutputSummary,
        title: "Blocked output",
        uri: "pikiclaw://runs/run-review-mission/blocked",
        status: .failed,
        provenance: "Blocked output",
        sourceRefs: [
            SourceRef(kind: "artifact-resolution", label: ArtifactBranchResolution.blocked.rawValue)
        ]
    )
    let followUp = Artifact(
        id: "artifact-mission-follow-up",
        workspaceId: "workspace-review-mission",
        kind: .commandOutputSummary,
        title: "Follow-up output",
        uri: "pikiclaw://runs/run-review-mission/follow-up",
        status: .ready,
        provenance: "Follow-up output",
        sourceRefs: [
            SourceRef(kind: "artifact-resolution", label: ArtifactBranchResolution.needsFollowUp.rawValue)
        ]
    )

    let summary = artifactReviewMissionSummary([ready, resolved, blocked, followUp])

    #expect(summary.totalCount == 4)
    #expect(summary.blockedCount == 1)
    #expect(summary.needsFollowUpCount == 1)
    #expect(summary.readyToReviewCount == 1)
    #expect(summary.resolvedCount == 1)
    #expect(summary.attentionCount == 2)
    #expect(summary.subtitle == "1 blocked · 1 follow-up · 1 ready")
}

@Test func artifactReviewMissionTargetOpensMostActionableWorkItemOutput() throws {
    let blockedItem = WorkItem(
        id: "workitem-review-target-blocked",
        workspaceId: "workspace-review-target",
        title: "Blocked saved output",
        sourceType: .goal
    )
    let followUpItem = WorkItem(
        id: "workitem-review-target-follow-up",
        workspaceId: "workspace-review-target",
        title: "Follow-up saved output",
        sourceType: .manualPrompt
    )
    let readyItem = WorkItem(
        id: "workitem-review-target-ready",
        workspaceId: "workspace-review-target",
        title: "Ready saved output",
        sourceType: .jira
    )
    let newerReady = Artifact(
        id: "artifact-review-target-ready-new",
        workspaceId: readyItem.workspaceId,
        workItemId: readyItem.id,
        kind: .commandOutputSummary,
        title: "Ready output",
        uri: "pikiclaw://runs/run-review-target/ready-new",
        status: .ready,
        provenance: "Ready",
        createdAt: Date(timeIntervalSince1970: 40)
    )
    let followUp = Artifact(
        id: "artifact-review-target-follow-up",
        workspaceId: followUpItem.workspaceId,
        workItemId: followUpItem.id,
        kind: .commandOutputSummary,
        title: "Follow-up output",
        uri: "pikiclaw://runs/run-review-target/follow-up",
        status: .ready,
        provenance: "Needs follow-up",
        createdAt: Date(timeIntervalSince1970: 30),
        sourceRefs: [
            SourceRef(kind: "artifact-resolution", label: ArtifactBranchResolution.needsFollowUp.rawValue)
        ]
    )
    let blocked = Artifact(
        id: "artifact-review-target-blocked",
        workspaceId: blockedItem.workspaceId,
        workItemId: blockedItem.id,
        kind: .commandOutputSummary,
        title: "Blocked output",
        uri: "pikiclaw://runs/run-review-target/blocked",
        status: .failed,
        provenance: "Blocked",
        createdAt: Date(timeIntervalSince1970: 20),
        sourceRefs: [
            SourceRef(kind: "artifact-resolution", label: ArtifactBranchResolution.blocked.rawValue)
        ]
    )
    let orphanBlocked = Artifact(
        id: "artifact-review-target-orphan",
        workspaceId: "workspace-review-target",
        workItemId: "missing-workitem",
        kind: .commandOutputSummary,
        title: "Orphan blocked output",
        uri: "pikiclaw://runs/run-review-target/orphan",
        status: .failed,
        provenance: "Blocked but missing item",
        createdAt: Date(timeIntervalSince1970: 50),
        sourceRefs: [
            SourceRef(kind: "artifact-resolution", label: ArtifactBranchResolution.blocked.rawValue)
        ]
    )
    let snapshot = NativeStoreSnapshot(
        workItems: [readyItem, followUpItem, blockedItem],
        artifacts: [newerReady, followUp, blocked, orphanBlocked]
    )

    let target = try #require(artifactReviewMissionTarget(snapshot: snapshot))

    #expect(target.artifactId == blocked.id)
    #expect(target.workItemId == blockedItem.id)
    #expect(target.workspaceId == blockedItem.workspaceId)
    #expect(target.kind == .blocked)
    #expect(target.title == "Blocked output")
    #expect(target.workItemTitle == "Blocked saved output")
    #expect(target.followUpWorkflowLabel == "Triage")
    #expect(target.followUpWorkflowSummary == "Find cause, seam, smallest fix, and missing input")
    #expect(target.followUpSymbol == "ladybug")
}

@Test func missionFollowUpLaneSummaryCountsChatsAndSavedOutputs() {
    let workspace = Workspace(
        id: "workspace-lane-summary",
        name: "Lane Summary",
        pathDisplay: "/tmp/lane-summary",
        trustState: .trusted
    )
    let codex = AgentProfile(
        id: "agent-lane-codex",
        kind: .codex,
        displayName: "Codex",
        executableName: "codex"
    )
    let claude = AgentProfile(
        id: "agent-lane-claude",
        kind: .claude,
        displayName: "Claude Code",
        executableName: "claude"
    )
    let triageItem = WorkItem(
        id: "workitem-lane-triage",
        workspaceId: workspace.id,
        title: "Repair failed native output",
        sourceType: .jira,
        jira: JiraWorkItemFields(key: "IVAS-9100", status: "In Progress")
    )
    let hardeningItem = WorkItem(
        id: "workitem-lane-hardening",
        workspaceId: workspace.id,
        title: "Harden logtrace skill",
        sourceType: .manualPrompt
    )
    let reviewItem = WorkItem(
        id: "workitem-lane-review",
        workspaceId: workspace.id,
        title: "Review saved patch",
        sourceType: .manualPrompt
    )
    let writeBackItem = WorkItem(
        id: "workitem-lane-jira",
        workspaceId: workspace.id,
        title: "Post Jira status",
        sourceType: .jira,
        jira: JiraWorkItemFields(key: "IVAS-9101", status: "In Review")
    )
    let handoffItem = WorkItem(
        id: "workitem-lane-handoff",
        workspaceId: workspace.id,
        title: "Hand off native review evidence",
        sourceType: .manualPrompt
    )
    let triageRun = AgentRun(
        id: "run-lane-triage",
        workItemId: triageItem.id,
        workspaceId: triageItem.workspaceId,
        agentProfileId: "agent-lane-summary",
        state: .failed,
        promptSnapshot: "Debug failed native output",
        transcript: """
        error: native follow-up crashed in RootView.swift:42
        Jira: IVAS-9100
        """
    )
    let hardeningRun = AgentRun(
        id: "run-lane-hardening",
        workItemId: hardeningItem.id,
        workspaceId: hardeningItem.workspaceId,
        agentProfileId: "agent-lane-summary",
        state: .waitingForUser,
        promptSnapshot: "Repair skill recovery",
        transcript: """
        Skill /logtrace failed because IVA_LOGTRACER_ENV_FILE is missing.
        Suggested skill command: `/logtrace env=stage conversationId=p-v-lane last=24h`
        """
    )
    let completedRun = AgentRun(
        id: "run-lane-completed",
        workItemId: triageItem.id,
        workspaceId: triageItem.workspaceId,
        agentProfileId: "agent-lane-summary",
        state: .completed,
        promptSnapshot: "Completed historical work",
        transcript: "error: historical issue should not count in active lanes"
    )
    let codexHandoffRun = AgentRun(
        id: "run-lane-handoff-codex",
        workItemId: handoffItem.id,
        workspaceId: handoffItem.workspaceId,
        agentProfileId: codex.id,
        state: .completed,
        startedAt: Date(timeIntervalSince1970: 100),
        endedAt: Date(timeIntervalSince1970: 120),
        promptSnapshot: "Codex prepared implementation evidence"
    )
    let claudeHandoffRun = AgentRun(
        id: "run-lane-handoff-claude",
        workItemId: handoffItem.id,
        workspaceId: handoffItem.workspaceId,
        agentProfileId: claude.id,
        state: .completed,
        startedAt: Date(timeIntervalSince1970: 130),
        endedAt: Date(timeIntervalSince1970: 150),
        promptSnapshot: "Claude reviewed implementation evidence"
    )
    let reviewArtifact = Artifact(
        id: "artifact-lane-review",
        workspaceId: reviewItem.workspaceId,
        workItemId: reviewItem.id,
        kind: .patch,
        title: "Patch: review workspace binding",
        uri: "pikiclaw://runs/run-lane-review/patch",
        status: .ready,
        provenance: "Patch updates the saved output row.",
        sourceRefs: [
            SourceRef(kind: "artifact-resolution", label: ArtifactBranchResolution.needsFollowUp.rawValue)
        ]
    )
    let jiraArtifact = Artifact(
        id: "artifact-lane-jira",
        workspaceId: writeBackItem.workspaceId,
        workItemId: writeBackItem.id,
        kind: .commandOutputSummary,
        title: "Jira update ready",
        uri: "pikiclaw://runs/run-lane-jira/output",
        status: .ready,
        provenance: "Jira update:\nStatus: validation passed\nNext action: paste into IVAS-9101"
    )
    let resolvedJiraArtifact = Artifact(
        id: "artifact-lane-jira-resolved",
        workspaceId: writeBackItem.workspaceId,
        workItemId: writeBackItem.id,
        kind: .commandOutputSummary,
        title: "Resolved Jira update",
        uri: "pikiclaw://runs/run-lane-jira/resolved",
        status: .verified,
        provenance: "Jira update already posted",
        sourceRefs: [
            SourceRef(kind: "artifact-resolution", label: ArtifactBranchResolution.resolved.rawValue)
        ]
    )
    let snapshot = NativeStoreSnapshot(
        workspaces: [workspace],
        workItems: [triageItem, hardeningItem, reviewItem, writeBackItem, handoffItem],
        runs: [triageRun, hardeningRun, completedRun, codexHandoffRun, claudeHandoffRun],
        artifacts: [reviewArtifact, jiraArtifact, resolvedJiraArtifact],
        agentProfiles: [codex, claude]
    )

    let lanes = missionFollowUpLaneSummary(snapshot: snapshot)

    #expect(lanes.map(\.label) == ["Triage", "MR", "Write-back", "Hardening", "Handoff"])
    #expect(lanes.map(\.totalCount) == [1, 1, 1, 1, 1])
    #expect(lanes[0].chatCount == 1)
    #expect(lanes[0].outputCount == 0)
    #expect(lanes[0].target == .chat(runId: triageRun.id, workspaceId: triageRun.workspaceId, workItemId: triageRun.workItemId, title: triageItem.title))
    #expect(lanes[0].target?.actionLabel == "Open chat")
    #expect(lanes[0].target?.title == "Repair failed native output")
    #expect(lanes[0].previewDetail == "Open chat · Repair failed native output · 1 chat · 0 output · 0 handoff")
    #expect(lanes[1].chatCount == 0)
    #expect(lanes[1].outputCount == 1)
    #expect(lanes[1].target == .output(artifactId: reviewArtifact.id, workspaceId: reviewArtifact.workspaceId, workItemId: reviewItem.id, title: reviewArtifact.title))
    #expect(lanes[1].target?.actionLabel == "Open output")
    #expect(lanes[1].target?.title == "Patch: review workspace binding")
    #expect(lanes[1].previewDetail == "Open output · Patch: review workspace binding · 0 chat · 1 output · 0 handoff")
    #expect(lanes[2].chatCount == 0)
    #expect(lanes[2].outputCount == 1)
    #expect(lanes[2].target == .output(artifactId: jiraArtifact.id, workspaceId: jiraArtifact.workspaceId, workItemId: writeBackItem.id, title: jiraArtifact.title))
    #expect(lanes[2].target?.actionLabel == "Open output")
    #expect(lanes[2].target?.title == "Jira update ready")
    #expect(lanes[2].previewDetail == "Open output · Jira update ready · 0 chat · 1 output · 0 handoff")
    #expect(lanes[3].chatCount == 1)
    #expect(lanes[3].outputCount == 0)
    #expect(lanes[3].target == .chat(runId: hardeningRun.id, workspaceId: hardeningRun.workspaceId, workItemId: hardeningRun.workItemId, title: hardeningItem.title))
    #expect(lanes[3].target?.actionLabel == "Open chat")
    #expect(lanes[3].target?.title == "Harden logtrace skill")
    #expect(lanes[3].previewDetail == "Open chat · Harden logtrace skill · 1 chat · 0 output · 0 handoff")
    #expect(lanes[3].detail == "1 chat · 0 output · 0 handoff")
    #expect(lanes[4].chatCount == 0)
    #expect(lanes[4].outputCount == 0)
    #expect(lanes[4].handoffCount == 1)
    #expect(lanes[4].target == .handoff(workItemId: handoffItem.id, workspaceId: handoffItem.workspaceId, title: handoffItem.title))
    #expect(lanes[4].target?.actionLabel == "Open handoff")
    #expect(lanes[4].target?.title == "Hand off native review evidence")
    #expect(lanes[4].previewDetail == "Open handoff · Hand off native review evidence · 0 chat · 0 output · 1 handoff")
    #expect(lanes[4].detail == "0 chat · 0 output · 1 handoff")

    let reviewTargets = artifactReviewMissionTargets(snapshot: snapshot)
    #expect(missionFollowUpLaneFocusedArtifactId(lanes[1].target) == reviewArtifact.id)
    #expect(missionFollowUpLanePinnedArtifactReviewTargets(
        Array(reviewTargets.reversed()),
        focusTarget: lanes[1].target,
        snapshot: snapshot
    ).first?.artifactId == reviewArtifact.id)

    let handoffItems = missionAgentHandoffTrailItems(snapshot: snapshot)
    #expect(missionFollowUpLaneFocusedHandoffWorkItemId(lanes[4].target) == handoffItem.id)
    #expect(missionFollowUpLanePinnedHandoffItems(
        handoffItems,
        focusTarget: lanes[4].target,
        snapshot: snapshot
    ).first?.workItemId == handoffItem.id)

    let pinnedRuns = missionFollowUpLanePinnedRuns(
        [completedRun, triageRun, hardeningRun],
        focusTarget: lanes[3].target,
        snapshot: snapshot
    )
    #expect(pinnedRuns.first?.id == hardeningRun.id)
    #expect(missionFollowUpLaneTargetMatchesRun(lanes[3].target, run: hardeningRun))
    #expect(missionFollowUpLaneTargetMatchesRun(lanes[3].target, run: triageRun) == false)
}

@Test func missionFollowUpLaneFocusStepsThroughKeyboardTargets() {
    let triage = MissionFollowUpLaneSummaryItem(
        label: "Triage",
        symbol: "ladybug",
        summary: "Cause, seam, fix",
        chatCount: 1,
        outputCount: 0,
        handoffCount: 0,
        target: .chat(
            runId: "run-lane-keyboard-triage",
            workspaceId: "workspace-lane-keyboard",
            workItemId: nil,
            title: "Failed chat"
        )
    )
    let unavailable = MissionFollowUpLaneSummaryItem(
        label: "Unavailable",
        symbol: "questionmark",
        summary: "No target",
        chatCount: 1,
        outputCount: 0,
        handoffCount: 0,
        target: nil
    )
    let review = MissionFollowUpLaneSummaryItem(
        label: "MR",
        symbol: "checkmark.seal",
        summary: "Review readiness",
        chatCount: 0,
        outputCount: 1,
        handoffCount: 0,
        target: .output(
            artifactId: "artifact-lane-keyboard-review",
            workspaceId: "workspace-lane-keyboard",
            workItemId: "workitem-lane-keyboard-review",
            title: "Review output"
        )
    )
    let handoff = MissionFollowUpLaneSummaryItem(
        label: "Handoff",
        symbol: "arrow.triangle.branch",
        summary: "Next agent context",
        chatCount: 0,
        outputCount: 0,
        handoffCount: 1,
        target: .handoff(
            workItemId: "workitem-lane-keyboard-handoff",
            workspaceId: "workspace-lane-keyboard",
            title: "Agent handoff"
        )
    )
    let lanes = [triage, unavailable, review, handoff]

    #expect(missionFollowUpLaneFocusedItem(in: lanes, currentLabel: "MR")?.label == "MR")
    #expect(missionFollowUpLaneFocusedItem(in: lanes, currentLabel: "Unavailable") == nil)
    #expect(missionFollowUpLaneFocusedItem(in: lanes, currentLabel: "Missing") == nil)
    #expect(missionFollowUpLaneFocusedItem(in: lanes, currentLabel: nil) == nil)
    #expect(missionFollowUpLaneSteppedFocusItem(in: lanes, currentLabel: nil, direction: .next)?.label == "Triage")
    #expect(missionFollowUpLaneSteppedFocusItem(in: lanes, currentLabel: nil, direction: .previous)?.label == "Handoff")
    #expect(missionFollowUpLaneSteppedFocusItem(in: lanes, currentLabel: "Triage", direction: .next)?.label == "MR")
    #expect(missionFollowUpLaneSteppedFocusItem(in: lanes, currentLabel: "Triage", direction: .previous)?.label == "Handoff")
    #expect(missionFollowUpLaneSteppedFocusItem(in: lanes, currentLabel: "MR", direction: .next)?.label == "Handoff")
    #expect(missionFollowUpLaneSteppedFocusItem(in: lanes, currentLabel: "Handoff", direction: .next)?.label == "Triage")
    #expect(missionFollowUpLaneSteppedFocusItem(in: lanes, currentLabel: "Missing", direction: .next)?.label == "Triage")
    #expect(missionFollowUpLaneSteppedFocusItem(in: [unavailable], currentLabel: nil, direction: .next) == nil)
}

@Test func missionFollowUpLaneFocusPinsHiddenTargetsIntoMissionControlLists() {
    let workspace = Workspace(
        id: "workspace-lane-focus",
        name: "Lane Focus",
        pathDisplay: "/tmp/lane-focus",
        trustState: .trusted
    )
    let codex = AgentProfile(
        id: "agent-lane-focus-codex",
        kind: .codex,
        displayName: "Codex",
        executableName: "codex"
    )
    let claude = AgentProfile(
        id: "agent-lane-focus-claude",
        kind: .claude,
        displayName: "Claude Code",
        executableName: "claude"
    )
    let chatItem = WorkItem(
        id: "workitem-lane-focus-chat",
        workspaceId: workspace.id,
        title: "Pinned failed chat",
        sourceType: .manualPrompt
    )
    let visibleOutputItem = WorkItem(
        id: "workitem-lane-focus-visible-output",
        workspaceId: workspace.id,
        title: "Visible output",
        sourceType: .manualPrompt
    )
    let focusedOutputItem = WorkItem(
        id: "workitem-lane-focus-hidden-output",
        workspaceId: workspace.id,
        title: "Hidden output",
        sourceType: .manualPrompt
    )
    let visibleHandoffItem = WorkItem(
        id: "workitem-lane-focus-visible-handoff",
        workspaceId: workspace.id,
        title: "Visible handoff",
        sourceType: .manualPrompt,
        updatedAt: Date(timeIntervalSince1970: 300)
    )
    let focusedHandoffItem = WorkItem(
        id: "workitem-lane-focus-hidden-handoff",
        workspaceId: workspace.id,
        title: "Hidden handoff",
        sourceType: .manualPrompt,
        updatedAt: Date(timeIntervalSince1970: 100)
    )
    let visibleChatRun = AgentRun(
        id: "run-lane-focus-visible",
        workItemId: chatItem.id,
        workspaceId: workspace.id,
        agentProfileId: codex.id,
        state: .waitingForUser,
        startedAt: Date(timeIntervalSince1970: 20),
        promptSnapshot: "Visible queue row"
    )
    let focusedChatRun = AgentRun(
        id: "run-lane-focus-hidden",
        workItemId: chatItem.id,
        workspaceId: workspace.id,
        agentProfileId: codex.id,
        state: .failed,
        startedAt: Date(timeIntervalSince1970: 10),
        promptSnapshot: "Hidden queue row"
    )
    let visibleOutput = Artifact(
        id: "artifact-lane-focus-visible",
        workspaceId: workspace.id,
        workItemId: visibleOutputItem.id,
        kind: .commandOutputSummary,
        title: "Visible output target",
        uri: "pikiclaw://runs/run-lane-focus-visible/output",
        status: .ready,
        provenance: "Ready",
        createdAt: Date(timeIntervalSince1970: 30)
    )
    let focusedOutput = Artifact(
        id: "artifact-lane-focus-hidden",
        workspaceId: workspace.id,
        workItemId: focusedOutputItem.id,
        kind: .commandOutputSummary,
        title: "Hidden output target",
        uri: "pikiclaw://runs/run-lane-focus-hidden/output",
        status: .ready,
        provenance: "Ready",
        createdAt: Date(timeIntervalSince1970: 10)
    )
    let visibleCodexHandoffRun = AgentRun(
        id: "run-lane-focus-visible-codex",
        workItemId: visibleHandoffItem.id,
        workspaceId: workspace.id,
        agentProfileId: codex.id,
        state: .completed,
        startedAt: Date(timeIntervalSince1970: 300),
        promptSnapshot: "Codex visible handoff"
    )
    let visibleClaudeHandoffRun = AgentRun(
        id: "run-lane-focus-visible-claude",
        workItemId: visibleHandoffItem.id,
        workspaceId: workspace.id,
        agentProfileId: claude.id,
        state: .completed,
        startedAt: Date(timeIntervalSince1970: 320),
        promptSnapshot: "Claude visible handoff"
    )
    let focusedCodexHandoffRun = AgentRun(
        id: "run-lane-focus-hidden-codex",
        workItemId: focusedHandoffItem.id,
        workspaceId: workspace.id,
        agentProfileId: codex.id,
        state: .completed,
        startedAt: Date(timeIntervalSince1970: 100),
        promptSnapshot: "Codex hidden handoff"
    )
    let focusedClaudeHandoffRun = AgentRun(
        id: "run-lane-focus-hidden-claude",
        workItemId: focusedHandoffItem.id,
        workspaceId: workspace.id,
        agentProfileId: claude.id,
        state: .completed,
        startedAt: Date(timeIntervalSince1970: 120),
        promptSnapshot: "Claude hidden handoff"
    )
    let snapshot = NativeStoreSnapshot(
        workspaces: [workspace],
        workItems: [chatItem, visibleOutputItem, focusedOutputItem, visibleHandoffItem, focusedHandoffItem],
        runs: [
            visibleChatRun,
            focusedChatRun,
            visibleCodexHandoffRun,
            visibleClaudeHandoffRun,
            focusedCodexHandoffRun,
            focusedClaudeHandoffRun
        ],
        artifacts: [visibleOutput, focusedOutput],
        agentProfiles: [codex, claude]
    )

    let pinnedRuns = missionFollowUpLanePinnedRuns(
        [visibleChatRun],
        focusTarget: .chat(
            runId: focusedChatRun.id,
            workspaceId: workspace.id,
            workItemId: chatItem.id,
            title: chatItem.title
        ),
        snapshot: snapshot
    )
    #expect(pinnedRuns.map(\.id) == [focusedChatRun.id, visibleChatRun.id])
    #expect(missionFollowUpLaneTargetMatchesRun(.chat(
        runId: focusedChatRun.id,
        workspaceId: workspace.id,
        workItemId: chatItem.id,
        title: chatItem.title
    ), run: focusedChatRun))

    let visibleOutputTargets = artifactReviewMissionTargets(snapshot: snapshot, limit: 1)
    #expect(visibleOutputTargets.map(\.artifactId) == [visibleOutput.id])
    let pinnedOutputTargets = missionFollowUpLanePinnedArtifactReviewTargets(
        visibleOutputTargets,
        focusTarget: .output(
            artifactId: focusedOutput.id,
            workspaceId: workspace.id,
            workItemId: focusedOutputItem.id,
            title: focusedOutput.title
        ),
        snapshot: snapshot
    )
    #expect(pinnedOutputTargets.map(\.artifactId) == [focusedOutput.id, visibleOutput.id])

    let visibleHandoffItems = missionAgentHandoffTrailItems(snapshot: snapshot, limit: 1)
    #expect(visibleHandoffItems.map(\.workItemId) == [visibleHandoffItem.id])
    let pinnedHandoffItems = missionFollowUpLanePinnedHandoffItems(
        visibleHandoffItems,
        focusTarget: .handoff(
            workItemId: focusedHandoffItem.id,
            workspaceId: workspace.id,
            title: focusedHandoffItem.title
        ),
        snapshot: snapshot
    )
    #expect(pinnedHandoffItems.map(\.workItemId) == [focusedHandoffItem.id, visibleHandoffItem.id])
}

@Test func artifactReviewMissionTargetFallsBackToNewestReadyOutput() throws {
    let item = WorkItem(
        id: "workitem-review-target-ready-only",
        workspaceId: "workspace-review-target-ready-only",
        title: "Ready only output",
        sourceType: .manualPrompt
    )
    let olderReady = Artifact(
        id: "artifact-review-target-ready-older",
        workspaceId: item.workspaceId,
        workItemId: item.id,
        kind: .commandOutputSummary,
        title: "Older ready output",
        uri: "pikiclaw://runs/run-review-target/ready-older",
        status: .ready,
        provenance: "Ready",
        createdAt: Date(timeIntervalSince1970: 10)
    )
    let newerReady = Artifact(
        id: "artifact-review-target-ready-newer",
        workspaceId: item.workspaceId,
        workItemId: item.id,
        kind: .verificationResult,
        title: "Newer ready output",
        uri: "pikiclaw://runs/run-review-target/ready-newer",
        status: .ready,
        provenance: "Ready",
        createdAt: Date(timeIntervalSince1970: 20)
    )
    let resolved = Artifact(
        id: "artifact-review-target-resolved",
        workspaceId: item.workspaceId,
        workItemId: item.id,
        kind: .verificationResult,
        title: "Resolved output",
        uri: "pikiclaw://runs/run-review-target/resolved",
        status: .verified,
        provenance: "Resolved",
        createdAt: Date(timeIntervalSince1970: 30),
        sourceRefs: [
            SourceRef(kind: "artifact-resolution", label: ArtifactBranchResolution.resolved.rawValue)
        ]
    )
    let snapshot = NativeStoreSnapshot(
        workItems: [item],
        artifacts: [olderReady, newerReady, resolved]
    )

    let target = try #require(artifactReviewMissionTarget(snapshot: snapshot))

    #expect(target.artifactId == newerReady.id)
    #expect(target.workItemId == item.id)
    #expect(target.kind == .unreviewed)
    #expect(target.title == "Newer ready output")
    #expect(target.workItemTitle == "Ready only output")
}

@Test func artifactReviewMissionTargetsLimitKeepsGlobalReviewOrder() {
    let blockedItem = WorkItem(
        id: "workitem-review-list-blocked",
        workspaceId: "workspace-review-list",
        title: "Blocked list item",
        sourceType: .manualPrompt
    )
    let followUpItem = WorkItem(
        id: "workitem-review-list-follow-up",
        workspaceId: "workspace-review-list",
        title: "Follow-up list item",
        sourceType: .goal
    )
    let readyItem = WorkItem(
        id: "workitem-review-list-ready",
        workspaceId: "workspace-review-list",
        title: "Ready list item",
        sourceType: .jira
    )
    let newerBlocked = Artifact(
        id: "artifact-review-list-blocked-newer",
        workspaceId: blockedItem.workspaceId,
        workItemId: blockedItem.id,
        kind: .commandOutputSummary,
        title: "Newer blocked output",
        uri: "pikiclaw://runs/run-review-list/blocked-newer",
        status: .failed,
        provenance: "Blocked",
        createdAt: Date(timeIntervalSince1970: 50),
        sourceRefs: [
            SourceRef(kind: "artifact-resolution", label: ArtifactBranchResolution.blocked.rawValue)
        ]
    )
    let olderBlocked = Artifact(
        id: "artifact-review-list-blocked-older",
        workspaceId: blockedItem.workspaceId,
        workItemId: blockedItem.id,
        kind: .commandOutputSummary,
        title: "Older blocked output",
        uri: "pikiclaw://runs/run-review-list/blocked-older",
        status: .failed,
        provenance: "Blocked",
        createdAt: Date(timeIntervalSince1970: 40),
        sourceRefs: [
            SourceRef(kind: "artifact-resolution", label: ArtifactBranchResolution.blocked.rawValue)
        ]
    )
    let followUp = Artifact(
        id: "artifact-review-list-follow-up",
        workspaceId: followUpItem.workspaceId,
        workItemId: followUpItem.id,
        kind: .commandOutputSummary,
        title: "Follow-up output",
        uri: "pikiclaw://runs/run-review-list/follow-up",
        status: .ready,
        provenance: "Needs follow-up",
        createdAt: Date(timeIntervalSince1970: 60),
        sourceRefs: [
            SourceRef(kind: "artifact-resolution", label: ArtifactBranchResolution.needsFollowUp.rawValue)
        ]
    )
    let ready = Artifact(
        id: "artifact-review-list-ready",
        workspaceId: readyItem.workspaceId,
        workItemId: readyItem.id,
        kind: .verificationResult,
        title: "Ready output",
        uri: "pikiclaw://runs/run-review-list/ready",
        status: .ready,
        provenance: "Ready",
        createdAt: Date(timeIntervalSince1970: 70)
    )
    let resolved = Artifact(
        id: "artifact-review-list-resolved",
        workspaceId: readyItem.workspaceId,
        workItemId: readyItem.id,
        kind: .verificationResult,
        title: "Resolved output",
        uri: "pikiclaw://runs/run-review-list/resolved",
        status: .verified,
        provenance: "Resolved",
        createdAt: Date(timeIntervalSince1970: 80),
        sourceRefs: [
            SourceRef(kind: "artifact-resolution", label: ArtifactBranchResolution.resolved.rawValue)
        ]
    )
    let snapshot = NativeStoreSnapshot(
        workItems: [readyItem, followUpItem, blockedItem],
        artifacts: [ready, resolved, followUp, olderBlocked, newerBlocked]
    )

    let targets = artifactReviewMissionTargets(snapshot: snapshot, limit: 3)

    #expect(targets.map(\.artifactId) == [
        newerBlocked.id,
        olderBlocked.id,
        followUp.id
    ])
    #expect(targets.map(\.kind) == [.blocked, .blocked, .needsFollowUp])
    #expect(targets.map(\.workItemTitle) == [
        "Blocked list item",
        "Blocked list item",
        "Follow-up list item"
    ])
}

@Test func artifactReviewMissionTargetBuildsSideChatStartFromSourceRun() throws {
    let item = WorkItem(
        id: "workitem-review-sidechat",
        workspaceId: "workspace-review-sidechat",
        title: "IVAS-9072: Review saved output",
        sourceType: .jira,
        state: .review,
        jira: JiraWorkItemFields(key: "IVAS-9072", status: "In Review")
    )
    let sourceRun = AgentRun(
        id: "run-review-sidechat-source",
        workItemId: item.id,
        workspaceId: item.workspaceId,
        agentProfileId: "agent-review-sidechat",
        state: .completed,
        promptSnapshot: "Prepare Jira update evidence",
        transcript: "Jira update evidence is ready."
    )
    let artifact = Artifact(
        id: "artifact-review-sidechat",
        workspaceId: item.workspaceId,
        workItemId: item.id,
        runId: sourceRun.id,
        kind: .commandOutputSummary,
        title: "Saved Jira update evidence",
        uri: "pikiclaw://artifacts/artifact-review-sidechat",
        status: .ready,
        provenance: """
        Jira update:
        Status: validation passed
        Next action: review and post the update
        """
    )
    let orphanArtifact = Artifact(
        id: "artifact-review-sidechat-orphan",
        workspaceId: item.workspaceId,
        workItemId: item.id,
        kind: .commandOutputSummary,
        title: "Orphan output",
        uri: "pikiclaw://artifacts/artifact-review-sidechat-orphan",
        status: .ready,
        provenance: "Ready but no source run.",
        createdAt: Date(timeIntervalSince1970: 1)
    )
    let snapshot = NativeStoreSnapshot(
        workItems: [item],
        runs: [sourceRun],
        artifacts: [orphanArtifact, artifact]
    )

    let target = try #require(artifactReviewMissionTarget(snapshot: snapshot))
    let start = try #require(artifactReviewMissionSideChatStart(target: target, snapshot: snapshot))
    let orphanTarget = try #require(artifactReviewMissionTargets(snapshot: snapshot, limit: 2).last)

    #expect(target.artifactId == artifact.id)
    #expect(target.sourceRunId == sourceRun.id)
    #expect(start.parentRunId == sourceRun.id)
    #expect(start.workspaceId == sourceRun.workspaceId)
    #expect(start.workItemId == item.id)
    #expect(start.permissionMode == .readOnly)
    #expect(start.followUpLabel == "Jira - Read-only update")
    #expect(start.prompt.contains("Prepare a Jira-ready update"))
    #expect(start.prompt.contains("Saved output:"))
    #expect(start.prompt.contains("Saved Jira update evidence"))
    #expect(orphanTarget.artifactId == orphanArtifact.id)
    #expect(orphanTarget.sourceRunId == nil)
    #expect(artifactReviewMissionSideChatStart(target: orphanTarget, snapshot: snapshot) == nil)
}

@MainActor
@Test func artifactReviewMissionTargetResolvedInlineLeavesReviewQueue() async throws {
    let directory = URL(fileURLWithPath: NSTemporaryDirectory())
        .appendingPathComponent("pikiclaw-mission-output-resolve-\(UUID().uuidString)", isDirectory: true)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: directory) }

    let workspace = Workspace(
        id: "workspace-mission-output-resolve",
        name: "Mission Output Resolve",
        pathDisplay: directory.path,
        trustState: .trusted
    )
    let item = WorkItem(
        id: "workitem-mission-output-resolve",
        workspaceId: workspace.id,
        title: "Resolve output from Mission Control",
        sourceType: .manualPrompt
    )
    let artifact = Artifact(
        id: "artifact-mission-output-resolve",
        workspaceId: workspace.id,
        workItemId: item.id,
        kind: .commandOutputSummary,
        title: "Ready output to resolve",
        uri: "pikiclaw://runs/run-mission-output-resolve/evidence",
        status: .ready,
        provenance: "Ready for Mission Control review"
    )
    let seed = NativeAppSeed(
        projects: [],
        workspaces: [workspace],
        workItems: [item],
        runs: [],
        artifacts: [artifact],
        capabilities: [],
        knowledgeCards: [],
        automations: [],
        agentProfiles: [],
        providerProfiles: []
    )
    let store = JSONNativeStore(fileURL: directory.appendingPathComponent("state.json"), seed: seed)
    let model = NativeAppModel(store: store)
    await model.reload()

    #expect(artifactReviewMissionTarget(snapshot: model.snapshot)?.artifactId == artifact.id)
    #expect(await model.markArtifactBranchResolution(
        artifactId: artifact.id,
        resolution: .resolved
    ))

    let snapshot = try await store.loadSnapshot()
    let resolvedArtifact = try #require(snapshot.artifacts.first(where: { $0.id == artifact.id }))

    #expect(artifactReviewMissionTargets(snapshot: snapshot).isEmpty)
    #expect(artifactBranchResolution(resolvedArtifact) == .resolved)
    #expect(resolvedArtifact.status == .verified)
    #expect(model.statusLine == "Artifact marked resolved")
}

@MainActor
@Test func dismissArtifactReviewHidesMissionTargetWithoutResolvingOutput() async throws {
    let directory = URL(fileURLWithPath: NSTemporaryDirectory())
        .appendingPathComponent("pikiclaw-mission-output-dismiss-\(UUID().uuidString)", isDirectory: true)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: directory) }

    let workspace = Workspace(
        id: "workspace-mission-output-dismiss",
        name: "Mission Output Dismiss",
        pathDisplay: directory.path,
        trustState: .trusted
    )
    let item = WorkItem(
        id: "workitem-mission-output-dismiss",
        workspaceId: workspace.id,
        title: "Dismiss output from Mission Control",
        sourceType: .manualPrompt
    )
    let artifact = Artifact(
        id: "artifact-mission-output-dismiss",
        workspaceId: workspace.id,
        workItemId: item.id,
        kind: .commandOutputSummary,
        title: "Ready output to dismiss",
        uri: "pikiclaw://runs/run-mission-output-dismiss/evidence",
        status: .ready,
        provenance: "Ready but acknowledged from Mission Control"
    )
    let seed = NativeAppSeed(
        projects: [],
        workspaces: [workspace],
        workItems: [item],
        runs: [],
        artifacts: [artifact],
        capabilities: [],
        knowledgeCards: [],
        automations: [],
        agentProfiles: [],
        providerProfiles: []
    )
    let store = JSONNativeStore(fileURL: directory.appendingPathComponent("state.json"), seed: seed)
    let model = NativeAppModel(store: store)
    await model.reload()

    #expect(artifactReviewMissionTarget(snapshot: model.snapshot)?.artifactId == artifact.id)
    #expect(await model.dismissArtifactReview(artifactId: artifact.id))

    let snapshot = try await store.loadSnapshot()
    let dismissedArtifact = try #require(snapshot.artifacts.first(where: { $0.id == artifact.id }))
    let summary = artifactReviewMissionSummary(snapshot.artifacts)

    #expect(artifactReviewMissionTargets(snapshot: snapshot).isEmpty)
    #expect(artifactMissionReviewDismissed(dismissedArtifact))
    #expect(artifactBranchResolution(dismissedArtifact) == nil)
    #expect(dismissedArtifact.status == .ready)
    #expect(summary.totalCount == 0)
    #expect(summary.attentionCount == 0)
    #expect(model.statusLine == "Output hidden from Mission Control")
    #expect(snapshot.auditEvents.contains { $0.summary == "Dismissed output Ready output to dismiss from Mission Control" })
}

@Test func artifactSideChatLineageSummarizesReviewBranches() throws {
    let item = WorkItem(
        id: "workitem-output-lineage",
        workspaceId: "workspace-output-lineage",
        title: "Track artifact review branches"
    )
    let parent = AgentRun(
        id: "run-output-lineage-parent",
        workItemId: item.id,
        workspaceId: item.workspaceId,
        agentProfileId: "agent-output-lineage",
        state: .completed,
        sideChatRunIds: [
            "run-output-lineage-review",
            "run-output-lineage-validate"
        ],
        promptSnapshot: "Capture artifact evidence"
    )
    let review = AgentRun(
        id: "run-output-lineage-review",
        workItemId: item.id,
        workspaceId: item.workspaceId,
        agentProfileId: "agent-output-lineage",
        state: .completed,
        sideChatOfRunId: parent.id,
        promptSnapshot: "Review saved artifact",
        contextRefs: [
            ContextRef(kind: "follow-up", label: "Review - Read-only review")
        ]
    )
    let validate = AgentRun(
        id: "run-output-lineage-validate",
        workItemId: item.id,
        workspaceId: item.workspaceId,
        agentProfileId: "agent-output-lineage",
        state: .completed,
        sideChatOfRunId: parent.id,
        promptSnapshot: "Validate saved artifact",
        contextRefs: [
            ContextRef(kind: "follow-up", label: "Validate - Validate only")
        ]
    )
    let parentArtifact = Artifact(
        id: "artifact-output-lineage-parent",
        workspaceId: item.workspaceId,
        workItemId: item.id,
        runId: parent.id,
        kind: .commandOutputSummary,
        title: "Parent evidence",
        uri: "pikiclaw://runs/run-output-lineage-parent/evidence",
        status: .ready,
        provenance: "Parent output"
    )
    let branchArtifact = Artifact(
        id: "artifact-output-lineage-branch",
        workspaceId: item.workspaceId,
        workItemId: item.id,
        runId: validate.id,
        kind: .verificationResult,
        title: "Branch validation",
        uri: "pikiclaw://runs/run-output-lineage-validate/evidence",
        status: .verified,
        provenance: "Branch output"
    )
    let snapshot = NativeStoreSnapshot(
        workItems: [item],
        runs: [parent, review, validate],
        artifacts: [parentArtifact, branchArtifact]
    )

    let parentLineage = try #require(artifactSideChatLineage(
        artifact: parentArtifact,
        sourceRun: parent,
        snapshot: snapshot
    ))
    let branchLineage = try #require(artifactSideChatLineage(
        artifact: branchArtifact,
        sourceRun: validate,
        snapshot: snapshot
    ))

    #expect(parentLineage.title == "2 branches")
    #expect(parentLineage.detail == "Review - Read-only review, Validate - Validate only")
    #expect(parentLineage.symbol == "arrow.triangle.branch")
    #expect(parentLineage.help == "Open the Review - Read-only review side chat transcript.")
    #expect(parentLineage.targetRunId == review.id)
    #expect(artifactLineageTargetRun(parentLineage, snapshot: snapshot)?.id == review.id)
    #expect(branchLineage.title == "Branch")
    #expect(branchLineage.detail == "Validate - Validate only from Capture artifact evidence")
    #expect(branchLineage.help == "Open the Validate - Validate only side chat transcript.")
    #expect(branchLineage.targetRunId == validate.id)
    #expect(artifactLineageTargetRun(branchLineage, snapshot: snapshot)?.id == validate.id)
}

@MainActor
@Test func artifactBranchResolutionMarksReviewDecision() async throws {
    let directory = URL(fileURLWithPath: NSTemporaryDirectory())
        .appendingPathComponent("pikiclaw-artifact-resolution-\(UUID().uuidString)", isDirectory: true)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: directory) }

    let workspace = Workspace(
        id: "workspace-artifact-resolution",
        name: "Artifact Resolution",
        pathDisplay: directory.path,
        trustState: .trusted
    )
    let agent = AgentProfile(
        id: "agent-artifact-resolution",
        kind: .codex,
        displayName: "Codex",
        executableName: "codex",
        isEnabled: true
    )
    let item = WorkItem(
        id: "workitem-artifact-resolution",
        workspaceId: workspace.id,
        title: "Review saved artifact",
        state: .review
    )
    let parent = AgentRun(
        id: "run-artifact-resolution-parent",
        workItemId: item.id,
        workspaceId: workspace.id,
        agentProfileId: agent.id,
        state: .completed,
        sideChatRunIds: ["run-artifact-resolution-review"],
        promptSnapshot: "Capture output"
    )
    let review = AgentRun(
        id: "run-artifact-resolution-review",
        workItemId: item.id,
        workspaceId: workspace.id,
        agentProfileId: agent.id,
        state: .completed,
        sideChatOfRunId: parent.id,
        promptSnapshot: "Review output",
        contextRefs: [
            ContextRef(kind: "follow-up", label: "Review - Read-only review")
        ]
    )
    let artifact = Artifact(
        id: "artifact-resolution-output",
        workspaceId: workspace.id,
        workItemId: item.id,
        runId: parent.id,
        kind: .commandOutputSummary,
        title: "Evidence: branch review",
        uri: "pikiclaw://runs/run-artifact-resolution-parent/evidence",
        status: .ready,
        provenance: "Captured output"
    )
    let seed = NativeAppSeed(
        projects: [],
        workspaces: [workspace],
        workItems: [item],
        runs: [parent, review],
        artifacts: [artifact],
        capabilities: [],
        knowledgeCards: [],
        automations: [],
        agentProfiles: [agent],
        providerProfiles: []
    )
    let store = JSONNativeStore(fileURL: directory.appendingPathComponent("state.json"), seed: seed)
    let model = NativeAppModel(store: store)
    await model.reload()

    #expect(await model.markArtifactBranchResolution(
        artifactId: artifact.id,
        resolution: .resolved,
        branchRunId: review.id
    ))

    var snapshot = try await store.loadSnapshot()
    let resolvedArtifact = try #require(snapshot.artifacts.first(where: { $0.id == artifact.id }))
    #expect(resolvedArtifact.status == .verified)
    #expect(resolvedArtifact.verifiedAt != nil)
    #expect(resolvedArtifact.provenance.contains("Branch decision: Resolved via Review - Read-only review."))
    #expect(resolvedArtifact.sourceRefs.contains(SourceRef(
        kind: "artifact-resolution",
        label: ArtifactBranchResolution.resolved.rawValue,
        uri: "pikiclaw://runs/run-artifact-resolution-review"
    )))
    #expect(artifactBranchResolution(resolvedArtifact) == .resolved)

    #expect(await model.markArtifactBranchResolution(
        artifactId: artifact.id,
        resolution: .blocked,
        branchRunId: review.id
    ))

    snapshot = try await store.loadSnapshot()
    let blockedArtifact = try #require(snapshot.artifacts.first(where: { $0.id == artifact.id }))
    let resolutionRefs = blockedArtifact.sourceRefs.filter { $0.kind == "artifact-resolution" }
    #expect(blockedArtifact.status == .failed)
    #expect(blockedArtifact.verifiedAt == nil)
    #expect(blockedArtifact.provenance.contains("Branch decision: Blocked via Review - Read-only review."))
    #expect(blockedArtifact.provenance.contains("Branch decision: Resolved") == false)
    #expect(resolutionRefs == [
        SourceRef(
            kind: "artifact-resolution",
            label: ArtifactBranchResolution.blocked.rawValue,
            uri: "pikiclaw://runs/run-artifact-resolution-review"
        )
    ])
    #expect(artifactBranchResolution(blockedArtifact) == .blocked)
    #expect(model.statusLine == "Artifact marked blocked")
    #expect(snapshot.auditEvents.contains { $0.summary == "Blocked artifact Evidence: branch review" })
}

@Test func artifactClipboardSummaryPreservesWorkItemRunAndRefs() {
    let item = WorkItem(
        id: "workitem-output-copy",
        workspaceId: "workspace-output-copy",
        title: "IVAS-9003: Copy evidence",
        sourceType: .jira,
        sourceRefs: [
            SourceRef(kind: "jira", label: "IVAS-9003", uri: "https://jira.example/browse/IVAS-9003")
        ]
    )
    let run = AgentRun(
        id: "run-output-copy",
        workItemId: item.id,
        workspaceId: item.workspaceId,
        agentProfileId: "agent-output-copy",
        state: .failed,
        promptSnapshot: "Review failed sync"
    )
    let artifact = Artifact(
        id: "artifact-output-copy",
        workspaceId: item.workspaceId,
        workItemId: item.id,
        runId: run.id,
        kind: .commandOutputSummary,
        title: "Evidence: failed sync",
        uri: "pikiclaw://runs/run-output-copy/evidence",
        status: .failed,
        provenance: "Captured from failed chat output: queue sync failed",
        sourceRefs: [
            SourceRef(kind: "chat-run", label: "Review failed sync", uri: "pikiclaw://runs/run-output-copy"),
            SourceRef(kind: "jira", label: "IVAS-9003", uri: "https://jira.example/browse/IVAS-9003")
        ]
    )

    let summary = artifactClipboardSummary(artifact: artifact, run: run, workItem: item)

    #expect(summary.contains("Output: Evidence: failed sync"))
    #expect(summary.contains("Work item: IVAS-9003: Copy evidence"))
    #expect(summary.contains("Source chat: Review failed sync"))
    #expect(summary.contains("Captured from failed chat output"))
    #expect(summary.components(separatedBy: "[jira] IVAS-9003").count == 2)
}

@Test func artifactFollowUpPromptCarriesStructuredSignalsFromSavedOutput() {
    let item = WorkItem(
        id: "workitem-output-signals",
        workspaceId: "workspace-output-signals",
        title: "IVAS-9006: Continue saved output",
        sourceType: .jira,
        jira: JiraWorkItemFields(key: "IVAS-9006", status: "In Progress")
    )
    let run = AgentRun(
        id: "run-output-signals",
        workItemId: item.id,
        workspaceId: item.workspaceId,
        agentProfileId: "agent-output-signals",
        state: .completed,
        promptSnapshot: "Summarize saved output"
    )
    let artifact = Artifact(
        id: "artifact-output-signals",
        workspaceId: item.workspaceId,
        workItemId: item.id,
        runId: run.id,
        kind: .commandOutputSummary,
        title: "Evidence: saved output signals",
        uri: "pikiclaw://runs/run-output-signals/evidence",
        status: .ready,
        provenance: """
        Decision: not ready to post Jira done until validation is copied.
        Blockers:
        - waiting for Jira write permission.
        Risk: full app smoke has not run.
        复现步骤：
        - 打开 Jira ticket 后点击 Start。
        根因：detailTab 没有传入 Jira 工作区。
        Validation: swift test --filter ChatMessageHistoryTests passed
        Next command: `git status --short`
        """
    )

    let summary = artifactClipboardSummary(artifact: artifact, run: run, workItem: item)
    let prompt = artifactFollowUpPrompt(artifact: artifact, run: run, workItem: item)

    #expect(summary.contains("Output signals:"))
    #expect(summary.contains("Decision signals: Decision: not ready to post Jira done until validation is copied."))
    #expect(summary.contains("Actionable notes: Blocker: waiting for Jira write permission.; Risk: full app smoke has not run."))
    #expect(summary.contains("Reproduction notes: Steps: 打开 Jira ticket 后点击 Start。"))
    #expect(summary.contains("Diagnosis notes: Root cause: detailTab 没有传入 Jira 工作区。"))
    #expect(summary.contains("Validation evidence: swift test --filter ChatMessageHistoryTests (passed)"))
    #expect(summary.contains("Next commands: git status --short"))
    #expect(prompt.contains("Output signals:"))
    #expect(prompt.contains("Actionable notes: Blocker: waiting for Jira write permission.; Risk: full app smoke has not run."))
    #expect(prompt.contains("Diagnosis notes: Root cause: detailTab 没有传入 Jira 工作区。"))
    #expect(prompt.contains("Next commands: git status --short"))
    #expect(prompt.contains("Evidence:"))
}

@Test func artifactFollowUpPromptSpecializesJiraAndGenericWork() {
    let jiraItem = WorkItem(
        id: "workitem-output-jira-follow-up",
        workspaceId: "workspace-output-follow-up",
        title: "IVAS-9004: Publish evidence",
        sourceType: .jira,
        sourceRefs: [
            SourceRef(kind: "jira", label: "IVAS-9004", uri: "https://jira.example/browse/IVAS-9004")
        ],
        jira: JiraWorkItemFields(key: "IVAS-9004", status: "In Progress")
    )
    let manualItem = WorkItem(
        id: "workitem-output-manual-follow-up",
        workspaceId: "workspace-output-follow-up",
        title: "Improve output workflow",
        sourceType: .manualPrompt
    )
    let run = AgentRun(
        id: "run-output-follow-up",
        workItemId: jiraItem.id,
        workspaceId: jiraItem.workspaceId,
        agentProfileId: "agent-output-follow-up",
        state: .completed,
        promptSnapshot: "Summarize validation"
    )
    let artifact = Artifact(
        id: "artifact-output-follow-up",
        workspaceId: jiraItem.workspaceId,
        workItemId: jiraItem.id,
        runId: run.id,
        kind: .commandOutputSummary,
        title: "Evidence: validation passed",
        uri: "pikiclaw://runs/run-output-follow-up/evidence",
        status: .ready,
        provenance: "Captured validation evidence"
    )

    let jiraPrompt = artifactFollowUpPrompt(artifact: artifact, run: run, workItem: jiraItem)
    let manualPrompt = artifactFollowUpPrompt(artifact: artifact, run: run, workItem: manualItem)
    let reviewArtifact = Artifact(
        id: "artifact-output-review-follow-up",
        workspaceId: manualItem.workspaceId,
        workItemId: manualItem.id,
        runId: run.id,
        kind: .reviewComment,
        title: "MR review findings",
        uri: "pikiclaw://runs/run-output-follow-up/review",
        status: .draft,
        provenance: "Finding: missing validation for retry flow."
    )
    let reviewPrompt = artifactFollowUpPrompt(artifact: reviewArtifact, run: run, workItem: manualItem)

    #expect(jiraPrompt.contains("Prepare a Jira-ready update"))
    #expect(jiraPrompt.contains("paste as a Jira comment"))
    #expect(jiraPrompt.contains("Output: Evidence: validation passed"))
    #expect(reviewPrompt.contains("Prepare an MR-ready review note"))
    #expect(reviewPrompt.contains("actionable findings and risk"))
    #expect(reviewPrompt.contains("merge request review"))
    #expect(reviewPrompt.contains("Finding: missing validation for retry flow."))
    #expect(manualPrompt.contains("Continue from this saved output"))
    #expect(manualPrompt.contains("next highest-leverage action"))
    #expect(manualPrompt.contains("preserve source refs"))
}

@Test func artifactFollowUpActionUsesUnifiedRunActionContracts() {
    let jiraItem = WorkItem(
        id: "workitem-output-action-jira",
        workspaceId: "workspace-output-action",
        title: "IVAS-9050: Publish saved validation",
        sourceType: .jira,
        jira: JiraWorkItemFields(key: "IVAS-9050", status: "In Progress")
    )
    let manualItem = WorkItem(
        id: "workitem-output-action-manual",
        workspaceId: "workspace-output-action",
        title: "Unify saved output actions",
        sourceType: .manualPrompt
    )
    let run = AgentRun(
        id: "run-output-action",
        workItemId: jiraItem.id,
        workspaceId: jiraItem.workspaceId,
        agentProfileId: "agent-output-action",
        state: .completed,
        promptSnapshot: "Capture saved output actions"
    )

    let jiraArtifact = Artifact(
        id: "artifact-output-action-jira",
        workspaceId: jiraItem.workspaceId,
        workItemId: jiraItem.id,
        runId: run.id,
        kind: .commandOutputSummary,
        title: "Evidence: Jira update ready",
        uri: "pikiclaw://runs/run-output-action/evidence",
        status: .ready,
        provenance: "Jira update: validation passed; waiting for write permission."
    )
    let genericArtifact = Artifact(
        id: "artifact-output-action-generic",
        workspaceId: manualItem.workspaceId,
        workItemId: manualItem.id,
        runId: run.id,
        kind: .commandOutputSummary,
        title: "Evidence: next step offered",
        uri: "pikiclaw://runs/run-output-action/generic",
        status: .ready,
        provenance: "Next action: continue with the smallest UI follow-up."
    )
    let failedArtifact = Artifact(
        id: "artifact-output-action-failed",
        workspaceId: manualItem.workspaceId,
        workItemId: manualItem.id,
        runId: run.id,
        kind: .commandOutputSummary,
        title: "Evidence: command failed",
        uri: "pikiclaw://runs/run-output-action/failed",
        status: .failed,
        provenance: "error: native output rail follow-up failed"
    )
    let validationArtifact = Artifact(
        id: "artifact-output-action-validation",
        workspaceId: manualItem.workspaceId,
        workItemId: manualItem.id,
        runId: run.id,
        kind: .verificationResult,
        title: "Validation passed",
        uri: "pikiclaw://runs/run-output-action/validation",
        status: .verified,
        provenance: "Validation: swift test --filter ChatMessageHistoryTests passed"
    )
    let jiraBugArtifact = Artifact(
        id: "artifact-output-action-jira-bug",
        workspaceId: jiraItem.workspaceId,
        workItemId: jiraItem.id,
        runId: run.id,
        kind: .commandOutputSummary,
        title: "Evidence: Chinese bug diagnosis",
        uri: "pikiclaw://runs/run-output-action/jira-bug",
        status: .ready,
        provenance: """
        复现步骤：
        - 打开 Jira ticket 后点击 Start。
        根因：detailTab 没有传入 Jira 工作区。
        修复方案：把 detailTab 绑定到 JiraWorkQueueView。
        """
    )
    let skillArtifact = Artifact(
        id: "artifact-output-action-skill",
        workspaceId: jiraItem.workspaceId,
        workItemId: jiraItem.id,
        runId: run.id,
        kind: .commandOutputSummary,
        title: "Evidence: skill recovery",
        uri: "pikiclaw://runs/run-output-action/skill",
        status: .ready,
        provenance: "技能 /logtrace 执行失败：缺少 IVA_LOGTRACER_ENV_FILE，需要修复 skill invocation。"
    )
    let titleOnlySkillArtifact = Artifact(
        id: "artifact-output-action-title-skill",
        workspaceId: jiraItem.workspaceId,
        workItemId: jiraItem.id,
        runId: run.id,
        kind: .commandOutputSummary,
        title: "Skill /logtrace failed",
        uri: "pikiclaw://runs/run-output-action/title-skill",
        status: .ready,
        provenance: ""
    )
    let sourceRefTraceArtifact = Artifact(
        id: "artifact-output-action-source-trace",
        workspaceId: manualItem.workspaceId,
        workItemId: manualItem.id,
        runId: run.id,
        kind: .commandOutputSummary,
        title: "Evidence: source trace",
        uri: "pikiclaw://runs/run-output-action/source-trace",
        status: .ready,
        provenance: "",
        sourceRefs: [
            SourceRef(
                kind: "trace",
                label: "traceparent",
                uri: "00-4a0031017ceb19eab6d3a39468a20000-0123456789abcdef-01"
            )
        ]
    )
    let explicitFieldTraceArtifact = Artifact(
        id: "artifact-output-action-explicit-trace",
        workspaceId: manualItem.workspaceId,
        workItemId: manualItem.id,
        runId: run.id,
        kind: .commandOutputSummary,
        title: "Evidence: explicit trace fields",
        uri: "pikiclaw://runs/run-output-action/explicit-trace",
        status: .ready,
        provenance: "trace_id=4a0031017ceb19eab6d3a39468a20000 request-id req-voice-123 turn_id turn-voice-456"
    )
    let bareHexArtifact = Artifact(
        id: "artifact-output-action-bare-hex",
        workspaceId: manualItem.workspaceId,
        workItemId: manualItem.id,
        runId: run.id,
        kind: .commandOutputSummary,
        title: "Evidence: raw copied value",
        uri: "pikiclaw://runs/run-output-action/raw-value",
        status: .ready,
        provenance: "4a0031017ceb19eab6d3a39468a20000"
    )
    let jiraPatchArtifact = Artifact(
        id: "artifact-output-action-jira-patch",
        workspaceId: jiraItem.workspaceId,
        workItemId: jiraItem.id,
        runId: run.id,
        kind: .patch,
        title: "Patch: Jira fix",
        uri: "pikiclaw://runs/run-output-action/patch",
        status: .draft,
        provenance: "Patch updates the Jira detail workspace binding."
    )

    let jiraAction = artifactFollowUpAction(artifact: jiraArtifact, run: run, workItem: jiraItem)
    let genericAction = artifactFollowUpAction(artifact: genericArtifact, run: run, workItem: manualItem)
    let failedAction = artifactFollowUpAction(artifact: failedArtifact, run: run, workItem: manualItem)
    let validationAction = artifactFollowUpAction(artifact: validationArtifact, run: run, workItem: manualItem)
    let jiraBugAction = artifactFollowUpAction(artifact: jiraBugArtifact, run: run, workItem: jiraItem)
    let skillAction = artifactFollowUpAction(artifact: skillArtifact, run: run, workItem: jiraItem)
    let titleOnlySkillAction = artifactFollowUpAction(artifact: titleOnlySkillArtifact, run: run, workItem: jiraItem)
    let sourceRefTraceAction = artifactFollowUpAction(artifact: sourceRefTraceArtifact, run: run, workItem: manualItem)
    let explicitFieldTraceAction = artifactFollowUpAction(artifact: explicitFieldTraceArtifact, run: run, workItem: manualItem)
    let bareHexAction = artifactFollowUpAction(artifact: bareHexArtifact, run: run, workItem: manualItem)
    let jiraPatchAction = artifactFollowUpAction(artifact: jiraPatchArtifact, run: run, workItem: jiraItem)

    #expect(jiraAction.id == "jira-update")
    #expect(jiraAction.title == "Jira")
    #expect(jiraAction.detail == "Read-only update")
    #expect(jiraAction.workflowLabel == "Write-back")
    #expect(jiraAction.workflowSummary == "Prepare status, evidence, validation, blockers, and next action")
    #expect(jiraAction.permissionMode == .readOnly)
    #expect(jiraAction.isGeneratedUI == false)
    #expect(jiraAction.prompt.contains("Output contract:"))
    #expect(jiraAction.prompt.contains("paste-ready Jira comment"))
    #expect(jiraAction.prompt.contains("Do not claim posting happened"))
    #expect(jiraAction.prompt.contains("Read-only follow-up"))
    #expect(jiraAction.prompt.contains("Saved output:"))

    #expect(genericAction.id == "continue")
    #expect(genericAction.title == "Continue")
    #expect(genericAction.permissionMode == .askBeforeEdit)
    #expect(genericAction.isGeneratedUI)
    #expect(genericAction.prompt.contains("Continue from the previous output"))
    #expect(genericAction.prompt.contains("Continue from this saved output"))
    #expect(genericAction.prompt.contains("Ask-before-edit follow-up"))

    #expect(failedAction.id == "bug-analysis")
    #expect(failedAction.title == "Bug")
    #expect(failedAction.workflowLabel == "Triage")
    #expect(failedAction.permissionMode == .readOnly)
    #expect(failedAction.prompt.contains("Confirmed facts, likely seam, smallest safe fix"))

    #expect(validationAction.id == "validation")
    #expect(validationAction.title == "Validate")
    #expect(validationAction.permissionMode == .askBeforeEdit)
    #expect(validationAction.prompt.contains("check run, result, evidence, and next action"))

    #expect(jiraBugAction.id == "bug-analysis")
    #expect(jiraBugAction.title == "Bug")
    #expect(jiraBugAction.permissionMode == .readOnly)
    #expect(jiraBugAction.prompt.contains("Analyze this saved output as a bug"))
    #expect(jiraBugAction.prompt.contains("Diagnosis notes: Root cause: detailTab 没有传入 Jira 工作区。; Fix path: 把 detailTab 绑定到 JiraWorkQueueView。"))

    #expect(skillAction.id == "skill-hardening")
    #expect(skillAction.title == "Skill")
    #expect(skillAction.workflowLabel == "Hardening")
    #expect(skillAction.permissionMode == .askBeforeEdit)
    #expect(skillAction.prompt.contains("Harden the skill path behind this saved output"))
    #expect(skillAction.prompt.contains("技能 /logtrace 执行失败"))

    #expect(titleOnlySkillAction.id == "skill-hardening")
    #expect(titleOnlySkillAction.title == "Skill")
    #expect(titleOnlySkillAction.prompt.contains("Output signals:"))
    #expect(titleOnlySkillAction.prompt.contains("Failure signals: Skill /logtrace failed"))

    #expect(sourceRefTraceAction.id == "log-analysis")
    #expect(sourceRefTraceAction.title == "Logs")
    #expect(sourceRefTraceAction.permissionMode == .readOnly)
    #expect(sourceRefTraceAction.prompt.contains("[trace] traceparent 00-4a0031017ceb19eab6d3a39468a20000-0123456789abcdef-01"))

    #expect(explicitFieldTraceAction.id == "log-analysis")
    #expect(explicitFieldTraceAction.title == "Logs")
    #expect(explicitFieldTraceAction.prompt.contains("trace_id=4a0031017ceb19eab6d3a39468a20000"))
    #expect(explicitFieldTraceAction.prompt.contains("request-id req-voice-123"))
    #expect(explicitFieldTraceAction.prompt.contains("turn_id turn-voice-456"))

    #expect(bareHexAction.id == "continue")
    #expect(bareHexAction.title == "Continue")
    #expect(bareHexAction.prompt.contains("4a0031017ceb19eab6d3a39468a20000"))

    #expect(jiraPatchAction.id == "mr-review")
    #expect(jiraPatchAction.title == "Review")
    #expect(jiraPatchAction.workflowLabel == "MR")
    #expect(jiraPatchAction.permissionMode == .readOnly)
    #expect(jiraPatchAction.prompt.contains("Prepare an MR-ready review note"))
}

@Test func artifactFollowUpActionRoutesNamedSkillFailuresWithoutSlash() {
    let run = AgentRun(
        id: "run-output-action-named-skill",
        workspaceId: "workspace-output-action",
        agentProfileId: "agent-output-action",
        state: .completed,
        promptSnapshot: "Fix common skill recovery"
    )
    let artifact = Artifact(
        id: "artifact-output-action-chsql",
        workspaceId: run.workspaceId,
        runId: run.id,
        kind: .commandOutputSummary,
        title: "chsql failed",
        uri: "pikiclaw://runs/run-output-action/chsql",
        status: .ready,
        provenance: "chsql failed because CLICKHOUSE_PROFILE is missing."
    )

    let action = artifactFollowUpAction(artifact: artifact, run: run, workItem: nil)

    #expect(action.id == "skill-hardening")
    #expect(action.title == "Skill")
    #expect(action.permissionMode == .askBeforeEdit)
    #expect(action.prompt.contains("Harden the skill path behind this saved output"))
    #expect(action.prompt.contains("chsql failed because CLICKHOUSE_PROFILE is missing."))
}

@MainActor
@Test func saveArtifactKnowledgeNoteCreatesObsidianArtifactAndKnowledgeCard() async throws {
    let directory = URL(fileURLWithPath: NSTemporaryDirectory())
        .appendingPathComponent("pikiclaw-output-knowledge-\(UUID().uuidString)", isDirectory: true)
    let vault = directory.appendingPathComponent("Obsidian Vault", isDirectory: true)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: directory) }

    let workspace = Workspace(
        id: "workspace-output-knowledge",
        name: "Output Knowledge",
        pathDisplay: directory.path,
        trustState: .trusted
    )
    let agent = AgentProfile(
        id: "agent-output-knowledge",
        kind: .codex,
        displayName: "Codex",
        executableName: "codex",
        isEnabled: true
    )
    let workItem = WorkItem(
        id: "workitem-output-knowledge",
        workspaceId: workspace.id,
        title: "IVAS-9005: Save output knowledge",
        sourceType: .jira,
        sourceRefs: [
            SourceRef(kind: "jira", label: "IVAS-9005", uri: "https://jira.example/browse/IVAS-9005")
        ],
        state: .active,
        jira: JiraWorkItemFields(key: "IVAS-9005", status: "In Progress")
    )
    let run = AgentRun(
        id: "run-output-knowledge",
        workItemId: workItem.id,
        workspaceId: workspace.id,
        agentProfileId: agent.id,
        state: .completed,
        promptSnapshot: "Save useful output"
    )
    let artifact = Artifact(
        id: "artifact-output-knowledge",
        workspaceId: workspace.id,
        workItemId: workItem.id,
        runId: run.id,
        kind: .commandOutputSummary,
        title: "Evidence: reusable workflow",
        uri: "pikiclaw://runs/run-output-knowledge/evidence",
        status: .ready,
        provenance: "Captured durable workflow evidence",
        sourceRefs: [
            SourceRef(kind: "chat-run", label: "Save useful output", uri: "pikiclaw://runs/run-output-knowledge")
        ]
    )
    let seed = NativeAppSeed(
        projects: [],
        workspaces: [workspace],
        workItems: [workItem],
        runs: [run],
        artifacts: [artifact],
        capabilities: [],
        knowledgeCards: [],
        automations: [],
        agentProfiles: [agent],
        providerProfiles: []
    )
    let store = JSONNativeStore(fileURL: directory.appendingPathComponent("state.json"), seed: seed)
    let model = NativeAppModel(store: store)
    await model.reload()

    let noteArtifactId = try #require(await model.saveArtifactKnowledgeNote(
        artifactId: artifact.id,
        obsidianRoot: vault
    ))
    let secondNoteArtifactId = try #require(await model.saveArtifactKnowledgeNote(
        artifactId: artifact.id,
        obsidianRoot: vault
    ))

    let snapshot = try await store.loadSnapshot()
    let noteArtifact = try #require(snapshot.artifacts.first(where: { $0.id == noteArtifactId }))
    let card = try #require(snapshot.knowledgeCards.first(where: { $0.id == "knowledge-artifact-output-knowledge" }))

    #expect(noteArtifactId == secondNoteArtifactId)
    #expect(noteArtifact.kind == .obsidianNote)
    #expect(noteArtifact.uri.hasPrefix(vault.path))
    #expect(FileManager.default.fileExists(atPath: noteArtifact.uri))
    let noteBody = try String(contentsOf: URL(fileURLWithPath: noteArtifact.uri), encoding: .utf8)
    #expect(noteBody.contains("# Evidence: reusable workflow"))
    #expect(noteBody.contains("Captured durable workflow evidence"))
    #expect(noteBody.contains("IVAS-9005: Save output knowledge"))
    #expect(card.artifactRefs.contains(artifact.id))
    #expect(card.artifactRefs.contains(noteArtifact.id))
    #expect(card.sourceRefs.contains(SourceRef(kind: "artifact", label: artifact.id.rawValue, uri: artifact.uri)))
    #expect(card.sourceRefs.contains(where: { $0.kind == "obsidian" && $0.uri == noteArtifact.uri }))
    #expect(card.sourceRefs.contains(SourceRef(kind: "jira", label: "IVAS-9005", uri: "https://jira.example/browse/IVAS-9005")))
    #expect(card.tags.contains("jira"))
    #expect(model.statusLine == "Knowledge note saved")
}

@MainActor
@Test func followUpSideChatStartsChildRunWithPrompt() async throws {
    let directory = URL(fileURLWithPath: NSTemporaryDirectory())
        .appendingPathComponent("pikiclaw-follow-up-side-chat-\(UUID().uuidString)", isDirectory: true)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: directory) }

    let workspace = Workspace(
        id: "workspace-follow-up-side-chat",
        name: "Follow-up Side Chat",
        pathDisplay: directory.path,
        trustState: .trusted
    )
    let agent = AgentProfile(
        id: "agent-follow-up-side-chat",
        kind: .codex,
        displayName: "Codex",
        executableName: "codex",
        isEnabled: true
    )
    let workItem = WorkItem(
        id: "workitem-follow-up-side-chat",
        workspaceId: workspace.id,
        title: "Repair validation follow-up",
        sourceType: .jira,
        state: .active,
        acceptanceCriteria: [
            "Reproduce the failed validation",
            "Confirm the smallest safe fix"
        ],
        jira: JiraWorkItemFields(
            key: "IVAS-9012",
            url: "https://jira.example/browse/IVAS-9012",
            status: "In Progress",
            assignee: "Michael",
            priority: "High",
            issueType: "Task",
            sprint: "Sprint 14"
        )
    )
    let parent = AgentRun(
        id: "run-follow-up-parent",
        workItemId: workItem.id,
        workspaceId: workspace.id,
        agentProfileId: agent.id,
        permissionMode: .autopilot,
        state: .completed,
        endedAt: Date(timeIntervalSince1970: 10),
        promptSnapshot: "original work",
        transcript: "original answer\n[completed with exit code 0]\n"
    )
    let relatedArtifact = Artifact(
        id: "artifact-follow-up-validation",
        workspaceId: workspace.id,
        workItemId: workItem.id,
        runId: parent.id,
        kind: .verificationResult,
        title: "Validation: retry still failing",
        uri: "pikiclaw://artifacts/artifact-follow-up-validation",
        status: .failed,
        provenance: """
        Validation failed after the retry; inspect the smallest failing path before changing code.
        Error: retry validation crashed in RootView.swift:42
        Validation: swift test --filter ChatMessageHistoryTests failed
        Jira update:
        Status: retry validation is still failing
        Evidence: RootView.swift:42 needs a nil workspace guard.
        MR review comment:
        Request changes: add the nil workspace guard before merge.
        Branch decision: Blocked via Review - Read-only review.
        Skill /clickhouse failed because CLICKHOUSE_PROFILE is missing.
        Suggested skill command: `/clickhouse show error spans for TraceId=4a0031017ceb19eab6d3a39468a20000 limit=20`
        Next command: `swift test --filter ChatMessageHistoryTests`
        """,
        createdAt: Date(timeIntervalSince1970: 11),
        sourceRefs: [
            SourceRef(kind: "artifact-resolution", label: "blocked", uri: "pikiclaw://runs/run-follow-up-review")
        ]
    )
    let unrelatedArtifact = Artifact(
        id: "artifact-follow-up-unrelated",
        workspaceId: workspace.id,
        workItemId: "workitem-follow-up-other",
        runId: parent.id,
        kind: .markdownReport,
        title: "Unrelated report",
        uri: "pikiclaw://artifacts/artifact-follow-up-unrelated",
        status: .ready,
        provenance: "This output belongs to a different work item.",
        createdAt: Date(timeIntervalSince1970: 12)
    )
    let relatedKnowledgeCard = KnowledgeCard(
        id: "knowledge-follow-up-validation",
        scope: .workspace,
        title: "Validation retry rule",
        body: "When retry validation fails, preserve the failing command and inspect the smallest failing path first.",
        sourceRefs: [
            SourceRef(kind: "work-item", label: workItem.title, uri: "pikiclaw://work-items/\(workItem.id.rawValue)")
        ],
        artifactRefs: [relatedArtifact.id],
        tags: ["validation", "jira"],
        confidence: 0.92,
        createdAt: Date(timeIntervalSince1970: 13),
        updatedAt: Date(timeIntervalSince1970: 13)
    )
    let unrelatedKnowledgeCard = KnowledgeCard(
        id: "knowledge-follow-up-unrelated",
        scope: .workspace,
        title: "Unrelated knowledge",
        body: "This belongs to the unrelated report.",
        sourceRefs: [],
        artifactRefs: [unrelatedArtifact.id],
        tags: ["other"],
        confidence: 1.0,
        createdAt: Date(timeIntervalSince1970: 14),
        updatedAt: Date(timeIntervalSince1970: 14)
    )
    let seed = NativeAppSeed(
        projects: [],
        workspaces: [workspace],
        workItems: [workItem],
        runs: [parent],
        artifacts: [relatedArtifact, unrelatedArtifact],
        capabilities: [],
        knowledgeCards: [relatedKnowledgeCard, unrelatedKnowledgeCard],
        automations: [],
        agentProfiles: [agent],
        providerProfiles: []
    )
    let store = JSONNativeStore(fileURL: directory.appendingPathComponent("state.json"), seed: seed)
    let capture = PromptCapture()
    let model = NativeAppModel(
        store: store,
        agentAdapterFactory: { descriptor in
            CapturingAgentAdapter(descriptor: descriptor, capture: capture)
        }
    )
    await model.reload()
    model.activeRunId = parent.id

    let childId = try #require(await model.startFollowUpSideChat(
        parentRunId: parent.id,
        prompt: "Review the failed validation in a side chat.",
        permissionMode: .readOnly,
        followUpLabel: "Review - Read-only review"
    ))

    let snapshot = try await store.loadSnapshot()
    let updatedParent = try #require(snapshot.runs.first(where: { $0.id == parent.id }))
    let child = try #require(snapshot.runs.first(where: { $0.id == childId }))

    #expect(updatedParent.sideChatRunIds == [childId])
    #expect(child.sideChatOfRunId == parent.id)
    #expect(child.permissionMode == .readOnly)
    #expect(child.contextRefs.contains(ContextRef(kind: "follow-up", label: "Review - Read-only review")))
    #expect(sideChatPaneLabel(for: child) == "Review - Read-only review")
    #expect(child.promptSnapshot == "Review the failed validation in a side chat.")
    #expect(child.transcript.contains("second answer"))
    let capturedPrompt = try #require(capture.prompts.last)
    #expect(capturedPrompt.contains("Review the failed validation in a side chat."))
    #expect(capturedPrompt.contains("focused side chat"))
    #expect(capturedPrompt.contains("- Parent run: run-follow-up-parent"))
    #expect(capturedPrompt.contains("- Follow-up: Review - Read-only review"))
    #expect(capturedPrompt.contains("- Work item: Repair validation follow-up"))
    #expect(capturedPrompt.contains("- Work item state: active"))
    #expect(capturedPrompt.contains("- Work item source: jira"))
    #expect(capturedPrompt.contains("- Jira: key IVAS-9012, status In Progress, priority High, assignee Michael, type Task, sprint Sprint 14"))
    #expect(capturedPrompt.contains("- Jira URL: https://jira.example/browse/IVAS-9012"))
    #expect(capturedPrompt.contains("- Acceptance criteria:\n- Reproduce the failed validation\n- Confirm the smallest safe fix"))
    #expect(capturedPrompt.contains("- Related outputs:\n- [verificationResult/failed] Validation: retry still failing"))
    #expect(capturedPrompt.contains("Validation failed after the retry; inspect the smallest failing path before changing code."))
    #expect(capturedPrompt.contains("pikiclaw://artifacts/artifact-follow-up-validation"))
    #expect(capturedPrompt.contains("- Extracted signals:"))
    #expect(capturedPrompt.contains("- Branch decisions: Branch blocked: Validation: retry still failing - Branch decision: Blocked via Review - Read-only review."))
    #expect(capturedPrompt.contains("- Handoff drafts: Jira draft: Status: retry validation is still failing | Evidence: RootView.swift:42 needs a nil workspace guard.; MR draft: Request changes: add the nil workspace guard before merge."))
    #expect(capturedPrompt.contains("- Failure signals: Error: retry validation crashed in RootView.swift:42"))
    #expect(capturedPrompt.contains("- Validation evidence: swift test --filter ChatMessageHistoryTests (failed)"))
    #expect(capturedPrompt.contains("- Pending commands: swift test --filter ChatMessageHistoryTests"))
    #expect(capturedPrompt.contains("- Jira refs: IVAS-9012"))
    #expect(capturedPrompt.contains("- Skill recovery: Recover /clickhouse: set CLICKHOUSE_PROFILE before rerun.; Rerun: /clickhouse show error spans for TraceId=4a0031017ceb19eab6d3a39468a20000 limit=20"))
    #expect(capturedPrompt.contains("- Related knowledge:\n- Validation retry rule [validation,jira]"))
    #expect(capturedPrompt.contains("When retry validation fails, preserve the failing command and inspect the smallest failing path first."))
    #expect(!capturedPrompt.contains("Unrelated report"))
    #expect(!capturedPrompt.contains("Unrelated knowledge"))
    #expect(capturedPrompt.contains("- Parent prompt:\noriginal work"))
    #expect(capturedPrompt.contains("- Parent output:\noriginal answer"))
    #expect(!capturedPrompt.contains("[completed with exit code 0]"))
    #expect(model.activeRunId == parent.id)
}

@MainActor
@Test func artifactFollowUpActionStartsSideChatWithSavedOutputContext() async throws {
    let directory = URL(fileURLWithPath: NSTemporaryDirectory())
        .appendingPathComponent("pikiclaw-artifact-side-chat-\(UUID().uuidString)", isDirectory: true)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: directory) }

    let workspace = Workspace(
        id: "workspace-artifact-side-chat",
        name: "Artifact Side Chat",
        pathDisplay: directory.path,
        trustState: .trusted
    )
    let agent = AgentProfile(
        id: "agent-artifact-side-chat",
        kind: .codex,
        displayName: "Codex",
        executableName: "codex",
        isEnabled: true
    )
    let workItem = WorkItem(
        id: "workitem-artifact-side-chat",
        workspaceId: workspace.id,
        title: "IVAS-9051: Publish artifact update",
        sourceType: .jira,
        state: .active,
        jira: JiraWorkItemFields(key: "IVAS-9051", status: "In Progress")
    )
    let parent = AgentRun(
        id: "run-artifact-side-chat-parent",
        workItemId: workItem.id,
        workspaceId: workspace.id,
        agentProfileId: agent.id,
        permissionMode: .autopilot,
        state: .completed,
        promptSnapshot: "Capture Jira update evidence",
        transcript: "Implementation complete; Jira update still needs review."
    )
    let artifact = Artifact(
        id: "artifact-side-chat-jira-update",
        workspaceId: workspace.id,
        workItemId: workItem.id,
        runId: parent.id,
        kind: .commandOutputSummary,
        title: "Evidence: Jira update ready",
        uri: "pikiclaw://artifacts/artifact-side-chat-jira-update",
        status: .ready,
        provenance: """
        Jira update:
        Status: implementation complete
        Validation: swift test --filter ChatMessageHistoryTests passed
        Blockers: waiting for Jira write permission
        Next action: review and post the update
        """
    )
    let seed = NativeAppSeed(
        projects: [],
        workspaces: [workspace],
        workItems: [workItem],
        runs: [parent],
        artifacts: [artifact],
        capabilities: [],
        knowledgeCards: [],
        automations: [],
        agentProfiles: [agent],
        providerProfiles: []
    )
    let store = JSONNativeStore(fileURL: directory.appendingPathComponent("state.json"), seed: seed)
    let capture = PromptCapture()
    let model = NativeAppModel(
        store: store,
        agentAdapterFactory: { descriptor in
            CapturingAgentAdapter(descriptor: descriptor, capture: capture)
        }
    )
    await model.reload()
    model.activeRunId = parent.id
    model.draftPrompt = "Keep the main composer intact."

    let action = artifactFollowUpAction(artifact: artifact, run: parent, workItem: workItem)
    let childId = try #require(await model.startFollowUpSideChat(
        parentRunId: parent.id,
        prompt: action.prompt,
        permissionMode: action.permissionMode,
        followUpLabel: runFollowUpStagedLabel(action)
    ))

    let snapshot = try await store.loadSnapshot()
    let updatedParent = try #require(snapshot.runs.first(where: { $0.id == parent.id }))
    let child = try #require(snapshot.runs.first(where: { $0.id == childId }))

    #expect(action.id == "jira-update")
    #expect(updatedParent.sideChatRunIds == [childId])
    #expect(child.sideChatOfRunId == parent.id)
    #expect(child.permissionMode == .readOnly)
    #expect(child.contextRefs.contains(ContextRef(kind: "follow-up", label: "Jira - Read-only update")))
    #expect(child.promptSnapshot.contains("Prepare a Jira-ready update"))
    #expect(child.promptSnapshot.contains("Saved output:"))
    #expect(child.promptSnapshot.contains("Evidence: Jira update ready"))
    #expect(child.promptSnapshot.contains("Read-only follow-up"))
    #expect(model.draftPrompt == "Keep the main composer intact.")
    let capturedPrompt = try #require(capture.prompts.last)
    #expect(capturedPrompt.contains("This is a focused side chat"))
    #expect(capturedPrompt.contains("- Follow-up: Jira - Read-only update"))
    #expect(capturedPrompt.contains("Saved output:"))
    #expect(capturedPrompt.contains("paste-ready Jira comment"))
    #expect(capturedPrompt.contains("waiting for Jira write permission"))
}

@MainActor
@Test func captureRunEvidenceCreatesWorkItemArtifactAndUpdatesItInPlace() async throws {
    let directory = URL(fileURLWithPath: NSTemporaryDirectory())
        .appendingPathComponent("pikiclaw-run-evidence-\(UUID().uuidString)", isDirectory: true)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: directory) }

    let workspace = Workspace(
        id: "workspace-run-evidence",
        name: "Run Evidence",
        pathDisplay: directory.path,
        trustState: .trusted
    )
    let agent = AgentProfile(
        id: "agent-run-evidence",
        kind: .codex,
        displayName: "Codex",
        executableName: "codex",
        isEnabled: true
    )
    let workItem = WorkItem(
        id: "workitem-run-evidence",
        workspaceId: workspace.id,
        title: "IVAS-9002: Repair Jira evidence flow",
        sourceType: .jira,
        sourceRefs: [
            SourceRef(kind: "jira", label: "IVAS-9002", uri: "https://jira.example/browse/IVAS-9002")
        ],
        state: .active,
        jira: JiraWorkItemFields(key: "IVAS-9002", status: "In Progress")
    )
    let run = AgentRun(
        id: "run-evidence-source",
        workItemId: workItem.id,
        workspaceId: workspace.id,
        agentProfileId: agent.id,
        state: .completed,
        endedAt: Date(timeIntervalSince1970: 10),
        promptSnapshot: "Validate Jira evidence flow",
        contextRefs: [
            ContextRef(kind: "file", label: "RootView.swift", uri: "apps/macos/Sources/PikiclawMac/RootView.swift")
        ],
        transcript: "Validated current sprint sync and captured outputs.\n[completed with exit code 0]\n"
    )
    let seed = NativeAppSeed(
        projects: [],
        workspaces: [workspace],
        workItems: [workItem],
        runs: [run],
        artifacts: [],
        capabilities: [],
        knowledgeCards: [],
        automations: [],
        agentProfiles: [agent],
        providerProfiles: []
    )
    let store = JSONNativeStore(fileURL: directory.appendingPathComponent("state.json"), seed: seed)
    let model = NativeAppModel(store: store)
    await model.reload()

    let firstArtifactId = try #require(await model.captureRunEvidence(runId: run.id))
    let secondArtifactId = try #require(await model.captureRunEvidence(runId: run.id))

    let snapshot = try await store.loadSnapshot()
    let runArtifacts = snapshot.artifacts.filter { $0.runId == run.id && $0.kind == .commandOutputSummary }
    let artifact = try #require(runArtifacts.first)

    #expect(firstArtifactId == secondArtifactId)
    #expect(runArtifacts.count == 1)
    #expect(artifact.workspaceId == workspace.id)
    #expect(artifact.workItemId == workItem.id)
    #expect(artifact.status == .ready)
    #expect(artifact.title == "Evidence: IVAS-9002: Repair Jira evidence flow")
    #expect(artifact.uri == "pikiclaw://runs/run-evidence-source/evidence")
    #expect(artifact.provenance.contains("Validated current sprint sync"))
    #expect(artifact.sourceRefs.contains(SourceRef(kind: "chat-run", label: "Validate Jira evidence flow", uri: "pikiclaw://runs/run-evidence-source")))
    #expect(artifact.sourceRefs.contains(SourceRef(kind: "jira", label: "IVAS-9002", uri: "https://jira.example/browse/IVAS-9002")))
    #expect(artifact.sourceRefs.contains(SourceRef(kind: "file", label: "RootView.swift", uri: "apps/macos/Sources/PikiclawMac/RootView.swift")))
    #expect(model.statusLine == "Evidence updated")
}

private final class PromptCapture: @unchecked Sendable {
    var prompts: [String] = []
    var permissionModes: [PermissionMode] = []
    var arguments: [[String]] = []
    var stdinTexts: [String?] = []
}

private struct CapturingAgentAdapter: AgentAdapter {
    let descriptor: AgentDescriptor
    let capture: PromptCapture

    func detect() async -> AgentDetection {
        AgentDetection(isAvailable: true, executablePath: "/usr/bin/true", authState: "mock", detail: "Capturing adapter")
    }

    func start(_ request: AgentLaunchRequest) -> AsyncThrowingStream<RunnerEvent, Error> {
        capture.prompts.append(request.prompt)
        capture.permissionModes.append(request.run.permissionMode)
        capture.arguments.append(request.arguments)
        capture.stdinTexts.append(request.stdinText)
        return AsyncThrowingStream { continuation in
            continuation.yield(.stateChanged(.running))
            continuation.yield(.output("second answer\n"))
            continuation.yield(.completed(exitCode: 0))
            continuation.finish()
        }
    }
}

private final class StreamingRunProbe: @unchecked Sendable {
    private let lock = NSLock()
    private var continuations: [AsyncThrowingStream<RunnerEvent, Error>.Continuation] = []
    private var outputCount = 0
    private var outputWaiters: [(count: Int, waiter: CheckedContinuation<Void, Never>)] = []

    var emittedOutputCount: Int {
        self.lock.lock()
        defer { self.lock.unlock() }
        return outputCount
    }

    func stream() -> AsyncThrowingStream<RunnerEvent, Error> {
        AsyncThrowingStream { continuation in
            self.lock.lock()
            self.continuations.append(continuation)
            self.outputCount += 1
            let readyWaiters = self.outputWaiters.filter { self.outputCount >= $0.count }
            self.outputWaiters.removeAll { self.outputCount >= $0.count }
            self.lock.unlock()

            continuation.yield(.stateChanged(.running))
            continuation.yield(.output("first token\n"))
            readyWaiters.forEach { $0.waiter.resume() }
        }
    }

    func waitForFirstOutput() async {
        await waitForOutputCount(1)
    }

    func waitForOutputCount(_ count: Int) async {
        await withCheckedContinuation { waiter in
            self.lock.lock()
            if self.outputCount >= count {
                self.lock.unlock()
                waiter.resume()
                return
            }
            self.outputWaiters.append((count, waiter))
            self.lock.unlock()
        }
    }

    func finish(exitCode: Int32) {
        finishAll(exitCode: exitCode)
    }

    func finishAll(exitCode: Int32) {
        self.lock.lock()
        let continuations = self.continuations
        self.continuations.removeAll()
        self.lock.unlock()
        for continuation in continuations {
            continuation.yield(.completed(exitCode: exitCode))
            continuation.finish()
        }
    }
}

private struct StreamingRunProbeAdapter: AgentAdapter {
    let descriptor: AgentDescriptor
    let probe: StreamingRunProbe

    func detect() async -> AgentDetection {
        AgentDetection(isAvailable: true)
    }

    func start(_ request: AgentLaunchRequest) -> AsyncThrowingStream<RunnerEvent, Error> {
        probe.stream()
    }
}
