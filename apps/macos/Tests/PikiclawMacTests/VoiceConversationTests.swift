import Foundation
import Testing
@testable import PikiclawCore
@testable import PikiclawMac
@testable import PikiclawRunner

@MainActor
@Test func nativeModelMarksPersistedActiveVoiceRunsStaleOnLaunch() async throws {
    let dir = URL(fileURLWithPath: NSTemporaryDirectory())
        .appendingPathComponent("pikiclaw-voice-stale-\(UUID().uuidString)", isDirectory: true)
    try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: dir) }

    let workspace = Workspace(
        id: "workspace-voice-stale",
        name: "Voice Stale",
        pathDisplay: dir.path,
        trustState: .trusted
    )
    let codex = AgentProfile(
        id: "agent-codex-stale",
        kind: .codex,
        displayName: "Codex",
        executableName: "codex",
        isEnabled: true
    )
    let staleCandidate = AgentRun(
        id: "run-voice-orphan",
        workspaceId: workspace.id,
        agentProfileId: codex.id,
        state: .running,
        startedAt: Date(),
        promptSnapshot: "Voice Assistant request: orphaned task",
        contextRefs: [ContextRef(kind: "voice", label: "Voice Assistant")]
    )
    let seed = NativeAppSeed(
        projects: [],
        workspaces: [workspace],
        workItems: [],
        runs: [staleCandidate],
        artifacts: [],
        capabilities: [],
        knowledgeCards: [],
        automations: [],
        agentProfiles: [codex],
        providerProfiles: []
    )
    let store = JSONNativeStore(fileURL: dir.appendingPathComponent("state.json"), seed: seed)
    let model = NativeAppModel(store: store)

    await model.reload()

    let snapshot = try await store.loadSnapshot()
    let recoveredRun = try #require(snapshot.runs.first(where: { $0.id == staleCandidate.id }))
    #expect(recoveredRun.state == .stale)
    #expect(recoveredRun.endedAt != nil)
    #expect(recoveredRun.transcript.contains("Marked stale because Pikiclaw restarted"))
    #expect(model.restartBlockedByActiveRun == false)
}

@MainActor
@Test func voiceConversationOpensDraftRunWithFirstEnabledAgent() async throws {
    let dir = URL(fileURLWithPath: NSTemporaryDirectory())
        .appendingPathComponent("pikiclaw-voice-conversation-\(UUID().uuidString)", isDirectory: true)
    try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: dir) }

    let workspace = Workspace(
        id: "workspace-voice-test",
        name: "Voice Test",
        pathDisplay: dir.path,
        trustState: .trusted
    )
    let disabledCodex = AgentProfile(
        id: "agent-codex-disabled",
        kind: .codex,
        displayName: "Codex",
        executableName: "codex",
        isEnabled: false
    )
    let firstEnabled = AgentProfile(
        id: "agent-claude-enabled",
        kind: .claude,
        displayName: "Claude",
        executableName: "claude",
        isEnabled: true
    )
    let laterEnabled = AgentProfile(
        id: "agent-gemini-enabled",
        kind: .gemini,
        displayName: "Gemini",
        executableName: "gemini",
        isEnabled: true
    )
    let seed = NativeAppSeed(
        projects: [],
        workspaces: [workspace],
        workItems: [],
        runs: [],
        artifacts: [],
        capabilities: [],
        knowledgeCards: [],
        automations: [],
        agentProfiles: [disabledCodex, firstEnabled, laterEnabled],
        providerProfiles: []
    )
    let store = JSONNativeStore(fileURL: dir.appendingPathComponent("state.json"), seed: seed)
    let model = NativeAppModel(store: store)
    await model.reload()

    let runId = try #require(await model.ensureVoiceConversation(workspaceId: workspace.id))
    let snapshot = try await store.loadSnapshot()
    let run = try #require(snapshot.runs.first(where: { $0.id == runId }))

    #expect(run.state == .draft)
    #expect(run.workspaceId == workspace.id)
    #expect(run.agentProfileId == firstEnabled.id)
    #expect(run.promptSnapshot == "Pikiclaw Voice Assistant Agent")
    #expect(run.contextRefs.contains(where: { $0.kind == "voiceAssistantAgent" }))
    #expect(model.activeRunId == run.id)
    #expect(model.selectedAgentKind == firstEnabled.kind)
    #expect(model.restartBlockedByActiveRun == false)
    #expect(run.transcript.contains("Conversation opened"))
}

@MainActor
@Test func voiceConversationRecordsGreetingAndLocalTurns() async throws {
    let dir = URL(fileURLWithPath: NSTemporaryDirectory())
        .appendingPathComponent("pikiclaw-voice-transcript-\(UUID().uuidString)", isDirectory: true)
    try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: dir) }

    let workspace = Workspace(
        id: "workspace-voice-transcript",
        name: "Voice Transcript",
        pathDisplay: dir.path,
        trustState: .trusted
    )
    let codex = AgentProfile(
        id: "agent-codex-transcript",
        kind: .codex,
        displayName: "Codex",
        executableName: "codex",
        isEnabled: true
    )
    let seed = NativeAppSeed(
        projects: [],
        workspaces: [workspace],
        workItems: [],
        runs: [],
        artifacts: [],
        capabilities: [],
        knowledgeCards: [],
        automations: [],
        agentProfiles: [codex],
        providerProfiles: []
    )
    let store = JSONNativeStore(fileURL: dir.appendingPathComponent("state.json"), seed: seed)
    let model = NativeAppModel(store: store)
    await model.reload()

    let runId = try #require(await model.ensureVoiceConversation(workspaceId: workspace.id, focus: false))
    await model.appendVoiceConversationTurn(
        runId: runId,
        role: "assistant voice",
        text: "你好，我在。你可以直接说要做什么。",
        caption: "Voice Greeting"
    )
    await model.appendVoiceConversationTurn(
        runId: runId,
        role: "user voice",
        text: "你可以做什么",
        caption: "You · Live"
    )

    let snapshot = try await store.loadSnapshot()
    let run = try #require(snapshot.runs.first(where: { $0.id == runId }))

    #expect(run.state == .draft)
    #expect(run.transcript.contains("[assistant voice · Voice Greeting]"))
    #expect(run.transcript.contains("你好，我在。你可以直接说要做什么。"))
    #expect(run.transcript.contains("[user voice · You · Live]"))
    #expect(run.transcript.contains("你可以做什么"))
}

@MainActor
@Test func voiceConversationRoutesVoiceConfigurationRequestToAgentRun() async throws {
    let dir = URL(fileURLWithPath: NSTemporaryDirectory())
        .appendingPathComponent("pikiclaw-voice-config-route-\(UUID().uuidString)", isDirectory: true)
    try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: dir) }

    let workspace = Workspace(
        id: "workspace-voice-config-route",
        name: "Voice Config Route",
        pathDisplay: dir.path,
        trustState: .trusted
    )
    let codex = AgentProfile(
        id: "agent-codex-config-route",
        kind: .codex,
        displayName: "Codex",
        executableName: "codex",
        isEnabled: true
    )
    let seed = NativeAppSeed(
        projects: [],
        workspaces: [workspace],
        workItems: [],
        runs: [],
        artifacts: [],
        capabilities: [],
        knowledgeCards: [],
        automations: [],
        agentProfiles: [codex],
        providerProfiles: []
    )
    let store = JSONNativeStore(fileURL: dir.appendingPathComponent("state.json"), seed: seed)
    let model = NativeAppModel(
        store: store,
        agentAdapterFactory: { descriptor in
            VoiceScenarioAgentAdapter(descriptor: descriptor)
        }
    )
    await model.reload()

    let conversationRunId = try #require(await model.ensureVoiceConversation(workspaceId: workspace.id, focus: false))
    let plan = VoiceAssistantPlanner.makePlan(
        utterance: "还有其他语音可以选择吗，因为我觉得你目前的声音很不自然",
        workspace: workspace,
        preferredAgent: codex.kind
    )

    #expect(plan.intent == .delegate)
    let submittedRunId = try #require(await model.submitVoiceTurn(
        plan,
        conversationRunId: conversationRunId,
        workspaceId: workspace.id,
        targetWorkItemId: nil
    ))
    let run = try await waitForRun(submittedRunId, in: store) { $0.state == .completed }
    try await waitForModelIdle(model)

    #expect(run.id == conversationRunId)
    #expect(run.state == .completed)
    #expect(run.transcript.contains("[user voice]"))
    #expect(run.transcript.contains("声音很不自然"))
    #expect(run.transcript.contains("[scenario completed]"))
}

@MainActor
@Test func voiceConversationCompletesTenRealProductUseCases() async throws {
    let dir = URL(fileURLWithPath: NSTemporaryDirectory())
        .appendingPathComponent("pikiclaw-voice-scenarios-\(UUID().uuidString)", isDirectory: true)
    try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: dir) }

    let workspace = Workspace(
        id: "workspace-voice-scenarios",
        name: "Pikiclaw Voice Scenarios",
        pathDisplay: dir.path,
        trustState: .trusted
    )
    let codex = AgentProfile(
        id: "agent-codex",
        kind: .codex,
        displayName: "Codex",
        executableName: "codex",
        isEnabled: true
    )
    let hermes = AgentProfile(
        id: "agent-hermes",
        kind: .hermes,
        displayName: "Hermes",
        executableName: "hermes",
        isEnabled: true
    )
    let seed = NativeAppSeed(
        projects: [],
        workspaces: [workspace],
        workItems: [],
        runs: [],
        artifacts: [],
        capabilities: [],
        knowledgeCards: [],
        automations: [],
        agentProfiles: [codex, hermes],
        providerProfiles: []
    )
    let store = JSONNativeStore(fileURL: dir.appendingPathComponent("state.json"), seed: seed)
    let model = NativeAppModel(
        store: store,
        agentAdapterFactory: { descriptor in
            VoiceScenarioAgentAdapter(descriptor: descriptor)
        }
    )
    await model.reload()

    let utterances = [
        "帮我优化 chat 消息列表的阅读体验，消息需要更好管理并保持状态稳定。",
        "帮我继续优化 voice assistant，重点检查 greeting、打断和自动提交。",
        "帮我整理 chat message 的管理方式，让历史和当前会话更清晰。",
        "帮我优化 output 面板，agent 输出要更容易扫描和定位问题。",
        "帮我检查 voice 状态切换，从 listening 到 thinking 再到 speaking 是否自然。",
        "帮我设计 agent 选择逻辑，默认使用第一个可用 agent，但代码任务优先 Codex。",
        "帮我验证状态查询这类语音请求，不要误启动新的 agent run。",
        "帮我修复语音识别后的后台提交，必须进入同一个 Conversation。",
        "帮我改善 chat 里的继续对话，回复应该复用当前 Conversation。",
        "帮我检查失败输出和完成报告，voice 要能听到结果并保存 transcript。"
    ]

    var completedRunIds: [EntityID] = []
    for utterance in utterances {
        let conversationRunId = try #require(await model.ensureVoiceConversation(workspaceId: workspace.id))
        let plan = VoiceAssistantPlanner.makePlan(
            utterance: utterance,
            workspace: workspace,
            preferredAgent: codex.kind
        )
        #expect(plan.intent == .delegate)

        let submittedRunId = try #require(await model.submitVoiceTurn(
            plan,
            conversationRunId: conversationRunId,
            workspaceId: workspace.id,
            targetWorkItemId: nil
        ))
        let run = try await waitForRun(submittedRunId, in: store) { $0.state == .completed }
        try await waitForModelIdle(model)

        #expect(run.id == conversationRunId)
        #expect(run.state == .completed)
        #expect(run.workspaceId == workspace.id)
        #expect(run.agentProfileId == codex.id)
        #expect(run.transcript.contains("[user voice]"))
        #expect(run.transcript.contains(utterance))
        #expect(run.transcript.contains("[scenario completed]"))
        #expect(run.promptSnapshot.contains("Voice Assistant Agent working memory before this turn"))
        #expect(model.restartBlockedByActiveRun == false)
        completedRunIds.append(run.id)
    }

    #expect(completedRunIds.count == 10)
    #expect(Set(completedRunIds).count == 10)
}

@MainActor
@Test func voiceConversationCanStartNewTaskWhilePreviousRunIsExecuting() async throws {
    let dir = URL(fileURLWithPath: NSTemporaryDirectory())
        .appendingPathComponent("pikiclaw-voice-concurrent-\(UUID().uuidString)", isDirectory: true)
    try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: dir) }

    let workspace = Workspace(
        id: "workspace-voice-concurrent",
        name: "Voice Concurrent",
        pathDisplay: dir.path,
        trustState: .trusted
    )
    let codex = AgentProfile(
        id: "agent-codex-concurrent",
        kind: .codex,
        displayName: "Codex",
        executableName: "codex",
        isEnabled: true
    )
    let seed = NativeAppSeed(
        projects: [],
        workspaces: [workspace],
        workItems: [],
        runs: [],
        artifacts: [],
        capabilities: [],
        knowledgeCards: [],
        automations: [],
        agentProfiles: [codex],
        providerProfiles: []
    )
    let store = JSONNativeStore(fileURL: dir.appendingPathComponent("state.json"), seed: seed)
    let model = NativeAppModel(
        store: store,
        agentAdapterFactory: { descriptor in
            VoiceSlowAgentAdapter(descriptor: descriptor)
        }
    )
    await model.reload()

    let firstConversationId = try #require(await model.ensureVoiceConversation(workspaceId: workspace.id, focus: false))
    let firstPlan = VoiceAssistantPlanner.makePlan(
        utterance: "帮我优化 voice 的第一个后台任务。",
        workspace: workspace,
        preferredAgent: codex.kind
    )
    let firstRunId = try #require(await model.submitVoiceTurn(
        firstPlan,
        conversationRunId: firstConversationId,
        workspaceId: workspace.id,
        targetWorkItemId: nil
    ))
    #expect(firstRunId == firstConversationId)

    let firstActiveRun = try #require((try await store.loadSnapshot()).runs.first(where: { $0.id == firstRunId }))
    #expect(NativeAppModel.isActiveExecutionState(firstActiveRun.state))
    #expect(model.runningRunIds.contains(firstRunId))

    let secondPlan = VoiceAssistantPlanner.makePlan(
        utterance: "再开一个任务，帮我检查 chat message 管理。",
        workspace: workspace,
        preferredAgent: codex.kind
    )
    let secondRunId = try #require(await model.submitVoiceTurn(
        secondPlan,
        conversationRunId: firstRunId,
        workspaceId: workspace.id,
        targetWorkItemId: nil,
        preserveActiveRunId: firstRunId
    ))

    #expect(secondRunId != firstRunId)
    let secondQueuedRun = try #require((try await store.loadSnapshot()).runs.first(where: { $0.id == secondRunId }))
    #expect(secondQueuedRun.contextRefs.contains(where: { $0.kind == "voice" }))
    #expect(NativeAppModel.isActiveExecutionState(secondQueuedRun.state))

    let firstCompletedRun = try await waitForRun(firstRunId, in: store) { $0.state == .completed }
    let secondCompletedRun = try await waitForRun(secondRunId, in: store) { $0.state == .completed }
    try await waitForModelIdle(model)
    #expect(firstCompletedRun.transcript.contains("第一个后台任务"))
    #expect(secondCompletedRun.transcript.contains("chat message"))
    #expect(model.runningRunIds.isEmpty)
    #expect(model.isRunning == false)
}

@MainActor
@Test func voiceConversationCanSubmitTextInputFromVoiceSurface() async throws {
    let dir = URL(fileURLWithPath: NSTemporaryDirectory())
        .appendingPathComponent("pikiclaw-voice-text-input-\(UUID().uuidString)", isDirectory: true)
    try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: dir) }

    let workspace = Workspace(
        id: "workspace-voice-text-input",
        name: "Voice Text Input",
        pathDisplay: dir.path,
        trustState: .trusted
    )
    let codex = AgentProfile(
        id: "agent-codex-text-input",
        kind: .codex,
        displayName: "Codex",
        executableName: "codex",
        isEnabled: true
    )
    let seed = NativeAppSeed(
        projects: [],
        workspaces: [workspace],
        workItems: [],
        runs: [],
        artifacts: [],
        capabilities: [],
        knowledgeCards: [],
        automations: [],
        agentProfiles: [codex],
        providerProfiles: []
    )
    let store = JSONNativeStore(fileURL: dir.appendingPathComponent("state.json"), seed: seed)
    let model = NativeAppModel(
        store: store,
        agentAdapterFactory: { descriptor in
            VoiceScenarioAgentAdapter(descriptor: descriptor)
        }
    )
    await model.reload()

    let conversationRunId = try #require(await model.ensureVoiceConversation(workspaceId: workspace.id, focus: false))
    let plan = VoiceAssistantPlanner.makePlan(
        utterance: "用文本输入提交一个后台任务。",
        workspace: workspace,
        preferredAgent: codex.kind
    )
    let submittedRunId = try #require(await model.submitVoiceTurn(
        plan,
        conversationRunId: conversationRunId,
        workspaceId: workspace.id,
        targetWorkItemId: nil,
        inputRole: "user text"
    ))
    let run = try await waitForRun(submittedRunId, in: store) { $0.state == .completed }

    #expect(run.transcript.contains("[user text]"))
    #expect(run.transcript.contains("用文本输入提交一个后台任务"))
}

@MainActor
@Test func voiceConversationCanPreserveCurrentChatLayout() async throws {
    let dir = URL(fileURLWithPath: NSTemporaryDirectory())
        .appendingPathComponent("pikiclaw-voice-preserve-layout-\(UUID().uuidString)", isDirectory: true)
    try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: dir) }

    let workspace = Workspace(
        id: "workspace-voice-preserve",
        name: "Voice Preserve",
        pathDisplay: dir.path,
        trustState: .trusted
    )
    let codex = AgentProfile(
        id: "agent-codex-preserve",
        kind: .codex,
        displayName: "Codex",
        executableName: "codex",
        isEnabled: true
    )
    let activeChat = AgentRun(
        id: "run-active-chat",
        workspaceId: workspace.id,
        agentProfileId: codex.id,
        state: .completed,
        promptSnapshot: "Keep this multi-chat layout active"
    )
    let seed = NativeAppSeed(
        projects: [],
        workspaces: [workspace],
        workItems: [],
        runs: [activeChat],
        artifacts: [],
        capabilities: [],
        knowledgeCards: [],
        automations: [],
        agentProfiles: [codex],
        providerProfiles: []
    )
    let store = JSONNativeStore(fileURL: dir.appendingPathComponent("state.json"), seed: seed)
    let model = NativeAppModel(
        store: store,
        agentAdapterFactory: { descriptor in
            VoiceScenarioAgentAdapter(descriptor: descriptor)
        }
    )
    await model.reload()
    model.activeRunId = activeChat.id

    let conversationRunId = try #require(await model.ensureVoiceConversation(workspaceId: workspace.id, focus: false))
    #expect(model.activeRunId == activeChat.id)

    let plan = VoiceAssistantPlanner.makePlan(
        utterance: "帮我优化当前多窗口 chat，但不要切走当前布局。",
        workspace: workspace,
        preferredAgent: codex.kind
    )
    let submittedRunId = try #require(await model.submitVoiceTurn(
        plan,
        conversationRunId: conversationRunId,
        workspaceId: workspace.id,
        targetWorkItemId: nil,
        preserveActiveRunId: activeChat.id
    ))
    let voiceRun = try await waitForRun(submittedRunId, in: store) { $0.state == .completed }
    try await waitForModelIdle(model)

    #expect(submittedRunId == conversationRunId)
    #expect(voiceRun.state == .completed)
    #expect(model.activeRunId == activeChat.id)
}

private struct VoiceScenarioAgentAdapter: AgentAdapter {
    let descriptor: AgentDescriptor

    func detect() async -> AgentDetection {
        AgentDetection(isAvailable: true, executablePath: "/usr/bin/true", authState: "mock", detail: "Voice scenario adapter")
    }

    func start(_ request: AgentLaunchRequest) -> AsyncThrowingStream<RunnerEvent, Error> {
        AsyncThrowingStream { continuation in
            continuation.yield(.stateChanged(.starting))
            continuation.yield(.stateChanged(.running))
            continuation.yield(.output("[scenario completed] \(firstLine(request.prompt))\n"))
            continuation.yield(.completed(exitCode: 0))
            continuation.finish()
        }
    }

    private func firstLine(_ text: String) -> String {
        text
            .split(whereSeparator: \.isNewline)
            .first
            .map(String.init)?
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .nilIfEmpty ?? "voice request"
    }
}

private struct VoiceSlowAgentAdapter: AgentAdapter {
    let descriptor: AgentDescriptor

    func detect() async -> AgentDetection {
        AgentDetection(isAvailable: true, executablePath: "/usr/bin/true", authState: "mock", detail: "Voice slow adapter")
    }

    func start(_ request: AgentLaunchRequest) -> AsyncThrowingStream<RunnerEvent, Error> {
        AsyncThrowingStream { continuation in
            Task {
                continuation.yield(.stateChanged(.starting))
                continuation.yield(.stateChanged(.running))
                continuation.yield(.output("[slow started] \(firstLine(request.prompt))\n"))
                try? await Task.sleep(nanoseconds: 260_000_000)
                continuation.yield(.output("[slow completed]\n"))
                continuation.yield(.completed(exitCode: 0))
                continuation.finish()
            }
        }
    }

    private func firstLine(_ text: String) -> String {
        text
            .split(whereSeparator: \.isNewline)
            .first
            .map(String.init)?
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .nilIfEmpty ?? "voice request"
    }
}

private enum VoiceConversationTestError: Error {
    case timedOut(EntityID)
}

@MainActor
private func waitForRun(
    _ runId: EntityID,
    in store: JSONNativeStore,
    matching predicate: (AgentRun) -> Bool
) async throws -> AgentRun {
    for _ in 0..<80 {
        let snapshot = try await store.loadSnapshot()
        if let run = snapshot.runs.first(where: { $0.id == runId }),
           predicate(run) {
            return run
        }
        try await Task.sleep(nanoseconds: 50_000_000)
    }
    throw VoiceConversationTestError.timedOut(runId)
}

@MainActor
private func waitForModelIdle(_ model: NativeAppModel) async throws {
    for _ in 0..<40 {
        if model.runningRunIds.isEmpty && !model.isRunning {
            return
        }
        try await Task.sleep(nanoseconds: 50_000_000)
    }
    throw VoiceConversationTestError.timedOut("model-idle")
}

private extension String {
    var nilIfEmpty: String? {
        isEmpty ? nil : self
    }
}
