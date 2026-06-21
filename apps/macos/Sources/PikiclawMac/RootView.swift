import AppKit
import PikiclawCore
import SwiftUI
import UniformTypeIdentifiers

private enum NativeRoute: String, CaseIterable, Identifiable {
    case chat
    case voice
    case terminal
    case projects
    case workItems
    case workPlan
    case notes
    case memory
    case workflows
    case missionControl
    case channels
    case agents
    case assistants
    case team
    case extensions
    case settings

    var id: String { rawValue }

    static let primary: [NativeRoute] = [
        .chat, .terminal, .projects, .workItems, .workPlan, .notes, .memory, .workflows,
    ]

    static let system: [NativeRoute] = [
        .missionControl, .channels, .agents, .assistants, .team, .extensions, .settings,
    ]

    var title: String {
        switch self {
        case .chat: "Conversations"
        case .voice: "Voice Lens"
        case .terminal: "Context Terminal"
        case .projects: "Projects"
        case .workItems: "Work Items"
        case .workPlan: "Work Plan"
        case .notes: "Notes"
        case .memory: "Memory"
        case .workflows: "Workflows"
        case .missionControl: "Mission Control"
        case .channels: "Channels"
        case .agents: "Agent Studio"
        case .assistants: "Assistant"
        case .team: "Team"
        case .extensions: "Extensions"
        case .settings: "Settings"
        }
    }

    var sidebarTitle: String {
        switch self {
        case .chat: "Conversations"
        case .voice: "Voice"
        case .terminal: "Terminal"
        case .projects: "Projects"
        case .workItems: "Work Items"
        case .workPlan: "Work Plan"
        case .notes: "Notes"
        case .memory: "Memory"
        case .workflows: "Workflows"
        case .missionControl: "Mission Control"
        case .channels: "Channels"
        case .agents: "Agent Studio"
        case .assistants: "Assistant"
        case .team: "Team"
        case .extensions: "Extensions"
        case .settings: "Settings"
        }
    }

    var subtitle: String {
        switch self {
        case .chat: "Start from a project, target, model, and permission mode."
        case .voice: "Speak a task, let Pikiclaw route it to an agent, and hear the report."
        case .terminal: "Open a shell in the current project, chat, or work item context."
        case .projects: "Workspace-backed project library. Rules and memory feed new chats."
        case .workItems: "Inbox, queue, and workbench for durable engineering tasks."
        case .workPlan: "Daily planning and lightweight intake before promotion to Work Items."
        case .notes: "Local notes and captured context waiting to become work evidence."
        case .memory: "Source-grounded knowledge that can be injected into project work."
        case .workflows: "Reusable work patterns for repeatable agent execution."
        case .missionControl: "Runtime health, usage, budget, blocked runs, and attention."
        case .channels: "IM terminals are equal entry points, not the product center."
        case .agents: "Install, login, configure, and test agent runtimes from one native workbench."
        case .assistants: "Purpose-built launch targets for common work."
        case .team: "Agent handoffs and multi-agent operating surfaces."
        case .extensions: "Skills, MCP servers, CLI tools, and connector capability state."
        case .settings: "System status, provider profiles, permissions, and restart controls."
        }
    }

    var symbol: String {
        switch self {
        case .chat: "text.bubble"
        case .voice: "waveform.circle"
        case .terminal: "terminal"
        case .projects: "folder"
        case .workItems: "square.grid.2x2"
        case .workPlan: "calendar"
        case .notes: "note.text"
        case .memory: "brain"
        case .workflows: "point.3.connected.trianglepath.dotted"
        case .missionControl: "gauge.with.dots.needle.67percent"
        case .channels: "bubble.left.and.bubble.right"
        case .agents: "cpu"
        case .assistants: "person.crop.circle.badge.plus"
        case .team: "person.2"
        case .extensions: "puzzlepiece.extension"
        case .settings: "gearshape"
        }
    }
}

private enum DetailTab: String, CaseIterable, Identifiable {
    case activity
    case sources
    case outputs

    var id: String { rawValue }

    var title: String {
        switch self {
        case .activity: "Activity"
        case .sources: "Sources"
        case .outputs: "Outputs"
        }
    }
}

struct RootView: View {
    @AppStorage(PKThemePreference.storageKey) private var themePreferenceRaw = PKThemePreference.dark.rawValue
    @StateObject private var model = NativeAppModel()
    @State private var route: NativeRoute = .chat
    @State private var selectedWorkspaceId: EntityID? = "workspace-pikiclaw"
    @State private var selectedWorkItemId: EntityID? = "workitem-native-v2"
    @State private var detailTab: DetailTab = .activity
    @State private var commandQuery = ""
    @State private var assistantDockOpen = false
    @State private var voiceOverlayOpen = false
    @State private var voiceOverlayAutoStart = false
    @State private var agentChatHistoryMode = false
    @State private var jiraQueueFocused = false
    @FocusState private var commandFocused: Bool

    private var themePreference: PKThemePreference {
        PKThemePreference(rawValue: themePreferenceRaw) ?? .dark
    }

    private var selectedWorkspace: Workspace? {
        model.snapshot.workspaces.first(where: { $0.id == selectedWorkspaceId }) ?? model.snapshot.workspaces.first
    }

    private var selectedWorkItem: WorkItem? {
        model.snapshot.workItems.first(where: { $0.id == selectedWorkItemId }) ?? model.snapshot.workItems.first
    }

    private var activeRun: AgentRun? {
        guard let activeRunId = model.activeRunId else { return nil }
        return model.snapshot.runs.first(where: { $0.id == activeRunId })
    }

    var body: some View {
        ZStack {
            PKTheme.surface.ignoresSafeArea()
            PikiclawGridBackground().ignoresSafeArea()

            HStack(spacing: 0) {
                AgentDock(
                    snapshot: model.snapshot,
                    selectedWorkspaceId: $selectedWorkspaceId,
                    selectedAgentKind: $model.selectedAgentKind,
                    statusLine: model.statusLine,
                    isRunning: model.isRunning,
                    jiraSyncIsRunning: model.jiraSyncIsRunning,
                    isVoiceSelected: voiceOverlayOpen || route == .voice,
                    isProjectSelected: route == .projects,
                    isJiraSelected: route == .workItems,
                    highlightsSelectedAgent: route == .chat,
                    openProjects: { navigate(.projects) },
                    openJira: openJiraQueue,
                    addProject: chooseWorkspace,
                    selectAgent: { kind in
                        closeVoiceOverlay()
                        agentChatHistoryMode = true
                        jiraQueueFocused = false
                        model.selectedAgentKind = kind
                        route = .chat
                        model.prepareNewChat()
                        Task { await model.refreshBranches(for: selectedWorkspace) }
                        commandFocused = true
                    },
                    newChat: openNewChat,
                    openVoice: { openVoiceAssistant(autoStart: true) },
                    openTerminal: openContextTerminal,
                    openAgentStudio: { navigate(.agents) },
                    openMissionControl: { navigate(.missionControl) }
                )

                Divider().overlay(PKTheme.edge)

                ZStack {
                    pageContent
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
            .overlay(alignment: .bottomTrailing) {
                if !voiceOverlayOpen {
                    VoiceLensLauncher(
                        runState: activeRun?.state,
                        isRunning: model.isRunning,
                        open: { openVoiceAssistant(autoStart: true) }
                    )
                    .padding(.trailing, 22)
                    .padding(.bottom, 22)
                    .transition(.opacity.combined(with: .scale(scale: 0.96, anchor: .bottomTrailing)))
                }
            }
            .blur(radius: voiceOverlayOpen ? 7 : 0)
            .allowsHitTesting(!voiceOverlayOpen)

            if voiceOverlayOpen {
                VoiceAssistantOverlay(
                    snapshot: model.snapshot,
                    selectedWorkspaceId: $selectedWorkspaceId,
                    selectedWorkItemId: $selectedWorkItemId,
                    model: model,
                    autoStart: voiceOverlayAutoStart,
                    close: {
                        withAnimation(.easeInOut(duration: 0.16)) {
                            voiceOverlayOpen = false
                        }
                        voiceOverlayAutoStart = false
                    },
                    navigate: navigate
                )
                .transition(.opacity.combined(with: .scale(scale: 0.98)))
                .zIndex(5)
            }
        }
        .preferredColorScheme(themePreference.colorScheme)
        .onReceive(NotificationCenter.default.publisher(for: .pikiclawNewChat)) { _ in
            openNewChat()
        }
        .onReceive(NotificationCenter.default.publisher(for: .pikiclawNewWorkItem)) { _ in
            Task<Void, Never> {
                await model.createWorkItem(workspaceId: selectedWorkspaceId)
                selectedWorkItemId = model.snapshot.workItems.first?.id
                route = .workItems
                jiraQueueFocused = false
            }
        }
        .onReceive(NotificationCenter.default.publisher(for: .pikiclawAddWorkspace)) { _ in
            chooseWorkspace()
        }
        .onReceive(NotificationCenter.default.publisher(for: .pikiclawRunSelectedWork)) { _ in
            Task<Void, Never> { await model.run(workItemId: selectedWorkItemId) }
        }
        .onReceive(NotificationCenter.default.publisher(for: .pikiclawRestartApplication)) { _ in
            model.restartApplication()
        }
        .onReceive(NotificationCenter.default.publisher(for: .pikiclawFocusCommandCenter)) { _ in
            route = .chat
            jiraQueueFocused = false
            commandFocused = true
        }
        .onReceive(NotificationCenter.default.publisher(for: .pikiclawToggleVoiceAssistant)) { _ in
            openVoiceAssistant()
        }
        .onReceive(NotificationCenter.default.publisher(for: .pikiclawOpenContextTerminal)) { _ in
            openContextTerminal()
        }
        .onReceive(NotificationCenter.default.publisher(for: .pikiclawNavigate)) { note in
            if let raw = note.object as? String, let destination = NativeRoute(rawValue: raw) {
                navigate(destination)
            }
        }
        .background(
            JiraCommandBridge(
                model: model,
                selectedWorkspaceId: $selectedWorkspaceId,
                selectedWorkItemId: $selectedWorkItemId,
                openQueue: openJiraQueue,
                openTicket: openJiraTicket,
                openChat: {
                    route = .chat
                }
            )
        )
    }

    @ViewBuilder
    private var pageContent: some View {
        switch route {
        case .chat:
            ChatHomeView(
                snapshot: model.snapshot,
                selectedWorkspaceId: $selectedWorkspaceId,
                selectedWorkItemId: $selectedWorkItemId,
                commandQuery: $commandQuery,
                commandFocused: $commandFocused,
                assistantDockOpen: $assistantDockOpen,
                model: model,
                showsAgentHistory: agentChatHistoryMode,
                navigate: navigate
            )
        case .voice:
            VoiceAssistantPage(
                snapshot: model.snapshot,
                selectedWorkspaceId: $selectedWorkspaceId,
                selectedWorkItemId: $selectedWorkItemId,
                model: model,
                navigate: navigate
            )
        case .terminal:
            ContextTerminalPage(
                snapshot: model.snapshot,
                selectedWorkspace: selectedWorkspace,
                selectedWorkItem: selectedWorkItem,
                selectedAgentKind: model.selectedAgentKind,
                selectedPermissionMode: model.selectedPermissionMode,
                activeRun: activeRun,
                model: model,
                openChat: {
                    route = .chat
                    commandFocused = true
                },
                openWorkItem: {
                    route = .workItems
                },
                refreshBranches: {
                    Task { await model.refreshBranches(for: selectedWorkspace) }
                }
            )
        case .projects:
            ProjectsPage(
                snapshot: model.snapshot,
                selectedWorkspaceId: $selectedWorkspaceId,
                selectedWorkItemId: $selectedWorkItemId,
                model: model,
                newProject: chooseWorkspace,
                navigate: navigate
            )
        case .workItems:
            WorkItemsPage(
                snapshot: model.snapshot,
                selectedWorkItemId: $selectedWorkItemId,
                selectedWorkspaceId: $selectedWorkspaceId,
                detailTab: $detailTab,
                model: model,
                navigate: navigate
            )
        case .workPlan:
            WorkPlanPage(snapshot: model.snapshot, promote: {
                route = .workItems
                Task { await model.createWorkItem(workspaceId: selectedWorkspaceId) }
            })
        case .notes:
            NotesPage(snapshot: model.snapshot)
        case .memory:
            MemoryPage(snapshot: model.snapshot)
        case .workflows:
            WorkflowPage(
                snapshot: model.snapshot,
                selectedWorkspaceId: $selectedWorkspaceId,
                selectedWorkItemId: $selectedWorkItemId,
                model: model,
                navigate: navigate
            )
        case .missionControl:
            MissionControlPage(
                snapshot: model.snapshot,
                selectedWorkspaceId: $selectedWorkspaceId,
                selectedWorkItemId: $selectedWorkItemId,
                model: model,
                navigate: navigate,
                refresh: {
                    Task { await model.reload() }
                }
            )
        case .agents:
            AgentStudioPage(
                snapshot: model.snapshot,
                selectedAgentKind: $model.selectedAgentKind,
                selectedWorkspaceId: $selectedWorkspaceId,
                selectedWorkItemId: $selectedWorkItemId,
                model: model,
                navigate: navigate
            )
        case .assistants:
            AssistantSurfacePage(
                snapshot: model.snapshot,
                selectedWorkspaceId: $selectedWorkspaceId,
                selectedWorkItemId: $selectedWorkItemId,
                model: model,
                navigate: navigate
            )
        case .channels, .team, .extensions, .settings:
            SystemSurfacePage(
                route: route,
                snapshot: model.snapshot,
                statusLine: model.statusLine,
                restartBlocked: model.restartBlockedByActiveRun,
                restart: { model.restartApplication() },
                refresh: {
                    Task { await model.reload() }
                }
            )
        }
    }

    private func navigate(_ next: NativeRoute) {
        if next == .voice {
            openVoiceAssistant(autoStart: true)
            return
        }
        closeVoiceOverlay()
        jiraQueueFocused = false
        route = next
    }

    private func openNewChat() {
        closeVoiceOverlay()
        route = .chat
        jiraQueueFocused = false
        agentChatHistoryMode = false
        model.prepareNewChat()
        Task<Void, Never> { await model.refreshBranches(for: selectedWorkspace) }
        commandFocused = true
    }

    private func openVoiceAssistant(autoStart: Bool = true) {
        if voiceOverlayOpen {
            closeVoiceOverlay()
            return
        }
        voiceOverlayAutoStart = autoStart
        withAnimation(.easeInOut(duration: 0.18)) {
            voiceOverlayOpen = true
        }
        assistantDockOpen = false
        commandFocused = false
    }

    private func openContextTerminal() {
        closeVoiceOverlay()
        route = .terminal
        jiraQueueFocused = false
        assistantDockOpen = false
        commandFocused = false
        Task<Void, Never> { await model.refreshBranches(for: selectedWorkspace) }
    }

    private func openJiraQueue() {
        closeVoiceOverlay()
        route = .workItems
        jiraQueueFocused = true
        if let firstJira = jiraTicketCardCandidates(from: model.snapshot.workItems, selectedWorkItemId: selectedWorkItemId, limit: 1).first {
            selectedWorkItemId = firstJira.id
            selectedWorkspaceId = firstJira.workspaceId
        }
        syncJiraOnFirstOpenIfNeeded()
    }

    private func openJiraTicket(_ itemId: EntityID) {
        closeVoiceOverlay()
        jiraQueueFocused = true
        selectedWorkItemId = itemId
        if let item = model.snapshot.workItems.first(where: { $0.id == itemId }) {
            selectedWorkspaceId = item.workspaceId
        }
        route = .workItems
    }

    private func chooseWorkspace() {
        closeVoiceOverlay()
        let panel = NSOpenPanel()
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.allowsMultipleSelection = false
        panel.prompt = "Add Workspace"
        if panel.runModal() == .OK, let url = panel.url {
            Task<Void, Never> {
                await model.addWorkspace(path: url.path)
                selectedWorkspaceId = model.snapshot.workspaces.first(where: { $0.pathDisplay == url.path })?.id
                route = .projects
                jiraQueueFocused = false
            }
        }
    }

    private func syncJiraOnFirstOpenIfNeeded() {
        let hasJiraItems = model.snapshot.workItems.contains { $0.sourceType == .jira }
        guard !hasJiraItems, !model.jiraSyncIsRunning else { return }
        Task<Void, Never> {
            if let itemId = await model.syncJiraTickets(scope: .currentSprint, workspaceId: selectedWorkspaceId) {
                selectedWorkItemId = itemId
                selectedWorkspaceId = model.snapshot.workItems.first(where: { $0.id == itemId })?.workspaceId ?? selectedWorkspaceId
            }
        }
    }

    private func closeVoiceOverlay() {
        if voiceOverlayOpen {
            withAnimation(.easeInOut(duration: 0.12)) {
                voiceOverlayOpen = false
            }
        }
        voiceOverlayAutoStart = false
    }
}

private struct JiraCommandBridge: View {
    @ObservedObject var model: NativeAppModel
    @Binding var selectedWorkspaceId: EntityID?
    @Binding var selectedWorkItemId: EntityID?
    let openQueue: () -> Void
    let openTicket: (EntityID) -> Void
    let openChat: () -> Void

    var body: some View {
        EmptyView()
            .onReceive(NotificationCenter.default.publisher(for: .pikiclawSyncJiraCurrentSprint)) { _ in
                Task<Void, Never> {
                    if let itemId = await model.syncJiraTickets(scope: .currentSprint, workspaceId: selectedWorkspaceId) {
                        selectedWorkItemId = itemId
                    }
                    openQueue()
                }
            }
            .onReceive(NotificationCenter.default.publisher(for: .pikiclawOpenJiraQueue)) { _ in
                openQueue()
            }
            .onReceive(NotificationCenter.default.publisher(for: .pikiclawOpenJiraTicket)) { note in
                if let raw = note.object as? String {
                    openTicket(EntityID(raw))
                } else {
                    openQueue()
                }
            }
            .onReceive(NotificationCenter.default.publisher(for: .pikiclawStartSelectedJiraTicket)) { note in
                Task<Void, Never> {
                    let itemId = (note.object as? String).map { EntityID($0) } ?? selectedWorkItemId
                    if let runId = await model.startJiraTicketWork(workItemId: itemId),
                       let run = model.snapshot.runs.first(where: { $0.id == runId }) {
                        selectedWorkItemId = run.workItemId
                        selectedWorkspaceId = run.workspaceId
                        openChat()
                    }
                }
            }
    }
}

private struct ProjectChatCanvasBackground: View {
    let accent: Color
    var cornerRadius: CGFloat = 18

    var body: some View {
        RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
            .fill(PKTheme.panel.opacity(0.56))
            .overlay(
                LinearGradient(
                    colors: [
                        accent.opacity(0.13),
                        PKTheme.surfaceRaised.opacity(0.18),
                        PKTheme.surface.opacity(0.10)
                    ],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                )
                .clipShape(RoundedRectangle(cornerRadius: cornerRadius, style: .continuous))
            )
    }
}

private struct PikiclawGridBackground: View {
    var body: some View {
        GeometryReader { proxy in
            Canvas { context, size in
                let step: CGFloat = 72
                var path = Path()
                var x: CGFloat = 0
                while x <= size.width {
                    path.move(to: CGPoint(x: x, y: 0))
                    path.addLine(to: CGPoint(x: x, y: size.height))
                    x += step
                }
                var y: CGFloat = 0
                while y <= size.height {
                    path.move(to: CGPoint(x: 0, y: y))
                    path.addLine(to: CGPoint(x: size.width, y: y))
                    y += step
                }
                context.stroke(path, with: .color(PKTheme.gridLine), lineWidth: 1)
            }
            .overlay(
                RadialGradient(
                    colors: [PKTheme.primary.opacity(0.12), .clear],
                    center: .topLeading,
                    startRadius: 80,
                    endRadius: max(proxy.size.width, proxy.size.height)
                )
            )
        }
    }
}

private struct AgentDock: View {
    let snapshot: NativeStoreSnapshot
    @Binding var selectedWorkspaceId: EntityID?
    @Binding var selectedAgentKind: NativeAgentKind
    let statusLine: String
    let isRunning: Bool
    let jiraSyncIsRunning: Bool
    let isVoiceSelected: Bool
    let isProjectSelected: Bool
    let isJiraSelected: Bool
    let highlightsSelectedAgent: Bool
    let openProjects: () -> Void
    let openJira: () -> Void
    let addProject: () -> Void
    let selectAgent: (NativeAgentKind) -> Void
    let newChat: () -> Void
    let openVoice: () -> Void
    let openTerminal: () -> Void
    let openAgentStudio: () -> Void
    let openMissionControl: () -> Void

    private var attentionRunCount: Int {
        snapshot.runs.filter { $0.state == .waitingForUser || $0.state == .failed }.count
    }

    var body: some View {
        VStack(spacing: 12) {
            BrandMark(size: 46)
                .padding(.top, 12)
                .help("Pikiclaw")

            Button(action: newChat) {
                VStack(spacing: 3) {
                    Image(systemName: "plus")
                        .font(.system(size: 16, weight: .semibold))
                    Text("New")
                        .font(.system(size: 8.5, weight: .bold))
                }
                .frame(width: 54, height: 52)
                .background(PKTheme.primary)
                .foregroundStyle(PKTheme.primaryText)
                .overlay(RoundedRectangle(cornerRadius: 11).stroke(PKTheme.primary.opacity(0.95), lineWidth: 1))
                .clipShape(RoundedRectangle(cornerRadius: 11))
            }
            .buttonStyle(.plain)
            .help("New \(agentShortLabel(selectedAgentKind)) chat in \(projectTitle(for: selectedWorkspaceId, snapshot: snapshot))")

            Button(action: openVoice) {
                VoiceDockButton(isLive: isRunning, isSelected: isVoiceSelected)
            }
            .buttonStyle(.plain)
            .help("Voice Lens")

            ProjectDockTile(
                snapshot: snapshot,
                selectedWorkspaceId: $selectedWorkspaceId,
                isProjectSelected: isProjectSelected,
                isJiraSelected: isJiraSelected,
                isSyncingJira: jiraSyncIsRunning,
                openProjects: openProjects,
                openJira: openJira,
                addProject: addProject
            )

            Divider()
                .overlay(PKTheme.edge)
                .padding(.horizontal, 16)

            VStack(spacing: 8) {
                ForEach(enabledAgentProfiles(in: snapshot)) { profile in
                    let kind = profile.kind
                    let profileRuns = snapshot.runs.filter { $0.agentProfileId == profile.id }
                    let profileAttentionCount = profileRuns.filter { $0.state == .waitingForUser || $0.state == .failed }.count
                    let profileHasActiveRun = profileRuns.contains { isLiveRunState($0.state) }
                    Button {
                        selectAgent(kind)
                    } label: {
                        let isSelected = highlightsSelectedAgent && selectedAgentKind == kind
                        ZStack(alignment: .topTrailing) {
                            VStack(spacing: 4) {
                                Image(systemName: agentSymbol(kind))
                                    .font(.system(size: 15, weight: .semibold))
                                Text(agentShortLabel(kind))
                                    .font(.system(size: 9, weight: .semibold))
                                    .lineLimit(1)
                                    .minimumScaleFactor(0.7)
                            }
                            .frame(width: 54, height: 52)

                            if profileAttentionCount > 0 {
                                DockBadge(text: profileAttentionCount > 9 ? "9+" : "\(profileAttentionCount)", color: PKTheme.warn)
                                    .offset(x: 6, y: -5)
                            } else if profileHasActiveRun {
                                Dot(color: PKTheme.ok)
                                    .padding(6)
                            }
                        }
                        .frame(width: 54, height: 52)
                        .foregroundStyle(isSelected ? PKTheme.primaryText : PKTheme.text3)
                        .background(isSelected ? agentTint(kind) : PKTheme.panel.opacity(0.54))
                        .overlay(
                            RoundedRectangle(cornerRadius: 11)
                                .stroke(isSelected ? agentTint(kind).opacity(0.95) : PKTheme.edge, lineWidth: 1)
                        )
                        .clipShape(RoundedRectangle(cornerRadius: 11))
                    }
                    .buttonStyle(.plain)
                    .help(agentDockHelp(profile: profile, active: profileHasActiveRun, attentionCount: profileAttentionCount, snapshot: snapshot))
                }
            }

            Spacer()

            Button(action: openTerminal) {
                Image(systemName: "terminal")
                    .font(.system(size: 15, weight: .semibold))
                    .frame(width: 42, height: 42)
                    .background(PKTheme.panel.opacity(0.62))
                    .foregroundStyle(PKTheme.primary)
                    .overlay(RoundedRectangle(cornerRadius: 10).stroke(PKTheme.primary.opacity(0.34), lineWidth: 1))
                    .clipShape(RoundedRectangle(cornerRadius: 10))
            }
            .buttonStyle(.plain)
            .help("Context Terminal")

            Button(action: openAgentStudio) {
                Image(systemName: "cpu")
                    .font(.system(size: 15, weight: .semibold))
                    .frame(width: 42, height: 42)
                    .background(PKTheme.panel.opacity(0.62))
                    .foregroundStyle(PKTheme.text3)
                    .overlay(RoundedRectangle(cornerRadius: 10).stroke(PKTheme.edge, lineWidth: 1))
                    .clipShape(RoundedRectangle(cornerRadius: 10))
            }
            .buttonStyle(.plain)
            .help("Agent Studio")

            Button(action: openMissionControl) {
                ZStack(alignment: .topTrailing) {
                    Image(systemName: "gauge.with.dots.needle.67percent")
                        .font(.system(size: 15, weight: .semibold))
                        .frame(width: 42, height: 42)
                        .background(PKTheme.panel.opacity(0.62))
                        .foregroundStyle(isRunning ? PKTheme.ok : PKTheme.text3)
                        .overlay(RoundedRectangle(cornerRadius: 10).stroke(PKTheme.edge, lineWidth: 1))
                        .clipShape(RoundedRectangle(cornerRadius: 10))

                    if attentionRunCount > 0 {
                        DockBadge(text: attentionRunCount > 9 ? "9+" : "\(attentionRunCount)", color: PKTheme.warn)
                            .offset(x: 7, y: -6)
                    }
                }
            }
            .buttonStyle(.plain)
            .help(attentionRunCount > 0 ? "\(attentionRunCount) run(s) need attention" : statusLine)
            .padding(.bottom, 12)
        }
        .frame(width: 82)
        .background(PKTheme.sidebar)
    }
}

private struct DockBadge: View {
    let text: String
    let color: Color

    var body: some View {
        Text(text)
            .font(.system(size: 8, weight: .heavy))
            .foregroundStyle(PKTheme.primaryText)
            .frame(minWidth: 16, minHeight: 16)
            .background(color)
            .clipShape(Capsule())
    }
}

private struct ProjectDockTile: View {
    let snapshot: NativeStoreSnapshot
    @Binding var selectedWorkspaceId: EntityID?
    let isProjectSelected: Bool
    let isJiraSelected: Bool
    let isSyncingJira: Bool
    let openProjects: () -> Void
    let openJira: () -> Void
    let addProject: () -> Void

    private var selectedTitle: String {
        projectTitle(for: selectedWorkspaceId, snapshot: snapshot)
    }

    private var hasSelection: Bool {
        selectedWorkspaceId != nil || !snapshot.projects.isEmpty || !snapshot.workspaces.isEmpty
    }

    private var jiraCount: Int {
        snapshot.workItems.filter { $0.sourceType == .jira && $0.state != .done && $0.state != .cancelled }.count
    }

    var body: some View {
        VStack(spacing: 7) {
            Button(action: openProjects) {
                VStack(spacing: 4) {
                    ZStack(alignment: .topTrailing) {
                        Image(systemName: "folder")
                            .font(.system(size: 15, weight: .semibold))
                            .frame(width: 28, height: 24)
                        Dot(color: hasSelection ? PKTheme.primary : PKTheme.warn)
                            .offset(x: 6, y: -2)
                    }

                    Text("Project")
                        .font(.system(size: 9, weight: .semibold))
                        .lineLimit(1)
                        .minimumScaleFactor(0.7)
                }
                .frame(width: 54, height: 52)
                .foregroundStyle(isProjectSelected ? PKTheme.primaryText : hasSelection ? PKTheme.primary : PKTheme.text3)
                .background(isProjectSelected ? PKTheme.primary : PKTheme.panel.opacity(0.54))
                .overlay(
                    RoundedRectangle(cornerRadius: 11)
                        .stroke(isProjectSelected ? PKTheme.primary.opacity(0.95) : hasSelection ? PKTheme.primary.opacity(0.56) : PKTheme.edge, lineWidth: 1)
                )
                .clipShape(RoundedRectangle(cornerRadius: 11))
            }
            .buttonStyle(.plain)
            .contextMenu {
                Button("Open Projects", systemImage: "folder", action: openProjects)
                Button("Open Jira", systemImage: "checklist", action: openJira)
                Button("Add Project...", systemImage: "plus", action: addProject)
            }
            .help("Project: \(selectedTitle)")

            Button(action: openJira) {
                ZStack(alignment: .topTrailing) {
                    VStack(spacing: 4) {
                        Image(systemName: isSyncingJira ? "arrow.triangle.2.circlepath" : "checklist")
                            .font(.system(size: 13, weight: .semibold))
                        Text("Jira")
                            .font(.system(size: 9, weight: .semibold))
                            .lineLimit(1)
                    }
                    .frame(width: 54, height: 52)

                    if jiraCount > 0 {
                        Text(jiraCount > 9 ? "9+" : "\(jiraCount)")
                            .font(.system(size: 8, weight: .bold))
                            .foregroundStyle(PKTheme.primaryText)
                            .frame(minWidth: 15, minHeight: 15)
                            .background(PKTheme.primary)
                            .clipShape(Circle())
                            .offset(x: 6, y: -6)
                    } else if isSyncingJira {
                        Dot(color: PKTheme.ok)
                            .offset(x: 6, y: -6)
                    }
                }
                .frame(width: 54, height: 52)
                .foregroundStyle(isJiraSelected ? PKTheme.primaryText : isSyncingJira ? PKTheme.ok : jiraCount > 0 ? PKTheme.primary : PKTheme.text3)
                .background(isJiraSelected ? PKTheme.primary : PKTheme.panel.opacity(0.46))
                .overlay(
                    RoundedRectangle(cornerRadius: 11)
                        .stroke(isJiraSelected ? PKTheme.primary.opacity(0.95) : isSyncingJira ? PKTheme.ok.opacity(0.42) : jiraCount > 0 ? PKTheme.primary.opacity(0.34) : PKTheme.edge, lineWidth: 1)
                )
                .clipShape(RoundedRectangle(cornerRadius: 11))
            }
            .buttonStyle(.plain)
            .contextMenu {
                Button("Open Jira Queue", systemImage: "checklist", action: openJira)
                Button("Sync from Jira", systemImage: "arrow.clockwise") {
                    NotificationCenter.default.post(name: .pikiclawSyncJiraCurrentSprint, object: nil)
                }
            }
            .help(isSyncingJira ? "Syncing Jira current sprint" : jiraCount > 0 ? "\(jiraCount) Jira ticket(s)" : "Open Jira")
        }
    }
}

private struct VoiceLensLauncher: View {
    let runState: RunState?
    let isRunning: Bool
    let open: () -> Void
    @State private var isHovering = false

    private var tint: Color {
        if isRunning { return PKTheme.ok }
        if runState == .waitingForUser { return PKTheme.warn }
        if runState == .failed { return PKTheme.err }
        return PKTheme.primary
    }

    private var isAttending: Bool {
        isHovering || isRunning || runState == .waitingForUser
    }

    var body: some View {
        Button(action: open) {
            ZStack {
                VoiceLauncherBloom(color: tint, isLive: isAttending, isHovering: isHovering)
                    .frame(width: 74, height: 74)

                Circle()
                    .stroke(Color.white.opacity(isHovering ? 0.30 : 0.18), lineWidth: 1)
                    .frame(width: 58, height: 58)

                Image(systemName: isRunning ? "waveform.path.ecg" : "waveform")
                    .font(.system(size: 22, weight: .semibold))
                    .foregroundStyle(Color.white.opacity(0.94))
                    .shadow(color: tint.opacity(0.60), radius: 9, y: 3)
            }
            .frame(width: 78, height: 78)
            .contentShape(Circle())
            .scaleEffect(isHovering ? 1.06 : 1)
            .shadow(color: tint.opacity(isAttending ? 0.42 : 0.24), radius: isAttending ? 26 : 18, y: 12)
        }
        .buttonStyle(.plain)
        .onHover { hovering in
            withAnimation(.spring(response: 0.24, dampingFraction: 0.72)) {
                isHovering = hovering
            }
        }
        .help("Open Voice Chat")
        .accessibilityLabel("Open Voice Chat")
    }
}

private struct VoiceLauncherBloom: View {
    let color: Color
    let isLive: Bool
    let isHovering: Bool

    var body: some View {
        TimelineView(.animation) { timeline in
            let seconds = timeline.date.timeIntervalSinceReferenceDate
            ZStack {
                ForEach(0..<4, id: \.self) { index in
                    Circle()
                        .fill(blobColor(index: index).opacity(isLive ? 0.32 : 0.18))
                        .frame(width: blobSize(index: index), height: blobSize(index: index))
                        .offset(blobOffset(index: index, seconds: seconds))
                        .blur(radius: 9)
                }

                Circle()
                    .fill(.ultraThinMaterial)
                    .frame(width: 64, height: 64)

                Circle()
                    .fill(
                        RadialGradient(
                            colors: [
                                Color.white.opacity(0.50),
                                color.opacity(isLive ? 0.46 : 0.28),
                                PKTheme.panelAlt.opacity(0.74)
                            ],
                            center: .topLeading,
                            startRadius: 2,
                            endRadius: 68
                        )
                    )
                    .frame(width: 62, height: 62)

                Circle()
                    .stroke(color.opacity(isLive ? 0.42 : 0.24), lineWidth: 1)
                    .frame(width: isHovering ? 72 : 66, height: isHovering ? 72 : 66)
            }
        }
    }

    private func blobColor(index: Int) -> Color {
        switch index {
        case 0: return color
        case 1: return PKTheme.ok
        case 2: return PKTheme.primary
        default: return Color.white
        }
    }

    private func blobSize(index: Int) -> CGFloat {
        [44, 36, 30, 24][index]
    }

    private func blobOffset(index: Int, seconds: TimeInterval) -> CGSize {
        let speed = isLive ? 1.24 : 0.54
        let phase = seconds * speed + Double(index) * 1.74
        let radius = CGFloat(isHovering ? 13 : (isLive ? 10 : 7))
        return CGSize(
            width: CGFloat(cos(phase)) * radius,
            height: CGFloat(sin(phase * 0.82)) * radius
        )
    }
}

private struct VoiceOverlayAtmosphere: View {
    let color: Color
    let isLive: Bool

    var body: some View {
        TimelineView(.animation) { timeline in
            let seconds = timeline.date.timeIntervalSinceReferenceDate
            ZStack {
                ForEach(0..<4, id: \.self) { index in
                    Circle()
                        .stroke(color.opacity(isLive ? 0.14 : 0.07), lineWidth: index == 0 ? 1.2 : 0.8)
                        .frame(width: ringSize(index: index, seconds: seconds), height: ringSize(index: index, seconds: seconds))
                        .offset(ringOffset(index: index, seconds: seconds))
                        .blur(radius: CGFloat(index) * 1.5)
                }

                RadialGradient(
                    colors: [
                        color.opacity(isLive ? 0.18 : 0.10),
                        PKTheme.ok.opacity(isLive ? 0.08 : 0.03),
                        Color.clear
                    ],
                    center: .center,
                    startRadius: 60,
                    endRadius: 540
                )
                .opacity(0.72)
            }
        }
        .allowsHitTesting(false)
    }

    private func ringSize(index: Int, seconds: TimeInterval) -> CGFloat {
        let base = CGFloat(380 + index * 120)
        let pulse = CGFloat(sin(seconds * (isLive ? 0.90 : 0.38) + Double(index))) * CGFloat(isLive ? 24 : 10)
        return base + pulse
    }

    private func ringOffset(index: Int, seconds: TimeInterval) -> CGSize {
        let phase = seconds * (isLive ? 0.45 : 0.20) + Double(index) * 1.3
        return CGSize(
            width: CGFloat(cos(phase)) * CGFloat(38 + index * 9),
            height: CGFloat(sin(phase * 0.76)) * CGFloat(28 + index * 6)
        )
    }
}

private struct PikiclawSidebar: View {
    @Binding var route: NativeRoute
    @Binding var selectedWorkspaceId: EntityID?
    @Binding var selectedWorkItemId: EntityID?
    let snapshot: NativeStoreSnapshot
    let statusLine: String
    let isRunning: Bool
    let newChat: () -> Void

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 10) {
                BrandMark()
                VStack(alignment: .leading, spacing: 2) {
                    Text("Pikiclaw")
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(PKTheme.text)
                    Text("PERCEIVES · REASONS · ACTS")
                        .font(.system(size: 9, weight: .medium))
                        .foregroundStyle(PKTheme.text3)
                }
                Spacer()
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 14)

            Button(action: newChat) {
                Label("New Chat", systemImage: "plus")
                    .font(.system(size: 13, weight: .semibold))
                    .frame(maxWidth: .infinity, minHeight: 36, alignment: .leading)
                    .padding(.horizontal, 12)
                    .background(PKTheme.surfaceHover.opacity(0.76))
                    .clipShape(RoundedRectangle(cornerRadius: 7))
            }
            .buttonStyle(.plain)
            .foregroundStyle(PKTheme.text)
            .padding(.horizontal, 12)
            .padding(.bottom, 12)

            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    RouteGroup(
                        routes: NativeRoute.primary,
                        route: $route
                    )
                    RouteGroup(
                        routes: NativeRoute.system,
                        route: $route
                    )

                    RecentBlock(
                        snapshot: snapshot,
                        selectedWorkspaceId: $selectedWorkspaceId,
                        selectedWorkItemId: $selectedWorkItemId,
                        route: $route
                    )
                }
                .padding(.horizontal, 12)
            }

            VStack(spacing: 9) {
                HStack {
                    Dot(color: isRunning ? PKTheme.ok : PKTheme.primary)
                    Text(isRunning ? "Running" : "Ready")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(PKTheme.text2)
                    Spacer()
                    Text("v0.4.0")
                        .font(.caption2)
                        .foregroundStyle(PKTheme.text3)
                }
                .padding(.horizontal, 10)
                .frame(height: 34)
                .background(PKTheme.surfaceHover.opacity(0.64))
                .overlay(RoundedRectangle(cornerRadius: 7).stroke(PKTheme.edge, lineWidth: 1))
                .clipShape(RoundedRectangle(cornerRadius: 7))

                Button {
                    NotificationCenter.default.post(name: .pikiclawFocusCommandCenter, object: nil)
                } label: {
                    Label(statusLine, systemImage: "command")
                        .font(.caption)
                        .lineLimit(1)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                .buttonStyle(.plain)
                .foregroundStyle(PKTheme.text3)
            }
            .padding(12)
            .overlay(alignment: .top) { Rectangle().fill(PKTheme.edge).frame(height: 1) }
        }
        .frame(width: 244)
        .background(PKTheme.sidebar)
    }
}

private struct RouteGroup: View {
    let routes: [NativeRoute]
    @Binding var route: NativeRoute

    var body: some View {
        VStack(spacing: 4) {
            ForEach(routes) { item in
                Button {
                    route = item
                } label: {
                    HStack(spacing: 11) {
                        Image(systemName: item.symbol)
                            .font(.system(size: 13, weight: .medium))
                            .frame(width: 18)
                        Text(item.sidebarTitle)
                            .font(.system(size: 13, weight: route == item ? .semibold : .regular))
                        Spacer()
                    }
                    .foregroundStyle(route == item ? PKTheme.text : PKTheme.text4)
                    .padding(.horizontal, 10)
                    .frame(height: 36)
                    .background(route == item ? PKTheme.surfaceHover.opacity(0.86) : .clear)
                    .overlay(alignment: .leading) {
                        if route == item {
                            RoundedRectangle(cornerRadius: 2)
                                .fill(PKTheme.primary)
                                .frame(width: 3, height: 22)
                        }
                    }
                    .clipShape(RoundedRectangle(cornerRadius: 7))
                }
                .buttonStyle(.plain)
            }
        }
    }
}

private struct RecentBlock: View {
    let snapshot: NativeStoreSnapshot
    @Binding var selectedWorkspaceId: EntityID?
    @Binding var selectedWorkItemId: EntityID?
    @Binding var route: NativeRoute

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("RECENTS")
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(PKTheme.text3)
                Spacer()
                Text("\(snapshot.runs.count + snapshot.workItems.count)")
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(PKTheme.text3)
                    .padding(.horizontal, 7)
                    .frame(height: 22)
                    .background(PKTheme.surfaceHover.opacity(0.7))
                    .clipShape(Capsule())
            }

            ForEach(snapshot.workItems.prefix(4)) { item in
                Button {
                    selectedWorkspaceId = item.workspaceId
                    selectedWorkItemId = item.id
                    route = .workItems
                } label: {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(item.title)
                            .font(.system(size: 12, weight: .medium))
                            .foregroundStyle(PKTheme.text2)
                            .lineLimit(1)
                        Text("\(sourceLabel(item.sourceType)) · \(item.state.rawValue)")
                            .font(.caption2)
                            .foregroundStyle(PKTheme.text3)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.top, 4)
    }
}

private struct ChatHomeView: View {
    let snapshot: NativeStoreSnapshot
    @Binding var selectedWorkspaceId: EntityID?
    @Binding var selectedWorkItemId: EntityID?
    @Binding var commandQuery: String
    var commandFocused: FocusState<Bool>.Binding
    @Binding var assistantDockOpen: Bool
    @ObservedObject var model: NativeAppModel
    let showsAgentHistory: Bool
    let navigate: (NativeRoute) -> Void
    @AppStorage("PikiclawMac.chatHistoryVisible") private var chatHistoryVisible = true
    @State private var focusedSideRunId: EntityID?
    @State private var hiddenSideRunIds: Set<EntityID> = []

    private var selectedWorkspace: Workspace? {
        snapshot.workspaces.first(where: { $0.id == selectedWorkspaceId }) ?? snapshot.workspaces.first
    }

    private var activeRun: AgentRun? {
        guard let activeRunId = model.activeRunId else { return nil }
        return snapshot.runs.first(where: { $0.id == activeRunId })
    }

    private var selectedWorkItem: WorkItem? {
        snapshot.workItems.first(where: { $0.id == selectedWorkItemId })
    }

    var body: some View {
        HStack(spacing: 0) {
            if showsAgentHistory && chatHistoryVisible {
                ChatHistoryPane(
                    snapshot: snapshot,
                    selectedAgentKind: model.selectedAgentKind,
                    activeRunId: model.activeRunId,
                    focusedSideRunId: focusedSideRunId,
                    hiddenSideRunIds: hiddenSideRunIds,
                    selectRun: { run in
                        model.activeRunId = run.id
                        focusedSideRunId = nil
                        selectedWorkspaceId = run.workspaceId
                        selectedWorkItemId = run.workItemId
                        Task { await model.markChatRead(runId: run.id) }
                    },
                    selectSideRun: { parent, child in
                        model.activeRunId = parent.id
                        focusedSideRunId = child.id
                        hiddenSideRunIds.remove(child.id)
                        trimVisibleSideRuns(parentId: parent.id, keeping: child.id)
                        selectedWorkspaceId = child.workspaceId
                        selectedWorkItemId = child.workItemId
                        Task { await model.markChatRead(runId: child.id) }
                    },
                    newChat: {
                        model.prepareNewChat()
                        focusedSideRunId = nil
                        Task { await model.refreshBranches(for: selectedWorkspace) }
                        commandFocused.wrappedValue = true
                    },
                    hideHistory: {
                        withAnimation(.easeInOut(duration: 0.16)) {
                            chatHistoryVisible = false
                        }
                    },
                    openRunInNewWindow: { run in
                        Task { await model.markChatRead(runId: run.id) }
                        DetachedChatWindowRegistry.shared.open(run: run, snapshot: snapshot)
                    },
                    attachSideChat: { parent, child in
                        Task {
                            await model.attachSideChat(parentRunId: parent.id, childRunId: child.id)
                            focusedSideRunId = child.id
                            hiddenSideRunIds.remove(child.id)
                            trimVisibleSideRuns(parentId: parent.id, keeping: child.id)
                            selectedWorkspaceId = child.workspaceId
                            selectedWorkItemId = child.workItemId
                        }
                    },
                    detachSideChat: { run, focus in
                        Task {
                            await model.detachSideChat(runId: run.id, focus: focus)
                            hiddenSideRunIds.remove(run.id)
                            if focus {
                                focusedSideRunId = nil
                                selectedWorkspaceId = run.workspaceId
                                selectedWorkItemId = run.workItemId
                            }
                        }
                    },
                    deleteRun: { run in
                        hiddenSideRunIds.remove(run.id)
                        Task { await model.deleteChat(runId: run.id) }
                    }
                )
                .frame(width: 312)

                Divider().overlay(PKTheme.edge)
            }

            ZStack {
                if model.activeRunId != nil {
                    NativeMultiChatWorkspace(
                        activeRun: activeRun,
                        snapshot: snapshot,
                        selectedWorkspace: selectedWorkspace,
                        selectedWorkspaceId: $selectedWorkspaceId,
                        selectedWorkItemId: $selectedWorkItemId,
                        model: model,
                        focusedSideRunId: $focusedSideRunId,
                        hiddenSideRunIds: $hiddenSideRunIds,
                        newChat: {
                            model.prepareNewChat()
                            focusedSideRunId = nil
                            Task { await model.refreshBranches(for: selectedWorkspace) }
                            commandFocused.wrappedValue = true
                        },
                        addInlineSideChat: { parent in
                            Task {
                                if let childId = await model.createInlineSideChat(parentRunId: parent.id) {
                                    focusedSideRunId = childId
                                    hiddenSideRunIds.remove(childId)
                                    trimVisibleSideRuns(parentId: parent.id, keeping: childId)
                                }
                            }
                        },
                        detachSideChat: { run in
                            Task {
                                await model.detachSideChat(runId: run.id, focus: true)
                                hiddenSideRunIds.remove(run.id)
                                focusedSideRunId = nil
                                selectedWorkspaceId = run.workspaceId
                                selectedWorkItemId = run.workItemId
                            }
                        },
                        openWorkItem: {
                            if let itemId = activeRun?.workItemId {
                                selectedWorkItemId = itemId
                            }
                            navigate(.workItems)
                        }
                    )
                    .padding(.horizontal, 24)
                    .padding(.top, 12)
                    .padding(.bottom, 24)
                } else {
                    NewChatLauncher(
                        snapshot: snapshot,
                        selectedWorkspaceId: $selectedWorkspaceId,
                        selectedWorkItemId: $selectedWorkItemId,
                        commandFocused: commandFocused,
                        model: model,
                        openTerminal: {
                            navigate(.terminal)
                        },
                        send: {
                            Task {
                                if let runId = await model.startChat(
                                    workspaceId: selectedWorkspaceId,
                                    targetWorkItemId: selectedWorkItemId
                                ),
                                   let run = model.snapshot.runs.first(where: { $0.id == runId }) {
                                    selectedWorkItemId = run.workItemId
                                }
                            }
                        }
                    )
                    .padding(24)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .overlay(alignment: .topLeading) {
                if showsAgentHistory && !chatHistoryVisible {
                    ChatHistoryRevealButton {
                        withAnimation(.easeInOut(duration: 0.16)) {
                            chatHistoryVisible = true
                        }
                    }
                    .padding(.leading, 10)
                    .padding(.top, 10)
                }
            }

            if assistantDockOpen {
                Divider().overlay(PKTheme.edge)
                AssistantInspector(
                    snapshot: snapshot,
                    selectedWorkspace: selectedWorkspace,
                    selectedWorkspaceId: $selectedWorkspaceId,
                    selectedWorkItemId: $selectedWorkItemId,
                    selectedWorkItem: selectedWorkItem,
                    model: model,
                    activeRun: activeRun,
                    close: { assistantDockOpen = false },
                    navigate: navigate
                )
                .frame(width: 388)
                .padding(18)
            }
        }
    }

    private var greetingTitle: String {
        let hour = Calendar.current.component(.hour, from: Date())
        let greeting = hour < 12 ? "Morning" : hour < 18 ? "Afternoon" : "Evening"
        let name = NSFullUserName().split(separator: " ").first.map(String.init) ?? "Michael"
        return "\(greeting), \(name)"
    }

    private var selectedTargetTitle: String {
        if let item = snapshot.workItems.first(where: { $0.id == selectedWorkItemId }) {
            return item.title
        }
        return "MR Review Assistant"
    }

    private var enabledAgentCount: Int {
        max(snapshot.agentProfiles.filter(\.isEnabled).count, 1)
    }

    private func trimVisibleSideRuns(parentId: EntityID, keeping keptRunId: EntityID?) {
        guard let group = nativeChatRunGroups(from: model.snapshot.runs).first(where: { $0.parent.id == parentId }) else {
            return
        }

        let visibleChildIds = group.children
            .map(\.id)
            .filter { !hiddenSideRunIds.contains($0) || $0 == keptRunId }
        guard visibleChildIds.count > nativeMaxVisibleSidePanes else { return }

        var visibleCount = visibleChildIds.count
        for childId in visibleChildIds where childId != keptRunId {
            if visibleCount <= nativeMaxVisibleSidePanes { break }
            hiddenSideRunIds.insert(childId)
            visibleCount -= 1
        }
    }
}

private struct NativeMultiChatWorkspace: View {
    let activeRun: AgentRun?
    let snapshot: NativeStoreSnapshot
    let selectedWorkspace: Workspace?
    @Binding var selectedWorkspaceId: EntityID?
    @Binding var selectedWorkItemId: EntityID?
    @ObservedObject var model: NativeAppModel
    @Binding var focusedSideRunId: EntityID?
    @Binding var hiddenSideRunIds: Set<EntityID>
    let newChat: () -> Void
    let addInlineSideChat: (AgentRun) -> Void
    let detachSideChat: (AgentRun) -> Void
    let openWorkItem: () -> Void

    private var parentRun: AgentRun? {
        guard let activeRun else { return nil }
        if let parentId = activeRun.sideChatOfRunId,
           let parent = snapshot.runs.first(where: { $0.id == parentId }) {
            return parent
        }
        return activeRun
    }

    private var sideRuns: [AgentRun] {
        guard let parentRun else { return [] }
        return nativeChatRunGroups(from: snapshot.runs).first(where: { $0.parent.id == parentRun.id })?.children ?? []
    }

    private var paneRuns: [AgentRun] {
        guard let parentRun else { return [] }
        return nativeVisibleMultiChatRuns(
            parent: parentRun,
            sideRuns: sideRuns,
            hiddenSideRunIds: hiddenSideRunIds,
            focusedSideRunId: focusedSideRunId
        )
    }

    private var workspace: Workspace? {
        guard let parentRun else { return selectedWorkspace }
        return snapshot.workspaces.first(where: { $0.id == parentRun.workspaceId }) ?? selectedWorkspace
    }

    private var columns: [GridItem] {
        let columnCount = paneRuns.count <= 1 ? 1 : 2
        return Array(repeating: GridItem(.flexible(minimum: 320), spacing: 12), count: columnCount)
    }

    var body: some View {
        if paneRuns.count <= 1 {
            singlePaneWorkspace
        } else {
            multiPaneWorkspace
        }
    }

    private var singlePaneWorkspace: some View {
        ConversationWorkspace(
            run: parentRun,
            snapshot: snapshot,
            selectedWorkspace: workspace,
            selectedWorkspaceId: $selectedWorkspaceId,
            selectedWorkItemId: $selectedWorkItemId,
            model: model,
            immersive: true,
            newChat: newChat,
            newSideChat: parentRun.map { parent in { addInlineSideChat(parent) } },
            startFollowUpSideChat: { parent, action in
                startFollowUpSideChat(parent: parent, action: action)
            },
            openWorkItem: openWorkItem
        )
    }

    private var multiPaneWorkspace: some View {
        ScrollView {
            LazyVGrid(columns: columns, alignment: .leading, spacing: 12) {
                ForEach(Array(paneRuns.enumerated()), id: \.element.id) { index, run in
                    paneWorkspace(run: run, isParent: index == 0)
                }
                if let parentRun, paneRuns.count < nativeMaxVisibleChatPanes {
                    AddSideChatTile(
                        accent: agentTint(agentKind(for: parentRun, snapshot: snapshot)),
                        action: { addInlineSideChat(parentRun) }
                    )
                    .frame(minHeight: 520)
                }
            }
            .padding(.horizontal, 12)
            .padding(.bottom, 12)
        }
    }

    private func paneWorkspace(run: AgentRun, isParent: Bool) -> some View {
        let isFocused = (isParent && focusedSideRunId == nil) || focusedSideRunId == run.id
        return ConversationWorkspace(
            run: run,
            snapshot: snapshot,
            selectedWorkspace: snapshot.workspaces.first(where: { $0.id == run.workspaceId }) ?? workspace,
            selectedWorkspaceId: $selectedWorkspaceId,
            selectedWorkItemId: $selectedWorkItemId,
            model: model,
            immersive: true,
            paneLabel: isParent ? "Parent" : sideChatPaneLabel(for: run),
            newChat: newChat,
            newSideChat: nil,
            startFollowUpSideChat: { parent, action in
                startFollowUpSideChat(parent: parent, action: action)
            },
            closeChat: isParent ? nil : { closeSideRun(run) },
            detachChat: isParent ? nil : { detachSideChat(run) },
            openWorkItem: openWorkItem
        )
        .frame(minHeight: 520)
        .overlay(
            RoundedRectangle(cornerRadius: 18)
                .stroke(isFocused ? PKTheme.primary.opacity(0.55) : Color.clear, lineWidth: 1.5)
        )
        .simultaneousGesture(TapGesture().onEnded {
            focusedSideRunId = isParent ? nil : run.id
            selectedWorkspaceId = run.workspaceId
            selectedWorkItemId = run.workItemId
            Task { await model.markChatRead(runId: run.id) }
        })
    }

    private func closeSideRun(_ run: AgentRun) {
        hiddenSideRunIds.insert(run.id)
        if focusedSideRunId == run.id {
            focusedSideRunId = nil
            if let parentRun {
                selectedWorkspaceId = parentRun.workspaceId
                selectedWorkItemId = parentRun.workItemId
            }
        }
    }

    private func trimVisibleFollowUpSideRuns(parentId: EntityID, keeping keptRunId: EntityID?) {
        guard let group = nativeChatRunGroups(from: model.snapshot.runs).first(where: { $0.parent.id == parentId }) else {
            return
        }

        let visibleChildIds = group.children
            .map(\.id)
            .filter { !hiddenSideRunIds.contains($0) || $0 == keptRunId }
        guard visibleChildIds.count > nativeMaxVisibleSidePanes else { return }

        var visibleCount = visibleChildIds.count
        for childId in visibleChildIds where childId != keptRunId {
            if visibleCount <= nativeMaxVisibleSidePanes { break }
            hiddenSideRunIds.insert(childId)
            visibleCount -= 1
        }
    }

    private func startFollowUpSideChat(parent: AgentRun, action: RunFollowUpAction) {
        Task {
            if let childId = await model.startFollowUpSideChat(
                parentRunId: parent.id,
                prompt: action.prompt,
                permissionMode: action.permissionMode,
                followUpLabel: runFollowUpStagedLabel(action)
            ) {
                focusedSideRunId = childId
                hiddenSideRunIds.remove(childId)
                trimVisibleFollowUpSideRuns(parentId: parent.id, keeping: childId)
                if let child = model.snapshot.runs.first(where: { $0.id == childId }) {
                    selectedWorkspaceId = child.workspaceId
                    selectedWorkItemId = child.workItemId
                }
            }
        }
    }

}

private let nativeMaxVisibleChatPanes = 4
private let nativeMaxVisibleSidePanes = nativeMaxVisibleChatPanes - 1

func nativeVisibleMultiChatRuns(
    parent: AgentRun,
    sideRuns: [AgentRun],
    hiddenSideRunIds: Set<EntityID>,
    focusedSideRunId: EntityID?
) -> [AgentRun] {
    let visibleSides = sideRuns.filter { !hiddenSideRunIds.contains($0.id) }
    guard visibleSides.count > nativeMaxVisibleSidePanes else {
        return [parent] + visibleSides
    }

    var selectedSides = Array(visibleSides.prefix(nativeMaxVisibleSidePanes))
    if let focusedSideRunId,
       !selectedSides.contains(where: { $0.id == focusedSideRunId }),
       let focused = visibleSides.first(where: { $0.id == focusedSideRunId }) {
        selectedSides.removeLast()
        selectedSides.append(focused)
    }
    return [parent] + selectedSides
}

private struct AddSideChatTile: View {
    let accent: Color
    let action: () -> Void
    @State private var hovering = false

    var body: some View {
        Button(action: action) {
            VStack(spacing: 10) {
                Image(systemName: "plus")
                    .font(.system(size: 18, weight: .semibold))
                    .foregroundStyle(hovering ? PKTheme.primaryText : accent)
                    .frame(width: 44, height: 44)
                    .background(hovering ? accent : accent.opacity(0.12))
                    .clipShape(RoundedRectangle(cornerRadius: 10))
                Text("Add chat")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(PKTheme.text)
                Text("Side chat")
                    .font(.caption)
                    .foregroundStyle(PKTheme.text3)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(PKTheme.panel.opacity(hovering ? 0.42 : 0.24))
            .overlay(
                RoundedRectangle(cornerRadius: 18)
                    .stroke(accent.opacity(hovering ? 0.48 : 0.26), style: StrokeStyle(lineWidth: 1.2, dash: [6, 6]))
            )
            .clipShape(RoundedRectangle(cornerRadius: 18))
        }
        .buttonStyle(.plain)
        .help("Add Side Chat")
        .onHover { hovering = $0 }
    }
}

private struct ChatHistoryPane: View {
    let snapshot: NativeStoreSnapshot
    let selectedAgentKind: NativeAgentKind
    let activeRunId: EntityID?
    let focusedSideRunId: EntityID?
    let hiddenSideRunIds: Set<EntityID>
    let selectRun: (AgentRun) -> Void
    let selectSideRun: (AgentRun, AgentRun) -> Void
    let newChat: () -> Void
    let hideHistory: () -> Void
    let openRunInNewWindow: (AgentRun) -> Void
    let attachSideChat: (AgentRun, AgentRun) -> Void
    let detachSideChat: (AgentRun, Bool) -> Void
    let deleteRun: (AgentRun) -> Void
    @State private var rootDetachTargeted = false

    private var runs: [AgentRun] {
        let matching = snapshot.runs.filter { run in
            agentKind(for: run, snapshot: snapshot) == selectedAgentKind
        }
        return matching.sorted { ($0.startedAt ?? .distantPast) > ($1.startedAt ?? .distantPast) }
    }

    private var groups: [NativeChatRunGroup] {
        nativeChatRunGroups(from: runs)
    }

    private var hasSideChats: Bool {
        groups.contains { !$0.children.isEmpty }
    }

    private var completedUnreadCount: Int {
        runs.filter { $0.isCompletedUnread }.count
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 10) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(agentDisplayName(selectedAgentKind))
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundStyle(PKTheme.text)
                    Text(completedUnreadCount == 0 ? "Chat history" : "Chat history · \(completedUnreadCount) unread")
                        .font(.caption)
                        .foregroundStyle(completedUnreadCount == 0 ? PKTheme.text3 : PKTheme.primary)
                }
                Spacer()
                ChatHistoryToggleButton(mode: .hide, action: hideHistory)
                Button(action: newChat) {
                    Image(systemName: "plus")
                        .font(.system(size: 13, weight: .semibold))
                        .frame(width: 30, height: 30)
                        .background(PKTheme.primary)
                        .foregroundStyle(PKTheme.primaryText)
                        .clipShape(RoundedRectangle(cornerRadius: 7))
                }
                .buttonStyle(.plain)
                .help("New Chat")
            }
            .padding(16)
            .overlay(alignment: .bottom) { Rectangle().fill(PKTheme.edge).frame(height: 1) }

            ScrollView {
                LazyVStack(alignment: .leading, spacing: 8) {
                    if hasSideChats {
                        NativeRootDetachDropZone(isTargeted: rootDetachTargeted)
                            .onDrop(of: [UTType.plainText], isTargeted: $rootDetachTargeted) { providers in
                                loadNativeRunId(from: providers) { runId in
                                    guard let run = runs.first(where: { $0.id == runId }),
                                          run.sideChatOfRunId != nil else { return }
                                    detachSideChat(run, true)
                                }
                                return true
                            }
                    }

                    ForEach(groups) { group in
                        ChatHistoryGroupRow(
                            group: group,
                            allRuns: runs,
                            selected: activeRunId == group.parent.id,
                            selectedChildId: focusedSideRunId,
                            visibleChildIds: visibleChildIds(for: group),
                            workspaceName: workspaceName(for: group.parent.workspaceId, snapshot: snapshot),
                            openInNewWindow: { openRunInNewWindow($0) },
                            attachSideChat: attachSideChat,
                            detachSideChat: detachSideChat,
                            delete: deleteRun,
                            selectParent: { selectRun(group.parent) },
                            selectChild: { child in selectSideRun(group.parent, child) }
                        )
                    }

                    if groups.isEmpty {
                        EmptyMiniState(
                            title: "No \(agentShortLabel(selectedAgentKind)) chats",
                            subtitle: "Start a chat on the right; it will stay in this window."
                        )
                    }
                }
                .padding(12)
            }
        }
        .background(PKTheme.panel.opacity(0.48))
    }

    private func visibleChildIds(for group: NativeChatRunGroup) -> Set<EntityID> {
        guard activeRunId == group.parent.id else { return [] }
        let visibleRuns = nativeVisibleMultiChatRuns(
            parent: group.parent,
            sideRuns: group.children,
            hiddenSideRunIds: hiddenSideRunIds,
            focusedSideRunId: focusedSideRunId
        )
        return Set(visibleRuns.dropFirst().map(\.id))
    }
}

private struct ChatHistoryRevealButton: View {
    let action: () -> Void

    var body: some View {
        ChatHistoryToggleButton(mode: .show, action: action)
    }
}

private struct ChatHistoryToggleButton: View {
    enum Mode {
        case hide
        case show

        var help: String {
            switch self {
            case .hide: "Hide Chat History"
            case .show: "Show Chat History"
            }
        }

        var symbol: String {
            switch self {
            case .hide: "sidebar.left"
            case .show: "sidebar.left"
            }
        }
    }

    let mode: Mode
    let action: () -> Void
    @State private var hovering = false

    var body: some View {
        Button(action: action) {
            Image(systemName: mode.symbol)
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(hovering ? PKTheme.text2 : PKTheme.text4)
                .frame(width: 30, height: 30)
                .background(hovering ? PKTheme.control.opacity(0.72) : Color.clear)
                .overlay(
                    RoundedRectangle(cornerRadius: 7)
                        .stroke(hovering ? PKTheme.edgeStrong.opacity(0.62) : Color.clear, lineWidth: 1)
                )
                .clipShape(RoundedRectangle(cornerRadius: 7))
                .contentShape(RoundedRectangle(cornerRadius: 7))
        }
        .buttonStyle(.plain)
        .help(mode.help)
        .onHover { hovering = $0 }
    }
}

private struct NativeChatRunGroup: Identifiable {
    let parent: AgentRun
    let children: [AgentRun]

    var id: EntityID { parent.id }
}

private func nativeChatRunGroups(from runs: [AgentRun]) -> [NativeChatRunGroup] {
    let runById = Dictionary(uniqueKeysWithValues: runs.map { ($0.id, $0) })
    return runs
        .filter { $0.sideChatOfRunId == nil }
        .map { parent in
            var seen = Set<EntityID>()
            var children: [AgentRun] = []
            for childId in parent.sideChatRunIds {
                guard let child = runById[childId], !seen.contains(child.id) else { continue }
                seen.insert(child.id)
                children.append(child)
            }
            for child in runs where child.sideChatOfRunId == parent.id && !seen.contains(child.id) {
                seen.insert(child.id)
                children.append(child)
            }
            return NativeChatRunGroup(parent: parent, children: children)
        }
}

private func nativeRunDragProvider(_ runId: EntityID) -> NSItemProvider {
    NSItemProvider(object: runId.rawValue as NSString)
}

private func loadNativeRunId(from providers: [NSItemProvider], onLoad: @escaping @MainActor @Sendable (EntityID) -> Void) {
    guard let provider = providers.first(where: { $0.hasItemConformingToTypeIdentifier(UTType.plainText.identifier) }) else { return }
    provider.loadItem(forTypeIdentifier: UTType.plainText.identifier, options: nil) { item, _ in
        let raw: String?
        if let data = item as? Data {
            raw = String(data: data, encoding: .utf8)
        } else if let text = item as? String {
            raw = text
        } else if let text = item as? NSString {
            raw = text as String
        } else {
            raw = nil
        }
        guard let raw = raw?.trimmingCharacters(in: .whitespacesAndNewlines), !raw.isEmpty else { return }
        Task { @MainActor in
            onLoad(EntityID(raw))
        }
    }
}

private struct NativeRootDetachDropZone: View {
    let isTargeted: Bool

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: "arrow.up.left.and.arrow.down.right")
                .font(.system(size: 11, weight: .semibold))
            Text("Drop here to detach chat")
                .font(.system(size: 11, weight: .semibold))
        }
        .foregroundStyle(isTargeted ? PKTheme.primary : PKTheme.text3)
        .frame(maxWidth: .infinity)
        .padding(.vertical, 9)
        .background(isTargeted ? PKTheme.primary.opacity(0.12) : PKTheme.panelAlt.opacity(0.35))
        .overlay(RoundedRectangle(cornerRadius: 9).stroke(isTargeted ? PKTheme.primary.opacity(0.45) : PKTheme.edge, style: StrokeStyle(lineWidth: 1, dash: [4, 4])))
        .clipShape(RoundedRectangle(cornerRadius: 9))
    }
}

private struct ChatHistoryGroupRow: View {
    let group: NativeChatRunGroup
    let allRuns: [AgentRun]
    let selected: Bool
    let selectedChildId: EntityID?
    let visibleChildIds: Set<EntityID>
    let workspaceName: String
    let openInNewWindow: (AgentRun) -> Void
    let attachSideChat: (AgentRun, AgentRun) -> Void
    let detachSideChat: (AgentRun, Bool) -> Void
    let delete: (AgentRun) -> Void
    let selectParent: () -> Void
    let selectChild: (AgentRun) -> Void
    @State private var isHovering = false
    @State private var isDropTargeted = false
    @State private var hoveredChildId: EntityID?

    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            parentBody
            if !group.children.isEmpty {
                VStack(spacing: 5) {
                    ForEach(group.children) { child in
                        childRow(child)
                    }
                }
                .padding(.leading, 10)
                .overlay(alignment: .leading) {
                    Rectangle()
                        .fill(PKTheme.primary.opacity(0.22))
                        .frame(width: 1)
                }
            }
        }
        .padding(11)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(selected ? PKTheme.selected : PKTheme.panelAlt.opacity(isHovering || isDropTargeted ? 0.50 : 0.38))
        .overlay(RoundedRectangle(cornerRadius: 8).stroke(isDropTargeted ? PKTheme.primary.opacity(0.55) : selected || isHovering ? PKTheme.edgeStrong : PKTheme.edge, lineWidth: 1))
        .clipShape(RoundedRectangle(cornerRadius: 8))
        .shadow(color: (isHovering || isDropTargeted ? PKTheme.primary.opacity(0.10) : Color.clear), radius: isHovering || isDropTargeted ? 12 : 0, y: 6)
        .contentShape(RoundedRectangle(cornerRadius: 8))
        .onTapGesture(perform: selectParent)
        .onHover { hovering in
            withAnimation(.easeInOut(duration: 0.14)) {
                isHovering = hovering
            }
        }
        .onDrag { nativeRunDragProvider(group.parent.id) }
        .onDrop(of: [UTType.plainText], isTargeted: $isDropTargeted) { providers in
            loadNativeRunId(from: providers) { runId in
                guard runId != group.parent.id,
                      let child = groupSourceRun(runId) else { return }
                attachSideChat(group.parent, child)
            }
            return true
        }
        .contextMenu {
            Button("Open in New Window", systemImage: "rectangle.on.rectangle") { openInNewWindow(group.parent) }
            Button("Delete Chat", systemImage: "trash", role: .destructive) { delete(group.parent) }
        }
        .animation(.easeInOut(duration: 0.14), value: selected)
        .animation(.easeInOut(duration: 0.14), value: isDropTargeted)
    }

    private var parentBody: some View {
        VStack(alignment: .leading, spacing: 7) {
            HStack(alignment: .top, spacing: 8) {
                Text(group.parent.promptSnapshot.firstLineFallback("Conversation"))
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(PKTheme.text)
                    .lineLimit(2)
                Spacer(minLength: 8)
                if !group.children.isEmpty {
                    Text("\(group.children.count + 1)")
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(PKTheme.primary)
                        .padding(.horizontal, 6)
                        .frame(height: 20)
                        .background(PKTheme.primary.opacity(0.12))
                        .clipShape(RoundedRectangle(cornerRadius: 6))
                }
                if group.parent.isCompletedUnread {
                    StatusPill(text: "unread", color: PKTheme.primary)
                }
                StatusPill(text: group.parent.state.rawValue, color: runStateColor(group.parent.state))
            }

            Text(workspaceName)
                .font(.caption)
                .foregroundStyle(PKTheme.text3)
                .lineLimit(1)

            HStack(spacing: 7) {
                if let startedAt = group.parent.startedAt {
                    Text(startedAt.formatted(date: .abbreviated, time: .shortened))
                        .font(.caption2)
                        .foregroundStyle(PKTheme.text3)
                }
                Spacer()
                if isHovering || selected {
                    RowIconButton(symbol: "rectangle.on.rectangle", help: "Open in New Window") { openInNewWindow(group.parent) }
                    RowIconButton(symbol: "trash", help: "Delete Chat", tint: PKTheme.err) { delete(group.parent) }
                }
            }
        }
    }

    private func childRow(_ child: AgentRun) -> some View {
        let childSelected = selectedChildId == child.id
        let childHovering = hoveredChildId == child.id
        let childVisible = visibleChildIds.contains(child.id)
        return HStack(spacing: 7) {
            Image(systemName: "text.bubble")
                .font(.system(size: 10, weight: .semibold))
                .foregroundStyle(childSelected || childVisible || childHovering ? PKTheme.primary : PKTheme.primary.opacity(0.72))
            VStack(alignment: .leading, spacing: 2) {
                Text(child.promptSnapshot.firstLineFallback("Side chat"))
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(childSelected || childVisible || childHovering ? PKTheme.text : PKTheme.text2)
                    .lineLimit(1)
                Text(child.state.rawValue)
                    .font(.caption2)
                    .foregroundStyle(PKTheme.text3)
                    .lineLimit(1)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            if child.isCompletedUnread {
                StatusPill(text: "unread", color: PKTheme.primary)
            }
            if childVisible {
                Image(systemName: "rectangle.split.2x1")
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(PKTheme.primary.opacity(childSelected ? 0.96 : 0.82))
                    .frame(width: 22, height: 20)
                    .background(PKTheme.primary.opacity(0.10))
                    .overlay(RoundedRectangle(cornerRadius: 6).stroke(PKTheme.primary.opacity(0.20), lineWidth: 1))
                    .clipShape(RoundedRectangle(cornerRadius: 6))
                    .help("Shown in layout")
            }
            RowIconButton(symbol: "arrow.up.right.square", help: "Detach Chat") {
                detachSideChat(child, true)
            }
        }
        .padding(7)
        .background(childSelected ? PKTheme.primary.opacity(0.13) : childVisible ? PKTheme.primary.opacity(0.07) : childHovering ? PKTheme.panelAlt.opacity(0.55) : PKTheme.panel.opacity(0.35))
        .overlay(RoundedRectangle(cornerRadius: 7).stroke(childSelected ? PKTheme.primary.opacity(0.42) : childVisible ? PKTheme.primary.opacity(0.26) : childHovering ? PKTheme.primary.opacity(0.24) : PKTheme.edge.opacity(0.65), lineWidth: 1))
        .clipShape(RoundedRectangle(cornerRadius: 7))
        .shadow(color: childHovering ? PKTheme.primary.opacity(0.08) : Color.clear, radius: childHovering ? 8 : 0, y: 4)
        .contentShape(RoundedRectangle(cornerRadius: 7))
        .onTapGesture {
            selectChild(child)
        }
        .onHover { hovering in
            withAnimation(.easeInOut(duration: 0.14)) {
                hoveredChildId = hovering ? child.id : nil
            }
        }
        .onDrag { nativeRunDragProvider(child.id) }
        .animation(.easeInOut(duration: 0.14), value: childSelected)
    }

    private func groupSourceRun(_ runId: EntityID) -> AgentRun? {
        allRuns.first(where: { $0.id == runId })
    }
}

private struct ChatHistoryRow: View {
    let run: AgentRun
    let selected: Bool
    let workspaceName: String
    let openInNewWindow: () -> Void
    let delete: () -> Void
    let action: () -> Void
    @State private var isHovering = false

    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            HStack(alignment: .top, spacing: 8) {
                Text(run.promptSnapshot.firstLineFallback("Conversation"))
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(PKTheme.text)
                    .lineLimit(2)
                Spacer(minLength: 8)
                if run.isCompletedUnread {
                    StatusPill(text: "unread", color: PKTheme.primary)
                }
                StatusPill(text: run.state.rawValue, color: runStateColor(run.state))
            }

            Text(workspaceName)
                .font(.caption)
                .foregroundStyle(PKTheme.text3)
                .lineLimit(1)

            HStack(spacing: 7) {
                if let startedAt = run.startedAt {
                    Text(startedAt.formatted(date: .abbreviated, time: .shortened))
                        .font(.caption2)
                        .foregroundStyle(PKTheme.text3)
                }
                Spacer()
                if isHovering || selected {
                    RowIconButton(symbol: "rectangle.on.rectangle", help: "Open in New Window", action: openInNewWindow)
                    RowIconButton(symbol: "trash", help: "Delete Chat", tint: PKTheme.err, action: delete)
                }
            }
        }
        .padding(11)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(selected ? PKTheme.selected : PKTheme.panelAlt.opacity(isHovering ? 0.50 : 0.38))
        .overlay(RoundedRectangle(cornerRadius: 8).stroke(selected || isHovering ? PKTheme.edgeStrong : PKTheme.edge, lineWidth: 1))
        .clipShape(RoundedRectangle(cornerRadius: 8))
        .shadow(color: isHovering ? PKTheme.primary.opacity(0.09) : Color.clear, radius: isHovering ? 12 : 0, y: 6)
        .contentShape(RoundedRectangle(cornerRadius: 8))
        .onTapGesture(perform: action)
        .onHover { hovering in
            withAnimation(.easeInOut(duration: 0.14)) {
                isHovering = hovering
            }
        }
        .contextMenu {
            Button("Open in New Window", systemImage: "rectangle.on.rectangle", action: openInNewWindow)
            Button("Delete Chat", systemImage: "trash", role: .destructive, action: delete)
        }
        .animation(.easeInOut(duration: 0.14), value: selected)
    }
}

private struct RowIconButton: View {
    let symbol: String
    let help: String
    var tint: Color = PKTheme.text3
    let action: () -> Void
    @State private var hovering = false

    var body: some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(hovering ? tint.opacity(0.98) : tint.opacity(0.78))
                .frame(width: 24, height: 22)
                .background(PKTheme.control.opacity(hovering ? 0.86 : 0.64))
                .overlay(RoundedRectangle(cornerRadius: 6).stroke(hovering ? PKTheme.edgeStrong.opacity(0.74) : PKTheme.edge, lineWidth: 1))
                .clipShape(RoundedRectangle(cornerRadius: 6))
                .scaleEffect(hovering ? 1.05 : 1)
        }
        .buttonStyle(.plain)
        .help(help)
        .onHover { hovering = $0 }
        .animation(.easeInOut(duration: 0.12), value: hovering)
    }
}

@MainActor
private final class DetachedChatWindowRegistry {
    static let shared = DetachedChatWindowRegistry()
    private var windows: [NSWindow] = []

    func open(run: AgentRun, snapshot: NativeStoreSnapshot) {
        windows.removeAll { !$0.isVisible }

        let rootView = DetachedChatWindowView(run: run, snapshot: snapshot)
            .frame(minWidth: 760, minHeight: 520)
            .tint(PKTheme.primary)

        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 860, height: 620),
            styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
            backing: .buffered,
            defer: false
        )
        window.title = run.promptSnapshot.firstLineFallback("Chat")
        window.tabbingMode = .disallowed
        window.minSize = NSSize(width: 760, height: 520)
        window.contentView = NSHostingView(rootView: rootView)
        window.center()
        window.makeKeyAndOrderFront(nil)
        windows.append(window)
        NSApp.activate(ignoringOtherApps: true)
    }
}

private struct DetachedChatWindowView: View {
    let run: AgentRun
    let snapshot: NativeStoreSnapshot

    private var workspace: Workspace? {
        snapshot.workspaces.first(where: { $0.id == run.workspaceId })
    }

    private var agentName: String {
        snapshot.agentProfiles.first(where: { $0.id == run.agentProfileId })?.displayName ?? "Pikiclaw"
    }

    private var accent: Color {
        agentTint(agentKind(for: run, snapshot: snapshot))
    }

    var body: some View {
        ZStack {
            PKTheme.surface.ignoresSafeArea()
            PikiclawGridBackground().ignoresSafeArea()

            VStack(spacing: 0) {
                HStack(spacing: 12) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(run.promptSnapshot.firstLineFallback("Chat"))
                            .font(.system(size: 20, weight: .semibold))
                            .foregroundStyle(PKTheme.text)
                            .lineLimit(1)
                        Text("\(workspace?.name ?? "Workspace") · \(agentName)")
                            .font(.caption)
                            .foregroundStyle(PKTheme.text3)
                    }
                    Spacer()
                    StatusPill(text: run.state.rawValue, color: runStateColor(run.state))
                }
                .padding(18)

                Rectangle()
                    .fill(PKTheme.edge.opacity(0.72))
                    .frame(height: 1)

                ScrollView {
                    VStack(alignment: .leading, spacing: 18) {
                        ForEach(run.messages) { message in
                            if message.role == .user {
                                ConversationMessageBubble(
                                    title: "You",
                                    subtitle: workspace?.name ?? "Project",
                                    text: message.content,
                                    createdAt: message.createdAt,
                                    symbol: "person.crop.circle",
                                    accent: accent,
                                    trailing: true
                                )
                            } else if message.role == .assistant {
                                AssistantResponseCard(
                                    title: agentName,
                                    text: message.content,
                                    createdAt: message.createdAt,
                                    state: .completed,
                                    isRunning: false,
                                    accent: accent
                                )
                            }
                        }

                        ConversationMessageBubble(
                            title: "You",
                            subtitle: workspace?.name ?? "Project",
                            text: run.promptSnapshot,
                            createdAt: run.startedAt,
                            symbol: "person.crop.circle",
                            accent: accent,
                            trailing: true
                        )

                        AssistantResponseCard(
                            title: agentName,
                            text: run.transcript.isEmpty ? "No assistant output yet." : run.transcript,
                            createdAt: run.endedAt ?? run.startedAt,
                            state: run.state,
                            isRunning: run.state == .running,
                            accent: accent
                        )
                    }
                    .padding(20)
                }
            }
            .background(PKTheme.panel.opacity(0.46))
            .overlay(RoundedRectangle(cornerRadius: 8).stroke(PKTheme.edge, lineWidth: 1))
            .clipShape(RoundedRectangle(cornerRadius: 8))
            .padding(18)
        }
        .preferredColorScheme(.dark)
    }
}

private struct NewChatLauncher: View {
    let snapshot: NativeStoreSnapshot
    @Binding var selectedWorkspaceId: EntityID?
    @Binding var selectedWorkItemId: EntityID?
    var commandFocused: FocusState<Bool>.Binding
    @ObservedObject var model: NativeAppModel
    let openTerminal: () -> Void
    let send: () -> Void

    private var selectedWorkspace: Workspace? {
        snapshot.workspaces.first(where: { $0.id == selectedWorkspaceId }) ?? snapshot.workspaces.first
    }

    var body: some View {
        GeometryReader { proxy in
            let contentWidth = min(max(proxy.size.width - 72, 320), 820)
            ScrollView {
                VStack(spacing: 44) {
                    Spacer(minLength: 0)

                    NewChatHero(
                        snapshot: snapshot,
                        selectedWorkspaceId: selectedWorkspaceId,
                        selectedAgentKind: model.selectedAgentKind,
                        isRunning: model.isRunning
                    )

                    MinimalChatComposer(
                        snapshot: snapshot,
                        selectedWorkspaceId: $selectedWorkspaceId,
                        selectedPermissionMode: $model.selectedPermissionMode,
                        text: $model.draftPrompt,
                        placeholder: "Ask \(agentShortLabel(model.selectedAgentKind)) what you need...",
                        focused: commandFocused,
                        selectedAgentKind: model.selectedAgentKind,
                        isRunning: model.isRunning,
                        showsSkillCards: false,
                        branchOptions: selectedWorkspace.map { model.branchOptionsByWorkspace[$0.id] ?? [] } ?? [],
                        branchStatus: selectedWorkspace.flatMap { model.branchStatusByWorkspace[$0.id] },
                        openTerminal: openTerminal,
                        captureWorkItem: {
                            Task { _ = await model.createWorkItem(workspaceId: selectedWorkspaceId) }
                        },
                        switchBranch: { branch in
                            Task { await model.switchBranch(branch, workspace: selectedWorkspace) }
                        },
                        send: send
                    )
                    .frame(width: contentWidth)

                    Spacer(minLength: 0)
                }
                .frame(width: contentWidth)
                .frame(maxWidth: .infinity)
                .frame(minHeight: proxy.size.height)
                .padding(.top, max(34, proxy.size.height * 0.12))
                .padding(.bottom, max(42, proxy.size.height * 0.10))
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .task(id: selectedWorkspace?.id) {
            await model.refreshBranches(for: selectedWorkspace)
        }
    }
}

private struct NewChatSectionHeader: View {
    let title: String
    let subtitle: String
    let count: Int?

    var body: some View {
        HStack(spacing: 9) {
            Text(title.uppercased())
                .font(.system(size: 10, weight: .semibold))
                .foregroundStyle(PKTheme.text3)
            Text(subtitle)
                .font(.caption)
                .foregroundStyle(PKTheme.text4)
                .lineLimit(1)
            Spacer()
            if let count {
                CountBadge(value: count)
            }
        }
        .padding(.horizontal, 2)
    }
}

private struct NewChatHero: View {
    let snapshot: NativeStoreSnapshot
    let selectedWorkspaceId: EntityID?
    let selectedAgentKind: NativeAgentKind
    let isRunning: Bool

    var body: some View {
        VStack(spacing: 14) {
            Image(systemName: agentSymbol(selectedAgentKind))
                .font(.system(size: 19, weight: .bold))
                .foregroundStyle(PKTheme.primaryText)
                .frame(width: 54, height: 54)
                .background(
                    LinearGradient(
                        colors: [accent, accent.opacity(0.66)],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    )
                )
                .clipShape(RoundedRectangle(cornerRadius: 8))
                .shadow(color: accent.opacity(0.26), radius: 18, x: 0, y: 8)

            VStack(spacing: 6) {
                Text("Welcome to Pikiclaw")
                    .font(.system(size: 17, weight: .semibold))
                    .foregroundStyle(accent)
                    .lineLimit(1)

                Text("How can \(agentShortLabel(selectedAgentKind)) help today?")
                    .font(.system(size: 26, weight: .semibold))
                    .foregroundStyle(PKTheme.text)
                    .multilineTextAlignment(.center)
                    .lineLimit(2)
                    .minimumScaleFactor(0.76)

                Text(subtitle)
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(PKTheme.text3)
                    .multilineTextAlignment(.center)
                    .lineLimit(2)
                    .minimumScaleFactor(0.82)
            }
        }
        .frame(maxWidth: 640)
        .frame(maxWidth: .infinity, alignment: .center)
    }

    private var accent: Color {
        agentTint(selectedAgentKind)
    }

    private var subtitle: String {
        if isRunning || runningRuns > 0 {
            return "\(agentShortLabel(selectedAgentKind)) is already moving in \(projectTitle(for: selectedWorkspaceId, snapshot: snapshot))."
        }
        if failedRuns >= 3 {
            return "\(agentShortLabel(selectedAgentKind)) has a few recent failed runs. Keep the next prompt specific."
        }
        return "\(projectTitle(for: selectedWorkspaceId, snapshot: snapshot)) is selected. Say the outcome and I will route the work."
    }

    private var failedRuns: Int {
        snapshot.runs.filter { run in
            agentKind(for: run, snapshot: snapshot) == selectedAgentKind && run.state == .failed
        }.count
    }

    private var runningRuns: Int {
        snapshot.runs.filter { run in
            agentKind(for: run, snapshot: snapshot) == selectedAgentKind && run.state == .running
        }.count
    }
}

private enum NewChatMode: String, CaseIterable, Identifiable {
    case daily
    case engineering
    case creative

    var id: String { rawValue }

    var title: String {
        switch self {
        case .daily: return "Daily Ops"
        case .engineering: return "Code Dev"
        case .creative: return "Design"
        }
    }

    var symbol: String {
        switch self {
        case .daily: return "briefcase"
        case .engineering: return "chevron.left.forwardslash.chevron.right"
        case .creative: return "paintpalette"
        }
    }

    var placeholder: String {
        switch self {
        case .daily: return "Ask"
        case .engineering: return "Tell"
        case .creative: return "Describe"
        }
    }
}

private struct NewChatCategoryStrip: View {
    let mode: NewChatMode
    let apply: (NewChatQuickAction) -> Void

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(quickActions(for: mode)) { action in
                    Button {
                        apply(action)
                    } label: {
                        HStack(spacing: 8) {
                            Image(systemName: action.symbol)
                                .font(.system(size: 12, weight: .semibold))
                            Text(action.title)
                                .font(.system(size: 12, weight: .semibold))
                                .lineLimit(1)
                        }
                        .foregroundStyle(PKTheme.text2)
                        .padding(.horizontal, 13)
                        .frame(height: 34)
                        .background(PKTheme.surfaceRaised.opacity(0.82))
                        .overlay(RoundedRectangle(cornerRadius: 8).stroke(PKTheme.edge, lineWidth: 1))
                        .clipShape(RoundedRectangle(cornerRadius: 8))
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }
}

private struct NewChatAssistantStrip: View {
    let templates: [AssistantLaunchTemplate]
    let currentPermissionMode: PermissionMode
    let recommendation: AssistantLaunchRecommendation?
    let launch: (AssistantLaunchTemplate) -> Void

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 10) {
                ForEach(templates) { template in
                    Button {
                        launch(template)
                    } label: {
                        NewChatAssistantCard(
                            template: template,
                            currentPermissionMode: currentPermissionMode,
                            recommendationReason: recommendation?.templateId == template.id ? recommendation?.reason : nil
                        )
                    }
                    .buttonStyle(.plain)
                    .help(recommendation?.templateId == template.id ? "\(template.title) - \(recommendation?.reason ?? "")" : template.title)
                }
            }
            .padding(.vertical, 1)
        }
    }
}

private struct NewChatAssistantCard: View {
    let template: AssistantLaunchTemplate
    let currentPermissionMode: PermissionMode
    let recommendationReason: String?
    @State private var hovering = false

    private var isRecommended: Bool {
        recommendationReason != nil
    }

    private var tint: Color {
        switch template.id {
        case "bug-analysis":
            return PKTheme.err
        case "mr-review":
            return PKTheme.ok
        case "validation":
            return Color(red: 0.62, green: 0.86, blue: 0.72)
        case "jira-execution":
            return PKTheme.warn
        case "log-analysis":
            return PKTheme.primary
        case "skill-hardening":
            return Color(red: 0.78, green: 0.88, blue: 1.00)
        default:
            return agentTint(template.agentKind)
        }
    }

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: template.symbol)
                .font(.system(size: 13, weight: .bold))
                .frame(width: 30, height: 30)
                .foregroundStyle(tint)
                .background(tint.opacity(0.14))
                .clipShape(RoundedRectangle(cornerRadius: 8))

            VStack(alignment: .leading, spacing: 5) {
                HStack(spacing: 7) {
                    Text(template.badge)
                        .font(.system(size: 10, weight: .bold))
                        .foregroundStyle(tint)
                        .lineLimit(1)
                    Text(template.title)
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(PKTheme.text)
                        .lineLimit(1)
                        .minimumScaleFactor(0.82)
                }

                Text(template.subtitle)
                    .font(.system(size: 10.5, weight: .medium))
                    .foregroundStyle(PKTheme.text3)
                    .lineLimit(2)
                    .fixedSize(horizontal: false, vertical: true)

                HStack(spacing: 6) {
                    if isRecommended {
                        CountBadge(text: "Suggested")
                    }
                    CountBadge(text: agentShortLabel(template.agentKind))
                    CountBadge(text: permissionTitle(assistantTemplatePermissionMode(template, current: currentPermissionMode)))
                    Spacer(minLength: 0)
                    Image(systemName: "arrow.right")
                        .font(.system(size: 10, weight: .bold))
                        .foregroundStyle(tint)
                }
            }

            Spacer(minLength: 0)
        }
        .padding(11)
        .frame(width: 226, height: 96, alignment: .topLeading)
        .background(
            LinearGradient(
                colors: [
                    tint.opacity(isRecommended ? 0.16 : hovering ? 0.13 : 0.08),
                    PKTheme.surfaceRaised.opacity(0.76)
                ],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
        )
        .overlay(RoundedRectangle(cornerRadius: 8).stroke(isRecommended ? tint.opacity(0.62) : hovering ? tint.opacity(0.42) : PKTheme.edge, lineWidth: 1))
        .clipShape(RoundedRectangle(cornerRadius: 8))
        .onHover { hovering = $0 }
    }
}

private struct JiraTicketQuickCard: View {
    let snapshot: NativeStoreSnapshot
    @Binding var selectedWorkspaceId: EntityID?
    @Binding var selectedWorkItemId: EntityID?
    @ObservedObject var model: NativeAppModel
    let parentRunId: EntityID?
    var draftContext: (() -> String?)?
    var focusComposer: (() -> Void)?

    private var candidates: [WorkItem] {
        jiraTicketCardCandidates(from: snapshot.workItems, selectedWorkItemId: selectedWorkItemId, limit: 4)
    }

    private var syncSummary: String {
        let sync = snapshot.jiraSync ?? JiraSyncState()
        if model.jiraSyncIsRunning { return "Syncing current sprint" }
        if let date = sync.lastSyncAt {
            return "\(sync.ticketCount) synced - \(date.formatted(date: .abbreviated, time: .shortened))"
        }
        return "Sync your sprint and start from a ticket"
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 10) {
                Image(systemName: "checklist")
                    .font(.system(size: 13, weight: .semibold))
                    .frame(width: 28, height: 28)
                    .foregroundStyle(PKTheme.primary)
                    .background(PKTheme.primary.opacity(0.12))
                    .clipShape(RoundedRectangle(cornerRadius: 8))

                VStack(alignment: .leading, spacing: 2) {
                    Text("Jira Tickets")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(PKTheme.text)
                    Text(syncSummary)
                        .font(.system(size: 11, weight: .medium))
                        .foregroundStyle(PKTheme.text3)
                        .lineLimit(1)
                }

                Spacer()

                Button {
                    syncSprint()
                } label: {
                    Image(systemName: model.jiraSyncIsRunning ? "arrow.triangle.2.circlepath" : "arrow.clockwise")
                        .font(.system(size: 12, weight: .semibold))
                        .frame(width: 30, height: 28)
                }
                .buttonStyle(.plain)
                .foregroundStyle(PKTheme.text2)
                .background(PKTheme.control.opacity(0.72))
                .overlay(RoundedRectangle(cornerRadius: 8).stroke(PKTheme.edge, lineWidth: 1))
                .clipShape(RoundedRectangle(cornerRadius: 8))
                .disabled(model.jiraSyncIsRunning)
                .help("Sync current sprint")
            }

            if !candidates.isEmpty {
                VStack(spacing: 8) {
                    ForEach(candidates) { ticket in
                        JiraTicketListRow(
                            item: ticket,
                            selected: selectedWorkItemId == ticket.id,
                            tint: ticketTint(ticket),
                            subtitle: ticketSubtitle(ticket),
                            evidenceSummary: jiraTicketEvidenceSummary(for: ticket, snapshot: snapshot),
                            select: {
                                selectedWorkItemId = ticket.id
                                selectedWorkspaceId = ticket.workspaceId
                            },
                            attach: {
                                attach(ticket)
                            },
                            start: {
                                start(ticket)
                            }
                        )
                    }
                }
            } else {
                HStack(spacing: 12) {
                    Text("No synced Jira tickets yet.")
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(PKTheme.text3)
                    Spacer()
                    Button {
                        syncSprint()
                    } label: {
                        Label("Sync Sprint", systemImage: "arrow.clockwise")
                            .font(.system(size: 12, weight: .semibold))
                    }
                    .buttonStyle(.plain)
                    .foregroundStyle(PKTheme.primaryText)
                    .padding(.horizontal, 12)
                    .frame(height: 30)
                    .background(PKTheme.primary)
                    .clipShape(RoundedRectangle(cornerRadius: 8))
                    .disabled(model.jiraSyncIsRunning)
                }
            }
        }
        .padding(14)
        .background(PKTheme.panel.opacity(0.68))
        .overlay(RoundedRectangle(cornerRadius: 8).stroke(PKTheme.primary.opacity(0.22), lineWidth: 1))
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }

    private func syncSprint() {
        Task<Void, Never> {
            if let itemId = await model.syncJiraTickets(scope: .currentSprint, workspaceId: selectedWorkspaceId) {
                selectedWorkItemId = itemId
                _ = model.stageJiraTicketForChat(workItemId: itemId, userInput: draftContext?())
                focusComposer?()
            }
        }
    }

    private func attach(_ item: WorkItem) {
        selectedWorkItemId = item.id
        selectedWorkspaceId = item.workspaceId
        _ = model.stageJiraTicketForChat(workItemId: item.id, userInput: draftContext?())
        focusComposer?()
    }

    private func start(_ item: WorkItem) {
        selectedWorkItemId = item.id
        selectedWorkspaceId = item.workspaceId
        Task<Void, Never> {
            if let runId = await model.startJiraTicketFromChat(
                workItemId: item.id,
                parentRunId: parentRunId,
                userInput: draftContext?()
            ),
               let run = model.snapshot.runs.first(where: { $0.id == runId }) {
                selectedWorkItemId = run.workItemId
                selectedWorkspaceId = run.workspaceId
            }
        }
    }

    private func ticketSubtitle(_ item: WorkItem) -> String {
        [item.jira?.sprint, item.jira?.priority, item.jira?.assignee]
            .compactMap { $0 }
            .filter { !$0.isEmpty }
            .joined(separator: " / ")
    }

    private func ticketTint(_ item: WorkItem) -> Color {
        switch item.state {
        case .blocked: return PKTheme.warn
        case .review: return Color.purple
        case .active: return PKTheme.ok
        case .done: return PKTheme.ok
        case .cancelled, .archived: return PKTheme.text4
        case .inbox, .planned: return PKTheme.primary
        }
    }
}

private struct JiraTicketListRow: View {
    let item: WorkItem
    let selected: Bool
    let tint: Color
    let subtitle: String
    let evidenceSummary: JiraTicketEvidenceSummary
    let select: () -> Void
    let attach: () -> Void
    let start: () -> Void

    var body: some View {
        HStack(spacing: 12) {
            Button(action: select) {
                HStack(alignment: .top, spacing: 11) {
                    VStack(spacing: 4) {
                        Text(item.jira?.key ?? "Jira")
                            .font(.system(size: 10, weight: .bold))
                            .foregroundStyle(selected ? PKTheme.primaryText : tint)
                            .lineLimit(1)
                            .minimumScaleFactor(0.72)
                        Circle()
                            .fill(tint)
                            .frame(width: 6, height: 6)
                    }
                    .frame(width: 56)

                    VStack(alignment: .leading, spacing: 5) {
                        HStack(spacing: 7) {
                            Text(item.jira?.status ?? item.state.rawValue)
                                .font(.system(size: 10, weight: .semibold))
                                .foregroundStyle(tint)
                                .lineLimit(1)
                            if let issueType = item.jira?.issueType {
                                Text(issueType)
                                    .font(.system(size: 10, weight: .medium))
                                    .foregroundStyle(PKTheme.text4)
                                    .lineLimit(1)
                            }
                        }

                        Text(item.title)
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(PKTheme.text)
                            .lineLimit(2)
                            .fixedSize(horizontal: false, vertical: true)

                        if !subtitle.isEmpty {
                            Text(subtitle)
                                .font(.system(size: 10, weight: .medium))
                                .foregroundStyle(PKTheme.text3)
                                .lineLimit(1)
                        }

                        JiraTicketRowEvidenceStrip(summary: evidenceSummary)
                    }
                    Spacer(minLength: 0)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)

            VStack(spacing: 6) {
                Button(action: attach) {
                    Image(systemName: "paperclip")
                        .font(.system(size: 11, weight: .semibold))
                        .frame(width: 30, height: 26)
                }
                .buttonStyle(.plain)
                .foregroundStyle(PKTheme.text2)
                .background(PKTheme.control.opacity(0.76))
                .overlay(RoundedRectangle(cornerRadius: 8).stroke(PKTheme.edge, lineWidth: 1))
                .clipShape(RoundedRectangle(cornerRadius: 8))
                .help("Attach ticket to chat")

                Button(action: start) {
                    Image(systemName: "play.fill")
                        .font(.system(size: 10, weight: .bold))
                        .frame(width: 30, height: 26)
                }
                .buttonStyle(.plain)
                .foregroundStyle(PKTheme.primaryText)
                .background(PKTheme.primary)
                .clipShape(RoundedRectangle(cornerRadius: 8))
                .help("Start ticket")
            }
        }
        .padding(10)
        .background(selected ? PKTheme.primary.opacity(0.13) : PKTheme.surfaceRaised.opacity(0.58))
        .overlay(RoundedRectangle(cornerRadius: 8).stroke(selected ? PKTheme.primary.opacity(0.50) : PKTheme.edge, lineWidth: 1))
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }
}

private struct JiraTicketRowEvidenceStrip: View {
    let summary: JiraTicketEvidenceSummary

    private var helpText: String {
        var parts = [
            "Outputs: \(summary.outputCount)",
            "Artifact refs: \(summary.artifactRefCount)",
            "Action signals: \(summary.actionSignalCount)",
            "Validation signals: \(summary.validationSignals.count)",
            "Pending commands: \(summary.pendingCommands.count)"
        ]
        if let actionSignalsHelp = summary.actionSignalsHelp {
            parts.append(actionSignalsHelp)
        }
        if let validationSignalsHelp = summary.validationSignalsHelp {
            parts.append(validationSignalsHelp)
        }
        if let pendingCommandsHelp = summary.pendingCommandsHelp {
            parts.append(pendingCommandsHelp)
        }
        return parts.joined(separator: "\n")
    }

    var body: some View {
        HStack(spacing: 6) {
            JiraTicketRowEvidenceChip(symbol: "shippingbox", value: summary.outputCount, title: "Outputs")
            JiraTicketRowEvidenceChip(symbol: "link", value: summary.artifactRefCount, title: "Artifact refs")
            JiraTicketRowEvidenceChip(symbol: "exclamationmark.triangle", value: summary.actionSignalCount, title: "Action signals")
            JiraTicketRowEvidenceChip(symbol: "checkmark.circle", value: summary.validationSignals.count, title: "Validation signals")
            JiraTicketRowEvidenceChip(symbol: "terminal", value: summary.pendingCommands.count, title: "Pending commands")
        }
        .help(helpText)
    }
}

private struct JiraTicketRowEvidenceChip: View {
    let symbol: String
    let value: Int
    let title: String

    private var tone: Color {
        value > 0 ? PKTheme.primary : PKTheme.text4
    }

    var body: some View {
        HStack(spacing: 4) {
            Image(systemName: symbol)
                .font(.system(size: 9, weight: .semibold))
                .foregroundStyle(tone)
            Text("\(value)")
                .font(.system(size: 9, weight: .semibold))
                .foregroundStyle(value > 0 ? PKTheme.text2 : PKTheme.text4)
                .lineLimit(1)
        }
        .frame(minWidth: 34)
        .frame(height: 22)
        .background(PKTheme.control.opacity(value > 0 ? 0.58 : 0.30))
        .overlay(RoundedRectangle(cornerRadius: 6).stroke(PKTheme.edge.opacity(value > 0 ? 0.86 : 0.50), lineWidth: 1))
        .clipShape(RoundedRectangle(cornerRadius: 6))
        .help("\(title): \(value)")
    }
}

private struct NewChatQuickAction: Identifiable {
    let id: String
    let symbol: String
    let title: String
    let prompt: String

    init(symbol: String, title: String, prompt: String) {
        self.id = title
        self.symbol = symbol
        self.title = title
        self.prompt = prompt
    }
}

private func quickActions(for mode: NewChatMode) -> [NewChatQuickAction] {
    switch mode {
    case .daily:
        return [
            NewChatQuickAction(symbol: "doc.text", title: "Daily Summary", prompt: "Summarize today's progress in {project}. Call out blockers, decisions, and the next concrete action."),
            NewChatQuickAction(symbol: "tray.full", title: "Inbox Triage", prompt: "Inspect the open work around {project}, group it by urgency, and recommend what I should handle first."),
            NewChatQuickAction(symbol: "calendar.badge.clock", title: "Plan Session", prompt: "Create a short execution plan for {project}: goal, checkpoints, risks, and what {agent} should do first."),
            NewChatQuickAction(symbol: "ellipsis", title: "More", prompt: "Help me choose the right workflow for {project}. Ask only if something is truly missing.")
        ]
    case .engineering:
        return [
            NewChatQuickAction(symbol: "wrench.and.screwdriver", title: "Repo Audit", prompt: "Inspect {project} and identify the next high-value engineering step. Include files to touch and how to verify."),
            NewChatQuickAction(symbol: "ladybug", title: "Bug Triage", prompt: "Trace the reported issue in {project}. Reproduce or locate the likely seam, then propose the smallest verified fix."),
            NewChatQuickAction(symbol: "checklist", title: "Review Diff", prompt: "Review the current changes in {project}. Prioritize bugs, regressions, missing tests, and risky behavior."),
            NewChatQuickAction(symbol: "shippingbox", title: "Release Check", prompt: "Check whether {project} is ready to ship. Verify build, tests, obvious UX risks, and remaining blockers.")
        ]
    case .creative:
        return [
            NewChatQuickAction(symbol: "sparkles", title: "UI Polish", prompt: "Improve this surface in {project} so it feels calmer, more useful, and closer to the product's current design language."),
            NewChatQuickAction(symbol: "rectangle.3.group", title: "Layout Study", prompt: "Compare layout options for {project}. Recommend the best structure for high-frequency agent work."),
            NewChatQuickAction(symbol: "paintbrush", title: "Visual Pass", prompt: "Do a visual pass on {project}: spacing, hierarchy, copy, interaction states, and anything that feels unfinished."),
            NewChatQuickAction(symbol: "text.bubble", title: "Copy Rewrite", prompt: "Rewrite the visible copy in {project} to be concise, confident, and useful without explaining the UI.")
        ]
    }
}

private struct NewChatTemplateGallery: View {
    let mode: NewChatMode
    let apply: (NewChatTemplate) -> Void

    private let columns = [
        GridItem(.flexible(), spacing: 14),
        GridItem(.flexible(), spacing: 14),
        GridItem(.flexible(), spacing: 14)
    ]

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 10) {
                Text("Best starting points")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(PKTheme.text2)
                Text("Click one to prefill the composer")
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(PKTheme.text4)
                Spacer()
            }

            LazyVGrid(columns: columns, spacing: 14) {
                ForEach(templates(for: mode)) { template in
                    Button {
                        apply(template)
                    } label: {
                        NewChatTemplateCard(template: template)
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }
}

private struct NewChatTemplate: Identifiable {
    let id: String
    let title: String
    let subtitle: String
    let symbol: String
    let accent: Color
    let prompt: String

    init(title: String, subtitle: String, symbol: String, accent: Color, prompt: String) {
        self.id = title
        self.title = title
        self.subtitle = subtitle
        self.symbol = symbol
        self.accent = accent
        self.prompt = prompt
    }
}

private struct NewChatTemplateCard: View {
    let template: NewChatTemplate
    @State private var hovering = false

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                Image(systemName: template.symbol)
                    .font(.system(size: 14, weight: .bold))
                    .frame(width: 30, height: 30)
                    .foregroundStyle(template.accent)
                    .background(template.accent.opacity(0.13))
                    .clipShape(RoundedRectangle(cornerRadius: 8))
                Spacer()
                Image(systemName: "arrow.up.right")
                    .font(.system(size: 10, weight: .bold))
                    .foregroundStyle(PKTheme.text4)
            }

            VStack(alignment: .leading, spacing: 5) {
                Text(template.title)
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(PKTheme.text)
                    .lineLimit(1)
                Text(template.subtitle)
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(PKTheme.text3)
                    .lineLimit(2)
                    .fixedSize(horizontal: false, vertical: true)
            }

            NewChatTemplatePreview(accent: template.accent)
        }
        .padding(16)
        .frame(maxWidth: .infinity, minHeight: 166, alignment: .topLeading)
        .background(
            LinearGradient(
                colors: [template.accent.opacity(hovering ? 0.12 : 0.08), PKTheme.surfaceRaised.opacity(0.90)],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
        )
        .overlay(
            RoundedRectangle(cornerRadius: 8)
                .stroke(hovering ? template.accent.opacity(0.48) : PKTheme.edge, lineWidth: 1)
        )
        .clipShape(RoundedRectangle(cornerRadius: 8))
        .onHover { hovering = $0 }
    }
}

private struct NewChatTemplatePreview: View {
    let accent: Color

    var body: some View {
        VStack(spacing: 6) {
            HStack(spacing: 6) {
                ForEach(0..<3, id: \.self) { index in
                    RoundedRectangle(cornerRadius: 4)
                        .fill(index == 0 ? accent.opacity(0.28) : PKTheme.control.opacity(0.72))
                        .frame(height: 16)
                }
            }

            HStack(alignment: .bottom, spacing: 5) {
                ForEach([0.38, 0.62, 0.46, 0.78, 0.52], id: \.self) { height in
                    RoundedRectangle(cornerRadius: 3)
                        .fill(accent.opacity(height > 0.7 ? 0.40 : 0.20))
                        .frame(height: 30 * height)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(9)
        .frame(height: 66)
        .background(PKTheme.inset.opacity(0.78))
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }
}

private func templates(for mode: NewChatMode) -> [NewChatTemplate] {
    switch mode {
    case .daily:
        return [
            NewChatTemplate(title: "Daily Report", subtitle: "Turn open work and recent runs into a clean status note.", symbol: "doc.text", accent: PKTheme.ok, prompt: "Create a daily report for {project}. Include completed work, open risks, owners, and the next three actions."),
            NewChatTemplate(title: "Work Queue", subtitle: "Rank active items by impact and effort before starting.", symbol: "list.bullet.rectangle", accent: PKTheme.primary, prompt: "Review the active work queue in {project}. Rank items by impact, effort, risk, and recommend the next task."),
            NewChatTemplate(title: "Meeting Prep", subtitle: "Prepare a crisp update from current project state.", symbol: "person.2.wave.2", accent: PKTheme.warn, prompt: "Prepare a meeting update for {project}. Keep it short: context, current status, decisions needed, and risks.")
        ]
    case .engineering:
        return [
            NewChatTemplate(title: "Repo Health", subtitle: "Inspect structure, tests, and the next safe implementation step.", symbol: "stethoscope", accent: PKTheme.primary, prompt: "Inspect {project}. Summarize code health, likely next implementation step, files to inspect, and the verification path."),
            NewChatTemplate(title: "Fix Path", subtitle: "Start from a symptom, trace the seam, then patch narrowly.", symbol: "point.topleft.down.curvedto.point.bottomright.up", accent: Color(red: 0.58, green: 0.70, blue: 1.00), prompt: "Given the current issue in {project}, trace the likely cause, implement the smallest fix, and verify it with focused tests."),
            NewChatTemplate(title: "Ship Check", subtitle: "Build, test, and spot-check the product surface before handoff.", symbol: "checkmark.seal", accent: PKTheme.ok, prompt: "Run a release readiness pass for {project}: build, focused tests, UI check, known risks, and final go/no-go.")
        ]
    case .creative:
        return [
            NewChatTemplate(title: "Product Polish", subtitle: "Improve hierarchy, spacing, empty states, and copy.", symbol: "wand.and.stars", accent: Color(red: 0.72, green: 0.64, blue: 1.00), prompt: "Polish this {project} surface. Improve hierarchy, spacing, empty states, copy, and interaction states while keeping it useful."),
            NewChatTemplate(title: "Flow Sketch", subtitle: "Convert a rough idea into screens and transitions.", symbol: "rectangle.connected.to.line.below", accent: PKTheme.primary, prompt: "Design the user flow for {project}. Define the screens, transitions, primary controls, and where agent work appears."),
            NewChatTemplate(title: "Copy Pass", subtitle: "Make interface text direct, warm, and low-noise.", symbol: "quote.bubble", accent: PKTheme.warn, prompt: "Rewrite the visible UI copy for {project}. Keep it concise, specific, and useful. Avoid explaining controls that are already obvious.")
        ]
    }
}

private struct ComposerSkillCardModel: Identifiable {
    let id: EntityID
    let title: String
    let subtitle: String
    let symbol: String
    let tint: Color
    let command: String
    let previewCommand: String

    init(capability: Capability, index: Int, existingText: String) {
        id = capability.id
        title = capability.name
        subtitle = composerSkillSubtitle(for: capability)
        symbol = composerSkillSymbol(for: capability)
        tint = composerSkillTint(for: capability, index: index)
        command = composerSkillCommand(for: capability)
        previewCommand = composerSkillPreviewCommand(for: capability, existingText: existingText)
    }
}

private struct ComposerSkillCardRow: View {
    let skills: [ComposerSkillCardModel]
    let select: (ComposerSkillCardModel) -> Void

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(skills) { skill in
                    ComposerSkillCard(skill: skill) {
                        select(skill)
                    }
                }
            }
            .padding(.horizontal, 2)
            .padding(.vertical, 1)
        }
    }
}

private struct ComposerSkillCard: View {
    let skill: ComposerSkillCardModel
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(alignment: .leading, spacing: 8) {
                HStack(spacing: 7) {
                    Image(systemName: skill.symbol)
                        .font(.system(size: 10.5, weight: .semibold))
                    Text(skill.title)
                        .font(.system(size: 11.5, weight: .semibold))
                        .lineLimit(1)
                        .minimumScaleFactor(0.82)
                }
                .foregroundStyle(skill.tint)
                .padding(.horizontal, 8)
                .frame(height: 22)
                .background(skill.tint.opacity(0.16))
                .clipShape(RoundedRectangle(cornerRadius: 5))

                Text(skill.subtitle)
                    .font(.system(size: 10.5, weight: .medium))
                    .foregroundStyle(PKTheme.text3)
                    .lineLimit(1)

                Text(skill.previewCommand)
                    .font(.system(size: 10, weight: .medium, design: .monospaced))
                    .foregroundStyle(PKTheme.text2)
                    .lineLimit(1)
                    .truncationMode(.middle)
            }
            .padding(10)
            .frame(width: 208, height: 82, alignment: .leading)
            .background(
                LinearGradient(
                    colors: [
                        skill.tint.opacity(0.11),
                        PKTheme.surfaceRaised.opacity(0.62)
                    ],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                )
            )
            .overlay(RoundedRectangle(cornerRadius: 10).stroke(skill.tint.opacity(0.18), lineWidth: 1))
            .clipShape(RoundedRectangle(cornerRadius: 10))
        }
        .buttonStyle(.plain)
        .help(skill.previewCommand)
    }
}

private func composerSkillSubtitle(for capability: Capability) -> String {
    let lower = capability.name.lowercased()
    if isLogTraceSkillName(lower) {
        return "Trace logs by conversationId"
    }
    if lower.contains("clickhouse") || lower.contains("ch sql") {
        return "Query project data"
    }
    if lower.contains("superpower") {
        return "Use the Superpowers workflow"
    }
    if capability.configState != "ready" && capability.configState != "unknown" {
        return capability.configState.capitalized
    }
    return "Run this project skill"
}

private func composerSkillSymbol(for capability: Capability) -> String {
    let lower = capability.name.lowercased()
    if isLogTraceSkillName(lower) {
        return "waveform.path.ecg"
    }
    if lower.contains("clickhouse") || lower.contains("ch sql") {
        return "tablecells"
    }
    if lower.contains("superpower") {
        return "bolt.fill"
    }
    return "sparkles"
}

private func composerSkillTint(for capability: Capability, index: Int) -> Color {
    let lower = capability.name.lowercased()
    if isLogTraceSkillName(lower) {
        return PKTheme.primary
    }
    if lower.contains("clickhouse") || lower.contains("ch sql") {
        return Color(red: 0.62, green: 0.86, blue: 0.58)
    }
    if lower.contains("superpower") {
        return Color(red: 1.00, green: 0.72, blue: 0.38)
    }
    let palette = [
        Color(red: 0.78, green: 0.88, blue: 1.00),
        Color(red: 1.00, green: 0.78, blue: 0.76),
        Color(red: 0.82, green: 0.94, blue: 0.70)
    ]
    return palette[index % palette.count]
}

func composerSkillCommand(for capability: Capability) -> String {
    let lower = capability.name.lowercased()
    if isLogTraceSkillName(lower) {
        return "/logtrace env=lab conversationId= last=24h "
    }
    if lower.contains("clickhouse") || lower.contains("ch sql") {
        return "/clickhouse "
    }
    return "/sk_\(composerSkillSlug(capability.name)) "
}

func composerSkillPreviewCommand(for capability: Capability, existingText: String) -> String {
    composerSkillDraft(command: composerSkillCommand(for: capability), existingText: existingText)
}

func composerSkillDraft(command: String, existingText: String) -> String {
    let trimmedCommand = command.gitTrimmed
    let existing = existingText.gitTrimmed
    guard !existing.isEmpty else { return command }
    guard !existing.hasPrefix("/") else { return existing }

    if trimmedCommand.hasPrefix("/logtrace") {
        let envOverride = composerLogTraceEnvOverride(from: existing)
        let lastOverride = composerLogTraceLastOverride(from: existing)
        let messageQuery = composerExplicitLogTraceMessageQuery(from: existing)
        if let explicitArgument = composerExplicitLogTraceArgument(from: existing) {
            return composerLogTraceDraft(
                command: trimmedCommand,
                argument: explicitArgument,
                existingArguments: existing,
                envOverride: envOverride,
                lastOverride: lastOverride,
                query: messageQuery
            )
        }
        if let traceParentArgument = composerBareLogTraceTraceParentArgument(from: existing) {
            return composerLogTraceDraft(
                command: trimmedCommand,
                argument: traceParentArgument,
                existingArguments: existing,
                envOverride: envOverride,
                lastOverride: lastOverride,
                query: messageQuery
            )
        }
        if let bareArgument = composerBareLogTraceArgument(from: existing) {
            return composerLogTraceDraft(
                command: trimmedCommand,
                argument: "conversationId=\(bareArgument)",
                existingArguments: existing,
                envOverride: envOverride,
                lastOverride: lastOverride,
                query: messageQuery
            )
        }
        if let messageQuery {
            return composerLogTraceDraft(
                command: trimmedCommand,
                argument: "",
                existingArguments: existing,
                envOverride: envOverride,
                lastOverride: lastOverride,
                query: messageQuery
            )
        }
        if envOverride != nil || lastOverride != nil {
            return composerLogTraceDraft(
                command: trimmedCommand,
                argument: "conversationId=",
                existingArguments: existing,
                envOverride: envOverride,
                lastOverride: lastOverride,
                symptom: composerLogTraceSymptom(from: existing)
            )
        }
        if existing.contains("=") {
            return "/logtrace \(existing)"
        }
        return "\(trimmedCommand) symptom=\"\(composerShellEscaped(existing))\""
    }

    if trimmedCommand.hasPrefix("/clickhouse") {
        return composerClickHouseDraft(command: trimmedCommand, existingText: existing)
    }

    return "\(trimmedCommand) \(existing)"
}

private func composerClickHouseDraft(command: String, existingText: String) -> String {
    if composerLooksLikeSQL(existingText) {
        return "\(command) \(existingText)"
    }
    let limitOverride = composerClickHouseLimitOverride(from: existingText)
    if let task = composerClickHouseTraceTask(from: existingText, limitOverride: limitOverride) {
        return "\(command) \(task)"
    }
    let limit = limitOverride ?? "limit=20"
    if let lookup = composerExplicitClickHouseLookup(from: existingText, limit: limit) {
        return "\(command) \(lookup)"
    }

    let value = composerSanitizedSkillValue(existingText)
    if composerLooksLikeSingleArgument(value),
       let lookup = composerClickHouseLookup(field: nil, value: value, limit: limit) {
        return "\(command) \(lookup)"
    }
    if let lookup = composerBareClickHouseLookup(from: existingText, limit: limit) {
        return "\(command) \(lookup)"
    }

    return "\(command) \(existingText)"
}

private func composerLooksLikeSQL(_ value: String) -> Bool {
    let first = value
        .split(whereSeparator: { $0.isWhitespace || $0.isNewline })
        .first
        .map(String.init)?
        .trimmingCharacters(in: composerSkillFieldTrimCharacters)
        .lowercased()
    guard let first else { return false }
    return ["select", "with", "show", "describe", "desc", "explain"].contains(first)
}

private func composerClickHouseLimitOverride(from value: String) -> String? {
    let tokens = value
        .split(whereSeparator: { $0.isWhitespace || $0.isNewline })
        .map(String.init)
    for index in tokens.indices {
        if let limit = composerClickHouseLimit(fromToken: tokens[index]) {
            return limit
        }
        let token = tokens[index]
            .trimmingCharacters(in: composerSkillFieldTrimCharacters)
            .lowercased()
        guard ["limit", "top", "rows"].contains(token),
              index + 1 < tokens.count else {
            continue
        }
        if let limit = composerClickHouseLimit(fromValue: tokens[index + 1]) {
            return limit
        }
    }
    return nil
}

private func composerClickHouseLimit(fromToken token: String) -> String? {
    let trimmed = token.trimmingCharacters(in: composerSkillValueTrimCharacters)
    for separator in ["=", ":", "："] {
        guard let range = trimmed.range(of: separator) else { continue }
        let field = String(trimmed[..<range.lowerBound])
            .trimmingCharacters(in: composerSkillFieldTrimCharacters)
            .lowercased()
        guard ["limit", "top", "rows"].contains(field) else { continue }
        return composerClickHouseLimit(fromValue: String(trimmed[range.upperBound...]))
    }
    return nil
}

private func composerClickHouseLimit(fromValue value: String) -> String? {
    let sanitized = value.trimmingCharacters(in: composerSkillValueTrimCharacters)
    guard !sanitized.isEmpty,
          sanitized.allSatisfy(\.isNumber),
          let parsed = Int(sanitized),
          parsed > 0 else {
        return nil
    }
    return "limit=\(min(parsed, 500))"
}

private enum ComposerClickHouseTraceTaskMode {
    case slow
    case error

    var taskLabel: String {
        switch self {
        case .slow:
            return "slow"
        case .error:
            return "error"
        }
    }

    var defaultLimit: String {
        switch self {
        case .slow:
            return "limit=10"
        case .error:
            return "limit=20"
        }
    }
}

private struct ComposerClickHouseTraceTarget {
    var traceId: String?
    var conversationId: String?
}

private func composerClickHouseTraceTask(
    from value: String,
    limitOverride: String?
) -> String? {
    guard let mode = composerClickHouseTraceTaskMode(from: value),
          let target = composerClickHouseTraceTarget(from: value),
          target.traceId != nil || target.conversationId != nil else {
        return nil
    }
    var pieces = ["show", mode.taskLabel, "spans", "for"]
    if let traceId = target.traceId {
        pieces.append("TraceId=\(traceId)")
    }
    if let conversationId = target.conversationId {
        pieces.append("ConversationId=\(conversationId)")
    }
    pieces.append(limitOverride ?? mode.defaultLimit)
    return pieces.joined(separator: " ")
}

private func composerClickHouseTraceTaskMode(from value: String) -> ComposerClickHouseTraceTaskMode? {
    let tokens = value
        .split(whereSeparator: { $0.isWhitespace || $0.isNewline })
        .map { composerSanitizedSkillValue(String($0)).lowercased() }
    if tokens.contains(where: composerClickHouseSlowMarker(_:)) {
        return .slow
    }
    if tokens.contains(where: composerClickHouseErrorMarker(_:)) {
        return .error
    }
    return nil
}

private func composerClickHouseSlowMarker(_ value: String) -> Bool {
    switch value {
    case "slow", "slower", "slowest", "latency", "duration", "long", "longest", "耗时", "慢", "延迟":
        return true
    default:
        return false
    }
}

private func composerClickHouseErrorMarker(_ value: String) -> Bool {
    switch value {
    case "error", "errors", "exception", "exceptions", "failed", "failure", "timeout", "timeouts", "错误", "异常", "失败", "超时":
        return true
    default:
        return false
    }
}

private func composerClickHouseTraceTarget(from value: String) -> ComposerClickHouseTraceTarget? {
    let tokens = value
        .split(whereSeparator: { $0.isWhitespace || $0.isNewline })
        .map(String.init)
    var target = ComposerClickHouseTraceTarget()
    for index in tokens.indices {
        if composerClickHouseLimit(fromToken: tokens[index]) != nil {
            continue
        }
        if let inline = composerInlineClickHouseTraceTarget(from: tokens[index]) {
            target = composerMergeClickHouseTraceTarget(target, inline)
        }
        if let explicit = composerExplicitClickHouseTraceTarget(from: tokens, index: index) {
            target = composerMergeClickHouseTraceTarget(target, explicit)
        }
        let sanitized = composerSanitizedSkillValue(tokens[index])
        if let bare = composerBareClickHouseTraceTarget(from: sanitized) {
            target = composerMergeClickHouseTraceTarget(target, bare)
        }
    }
    return (target.traceId != nil || target.conversationId != nil) ? target : nil
}

private func composerInlineClickHouseTraceTarget(from token: String) -> ComposerClickHouseTraceTarget? {
    let trimmed = token.trimmingCharacters(in: composerSkillValueTrimCharacters)
    for separator in ["=", ":", "："] {
        guard let range = trimmed.range(of: separator) else { continue }
        let field = String(trimmed[..<range.lowerBound])
        let value = composerSanitizedSkillValue(String(trimmed[range.upperBound...]))
        guard let canonicalField = composerClickHouseCanonicalField(field) else { continue }
        return composerClickHouseTraceTarget(field: canonicalField, value: value)
    }
    return nil
}

private func composerExplicitClickHouseTraceTarget(
    from tokens: [String],
    index: Int
) -> ComposerClickHouseTraceTarget? {
    let fieldToken = tokens[index].trimmingCharacters(in: composerSkillFieldTrimCharacters)
    if let canonicalField = composerClickHouseCanonicalField(fieldToken),
       index + 1 < tokens.count {
        return composerClickHouseTraceTarget(
            field: canonicalField,
            value: composerSanitizedSkillValue(tokens[index + 1])
        )
    }
    guard index + 2 < tokens.count else { return nil }
    let firstField = tokens[index].trimmingCharacters(in: composerSkillFieldTrimCharacters)
    let secondField = tokens[index + 1].trimmingCharacters(in: composerSkillFieldTrimCharacters)
    guard let canonicalField = composerClickHouseCanonicalField("\(firstField) \(secondField)") else {
        return nil
    }
    return composerClickHouseTraceTarget(
        field: canonicalField,
        value: composerSanitizedSkillValue(tokens[index + 2])
    )
}

private func composerClickHouseTraceTarget(field: String, value: String) -> ComposerClickHouseTraceTarget? {
    let sanitized = composerSanitizedSkillValue(value)
    guard composerLooksLikeSkillLookupValue(sanitized) else { return nil }
    switch field {
    case "TraceId":
        return ComposerClickHouseTraceTarget(traceId: sanitized, conversationId: nil)
    case "TraceParent":
        guard let traceId = composerTraceIdFromTraceParentValue(sanitized) else { return nil }
        return ComposerClickHouseTraceTarget(traceId: traceId, conversationId: nil)
    case "ConversationId":
        let traceId = sanitized.replacingOccurrences(of: "-", with: "")
        return ComposerClickHouseTraceTarget(
            traceId: composerLooksLikeTraceId(traceId) ? traceId : nil,
            conversationId: sanitized
        )
    default:
        return nil
    }
}

private func composerBareClickHouseTraceTarget(from value: String) -> ComposerClickHouseTraceTarget? {
    if let traceId = composerTraceIdFromTraceParentValue(value) {
        return ComposerClickHouseTraceTarget(traceId: traceId, conversationId: nil)
    }
    if composerLooksLikeTraceId(value) {
        return ComposerClickHouseTraceTarget(traceId: value, conversationId: nil)
    }
    guard value.contains("-") else { return nil }
    let traceId = value.replacingOccurrences(of: "-", with: "")
    guard composerLooksLikeTraceId(traceId) else { return nil }
    return ComposerClickHouseTraceTarget(traceId: traceId, conversationId: value)
}

private func composerMergeClickHouseTraceTarget(
    _ first: ComposerClickHouseTraceTarget,
    _ second: ComposerClickHouseTraceTarget
) -> ComposerClickHouseTraceTarget {
    ComposerClickHouseTraceTarget(
        traceId: first.traceId ?? second.traceId,
        conversationId: first.conversationId ?? second.conversationId
    )
}

private func composerExplicitClickHouseLookup(from value: String, limit: String) -> String? {
    let tokens = value
        .split(whereSeparator: { $0.isWhitespace || $0.isNewline })
        .map(String.init)
    for index in tokens.indices {
        let token = tokens[index]
        if let inline = composerInlineClickHouseLookup(from: token, limit: limit) {
            return inline
        }

        let fieldToken = token.trimmingCharacters(in: composerSkillFieldTrimCharacters)
        guard let canonicalField = composerClickHouseCanonicalField(fieldToken),
              index + 1 < tokens.count else {
            if let lookup = composerPairedClickHouseLookup(from: tokens, index: index, limit: limit) {
                return lookup
            }
            continue
        }
        if let lookup = composerClickHouseLookup(
            field: canonicalField,
            value: composerSanitizedSkillValue(tokens[index + 1]),
            limit: limit
        ) {
            return lookup
        }
    }
    return nil
}

private func composerPairedClickHouseLookup(from tokens: [String], index: Int, limit: String) -> String? {
    guard index + 2 < tokens.count else { return nil }
    let firstField = tokens[index].trimmingCharacters(in: composerSkillFieldTrimCharacters)
    let secondField = tokens[index + 1].trimmingCharacters(in: composerSkillFieldTrimCharacters)
    guard let canonicalField = composerClickHouseCanonicalField("\(firstField) \(secondField)") else {
        return nil
    }
    return composerClickHouseLookup(
        field: canonicalField,
        value: composerSanitizedSkillValue(tokens[index + 2]),
        limit: limit
    )
}

private func composerBareClickHouseLookup(from value: String, limit: String) -> String? {
    let tokens = value
        .split(whereSeparator: { $0.isWhitespace || $0.isNewline })
        .map(String.init)
    for token in tokens {
        let sanitized = composerSanitizedSkillValue(token)
        if let traceId = composerTraceIdFromTraceParentToken(sanitized),
           let lookup = composerClickHouseLookup(field: "TraceId", value: traceId, limit: limit) {
            return lookup
        }
        guard composerLooksLikeBareClickHouseLookupValue(sanitized),
              let lookup = composerClickHouseLookup(field: nil, value: sanitized, limit: limit) else {
            continue
        }
        return lookup
    }
    return nil
}

private func composerLooksLikeBareClickHouseLookupValue(_ value: String) -> Bool {
    if composerLooksLikeTraceId(value) { return true }
    guard value.contains("-") else { return false }
    return composerLooksLikeTraceId(value.replacingOccurrences(of: "-", with: ""))
}

private func composerInlineClickHouseLookup(from token: String, limit: String) -> String? {
    let trimmed = token.trimmingCharacters(in: composerSkillValueTrimCharacters)
    for separator in ["=", ":", "："] {
        guard let range = trimmed.range(of: separator) else { continue }
        let field = String(trimmed[..<range.lowerBound])
        let value = composerSanitizedSkillValue(String(trimmed[range.upperBound...]))
        guard let canonicalField = composerClickHouseCanonicalField(field),
              let lookup = composerClickHouseLookup(field: canonicalField, value: value, limit: limit) else {
            continue
        }
        return lookup
    }
    return nil
}

private func composerClickHouseLookup(field: String?, value: String, limit: String) -> String? {
    let sanitized = composerSanitizedSkillValue(value)
    guard composerLooksLikeSkillLookupValue(sanitized) else { return nil }
    switch field {
    case "ConversationId":
        return composerClickHouseConversationLookup(sanitized, limit: limit)
    case "TraceId":
        return "trace lookup TraceId=\(sanitized) \(limit)"
    case "TraceParent":
        guard let traceId = composerTraceIdFromTraceParentValue(sanitized) else { return nil }
        return "trace lookup TraceId=\(traceId) \(limit)"
    case "SessionId":
        return "trace lookup SessionId=\(sanitized) \(limit)"
    case nil:
        if let traceId = composerTraceIdFromTraceParentValue(sanitized) {
            return "trace lookup TraceId=\(traceId) \(limit)"
        }
        if sanitized.contains("-") {
            return composerClickHouseConversationLookup(sanitized, limit: limit)
        }
        if composerLooksLikeTraceId(sanitized) {
            return "trace lookup TraceId=\(sanitized) \(limit)"
        }
        return nil
    default:
        return nil
    }
}

private func composerClickHouseConversationLookup(_ conversationId: String, limit: String) -> String {
    let traceId = conversationId.replacingOccurrences(of: "-", with: "")
    if composerLooksLikeTraceId(traceId) {
        return "trace lookup TraceId=\(traceId) ConversationId=\(conversationId) \(limit)"
    }
    return "trace lookup ConversationId=\(conversationId) \(limit)"
}

private func composerClickHouseCanonicalField(_ value: String) -> String? {
    switch value
        .trimmingCharacters(in: composerSkillFieldTrimCharacters)
        .lowercased()
        .replacingOccurrences(of: "_", with: "")
        .replacingOccurrences(of: "-", with: "")
        .replacingOccurrences(of: " ", with: "") {
    case "conversationid":
        return "ConversationId"
    case "traceid":
        return "TraceId"
    case "traceparent":
        return "TraceParent"
    case "sessionid":
        return "SessionId"
    default:
        return nil
    }
}

private func composerLooksLikeTraceId(_ value: String) -> Bool {
    value.count == 32
        && value.unicodeScalars.allSatisfy { composerHexDigits.contains($0) }
}

private func composerTraceIdFromTraceParentToken(_ token: String) -> String? {
    let trimmed = token.trimmingCharacters(in: composerSkillValueTrimCharacters)
    for separator in ["=", ":", "："] {
        guard let range = trimmed.range(of: separator) else { continue }
        let field = String(trimmed[..<range.lowerBound])
        guard composerTraceParentField(field) else { continue }
        return composerTraceIdFromTraceParentValue(String(trimmed[range.upperBound...]))
    }
    return composerTraceIdFromTraceParentValue(trimmed)
}

private func composerTraceParentField(_ value: String) -> Bool {
    value
        .trimmingCharacters(in: composerSkillFieldTrimCharacters)
        .lowercased()
        .replacingOccurrences(of: "_", with: "")
        .replacingOccurrences(of: "-", with: "")
        .replacingOccurrences(of: " ", with: "") == "traceparent"
}

private func composerTraceIdFromTraceParentValue(_ value: String) -> String? {
    let parts = composerSanitizedSkillValue(value).split(separator: "-", omittingEmptySubsequences: false).map(String.init)
    guard parts.count >= 4,
          composerHexValue(parts[0], count: 2),
          composerLooksLikeTraceId(parts[1]),
          composerHexValue(parts[2], count: 16),
          composerHexValue(parts[3], count: 2) else {
        return nil
    }
    return parts[1]
}

private func composerHexValue(_ value: String, count: Int) -> Bool {
    value.count == count
        && value.unicodeScalars.allSatisfy { composerHexDigits.contains($0) }
}

private let composerHexDigits = CharacterSet(charactersIn: "0123456789abcdefABCDEF")

private let composerLogTraceDurationUnits: [(suffix: String, unit: String)] = [
    ("分钟", "m"),
    ("分", "m"),
    ("minutes", "m"),
    ("minute", "m"),
    ("mins", "m"),
    ("min", "m"),
    ("m", "m"),
    ("小时", "h"),
    ("hours", "h"),
    ("hour", "h"),
    ("hrs", "h"),
    ("hr", "h"),
    ("h", "h"),
    ("天", "d"),
    ("days", "d"),
    ("day", "d"),
    ("d", "d"),
    ("周", "w"),
    ("weeks", "w"),
    ("week", "w"),
    ("w", "w")
]

private func composerLogTraceDraft(
    command: String,
    argument: String,
    existingArguments: String = "",
    envOverride: String? = nil,
    lastOverride: String? = nil,
    query: String? = nil,
    symptom: String? = nil
) -> String {
    let defaults = command
        .split(separator: " ")
        .dropFirst()
        .map(String.init)
    let overrides = existingArguments
        .split(whereSeparator: { $0.isWhitespace || $0.isNewline })
        .map(String.init)
    let env = envOverride
        ?? overrides.first(where: { $0.hasPrefix("env=") })
        ?? defaults.first(where: { $0.hasPrefix("env=") })
        ?? "env=lab"
    let last = lastOverride
        ?? overrides.first(where: { $0.hasPrefix("last=") })
        ?? defaults.first(where: { $0.hasPrefix("last=") })
        ?? "last=24h"
    let symptomArgument = composerNilIfEmpty(symptom?.gitTrimmed ?? "")
        .map { "symptom=\"\(composerShellEscaped($0))\"" }
    return ["/logtrace", env, argument, query, last, symptomArgument]
        .compactMap { composerNilIfEmpty($0?.gitTrimmed ?? "") }
        .joined(separator: " ")
}

private func composerLogTraceEnvOverride(from value: String) -> String? {
    let tokens = value
        .split(whereSeparator: { $0.isWhitespace || $0.isNewline })
        .map(String.init)
    for token in tokens {
        if let env = composerLogTraceEnv(fromToken: token) {
            return env
        }
    }
    return nil
}

private func composerLogTraceEnv(fromToken token: String) -> String? {
    let trimmed = token.trimmingCharacters(in: composerSkillValueTrimCharacters)
    for separator in ["=", ":", "："] {
        if let range = trimmed.range(of: separator) {
            let field = String(trimmed[..<range.lowerBound])
                .trimmingCharacters(in: composerSkillFieldTrimCharacters)
                .lowercased()
            guard field == "env" || field == "environment" else { continue }
            return composerCanonicalLogTraceEnv(String(trimmed[range.upperBound...]))
        }
    }
    return composerCanonicalLogTraceEnv(trimmed)
}

private func composerCanonicalLogTraceEnv(_ value: String) -> String? {
    switch value
        .trimmingCharacters(in: composerSkillValueTrimCharacters)
        .lowercased() {
    case "prod", "production", "prd":
        return "env=production"
    case "stage", "staging", "stg":
        return "env=stage"
    case "lab", "cnlab", "cn-lab", "cn_lab",
         "lab01", "lab03", "lab05",
         "cnlab01", "cnlab03", "cnlab05",
         "cn-lab01", "cn-lab03", "cn-lab05",
         "cn_lab01", "cn_lab03", "cn_lab05":
        return "env=lab"
    default:
        return nil
    }
}

private func composerLogTraceLastOverride(from value: String) -> String? {
    let tokens = value
        .split(whereSeparator: { $0.isWhitespace || $0.isNewline })
        .map(String.init)
    for index in tokens.indices {
        let token = tokens[index].trimmingCharacters(in: composerSkillValueTrimCharacters)
        if let duration = composerLogTraceLast(fromToken: token) {
            return duration
        }
        if token.lowercased() == "last",
           index + 1 < tokens.count,
           let duration = composerLogTraceDuration(tokens[index + 1]) {
            return duration
        }
        if composerLogTraceIsDurationLeadToken(token),
           index + 2 < tokens.count,
           let duration = composerLogTraceDuration(number: tokens[index + 1], unit: tokens[index + 2]) {
            return duration
        }
        if index + 1 < tokens.count,
           let duration = composerLogTraceDuration(number: token, unit: tokens[index + 1]) {
            return duration
        }
    }
    return nil
}

private func composerLogTraceLast(fromToken token: String) -> String? {
    let trimmed = token.trimmingCharacters(in: composerSkillValueTrimCharacters)
    for separator in ["=", ":", "："] {
        if let range = trimmed.range(of: separator) {
            let field = String(trimmed[..<range.lowerBound])
                .trimmingCharacters(in: composerSkillFieldTrimCharacters)
                .lowercased()
            guard field == "last" else { continue }
            return composerLogTraceDuration(String(trimmed[range.upperBound...]))
        }
    }
    return composerLogTraceDuration(trimmed)
}

private func composerLogTraceDuration(_ value: String) -> String? {
    let sanitized = value
        .trimmingCharacters(in: composerSkillValueTrimCharacters)
        .lowercased()
    for (suffix, unit) in composerLogTraceDurationUnits {
        guard sanitized.hasSuffix(suffix) else { continue }
        let number = sanitized.dropLast(suffix.count)
        guard !number.isEmpty, number.allSatisfy(\.isNumber) else { continue }
        return "last=\(number)\(unit)"
    }
    return nil
}

private func composerLogTraceDuration(number: String, unit: String) -> String? {
    let sanitizedNumber = number.trimmingCharacters(in: composerSkillValueTrimCharacters)
    guard !sanitizedNumber.isEmpty,
          sanitizedNumber.allSatisfy(\.isNumber),
          let canonicalUnit = composerLogTraceDurationUnit(unit) else {
        return nil
    }
    return "last=\(sanitizedNumber)\(canonicalUnit)"
}

private func composerLogTraceDurationUnit(_ value: String) -> String? {
    let sanitized = value
        .trimmingCharacters(in: composerSkillValueTrimCharacters)
        .lowercased()
    return composerLogTraceDurationUnits.first(where: { $0.suffix == sanitized })?.unit
}

private func composerLogTraceIsDurationLeadToken(_ value: String) -> Bool {
    switch value
        .trimmingCharacters(in: composerSkillValueTrimCharacters)
        .lowercased() {
    case "last", "最近", "近", "过去":
        return true
    default:
        return false
    }
}

private func composerBareLogTraceTraceParentArgument(from value: String) -> String? {
    let tokens = value
        .split(whereSeparator: { $0.isWhitespace || $0.isNewline })
        .map(String.init)
    for token in tokens {
        let sanitized = composerSanitizedSkillValue(token)
        guard !sanitized.isEmpty,
              composerLogTraceEnv(fromToken: sanitized) == nil,
              composerLogTraceLast(fromToken: sanitized) == nil,
              let traceId = composerTraceIdFromTraceParentToken(sanitized) else {
            continue
        }
        return "traceId=\(traceId)"
    }
    return nil
}

private func composerBareLogTraceArgument(from value: String) -> String? {
    let tokens = value
        .split(whereSeparator: { $0.isWhitespace || $0.isNewline })
        .map(String.init)
    for token in tokens {
        let sanitized = composerSanitizedSkillValue(token)
        guard !sanitized.isEmpty,
              composerLogTraceEnv(fromToken: sanitized) == nil,
              composerLogTraceLast(fromToken: sanitized) == nil,
              composerLogTraceCanonicalField(sanitized) == nil,
              composerLooksLikeSkillLookupValue(sanitized) else {
            continue
        }
        return sanitized
    }
    return nil
}

private func composerLogTraceSymptom(from value: String) -> String? {
    let tokens = value
        .split(whereSeparator: { $0.isWhitespace || $0.isNewline })
        .map(String.init)
    var kept: [String] = []
    var skipCount = 0
    for index in tokens.indices {
        if skipCount > 0 {
            skipCount -= 1
            continue
        }
        let token = tokens[index]
        let sanitized = composerSanitizedSkillValue(token)
        if composerLogTraceEnv(fromToken: sanitized) != nil
            || composerLogTraceLast(fromToken: sanitized) != nil {
            continue
        }
        if index + 1 < tokens.count,
           composerLogTraceDuration(number: token, unit: tokens[index + 1]) != nil {
            skipCount = 1
            continue
        }
        if composerLogTraceIsDurationLeadToken(sanitized),
           index + 1 < tokens.count,
           composerLogTraceDuration(tokens[index + 1]) != nil {
            skipCount = 1
            continue
        }
        if composerLogTraceIsDurationLeadToken(sanitized),
           index + 2 < tokens.count,
           composerLogTraceDuration(number: tokens[index + 1], unit: tokens[index + 2]) != nil {
            skipCount = 2
            continue
        }
        if sanitized.lowercased() == "env" || sanitized.lowercased() == "environment" {
            continue
        }
        kept.append(token)
    }
    return composerNilIfEmpty(kept.joined(separator: " ").gitTrimmed)
}

private func composerExplicitLogTraceMessageQuery(from value: String) -> String? {
    let tokens = composerMeaningfulLogTraceSearchTokens(from: value)
    for index in tokens.indices {
        let token = tokens[index]
        if composerLogTraceFieldTokenSelectsMessage(token.raw) {
            return composerLogTraceMessageQuery(from: tokens, startIndex: index + 1)
        }
        if let inlineValue = composerInlineLogTraceMessageValue(from: token.raw) {
            return composerLogTraceMessageQuery(from: tokens, startIndex: index + 1, prefix: inlineValue)
        }
        if composerLogTraceMessageFieldMarker(token.lower) {
            var startIndex = index + 1
            if startIndex < tokens.count,
               composerLogTraceMessageConnector(tokens[startIndex].lower) {
                startIndex += 1
            }
            return composerLogTraceMessageQuery(from: tokens, startIndex: startIndex)
        }
        if composerLogTraceMessageSeverityMarker(token.lower) {
            return composerLogTraceMessageQuery(from: tokens, startIndex: index)
        }
    }
    return nil
}

private func composerMeaningfulLogTraceSearchTokens(from value: String) -> [(raw: String, lower: String)] {
    let tokens = value
        .split(whereSeparator: { $0.isWhitespace || $0.isNewline })
        .map(String.init)
    var kept: [(raw: String, lower: String)] = []
    var skipCount = 0
    for index in tokens.indices {
        if skipCount > 0 {
            skipCount -= 1
            continue
        }
        let token = tokens[index]
        let sanitized = composerSanitizedSkillValue(token)
        if composerLogTraceEnv(fromToken: sanitized) != nil
            || composerLogTraceLast(fromToken: sanitized) != nil {
            continue
        }
        if index + 1 < tokens.count,
           composerLogTraceDuration(number: token, unit: tokens[index + 1]) != nil {
            skipCount = 1
            continue
        }
        if composerLogTraceIsDurationLeadToken(sanitized),
           index + 1 < tokens.count,
           composerLogTraceDuration(tokens[index + 1]) != nil {
            skipCount = 1
            continue
        }
        if composerLogTraceIsDurationLeadToken(sanitized),
           index + 2 < tokens.count,
           composerLogTraceDuration(number: tokens[index + 1], unit: tokens[index + 2]) != nil {
            skipCount = 2
            continue
        }
        let marker = sanitized
            .trimmingCharacters(in: composerSkillFieldTrimCharacters)
            .lowercased()
        guard !marker.isEmpty else { continue }
        kept.append((raw: token, lower: marker))
    }
    return kept
}

private func composerInlineLogTraceMessageValue(from token: String) -> String? {
    let trimmed = token.trimmingCharacters(in: composerSkillValueTrimCharacters)
    for separator in ["=", ":", "："] {
        guard let range = trimmed.range(of: separator) else { continue }
        let field = String(trimmed[..<range.lowerBound])
        guard composerLogTraceMessageFieldMarker(field) else { continue }
        let value = composerSanitizedSkillValue(String(trimmed[range.upperBound...]))
        return composerNilIfEmpty(value)
    }
    return nil
}

private func composerLogTraceFieldTokenSelectsMessage(_ token: String) -> Bool {
    let trimmed = token.trimmingCharacters(in: composerSkillValueTrimCharacters)
    for separator in ["=", ":", "："] {
        guard let range = trimmed.range(of: separator) else { continue }
        let field = String(trimmed[..<range.lowerBound])
            .trimmingCharacters(in: composerSkillFieldTrimCharacters)
            .lowercased()
        guard ["field", "idfield", "id_field", "filterfield"].contains(field) else { continue }
        return composerLogTraceMessageFieldMarker(String(trimmed[range.upperBound...]))
    }
    return false
}

private func composerLogTraceMessageFieldMarker(_ value: String) -> Bool {
    switch value
        .trimmingCharacters(in: composerSkillFieldTrimCharacters)
        .lowercased()
        .replacingOccurrences(of: "_", with: "")
        .replacingOccurrences(of: "-", with: "")
        .replacingOccurrences(of: " ", with: "") {
    case "message", "msg", "log", "logs", "logmessage":
        return true
    default:
        return false
    }
}

private func composerLogTraceMessageConnector(_ value: String) -> Bool {
    switch value
        .trimmingCharacters(in: composerSkillFieldTrimCharacters)
        .lowercased() {
    case "contains", "contain", "include", "includes", "including", "like", "match", "matching", "with", "has", "grep", "search", "query":
        return true
    default:
        return false
    }
}

private func composerLogTraceMessageSeverityMarker(_ value: String) -> Bool {
    switch value
        .trimmingCharacters(in: composerSkillFieldTrimCharacters)
        .lowercased() {
    case "error", "errors", "exception", "exceptions", "timeout", "timeouts", "failure", "failed":
        return true
    default:
        return false
    }
}

private func composerLogTraceMessageQuery(
    from tokens: [(raw: String, lower: String)],
    startIndex: Int,
    prefix: String? = nil
) -> String? {
    var pieces: [String] = []
    if let prefix = composerNilIfEmpty(prefix?.gitTrimmed ?? "") {
        pieces.append(prefix)
    }
    guard startIndex < tokens.count || !pieces.isEmpty else { return nil }
    for token in tokens.dropFirst(startIndex) {
        let value = composerSanitizedSkillValue(token.raw)
        guard !value.isEmpty,
              !composerLogTraceMessageConnector(token.lower) else {
            continue
        }
        pieces.append(value)
    }
    let message = pieces.joined(separator: " ").gitTrimmed
    guard message.count >= 3 else { return nil }
    return "query=\"message:\\\"\(composerShellEscaped(message))\\\"\""
}

private func composerNilIfEmpty(_ value: String) -> String? {
    value.isEmpty ? nil : value
}

private func composerExplicitLogTraceArgument(from value: String) -> String? {
    let tokens = value
        .split(whereSeparator: { $0.isWhitespace || $0.isNewline })
        .map(String.init)
    for index in tokens.indices {
        let token = tokens[index]
        if let inline = composerInlineLogTraceArgument(from: token) {
            return inline
        }

        let fieldToken = token.trimmingCharacters(in: composerSkillFieldTrimCharacters)
        if composerTraceParentField(fieldToken),
           index + 1 < tokens.count,
           let traceId = composerTraceIdFromTraceParentValue(tokens[index + 1]) {
            return "traceId=\(traceId)"
        }
        guard let canonicalField = composerLogTraceCanonicalField(fieldToken),
              index + 1 < tokens.count else {
            if let argument = composerPairedLogTraceArgument(from: tokens, index: index) {
                return argument
            }
            continue
        }
        let nextValue = composerSanitizedSkillValue(tokens[index + 1])
        if composerLooksLikeSkillLookupValue(nextValue) {
            return "\(canonicalField)=\(nextValue)"
        }
    }
    return nil
}

private func composerPairedLogTraceArgument(from tokens: [String], index: Int) -> String? {
    guard index + 2 < tokens.count else { return nil }
    let firstField = tokens[index].trimmingCharacters(in: composerSkillFieldTrimCharacters)
    let secondField = tokens[index + 1].trimmingCharacters(in: composerSkillFieldTrimCharacters)
    if composerTraceParentField("\(firstField) \(secondField)"),
       let traceId = composerTraceIdFromTraceParentValue(tokens[index + 2]) {
        return "traceId=\(traceId)"
    }
    guard let canonicalField = composerLogTraceCanonicalField("\(firstField) \(secondField)") else {
        return nil
    }
    let nextValue = composerSanitizedSkillValue(tokens[index + 2])
    guard composerLooksLikeSkillLookupValue(nextValue) else { return nil }
    return "\(canonicalField)=\(nextValue)"
}

private func composerInlineLogTraceArgument(from token: String) -> String? {
    let trimmed = token.trimmingCharacters(in: composerSkillValueTrimCharacters)
    for separator in ["=", ":", "："] {
        guard let range = trimmed.range(of: separator) else { continue }
        let field = String(trimmed[..<range.lowerBound])
        let value = composerSanitizedSkillValue(String(trimmed[range.upperBound...]))
        if composerTraceParentField(field),
           let traceId = composerTraceIdFromTraceParentValue(value) {
            return "traceId=\(traceId)"
        }
        guard let canonicalField = composerLogTraceCanonicalField(field),
              composerLooksLikeSkillLookupValue(value) else {
            continue
        }
        return "\(canonicalField)=\(value)"
    }
    return nil
}

private func composerLogTraceCanonicalField(_ value: String) -> String? {
    switch value
        .trimmingCharacters(in: composerSkillFieldTrimCharacters)
        .lowercased()
        .replacingOccurrences(of: "_", with: "")
        .replacingOccurrences(of: "-", with: "")
        .replacingOccurrences(of: " ", with: "") {
    case "conversationid":
        return "conversationId"
    case "sessionid":
        return "sessionId"
    case "traceid":
        return "traceId"
    case "requestid":
        return "requestId"
    case "taskid":
        return "taskId"
    case "turnid":
        return "turnId"
    default:
        return nil
    }
}

private func composerSanitizedSkillValue(_ value: String) -> String {
    value.trimmingCharacters(in: composerSkillValueTrimCharacters)
}

private func composerLooksLikeSkillLookupValue(_ value: String) -> Bool {
    let trimmed = value.gitTrimmed
    guard trimmed.count >= 3 else { return false }
    if trimmed.rangeOfCharacter(from: .decimalDigits) != nil { return true }
    return trimmed.range(of: "-") != nil
        || trimmed.range(of: "_") != nil
        || trimmed.range(of: ".") != nil
}

private let composerSkillFieldTrimCharacters = CharacterSet.whitespacesAndNewlines
    .union(CharacterSet(charactersIn: ":："))

private let composerSkillValueTrimCharacters = CharacterSet.whitespacesAndNewlines
    .union(CharacterSet(charactersIn: "\"'`()[]{}<>,;."))

private func composerLooksLikeSingleArgument(_ value: String) -> Bool {
    !value.contains(where: { $0.isWhitespace || $0.isNewline })
}

private func composerShellEscaped(_ value: String) -> String {
    value.replacingOccurrences(of: "\\", with: "\\\\")
        .replacingOccurrences(of: "\"", with: "\\\"")
}

private func composerSkillPriority(for capability: Capability) -> Int {
    let lower = capability.name.lowercased()
    if isLogTraceSkillName(lower) {
        return 0
    }
    if lower.contains("clickhouse") {
        return 1
    }
    if lower.contains("ch sql") {
        return 2
    }
    if lower.contains("superpower") {
        return 3
    }
    if lower.contains("draw") || lower.contains("diagram") {
        return 4
    }
    if capability.configState == "ready" {
        return 10
    }
    return 20
}

func composerShouldShowSkillCards(for text: String) -> Bool {
    text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
}

private func isLogTraceSkillName(_ lowercasedName: String) -> Bool {
    lowercasedName.contains("logtrace")
        || lowercasedName.contains("log tracer")
        || lowercasedName.contains("trace")
        || lowercasedName.contains("iva")
}

private func composerSkillSlug(_ value: String) -> String {
    var result = ""
    var previousWasSeparator = false
    for scalar in value.lowercased().unicodeScalars {
        if CharacterSet.alphanumerics.contains(scalar) {
            result.unicodeScalars.append(scalar)
            previousWasSeparator = false
        } else if !previousWasSeparator {
            result.append("_")
            previousWasSeparator = true
        }
    }
    let trimmed = result.trimmingCharacters(in: CharacterSet(charactersIn: "_"))
    return trimmed.isEmpty ? "skill" : trimmed
}

private struct MinimalChatComposer: View {
    let snapshot: NativeStoreSnapshot
    @Binding var selectedWorkspaceId: EntityID?
    @Binding var selectedPermissionMode: PermissionMode
    @Binding var text: String
    let placeholder: String
    var focused: FocusState<Bool>.Binding
    let selectedAgentKind: NativeAgentKind
    let isRunning: Bool
    var showsSkillCards = true
    var branchOptions: [String] = []
    var branchStatus: String?
    var openTerminal: () -> Void = {}
    let captureWorkItem: () -> Void
    var switchBranch: (String) -> Void = { _ in }
    let send: () -> Void
    @State private var isHovering = false
    @State private var editorFocused = false
    @State private var imageAttachments: [ComposerImageAttachment] = []
    @State private var attachmentError: String?

    private var canSend: Bool {
        !isRunning && (!text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || !imageAttachments.isEmpty)
    }

    private var accent: Color {
        agentTint(selectedAgentKind)
    }

    private var composerFocused: Bool {
        focused.wrappedValue || editorFocused
    }

    private var draftWordCount: Int {
        text.trimmingCharacters(in: .whitespacesAndNewlines)
            .split { $0.isWhitespace || $0.isNewline }
            .count
    }

    private var sendHelpText: String {
        if isRunning { return "Agent is running" }
        if !canSend { return "Add a prompt or image before sending" }
        if imageAttachments.isEmpty { return "Send prompt" }
        return "Send with \(imageAttachments.count) image\(imageAttachments.count == 1 ? "" : "s")"
    }

    private var skillCards: [ComposerSkillCardModel] {
        guard showsSkillCards else {
            return []
        }
        guard composerShouldShowSkillCards(for: text) else {
            return []
        }

        let prioritized = snapshot.capabilities
            .filter { $0.kind == .skill }
            .sorted { lhs, rhs in
                let leftPriority = composerSkillPriority(for: lhs)
                let rightPriority = composerSkillPriority(for: rhs)
                if leftPriority != rightPriority {
                    return leftPriority < rightPriority
                }
                return lhs.name.localizedCaseInsensitiveCompare(rhs.name) == .orderedAscending
            }

        var cards: [ComposerSkillCardModel] = []
        var seenCommands = Set<String>()
        for capability in prioritized {
            let command = composerSkillCommand(for: capability)
            guard seenCommands.insert(command).inserted else { continue }
            cards.append(ComposerSkillCardModel(capability: capability, index: cards.count, existingText: ""))
            if cards.count == 3 { break }
        }
        return cards
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            if !skillCards.isEmpty {
                ComposerSkillCardRow(skills: skillCards) { skill in
                    insertSkillCommand(skill.previewCommand)
                }
            }

            VStack(spacing: 0) {
                ZStack(alignment: .topLeading) {
                    if text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !composerFocused {
                        VStack(alignment: .leading, spacing: 6) {
                            Text(placeholder)
                                .font(.system(size: 16, weight: .medium))
                                .foregroundStyle(PKTheme.text4.opacity(0.82))
                            Text(projectTitle(for: selectedWorkspaceId, snapshot: snapshot))
                                .font(.system(size: 11, weight: .semibold))
                                .foregroundStyle(PKTheme.text4.opacity(0.62))
                        }
                        .padding(.top, 20)
                        .padding(.leading, 18)
                        .allowsHitTesting(false)
                    }

                    NativeSendingTextEditor(
                        text: $text,
                        focused: focused,
                        fontSize: 16,
                        lineSpacing: 3,
                        textContainerInset: NSSize(width: 0, height: 6),
                        onSend: sendWithAttachments,
                        onPasteImages: pasteImagesFromClipboard,
                        onFocusChange: { editorFocused = $0 }
                    )
                    .frame(minHeight: 126, maxHeight: 176)
                    .padding(.top, 20)
                    .padding(.horizontal, 18)
                    .padding(.bottom, 4)
                }

                if !imageAttachments.isEmpty || attachmentError != nil {
                    ComposerImageAttachmentStrip(
                        attachments: imageAttachments,
                        error: attachmentError,
                        remove: { attachment in
                            imageAttachments.removeAll { $0.id == attachment.id }
                        },
                        clearError: { attachmentError = nil }
                    )
                    .padding(.horizontal, 12)
                    .padding(.bottom, 9)
                }

                Rectangle()
                    .fill(PKTheme.edge.opacity(0.62))
                    .frame(height: 1)

                HStack(spacing: 9) {
                    ProjectPickerChip(
                        snapshot: snapshot,
                        selectedWorkspaceId: $selectedWorkspaceId,
                        accent: accent
                    )

                    if let branch = branchTitle(for: selectedWorkspaceId, snapshot: snapshot) {
                        BranchPickerChip(
                            currentBranch: branch,
                            branchOptions: branchOptions,
                            branchStatus: branchStatus,
                            switchBranch: switchBranch
                        )
                    }

                    PermissionPickerChip(selectedPermissionMode: $selectedPermissionMode)

                    StatusPill(
                        text: isRunning ? "RUNNING" : "READY",
                        color: isRunning ? PKTheme.warn : accent
                    )

                    if draftWordCount > 0 {
                        StatusPill(text: "\(draftWordCount) WORDS", color: PKTheme.text3)
                    }

                    if !imageAttachments.isEmpty {
                        StatusPill(text: "\(imageAttachments.count) IMAGE\(imageAttachments.count == 1 ? "" : "S")", color: accent)
                    }

                    Spacer(minLength: 0)

                    ComposerIconButton(symbol: "paperclip", title: "Attach Images") {
                        addAttachments(ComposerImageAttachmentStore.pickImageFiles())
                    }
                    ComposerIconButton(symbol: "doc.on.clipboard", title: "Paste Image") {
                        addAttachments(ComposerImageAttachmentStore.importImagesFromPasteboard())
                    }
                    Spacer()

                    Button(action: sendWithAttachments) {
                        Image(systemName: isRunning ? "hourglass" : "arrow.up")
                            .font(.system(size: 14, weight: .bold))
                        .foregroundStyle(canSend ? PKTheme.primaryText : PKTheme.text4)
                        .frame(width: 38, height: 34)
                        .background(canSend ? accent : PKTheme.control.opacity(0.86))
                        .clipShape(RoundedRectangle(cornerRadius: 8))
                    }
                    .buttonStyle(.plain)
                    .disabled(!canSend)
                    .keyboardShortcut(.return, modifiers: .command)
                    .help(sendHelpText)
                }
                .padding(.horizontal, 12)
                .padding(.bottom, 14)
                .padding(.top, 11)
            }
            .background(
                LinearGradient(
                    colors: [
                        accent.opacity(0.07),
                        PKTheme.surfaceRaised.opacity(0.95)
                    ],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                )
            )
            .overlay(
                RoundedRectangle(cornerRadius: 10)
                    .stroke(focused.wrappedValue ? accent.opacity(0.72) : PKTheme.edgeStrong.opacity(isHovering ? 0.78 : 0.52), lineWidth: 1)
            )
            .clipShape(RoundedRectangle(cornerRadius: 10))
            .shadow(color: Color.black.opacity(focused.wrappedValue ? 0.22 : 0.12), radius: focused.wrappedValue ? 24 : 16, x: 0, y: 14)
            .onHover { isHovering = $0 }
            .onPasteCommand(of: [.image, .fileURL]) { _ in
                addAttachments(ComposerImageAttachmentStore.importImagesFromPasteboard())
                refocusComposer()
            }
            .onChange(of: isRunning) { _, running in
                if !running {
                    refocusComposer()
                }
            }
        }
    }

    private func addAttachments(_ result: ComposerImageAttachmentImportResult) {
        if !result.attachments.isEmpty {
            imageAttachments.append(contentsOf: result.attachments)
            attachmentError = nil
        }
        if let message = result.message {
            attachmentError = message
        }
    }

    private func insertSkillCommand(_ command: String) {
        text = command
        focused.wrappedValue = true
    }

    private func pasteImagesFromClipboard() -> Bool {
        guard ComposerImageAttachmentStore.canImportImagesFromPasteboard() else { return false }
        addAttachments(ComposerImageAttachmentStore.importImagesFromPasteboard())
        refocusComposer()
        return true
    }

    private func sendWithAttachments() {
        guard canSend else { return }
        text = ComposerAttachmentPrompt.appendImageRefs(
            to: text,
            images: imageAttachments.map { ComposerImageAttachmentRef(name: $0.name, path: $0.url.path) }
        )
        imageAttachments = []
        attachmentError = nil
        send()
        refocusComposer()
    }

    private func refocusComposer() {
        DispatchQueue.main.async {
            focused.wrappedValue = true
        }
    }
}

private struct ComposerToolbarLabel: View {
    let symbol: String
    let title: String
    let tint: Color
    var showsChevron = false
    var maxWidth: CGFloat = 188
    var fontSize: CGFloat = 12
    var height: CGFloat = 30

    var body: some View {
        HStack(spacing: 7) {
            Image(systemName: symbol)
                .font(.system(size: fontSize, weight: .semibold))
            Text(title)
                .font(.system(size: fontSize, weight: .semibold))
                .lineLimit(1)
                .truncationMode(.tail)
            if showsChevron {
                Image(systemName: "chevron.down")
                    .font(.system(size: 9, weight: .bold))
                    .foregroundStyle(tint.opacity(0.72))
            }
        }
        .foregroundStyle(tint)
        .padding(.horizontal, 10)
        .frame(maxWidth: maxWidth)
        .frame(height: height)
        .background(tint.opacity(0.10))
        .overlay(RoundedRectangle(cornerRadius: 8).stroke(tint.opacity(0.22), lineWidth: 1))
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }
}

private struct PermissionPickerChip: View {
    @Binding var selectedPermissionMode: PermissionMode
    @State private var open = false

    var body: some View {
        Button {
            open.toggle()
        } label: {
            ComposerToolbarLabel(
                symbol: "shield.checkered",
                title: permissionTitle(selectedPermissionMode),
                tint: PKTheme.text3,
                showsChevron: true,
                maxWidth: 118,
                fontSize: 11.5,
                height: 30
            )
        }
        .buttonStyle(.plain)
        .help("Permission mode")
        .popover(isPresented: $open, arrowEdge: .bottom) {
            PermissionPickerPopover(
                selectedPermissionMode: $selectedPermissionMode,
                close: { open = false }
            )
        }
    }
}

private struct PermissionPickerPopover: View {
    @Binding var selectedPermissionMode: PermissionMode
    let close: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("Permission")
                .font(.system(size: 9.5, weight: .semibold))
                .foregroundStyle(PKTheme.text4)
                .padding(.horizontal, 7)
                .padding(.top, 3)

            VStack(spacing: 2) {
                PermissionPickerRow(
                    title: "Read only",
                    mode: .readOnly,
                    selected: selectedPermissionMode == .readOnly,
                    action: select
                )
                PermissionPickerRow(
                    title: "Ask before edit",
                    mode: .askBeforeEdit,
                    selected: selectedPermissionMode == .askBeforeEdit,
                    action: select
                )
                PermissionPickerRow(
                    title: "Autopilot",
                    mode: .autopilot,
                    selected: selectedPermissionMode == .autopilot,
                    action: select
                )
            }
            .padding(3)
        }
        .frame(width: 178)
        .padding(4)
        .background(PKTheme.panel.opacity(0.98))
    }

    private func select(_ mode: PermissionMode) {
        selectedPermissionMode = mode
        close()
    }
}

private struct PermissionPickerRow: View {
    let title: String
    let mode: PermissionMode
    let selected: Bool
    let action: (PermissionMode) -> Void
    @State private var hovering = false

    var body: some View {
        Button {
            action(mode)
        } label: {
            HStack(spacing: 8) {
                Image(systemName: selected ? "checkmark" : "shield.checkered")
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(selected ? PKTheme.primary : PKTheme.text3)
                    .frame(width: 13)
                Text(title)
                    .font(.system(size: 11, weight: selected ? .semibold : .medium))
                    .foregroundStyle(selected ? PKTheme.text : PKTheme.text2)
                    .lineLimit(1)
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 7)
            .frame(height: 24)
            .background(selected ? PKTheme.primary.opacity(0.13) : hovering ? PKTheme.control.opacity(0.54) : Color.clear)
            .overlay(RoundedRectangle(cornerRadius: 6).stroke(selected ? PKTheme.primary.opacity(0.32) : Color.clear, lineWidth: 1))
            .clipShape(RoundedRectangle(cornerRadius: 6))
            .contentShape(RoundedRectangle(cornerRadius: 6))
        }
        .buttonStyle(.plain)
        .onHover { hovering = $0 }
    }
}

private struct ProjectPickerChip: View {
    let snapshot: NativeStoreSnapshot
    @Binding var selectedWorkspaceId: EntityID?
    let accent: Color
    var compact = false
    @State private var open = false

    private var currentTitle: String {
        projectTitle(for: selectedWorkspaceId, snapshot: snapshot)
    }

    var body: some View {
        Button {
            open.toggle()
        } label: {
            ComposerToolbarLabel(
                symbol: "folder",
                title: currentTitle,
                tint: accent,
                showsChevron: true,
                maxWidth: compact ? 142 : 164,
                fontSize: compact ? 11 : 11.5,
                height: compact ? 28 : 30
            )
        }
        .buttonStyle(.plain)
        .help("Project")
        .popover(isPresented: $open, arrowEdge: .bottom) {
            ProjectPickerPopover(
                snapshot: snapshot,
                selectedWorkspaceId: $selectedWorkspaceId,
                accent: accent,
                close: { open = false }
            )
        }
    }
}

private struct ProjectContextChip: View {
    let snapshot: NativeStoreSnapshot
    let workspaceId: EntityID
    let accent: Color
    var compact = false

    var body: some View {
        ComposerToolbarLabel(
            symbol: "folder",
            title: projectTitle(for: workspaceId, snapshot: snapshot),
            tint: accent,
            showsChevron: false,
            maxWidth: compact ? 142 : 164,
            fontSize: compact ? 11 : 11.5,
            height: compact ? 28 : 30
        )
        .help("Chat project")
    }
}

private struct ProjectPickerPopover: View {
    let snapshot: NativeStoreSnapshot
    @Binding var selectedWorkspaceId: EntityID?
    let accent: Color
    let close: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 8) {
                Text("Project")
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(PKTheme.text4)
                Spacer()
                Button {
                    close()
                    NotificationCenter.default.post(name: .pikiclawAddWorkspace, object: nil)
                } label: {
                    Image(systemName: "plus")
                        .font(.system(size: 11, weight: .bold))
                        .foregroundStyle(accent)
                        .frame(width: 24, height: 24)
                        .background(accent.opacity(0.10))
                        .clipShape(RoundedRectangle(cornerRadius: 6))
                }
                .buttonStyle(.plain)
                .help("Add Project")
            }
            .padding(.leading, 8)
            .padding(.trailing, 4)
            .padding(.top, 4)

            if snapshot.workspaces.isEmpty {
                Text("No projects")
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(PKTheme.text3)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(8)
            } else {
                ScrollView {
                    VStack(spacing: 3) {
                        ForEach(snapshot.workspaces) { workspace in
                            ProjectPickerRow(
                                workspace: workspace,
                                selected: selectedWorkspaceId == workspace.id,
                                accent: accent
                            ) {
                                selectedWorkspaceId = workspace.id
                                close()
                            }
                        }
                    }
                    .padding(4)
                }
                .frame(maxHeight: 174)
            }
        }
        .frame(width: 238)
        .padding(5)
        .background(PKTheme.panel.opacity(0.98))
    }
}

private struct ProjectPickerRow: View {
    let workspace: Workspace
    let selected: Bool
    let accent: Color
    let action: () -> Void
    @State private var hovering = false

    var body: some View {
        Button(action: action) {
            HStack(spacing: 8) {
                Image(systemName: selected ? "checkmark" : "folder")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(selected ? accent : PKTheme.text3)
                    .frame(width: 15)
                Text(workspace.name)
                    .font(.system(size: 12, weight: selected ? .semibold : .medium))
                    .foregroundStyle(selected ? PKTheme.text : PKTheme.text2)
                    .lineLimit(1)
                    .truncationMode(.tail)
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 8)
            .frame(height: 28)
            .background(selected ? accent.opacity(0.13) : hovering ? PKTheme.control.opacity(0.54) : Color.clear)
            .overlay(RoundedRectangle(cornerRadius: 7).stroke(selected ? accent.opacity(0.32) : Color.clear, lineWidth: 1))
            .clipShape(RoundedRectangle(cornerRadius: 7))
            .contentShape(RoundedRectangle(cornerRadius: 7))
        }
        .buttonStyle(.plain)
        .onHover { hovering = $0 }
    }
}

private struct BranchPickerChip: View {
    let currentBranch: String
    let branchOptions: [String]
    let branchStatus: String?
    var compact = false
    let switchBranch: (String) -> Void
    @State private var open = false

    var body: some View {
        Button {
            open.toggle()
        } label: {
            ComposerToolbarLabel(
                symbol: "arrow.triangle.branch",
                title: currentBranch,
                tint: PKTheme.text3,
                showsChevron: true,
                maxWidth: compact ? 126 : 154,
                fontSize: compact ? 11 : 11.5,
                height: compact ? 28 : 30
            )
        }
        .buttonStyle(.plain)
        .help("Current git branch")
        .popover(isPresented: $open, arrowEdge: .bottom) {
            BranchPickerPopover(
                currentBranch: currentBranch,
                branchOptions: branchOptions,
                branchStatus: branchStatus,
                close: { open = false },
                switchBranch: switchBranch
            )
        }
    }
}

private struct BranchPickerPopover: View {
    let currentBranch: String
    let branchOptions: [String]
    let branchStatus: String?
    let close: () -> Void
    let switchBranch: (String) -> Void

    private var branches: [String] {
        var seen = Set<String>()
        return ([currentBranch] + branchOptions)
            .filter { !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
            .filter { seen.insert($0).inserted }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("Branch")
                .font(.system(size: 9.5, weight: .semibold))
                .foregroundStyle(PKTheme.text4)
                .padding(.horizontal, 7)
                .padding(.top, 3)

            if let branchStatus, !branchStatus.isEmpty {
                Text(branchStatus)
                    .font(.system(size: 9.5, weight: .medium))
                    .foregroundStyle(PKTheme.text4)
                    .lineLimit(2)
                    .padding(.horizontal, 7)
                    .padding(.bottom, 2)
            }

            ScrollView {
                VStack(spacing: 2) {
                    ForEach(branches, id: \.self) { branch in
                        BranchPickerRow(
                            branch: branch,
                            selected: branch == currentBranch
                        ) {
                            if branch != currentBranch {
                                switchBranch(branch)
                            }
                            close()
                        }
                    }
                }
                .padding(3)
            }
            .frame(maxHeight: 150)
        }
        .frame(width: 218)
        .padding(4)
        .background(PKTheme.panel.opacity(0.98))
    }
}

private struct BranchPickerRow: View {
    let branch: String
    let selected: Bool
    let action: () -> Void
    @State private var hovering = false

    var body: some View {
        Button(action: action) {
            HStack(spacing: 8) {
                Image(systemName: selected ? "checkmark" : "arrow.triangle.branch")
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(selected ? PKTheme.primary : PKTheme.text3)
                    .frame(width: 13)
                Text(branch)
                    .font(.system(size: 11, weight: selected ? .semibold : .medium))
                    .foregroundStyle(selected ? PKTheme.text : PKTheme.text2)
                    .lineLimit(1)
                    .truncationMode(.middle)
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 7)
            .frame(height: 24)
            .background(selected ? PKTheme.primary.opacity(0.13) : hovering ? PKTheme.control.opacity(0.54) : Color.clear)
            .overlay(RoundedRectangle(cornerRadius: 6).stroke(selected ? PKTheme.primary.opacity(0.32) : Color.clear, lineWidth: 1))
            .clipShape(RoundedRectangle(cornerRadius: 6))
            .contentShape(RoundedRectangle(cornerRadius: 6))
        }
        .buttonStyle(.plain)
        .onHover { hovering = $0 }
    }
}

private struct ComposerIconButton: View {
    let symbol: String
    let title: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(PKTheme.text3)
                .frame(width: 30, height: 30)
                .background(PKTheme.control.opacity(0.72))
                .overlay(RoundedRectangle(cornerRadius: 8).stroke(PKTheme.edge, lineWidth: 1))
                .clipShape(RoundedRectangle(cornerRadius: 8))
        }
        .buttonStyle(.plain)
        .help(title)
    }
}

private struct NativeSendingTextEditor: NSViewRepresentable {
    @Binding var text: String
    var focused: FocusState<Bool>.Binding?
    let fontSize: CGFloat
    let lineSpacing: CGFloat
    var textContainerInset: NSSize = NSSize(width: 0, height: 0)
    let onSend: () -> Void
    var onPasteImages: (() -> Bool)? = nil
    var onFocusChange: (Bool) -> Void = { _ in }

    func makeCoordinator() -> Coordinator {
        Coordinator(self)
    }

    func makeNSView(context: Context) -> NSScrollView {
        let scrollView = NSScrollView()
        scrollView.drawsBackground = false
        scrollView.hasVerticalScroller = true
        scrollView.hasHorizontalScroller = false
        scrollView.borderType = .noBorder
        scrollView.autohidesScrollers = true

        let textView = SendingNSTextView()
        textView.delegate = context.coordinator
        textView.onSend = onSend
        textView.onPasteImages = onPasteImages
        textView.onFocusChange = { [weak coordinator = context.coordinator] isFocused in
            coordinator?.setFocused(isFocused)
        }
        textView.string = text
        textView.isEditable = true
        textView.isSelectable = true
        textView.isRichText = false
        textView.importsGraphics = false
        textView.allowsUndo = true
        textView.isAutomaticQuoteSubstitutionEnabled = false
        textView.isAutomaticDashSubstitutionEnabled = false
        textView.isAutomaticTextReplacementEnabled = false
        textView.isContinuousSpellCheckingEnabled = false
        textView.drawsBackground = false
        textView.backgroundColor = .clear
        textView.textColor = .labelColor
        textView.insertionPointColor = .controlAccentColor
        textView.textContainerInset = textContainerInset
        textView.textContainer?.widthTracksTextView = true
        textView.textContainer?.containerSize = NSSize(width: max(scrollView.contentSize.width, 1), height: CGFloat.greatestFiniteMagnitude)
        textView.minSize = NSSize(width: 0, height: scrollView.contentSize.height)
        textView.maxSize = NSSize(width: CGFloat.greatestFiniteMagnitude, height: CGFloat.greatestFiniteMagnitude)
        textView.isHorizontallyResizable = false
        textView.isVerticallyResizable = true
        textView.autoresizingMask = [.width]
        scrollView.documentView = textView
        applyStyle(to: textView)
        return scrollView
    }

    func updateNSView(_ scrollView: NSScrollView, context: Context) {
        guard let textView = scrollView.documentView as? SendingNSTextView else { return }
        context.coordinator.parent = self
        textView.onSend = onSend
        textView.onPasteImages = onPasteImages
        textView.onFocusChange = { [weak coordinator = context.coordinator] isFocused in
            coordinator?.setFocused(isFocused)
        }
        textView.textContainerInset = textContainerInset
        let isComposingText = textView.hasMarkedText()
        if !isComposingText && textView.string != text {
            textView.string = text
        }
        let editorWidth = max(scrollView.contentSize.width, 1)
        textView.textContainer?.containerSize = NSSize(width: editorWidth, height: .greatestFiniteMagnitude)
        if abs(textView.frame.width - editorWidth) > 0.5 {
            var frame = textView.frame
            frame.size.width = editorWidth
            textView.frame = frame
        }
        if !isComposingText {
            applyStyle(to: textView)
        }
        if focused?.wrappedValue == true,
           textView.window?.firstResponder !== textView {
            DispatchQueue.main.async {
                textView.window?.makeFirstResponder(textView)
            }
        }
    }

    private func applyStyle(to textView: NSTextView) {
        textView.font = .systemFont(ofSize: fontSize)
        let paragraph = NSMutableParagraphStyle()
        paragraph.lineSpacing = lineSpacing
        textView.defaultParagraphStyle = paragraph
        textView.typingAttributes = [
            .font: NSFont.systemFont(ofSize: fontSize),
            .foregroundColor: NSColor.labelColor,
            .paragraphStyle: paragraph,
        ]
    }

    @MainActor final class Coordinator: NSObject, NSTextViewDelegate {
        var parent: NativeSendingTextEditor

        init(_ parent: NativeSendingTextEditor) {
            self.parent = parent
        }

        func setFocused(_ isFocused: Bool) {
            parent.focused?.wrappedValue = isFocused
            parent.onFocusChange(isFocused)
        }

        func textDidChange(_ notification: Notification) {
            guard let textView = notification.object as? NSTextView else { return }
            guard !textView.hasMarkedText() else { return }
            parent.text = textView.string
        }

        func textDidBeginEditing(_ notification: Notification) {
            setFocused(true)
        }

        func textDidEndEditing(_ notification: Notification) {
            setFocused(false)
        }
    }

    final class SendingNSTextView: NSTextView {
        var onSend: (() -> Void)?
        var onPasteImages: (() -> Bool)?
        var onFocusChange: ((Bool) -> Void)?

        override func becomeFirstResponder() -> Bool {
            let didBecome = super.becomeFirstResponder()
            if didBecome {
                onFocusChange?(true)
            }
            return didBecome
        }

        override func resignFirstResponder() -> Bool {
            let didResign = super.resignFirstResponder()
            if didResign {
                onFocusChange?(false)
            }
            return didResign
        }

        override func mouseDown(with event: NSEvent) {
            window?.makeFirstResponder(self)
            onFocusChange?(true)
            super.mouseDown(with: event)
        }

        override func keyDown(with event: NSEvent) {
            let isReturn = event.keyCode == 36 || event.keyCode == 76
            let modifiers = event.modifierFlags.intersection(.deviceIndependentFlagsMask)
            if isReturn,
               !modifiers.contains(.shift),
               !modifiers.contains(.option),
               !modifiers.contains(.control) {
                if hasMarkedText() {
                    super.keyDown(with: event)
                    return
                }
                onSend?()
                return
            }
            super.keyDown(with: event)
        }

        override func paste(_ sender: Any?) {
            if onPasteImages?() == true {
                return
            }
            super.paste(sender)
        }
    }
}

private struct ConversationWorkspace: View {
    let run: AgentRun?
    let snapshot: NativeStoreSnapshot
    let selectedWorkspace: Workspace?
    @Binding var selectedWorkspaceId: EntityID?
    @Binding var selectedWorkItemId: EntityID?
    @ObservedObject var model: NativeAppModel
    var immersive = false
    var paneLabel: String?
    let newChat: () -> Void
    var newSideChat: (() -> Void)?
    var startFollowUpSideChat: ((AgentRun, RunFollowUpAction) -> Void)?
    var closeChat: (() -> Void)?
    var detachChat: (() -> Void)?
    let openWorkItem: () -> Void
    @State private var replyDraft = ""
    @State private var stagedFollowUpPermissionMode: PermissionMode?
    @State private var stagedFollowUpLabel: String?
    @State private var terminalOpen = false

    private var conversationAgentKind: NativeAgentKind {
        guard let run else { return model.selectedAgentKind }
        return agentKind(for: run, snapshot: snapshot)
    }

    private var accent: Color {
        agentTint(conversationAgentKind)
    }

    private var cornerRadius: CGFloat {
        immersive ? 18 : 8
    }

    private var currentRunBlocksReply: Bool {
        switch run?.state {
        case .queued, .starting, .running, .cancelling:
            return true
        case .waitingForUser, .completed, .failed, .cancelled, .stale, .draft, .none:
            return false
        }
    }

    private var effectiveReplyPermissionMode: PermissionMode {
        stagedFollowUpPermissionMode ?? run?.permissionMode ?? model.selectedPermissionMode
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 12) {
                if immersive {
                    Image(systemName: agentSymbol(conversationAgentKind))
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(PKTheme.primaryText)
                        .frame(width: 36, height: 36)
                        .background(accent)
                        .clipShape(RoundedRectangle(cornerRadius: 9))
                }
                VStack(alignment: .leading, spacing: 4) {
                    Text(runTitle)
                        .font(.system(size: immersive ? 20 : 20, weight: .semibold))
                        .foregroundStyle(PKTheme.text)
                        .lineLimit(1)
                        .truncationMode(.tail)
                    Text(immersive ? immersiveSubtitle : "\(selectedWorkspace?.name ?? "Project") · \(run?.state.rawValue ?? "starting")")
                        .font(.caption)
                        .foregroundStyle(PKTheme.text3)
                        .lineLimit(1)
                        .truncationMode(.tail)
                }
                .frame(minWidth: 0, maxWidth: .infinity, alignment: .leading)
                .layoutPriority(1)
                Spacer(minLength: 8)
                HStack(spacing: 7) {
                    if let paneLabel {
                        StatusPill(text: paneLabel, color: accent)
                    }
                    StatusPill(text: run?.state.rawValue ?? "starting", color: runStateColor(run?.state))
                    if let newSideChat {
                        ComposerIconButton(symbol: "rectangle.split.2x1", title: "Add Inline Chat", action: newSideChat)
                    }
                    if let closeChat {
                        ComposerIconButton(symbol: "xmark", title: "Close Pane", action: closeChat)
                    }
                    if let detachChat {
                        ComposerIconButton(symbol: "arrow.up.right.square", title: "Detach Chat", action: detachChat)
                    }
                    if immersive {
                        ComposerIconButton(symbol: "terminal", title: "Terminal") {
                            withAnimation(.easeInOut(duration: 0.16)) {
                                terminalOpen.toggle()
                            }
                        }
                    } else {
                        SecondaryButton(title: "Terminal", systemImage: "terminal") {
                            withAnimation(.easeInOut(duration: 0.16)) {
                                terminalOpen.toggle()
                            }
                        }
                        SecondaryButton(title: "Open Task", systemImage: "checklist", action: openWorkItem)
                        PrimaryButton(title: "New Chat", systemImage: "plus", action: newChat)
                    }
                }
                .fixedSize(horizontal: true, vertical: false)
                .layoutPriority(2)
            }
            .padding(.horizontal, immersive ? 22 : 18)
            .padding(.top, immersive ? 18 : 14)
            .padding(.bottom, 10)

            ConversationContextRibbon(
                workspace: selectedWorkspace,
                workItem: conversationWorkItem,
                run: run,
                agentKind: conversationAgentKind,
                agentName: agentLabel,
                terminalDirectory: selectedWorkspace.flatMap { model.terminalCurrentDirectory(for: $0) },
                permissionMode: effectiveReplyPermissionMode,
                stagedFollowUp: stagedFollowUpLabel
            )
            .padding(.horizontal, immersive ? 22 : 18)
            .padding(.bottom, immersive ? 16 : 12)

            Rectangle()
                .fill(PKTheme.edge.opacity(0.72))
                .frame(height: 1)

            if terminalOpen {
                ContextTerminalPane(
                    selectedWorkspace: selectedWorkspace,
                    selectedWorkItem: conversationWorkItem,
                    selectedAgentKind: conversationAgentKind,
                    selectedPermissionMode: effectiveReplyPermissionMode,
                    activeRun: run,
                    model: model,
                    openChat: {},
                    compact: true
                )
                .padding(.horizontal, 16)
                .padding(.vertical, 12)
                .transition(.move(edge: .top).combined(with: .opacity))

                Rectangle()
                    .fill(PKTheme.edge.opacity(0.62))
                    .frame(height: 1)
            }

            ScrollViewReader { reader in
                ScrollView {
                    VStack(alignment: .leading, spacing: 18) {
                        ForEach(run?.messages ?? []) { message in
                            if message.role == .user {
                                ConversationMessageBubble(
                                    title: "You",
                                    subtitle: selectedWorkspace?.name ?? "Project",
                                    text: message.content,
                                    createdAt: message.createdAt,
                                    symbol: "person.crop.circle",
                                    accent: accent,
                                    trailing: true
                                )
                            } else if message.role == .assistant {
                                AssistantResponseCard(
                                    title: agentLabel,
                                    text: message.content,
                                    createdAt: message.createdAt,
                                    state: .completed,
                                    isRunning: false,
                                    accent: accent
                                )
                            }
                        }

                        ConversationMessageBubble(
                            title: "You",
                            subtitle: selectedWorkspace?.name ?? "Project",
                            text: run?.promptSnapshot ?? model.draftPrompt,
                            createdAt: run?.startedAt,
                            symbol: "person.crop.circle",
                            accent: accent,
                            trailing: true,
                            onRerun: run.map { currentRun in
                                { Task { await model.rerunChat(runId: currentRun.id) } }
                            }
                        )

                        AssistantResponseCard(
                            title: agentLabel,
                            text: assistantText,
                            createdAt: run?.endedAt ?? run?.startedAt,
                            state: run?.state,
                            isRunning: currentRunBlocksReply,
                            accent: accent,
                            followUpActions: chatRunFollowUpActions(
                                run: run,
                                workItem: conversationWorkItem,
                                assistantText: assistantText
                            ),
                            onRerun: run.map { currentRun in
                                { Task { await model.rerunChat(runId: currentRun.id) } }
                            },
                            onFollowUp: stageFollowUp(_:),
                            onFollowUpSideChat: run.flatMap { currentRun in
                                startFollowUpSideChat.map { starter in
                                    { action in starter(currentRun, action) }
                                }
                            },
                            onSaveEvidence: saveEvidenceAction
                        )
                        .id("assistant-output")
                    }
                    .padding(immersive ? 24 : 20)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .onChange(of: run?.transcript ?? "") { _, _ in
                    withAnimation(.easeOut(duration: 0.16)) {
                        reader.scrollTo("assistant-output", anchor: .bottom)
                    }
                }
            }

            ConversationReplyComposer(
                snapshot: snapshot,
                selectedWorkspaceId: $selectedWorkspaceId,
                contextWorkspaceId: run?.workspaceId,
                text: $replyDraft,
                statusLine: model.statusLine,
                isRunning: currentRunBlocksReply,
                accent: accent,
                branchOptions: selectedWorkspace.map { model.branchOptionsByWorkspace[$0.id] ?? [] } ?? [],
                branchStatus: selectedWorkspace.flatMap { model.branchStatusByWorkspace[$0.id] },
                switchBranch: { branch in
                    Task { await model.switchBranch(branch, workspace: selectedWorkspace) }
                }
            ) {
                let next = replyDraft.trimmingCharacters(in: .whitespacesAndNewlines)
                guard !next.isEmpty else { return }
                let followUpPermissionMode = stagedFollowUpPermissionMode
                replyDraft = ""
                stagedFollowUpPermissionMode = nil
                stagedFollowUpLabel = nil
                Task {
                    let sentRunId: EntityID?
                    if let run {
                        sentRunId = await model.sendMessage(
                            in: run.id,
                            message: next,
                            permissionMode: followUpPermissionMode
                        )
                    } else {
                        model.draftPrompt = next
                        sentRunId = await model.startChat(
                            workspaceId: selectedWorkspaceId,
                            targetWorkItemId: selectedWorkItemId
                        )
                    }
                    if let sentRunId,
                       let sentRun = model.snapshot.runs.first(where: { $0.id == sentRunId }) {
                        selectedWorkItemId = sentRun.workItemId
                    }
                }
            }
            .padding(immersive ? 18 : 16)
        }
        .onChange(of: replyDraft) { _, newValue in
            if newValue.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                stagedFollowUpPermissionMode = nil
                stagedFollowUpLabel = nil
            }
        }
        .background {
            if immersive {
                ProjectChatCanvasBackground(accent: accent, cornerRadius: cornerRadius)
            } else {
                RoundedRectangle(cornerRadius: cornerRadius)
                    .fill(PKTheme.panel.opacity(0.46))
            }
        }
        .overlay(RoundedRectangle(cornerRadius: cornerRadius).stroke(accent.opacity(immersive ? 0.32 : 0.22), lineWidth: 1))
        .clipShape(RoundedRectangle(cornerRadius: cornerRadius))
        .shadow(color: immersive ? accent.opacity(0.10) : .clear, radius: 22, y: 14)
    }

    private var runTitle: String {
        run?.promptSnapshot.firstLineFallback("Conversation") ?? "Starting conversation"
    }

    private var immersiveSubtitle: String {
        let workspace = selectedWorkspace?.name ?? "Project"
        if let branch = selectedWorkspace?.currentBranch, !branch.isEmpty {
            return "\(workspace) · \(branch) · \(run?.state.rawValue ?? "starting")"
        }
        return "\(workspace) · \(run?.state.rawValue ?? "starting")"
    }

    private var agentLabel: String {
        guard let run,
              let profile = snapshot.agentProfiles.first(where: { $0.id == run.agentProfileId }) else {
            return "Pikiclaw"
        }
        return profile.displayName
    }

    private var assistantText: String {
        if let transcript = run?.transcript, !transcript.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return transcript
        }
        return model.isRunning ? "Starting the native runner..." : "No assistant output yet."
    }

    private var conversationWorkItem: WorkItem? {
        if let itemId = run?.workItemId ?? selectedWorkItemId {
            return snapshot.workItems.first(where: { $0.id == itemId })
        }
        return nil
    }

    private var saveEvidenceAction: (() -> Void)? {
        guard let run,
              chatCanCaptureEvidence(run: run, assistantText: assistantText) else {
            return nil
        }
        return {
            Task { await model.captureRunEvidence(runId: run.id) }
        }
    }

    private func stageFollowUp(_ action: RunFollowUpAction) {
        stagedFollowUpPermissionMode = action.permissionMode
        stagedFollowUpLabel = runFollowUpStagedLabel(action)
        replyDraft = action.prompt
        model.statusLine = runFollowUpStagedStatus(action)
    }
}

private struct ConversationContextRibbon: View {
    let workspace: Workspace?
    let workItem: WorkItem?
    let run: AgentRun?
    let agentKind: NativeAgentKind
    let agentName: String
    let terminalDirectory: String?
    let permissionMode: PermissionMode
    let stagedFollowUp: String?

    var body: some View {
        HStack(spacing: 10) {
            if let stagedFollowUp {
                LaunchContextChip(
                    symbol: "arrow.turn.down.right",
                    label: "Follow-up",
                    value: stagedFollowUp,
                    tone: PKTheme.primary
                )
            }
            LaunchContextChip(
                symbol: agentSymbol(agentKind),
                label: "Agent",
                value: "\(agentName) · \(run?.state.rawValue ?? "draft")",
                tone: agentTint(agentKind)
            )
            LaunchContextChip(
                symbol: "lock.shield",
                label: "Permission",
                value: permissionLabel(permissionMode),
                tone: permissionMode == .autopilot ? PKTheme.warn : PKTheme.primary
            )
            LaunchContextChip(
                symbol: "checklist",
                label: "Task",
                value: taskValue,
                tone: workItem == nil ? PKTheme.text3 : PKTheme.ok
            )
            LaunchContextChip(
                symbol: "terminal",
                label: "Context",
                value: contextValue,
                tone: PKTheme.text3
            )
        }
        .padding(10)
        .background(PKTheme.control.opacity(0.28))
        .overlay(RoundedRectangle(cornerRadius: 8).stroke(PKTheme.edge.opacity(0.82), lineWidth: 1))
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }

    private var taskValue: String {
        guard let workItem else { return "No selected task" }
        return "\(workItem.title) · \(sourceLabel(workItem.sourceType)) · \(workItem.state.rawValue)"
    }

    private var contextValue: String {
        let path = terminalDirectory ?? workspace?.pathDisplay ?? ""
        if let branch = workspace?.currentBranch, !branch.isEmpty {
            return "\(branch) · \(shortDisplayPath(path))"
        }
        return shortDisplayPath(path)
    }
}

struct RunFollowUpAction: Identifiable, Hashable {
    let id: String
    let title: String
    let detail: String
    let symbol: String
    let permissionMode: PermissionMode?
    let prompt: String

    init(
        id: String,
        title: String,
        detail: String? = nil,
        symbol: String,
        permissionMode: PermissionMode? = nil,
        prompt: String
    ) {
        self.id = id
        self.title = title
        self.detail = detail ?? runFollowUpDetail(id: id, permissionMode: permissionMode)
        self.symbol = symbol
        self.permissionMode = permissionMode
        self.prompt = runFollowUpPrompt(prompt, actionId: id, permissionMode: permissionMode)
    }
}

func runFollowUpStagedLabel(_ action: RunFollowUpAction) -> String {
    "\(action.title) - \(action.detail)"
}

func runFollowUpStagedStatus(_ action: RunFollowUpAction) -> String {
    "\(action.title) follow-up staged - \(action.detail)"
}

func sideChatPaneLabel(for run: AgentRun) -> String {
    if let label = run.contextRefs.first(where: { $0.kind == "follow-up" })?.label.gitTrimmed,
       !label.isEmpty {
        return label
    }
    return "Side"
}

private func runFollowUpDetail(id: String, permissionMode: PermissionMode?) -> String {
    switch id {
    case "bug-analysis":
        return "Read-only triage"
    case "log-analysis":
        return "Read-only trace"
    case "skill-hardening":
        return "Ask before edits"
    case "mr-review":
        return "Read-only review"
    case "validation":
        return "Validate only"
    case "jira-update":
        return "Read-only update"
    case "capture-evidence":
        return "Read-only capture"
    default:
        switch permissionMode {
        case .readOnly:
            return "Read-only"
        case .askBeforeEdit:
            return "Ask before edits"
        case .autopilot:
            return "Autopilot"
        case nil:
            return "Follow-up"
        }
    }
}

private func runFollowUpPrompt(_ prompt: String, actionId: String, permissionMode: PermissionMode?) -> String {
    let sections = [
        runFollowUpNonEmpty(prompt),
        runFollowUpNonEmpty(runFollowUpOutputContract(for: actionId)),
        runFollowUpPermissionGuard(for: permissionMode)
    ].compactMap { $0 }
    return sections
        .joined(separator: "\n\n")
}

private func runFollowUpNonEmpty(_ value: String) -> String? {
    let trimmed = value.gitTrimmed
    return trimmed.isEmpty ? nil : trimmed
}

private func runFollowUpOutputContract(for actionId: String) -> String {
    switch actionId {
    case "bug-analysis":
        return """
        Output contract:
        - Return sections: Confirmed facts, likely seam, smallest safe fix, focused validation, and missing input.
        - Keep file/function references precise when available.
        - Preserve Decision signals as the current triage status, not proof that a fix already happened.
        - If the evidence is not enough to name a seam, say so and ask for one concrete input.
        """
    case "log-analysis":
        return """
        Output contract:
        - Return sections: IDs checked, timeline/phases, error family, ambiguity, and next lookup.
        - Keep conversationId, sessionId, traceId, requestId, and taskId in separate fields.
        - Include the exact skill command to run next when more logs are needed.
        """
    case "skill-hardening":
        return """
        Output contract:
        - Return sections: skill path, current failure, invocation improvement, guardrail/doc change, and validation.
        - Distinguish confirmed SKILL.md/script behavior from proposed edits.
        - Keep credential and environment changes explicit.
        """
    case "mr-review":
        return """
        Output contract:
        - Return sections: findings, open questions, verification gaps, and ready/not-ready.
        - Put findings first, ordered by severity, with file/line evidence when available.
        - Preserve Decision signals as merge readiness, approval state, or remaining blocker context.
        - Treat Artifact refs as evidence pointers and Next commands as follow-up candidates, not proof they already ran.
        - If there are no findings, say that clearly and name residual test risk.
        """
    case "validation":
        return """
        Output contract:
        - Return sections: check run, result, evidence, and next action.
        - Prefer relevant Next commands from context as candidate checks; include exact commands or manual checks.
        - Separate validation failure from proposed implementation fixes.
        """
    case "jira-update":
        return """
        Output contract:
        - Return a paste-ready Jira comment with Status, Evidence, Validation, Blockers, and Next action.
        - Fold Decision signals into Status or Next action when they describe readiness, approval, or blockers.
        - Fold Artifact refs into Evidence and Next commands into Next action when relevant; keep URIs intact.
        - Keep confirmed facts separate from guesses.
        - Do not claim posting happened unless an external write actually succeeded.
        """
    case "capture-evidence":
        return """
        Output contract:
        - Return artifact-ready evidence with Source refs, Outputs, Validation, Blockers, and Next action.
        - Include a proposed knowledge card only when it has durable reusable value.
        - Preserve provenance instead of rewriting source-chat conclusions as fresh truth.
        """
    default:
        return """
        Output contract:
        - Return confirmed facts, recommended next action, and verification evidence.
        - Keep assumptions explicit.
        """
    }
}

private func runFollowUpPermissionGuard(for mode: PermissionMode?) -> String? {
    guard let mode else { return nil }
    switch mode {
    case .readOnly:
        return """
        Permission guard:
        - Read-only follow-up: inspect, analyze, and report only.
        - Do not edit files, stage or commit changes, install tools, change credentials, update external systems, or run destructive commands.
        - If a fix or write-back is needed, describe the smallest proposed change and ask before editing or posting.
        """
    case .askBeforeEdit:
        return """
        Permission guard:
        - Ask-before-edit follow-up: inspect, validate, draft changes, and explain the intended edit path.
        - Ask before editing files, installing tools, changing credentials, staging or committing changes, pushing branches, or writing to external systems.
        - Keep validation evidence separate from proposed fixes so the next action stays easy to approve.
        """
    case .autopilot:
        return nil
    }
}

func chatRunFollowUpActions(run: AgentRun?, workItem: WorkItem?, assistantText: String) -> [RunFollowUpAction] {
    guard let run else { return [] }
    switch run.state {
    case .queued, .starting, .running, .cancelling, .draft:
        return []
    case .waitingForUser, .completed, .failed, .cancelled, .stale:
        break
    }

    let output = friendlyAgentOutput(assistantText).trimmingCharacters(in: .whitespacesAndNewlines)
    guard !output.isEmpty, output != "No assistant output yet." else { return [] }

    let workItemTitle = workItem?.title.gitTrimmed ?? ""
    let target = workItemTitle.isEmpty ? run.promptSnapshot.firstLineFallback("this chat") : workItemTitle
    let context = runFollowUpContext(run: run, workItem: workItem, output: output)
    var actions: [RunFollowUpAction] = []

    guard runFollowUpShouldOfferWorkflowActions(
        run: run,
        workItem: workItem,
        output: output
    ) else { return [] }

    if run.state == .failed
        || run.state == .stale
        || outputContainsFailureSignal(output)
        || followUpContainsBlockingDecisionSignal(output) {
        actions.append(RunFollowUpAction(
            id: "bug-analysis",
            title: "Bug",
            symbol: "ladybug",
            permissionMode: .readOnly,
            prompt: """
            Analyze this run as a bug in \(target). If the trigger is a blocking review decision, treat that decision as the failure signal to triage.

            Start from the previous prompt and assistant output already in this chat. Separate confirmed facts from guesses, identify the likely seam, propose the smallest safe fix, and name the focused validation that should close the loop. If evidence is missing, ask for the single most useful missing input.

            \(context)
            """
        ))
    }

    if followUpContainsLogSignal(run: run, output: output) {
        actions.append(RunFollowUpAction(
            id: "log-analysis",
            title: "Logs",
            symbol: "waveform.path.ecg",
            permissionMode: .readOnly,
            prompt: """
            Trace this run through logs for \(target).

            Keep conversationId, sessionId, traceId, requestId, and taskId distinct. Prefer `/logtrace` for runtime log lookup and `/clickhouse` for TraceId or ConversationId span, slow span, and error span analysis when available. Build a phase-by-phase summary, compare related calls if the output provides multiple IDs, and call out field/source ambiguity before guessing.

            \(context)
            """
        ))
    }

    if followUpContainsSkillSignal(run: run, output: output) {
        actions.append(RunFollowUpAction(
            id: "skill-hardening",
            title: "Skill",
            symbol: "puzzlepiece.extension",
            permissionMode: .askBeforeEdit,
            prompt: """
            Harden the skill path behind this run for \(target).

            Start from the previous prompt and assistant output already in this chat. Identify the exact skill or command mentioned, inspect its SKILL.md and scripts before changing behavior, make invocation and failure recovery faster, improve examples or guardrails, and add focused validation where practical. Preserve environment and credential boundaries; if no exact skill is identifiable, report that first instead of doing a broad refactor.

            \(context)
            """
        ))
    }

    actions.append(RunFollowUpAction(
        id: "mr-review",
        title: "Review",
        symbol: "checkmark.seal",
        permissionMode: .readOnly,
        prompt: """
        Review the current changes for \(target).

        Use a code-review stance. Prioritize bugs, regressions, risky behavior, security or data-loss concerns, and missing tests. Lead with findings and file/line evidence when available, preserve decision signals, preserve artifact refs as evidence pointers, then list open questions and the verification gap. Treat any next commands as follow-up candidates, not validation that already happened.

        \(context)
        """
    ))

    actions.append(RunFollowUpAction(
        id: "validation",
        title: "Validate",
        symbol: "testtube.2",
        permissionMode: .askBeforeEdit,
        prompt: """
        Continue by validating \(target).

        Use the previous assistant output as context. Prefer a relevant Next command from the context when it is the narrowest useful check; otherwise pick the narrowest useful test, build, or manual check. Run or describe the exact verification path, and report only evidence that changes whether this work is ready. Do not modify implementation in this validation pass; if validation exposes a fix, report it as the next action.

        \(context)
        """
    ))

    if workItem?.sourceType == .jira || workItem?.jira != nil || followUpContainsJiraSignal(run: run, output: output) {
        actions.append(RunFollowUpAction(
            id: "jira-update",
            title: "Jira",
            symbol: "checklist",
            permissionMode: .readOnly,
        prompt: """
        Prepare a Jira-ready update for \(target).

        Use the previous assistant output, ticket key, and ticket context already in this chat. Summarize current status, decision signals, confirmed evidence, blockers, validation results, and the next concrete action in a concise comment-ready format. Preserve artifact refs in Evidence and use Next commands as candidate Next action text when they are still pending. If no ticket is bound to this chat yet, identify the ticket key or say what needs to be synced before posting.

        \(context)
        """
        ))
    } else {
        actions.append(RunFollowUpAction(
            id: "capture-evidence",
            title: "Evidence",
            symbol: "archivebox",
            permissionMode: .readOnly,
            prompt: """
            Extract durable evidence from this run for \(target).

            Summarize confirmed facts, source refs, changed files or artifacts, validation results, blockers, and the next concrete action. If a source-grounded memory card would be useful, propose the exact card content and cite the source context from this chat.

            \(context)
            """
        ))
    }

    return visibleRunFollowUpActions(actions)
}

private func runFollowUpShouldOfferWorkflowActions(
    run: AgentRun,
    workItem: WorkItem?,
    output: String
) -> Bool {
    switch run.state {
    case .failed, .cancelled, .stale, .waitingForUser:
        return true
    case .queued, .starting, .running, .cancelling, .draft, .completed:
        break
    }

    if let workItem {
        if workItem.sourceType != .manualPrompt || workItem.jira != nil {
            return true
        }
        if !workItem.sourceRefs.isEmpty || !workItem.externalRefs.isEmpty {
            return true
        }
    }

    if outputContainsFailureSignal(output)
        || followUpContainsBlockingDecisionSignal(output)
        || followUpContainsLogSignal(run: run, output: output)
        || followUpContainsJiraSignal(run: run, output: output)
        || followUpContainsSkillSignal(run: run, output: output) {
        return true
    }

    if !runFollowUpDecisionSignals(from: output).isEmpty
        || !runFollowUpReproductionNotes(from: output).isEmpty
        || !runFollowUpDiagnosisNotes(from: output).isEmpty
        || !runFollowUpHandoffDrafts(from: output).isEmpty
        || !runFollowUpExternalLinks(from: output).isEmpty
        || !runFollowUpArtifactRefs(from: output).isEmpty
        || !runFollowUpGitRefs(run: run, output: output).isEmpty
        || !runFollowUpEnvironmentRefs(run: run, output: output).isEmpty
        || !runFollowUpTicketRefs(run: run, workItem: workItem, output: output).isEmpty
        || !runFollowUpSkillRefs(run: run, output: output).isEmpty
        || !runFollowUpFailureSignals(from: output).isEmpty
        || !runFollowUpFileRefs(from: output).isEmpty
        || !runFollowUpValidationEvidence(from: output).isEmpty
        || !runFollowUpActionableNotes(from: output).isEmpty
        || !runFollowUpNextCommands(run: run, output: output).isEmpty
        || !runFollowUpSuggestedLogCommands(run: run, output: output).isEmpty {
        return true
    }

    return runFollowUpOutputLooksDurableEvidence(output)
}

private func runFollowUpOutputLooksDurableEvidence(_ output: String) -> Bool {
    output
        .split(whereSeparator: \.isNewline)
        .map { runFollowUpStrippedHeadingPrefix(runFollowUpStrippedListPrefix(String($0))).gitTrimmed }
        .contains { line in
            let lower = line.lowercased()
            return lower.hasPrefix("validated ")
                || lower.hasPrefix("verified ")
                || lower.hasPrefix("evidence:")
                || lower.hasPrefix("validation:")
                || lower.hasPrefix("verification:")
                || line.hasPrefix("已验证")
                || line.hasPrefix("验证通过")
        }
}

private func visibleRunFollowUpActions(_ actions: [RunFollowUpAction], limit: Int = 4) -> [RunFollowUpAction] {
    guard actions.count > limit else { return actions }
    var visible = Array(actions.prefix(limit))
    let hidden = actions.dropFirst(limit)
    let mustSurfaceIDs = ["jira-update"]
    let replaceableIDs = ["capture-evidence", "mr-review", "validation"]

    for action in hidden where mustSurfaceIDs.contains(action.id) {
        guard !visible.contains(where: { $0.id == action.id }) else { continue }
        guard let replacementIndex = replaceableIDs.compactMap({ id in
            visible.firstIndex(where: { $0.id == id })
        }).first else {
            continue
        }
        visible[replacementIndex] = action
    }
    return visible
}

private func runFollowUpContext(run: AgentRun, workItem: WorkItem?, output: String) -> String {
    var lines = [
        "Run context:",
        "- State: \(run.state.rawValue)"
    ]
    let prompt = run.promptSnapshot.gitTrimmed
    if !prompt.isEmpty {
        lines.append("- Original prompt: \(prompt.firstLineFallback("chat"))")
    }
    if let workItem {
        lines.append("- Work item: \(workItem.title.firstLineFallback("task"))")
        lines.append("- Work item state: \(workItem.state.rawValue)")
        let acceptance = workItem.acceptanceCriteria
            .map { $0.gitTrimmed }
            .filter { !$0.isEmpty }
            .prefix(3)
            .joined(separator: "; ")
        if !acceptance.isEmpty {
            lines.append("- Acceptance: \(acceptance)")
        }
        if let jira = workItem.jira {
            let jiraParts = [
                nonEmptyFollowUpText(jira.key),
                jira.status.flatMap(nonEmptyFollowUpText),
                jira.priority.flatMap(nonEmptyFollowUpText)
            ]
            .compactMap { $0 }
            .joined(separator: " · ")
            if !jiraParts.isEmpty {
                lines.append("- Jira: \(jiraParts)")
            }
        }
        if let sourceRefs = runFollowUpRefsContextLine(title: "Source refs", refs: workItem.sourceRefs) {
            lines.append(sourceRefs)
        }
        if let externalRefs = runFollowUpRefsContextLine(title: "External refs", refs: workItem.externalRefs) {
            lines.append(externalRefs)
        }
    }
    let excerpt = output.gitTrimmed.replacingOccurrences(of: "\n", with: " ")
    if !excerpt.isEmpty {
        let maxLength = 420
        let clipped = excerpt.count > maxLength ? "\(excerpt.prefix(maxLength))..." : excerpt
        lines.append("- Output excerpt: \(clipped)")
    }
    let statusSummary = runFollowUpStatusSummary(run: run, output: output)
    if !statusSummary.isEmpty {
        lines.append("- Status summary:\n\(statusSummary.map { "- \($0)" }.joined(separator: "\n"))")
    }
    let decisionSignals = runFollowUpDecisionSignals(from: output)
    if !decisionSignals.isEmpty {
        lines.append("- Decision signals:\n\(decisionSignals.map { "- \($0)" }.joined(separator: "\n"))")
    }
    let reproductionNotes = runFollowUpReproductionNotes(from: output)
    if !reproductionNotes.isEmpty {
        lines.append("- Reproduction notes:\n\(reproductionNotes.map { "- \($0)" }.joined(separator: "\n"))")
    }
    let diagnosisNotes = runFollowUpDiagnosisNotes(from: output)
    if !diagnosisNotes.isEmpty {
        lines.append("- Diagnosis notes:\n\(diagnosisNotes.map { "- \($0)" }.joined(separator: "\n"))")
    }
    let reviewFindings = runFollowUpReviewFindings(from: output)
    if !reviewFindings.isEmpty {
        lines.append("- Review findings:\n\(reviewFindings.map { "- \($0)" }.joined(separator: "\n"))")
    }
    let handoffDrafts = runFollowUpHandoffDrafts(from: output)
    if !handoffDrafts.isEmpty {
        lines.append("- Handoff drafts:\n\(handoffDrafts.map { "- \($0)" }.joined(separator: "\n"))")
    }
    let externalLinks = runFollowUpExternalLinks(from: output)
    if !externalLinks.isEmpty {
        lines.append("- External links:\n\(externalLinks.map { "- \($0)" }.joined(separator: "\n"))")
    }
    let artifactRefs = runFollowUpArtifactRefs(from: output)
    if !artifactRefs.isEmpty {
        lines.append("- Artifact refs:\n\(artifactRefs.map { "- \($0)" }.joined(separator: "\n"))")
    }
    let gitRefs = runFollowUpGitRefs(run: run, output: output)
    if !gitRefs.isEmpty {
        lines.append("- Git refs: \(gitRefs.joined(separator: ", "))")
    }
    let environmentRefs = runFollowUpEnvironmentRefs(run: run, output: output)
    if !environmentRefs.isEmpty {
        lines.append("- Environment refs: \(environmentRefs.joined(separator: ", "))")
    }
    let ticketRefs = runFollowUpTicketRefs(run: run, workItem: workItem, output: output)
    if !ticketRefs.isEmpty {
        lines.append("- Ticket refs: \(ticketRefs.joined(separator: ", "))")
    }
    let skillRefs = runFollowUpSkillRefs(run: run, output: output)
    if !skillRefs.isEmpty {
        lines.append("- Skill refs: \(skillRefs.joined(separator: ", "))")
    }
    let failureSignals = runFollowUpFailureSignals(from: output)
    if !failureSignals.isEmpty {
        lines.append("- Failure signals:\n\(failureSignals.map { "- \($0)" }.joined(separator: "\n"))")
    }
    let fileRefs = runFollowUpFileRefs(from: output)
    if !fileRefs.isEmpty {
        lines.append("- File refs:\n\(fileRefs.map { "- \($0)" }.joined(separator: "\n"))")
    }
    let validationEvidence = runFollowUpValidationEvidence(from: output)
    if !validationEvidence.isEmpty {
        lines.append("- Validation evidence:\n\(validationEvidence.map { "- \($0)" }.joined(separator: "\n"))")
    }
    let actionableNotes = runFollowUpActionableNotes(from: output)
    if !actionableNotes.isEmpty {
        lines.append("- Actionable notes:\n\(actionableNotes.map { "- \($0)" }.joined(separator: "\n"))")
    }
    let nextCommands = runFollowUpNextCommands(run: run, output: output)
    if !nextCommands.isEmpty {
        lines.append("- Next commands:\n\(nextCommands.map { "- \($0)" }.joined(separator: "\n"))")
    }
    let suggestedCommands = runFollowUpSuggestedLogCommands(run: run, output: output)
    if !suggestedCommands.isEmpty {
        lines.append("- Suggested log commands:\n\(suggestedCommands.map { "- \($0)" }.joined(separator: "\n"))")
    }
    return lines.joined(separator: "\n")
}

private func runFollowUpStatusSummary(run: AgentRun, output: String) -> [String] {
    var summary: [String] = []
    let lines = output
        .split(whereSeparator: \.isNewline)
        .map { String($0).gitTrimmed }
        .filter { !$0.isEmpty }

    for line in lines {
        guard let status = runFollowUpExplicitStatusLine(from: line) else { continue }
        summary.append(status)
    }

    if let inferred = runFollowUpInferredStatusLine(run: run, lines: lines) {
        summary.append(inferred)
    }

    return dedupedFollowUpCommands(summary).prefix(3).map { $0 }
}

private func runFollowUpExplicitStatusLine(from line: String) -> String? {
    let stripped = runFollowUpStrippedHeadingPrefix(runFollowUpStrippedListPrefix(line))
    guard !stripped.isEmpty else { return nil }

    for separator in [":", "："] {
        guard let range = stripped.range(of: separator) else { continue }
        let field = String(stripped[..<range.lowerBound])
        let body = runFollowUpCompactedEvidenceLine(String(stripped[range.upperBound...]))
        guard let label = runFollowUpStatusLabel(for: field),
              !body.isEmpty else {
            continue
        }
        return "\(label): \(body)"
    }

    return nil
}

private func runFollowUpStatusLabel(for value: String) -> String? {
    let normalized = value
        .gitTrimmed
        .lowercased()
        .replacingOccurrences(of: "_", with: " ")
        .replacingOccurrences(of: "-", with: " ")
    switch normalized {
    case "status", "current status":
        return "Status"
    case "summary", "result", "outcome":
        return "Result"
    case "readiness", "ready", "not ready":
        return "Readiness"
    case "done", "completed", "implemented", "fixed":
        return "Progress"
    case "no findings", "no issues", "findings":
        return "Review result"
    default:
        return nil
    }
}

private func runFollowUpInferredStatusLine(run: AgentRun, lines: [String]) -> String? {
    switch run.state {
    case .failed:
        return "Run outcome: failed"
    case .stale:
        return "Run outcome: stale"
    case .cancelled:
        return "Run outcome: cancelled"
    case .waitingForUser:
        return "Run outcome: waiting for user"
    case .queued, .starting, .running, .cancelling, .draft:
        return nil
    case .completed:
        break
    }

    for line in lines {
        let stripped = runFollowUpStrippedHeadingPrefix(runFollowUpStrippedListPrefix(line))
        let lower = stripped.lowercased()
        if lower == "done" || lower == "done." {
            return "Progress: done"
        }
        if lower.hasPrefix("implemented ")
            || lower.hasPrefix("completed ")
            || lower.hasPrefix("fixed ")
            || lower.hasPrefix("validated ") {
            return "Progress: \(runFollowUpCompactedEvidenceLine(stripped))"
        }
        if lower.hasPrefix("no findings")
            || lower.hasPrefix("no issues found")
            || lower.hasPrefix("no blocking findings") {
            return "Review result: \(runFollowUpCompactedEvidenceLine(stripped))"
        }
    }

    return nil
}

private func runFollowUpDecisionSignals(from output: String) -> [String] {
    let lines = output
        .split(whereSeparator: \.isNewline)
        .map { String($0).gitTrimmed }
        .filter { !$0.isEmpty }
    var signals: [String] = []
    var index = 0

    while index < lines.count {
        let line = lines[index]
        if let signal = runFollowUpDecisionLine(from: line) {
            signals.append(signal)
            index += 1
            continue
        }
        if let label = runFollowUpDecisionSectionLabel(from: line) {
            var body: [String] = []
            var nextIndex = index + 1
            while nextIndex < lines.count, body.count < 4 {
                let next = lines[nextIndex]
                if runFollowUpLooksLikeDecisionBoundary(next) {
                    break
                }
                let stripped = runFollowUpStrippedHeadingPrefix(runFollowUpStrippedListPrefix(next))
                guard !stripped.isEmpty else { break }
                body.append(runFollowUpCompactedEvidenceLine(stripped))
                nextIndex += 1
            }
            if !body.isEmpty {
                signals.append("\(label): \(body.joined(separator: " | "))")
                index = nextIndex
                continue
            }
        }
        if let inferred = runFollowUpInferredDecisionSignal(from: line) {
            signals.append(inferred)
        }
        index += 1
    }

    return dedupedFollowUpCommands(signals).prefix(5).map { $0 }
}

private func runFollowUpDecisionLine(from line: String) -> String? {
    let stripped = runFollowUpStrippedHeadingPrefix(runFollowUpStrippedListPrefix(line))
    guard !stripped.isEmpty else { return nil }
    for separator in [":", "："] {
        guard let range = stripped.range(of: separator) else { continue }
        let field = String(stripped[..<range.lowerBound])
        let body = runFollowUpCompactedEvidenceLine(String(stripped[range.upperBound...]))
        guard let label = runFollowUpDecisionLabel(for: field),
              !body.isEmpty else {
            continue
        }
        return "\(label): \(body)"
    }
    return nil
}

private func runFollowUpDecisionSectionLabel(from line: String) -> String? {
    let stripped = runFollowUpStrippedHeadingPrefix(runFollowUpStrippedListPrefix(line))
    guard stripped.hasSuffix(":") || stripped.hasSuffix("：") else {
        return nil
    }
    return runFollowUpDecisionLabel(for: String(stripped.dropLast()))
}

private func runFollowUpDecisionLabel(for value: String) -> String? {
    let normalized = value
        .gitTrimmed
        .lowercased()
        .replacingOccurrences(of: "_", with: " ")
        .replacingOccurrences(of: "-", with: " ")
        .replacingOccurrences(of: "/", with: " ")
        .replacingOccurrences(of: "  ", with: " ")
    switch normalized {
    case "decision", "ship decision", "merge decision", "go no go", "go or no go":
        return "Decision"
    case "recommendation", "recommend", "recommended next action":
        return "Recommendation"
    case "readiness", "ready", "not ready", "ready not ready", "ready or not ready",
         "merge readiness", "mr readiness", "review readiness":
        return "Readiness"
    case "approval", "approval note", "approval status", "review approval":
        return "Approval"
    case "request changes", "changes requested":
        return "Approval"
    default:
        return nil
    }
}

private func runFollowUpInferredDecisionSignal(from line: String) -> String? {
    let stripped = runFollowUpStrippedHeadingPrefix(runFollowUpStrippedListPrefix(line))
    let lower = stripped.lowercased()
    guard !stripped.isEmpty else { return nil }
    if lower.hasPrefix("ready to merge")
        || lower.hasPrefix("not ready to merge")
        || lower.hasPrefix("ready for review")
        || lower.hasPrefix("not ready for review") {
        return "Readiness: \(runFollowUpCompactedEvidenceLine(stripped))"
    }
    if lower.hasPrefix("approve")
        || lower.hasPrefix("approved")
        || lower.hasPrefix("request changes")
        || lower.hasPrefix("changes requested") {
        return "Approval: \(runFollowUpCompactedEvidenceLine(stripped))"
    }
    return nil
}

private func followUpContainsBlockingDecisionSignal(_ output: String) -> Bool {
    runFollowUpDecisionSignals(from: output).contains(where: runFollowUpDecisionSignalIsBlocking(_:))
}

private func runFollowUpDecisionSignalIsBlocking(_ signal: String) -> Bool {
    let lower = signal.lowercased()
    if lower.contains("no blocking findings") || lower.contains("no blockers") {
        return false
    }
    return lower.contains("not ready")
        || lower.contains("blocked")
        || lower.contains("blocker")
        || lower.contains("request changes")
        || lower.contains("changes requested")
        || lower.contains("no-go")
        || lower.contains("do not merge")
        || lower.contains("cannot merge")
        || lower.contains("must fix")
        || lower.contains("required fix")
        || lower.contains("needs fix")
}

private func runFollowUpLooksLikeDecisionBoundary(_ line: String) -> Bool {
    if runFollowUpDecisionLine(from: line) != nil || runFollowUpDecisionSectionLabel(from: line) != nil {
        return true
    }
    if runFollowUpReproductionLine(from: line) != nil || runFollowUpReproductionSectionLabel(from: line) != nil {
        return true
    }
    if runFollowUpDiagnosisLine(from: line) != nil || runFollowUpDiagnosisSectionLabel(from: line) != nil {
        return true
    }
    let stripped = runFollowUpStrippedHeadingPrefix(runFollowUpStrippedListPrefix(line))
    guard stripped.hasSuffix(":") || stripped.hasSuffix("：") else {
        return false
    }
    let heading = String(stripped.dropLast())
        .gitTrimmed
        .lowercased()
        .replacingOccurrences(of: "_", with: " ")
        .replacingOccurrences(of: "-", with: " ")
    return runFollowUpKnownSectionHeadings.contains(heading)
}

private let runFollowUpKnownSectionHeadings: Set<String> = [
    "status", "result", "summary", "validation", "tests", "changed files",
    "files changed", "file refs", "source refs", "external refs", "commands",
    "notes", "blockers", "next action", "open question", "risk", "findings",
    "jira update", "mr review comment", "review comment", "expected", "actual",
    "observed", "decision", "recommendation", "readiness", "merge readiness",
    "mr readiness", "ready/not ready", "ready not ready", "ready or not ready",
    "approval", "approval note", "request changes", "changes requested",
    "go/no-go", "go no go", "go or no go"
]

private func runFollowUpReproductionNotes(from output: String) -> [String] {
    let lines = output
        .split(whereSeparator: \.isNewline)
        .map { String($0).gitTrimmed }
        .filter { !$0.isEmpty }
    var notes: [String] = []
    var index = 0

    while index < lines.count {
        let line = lines[index]
        if let note = runFollowUpReproductionLine(from: line) {
            notes.append(note)
            index += 1
            continue
        }
        if let label = runFollowUpReproductionSectionLabel(from: line) {
            var body: [String] = []
            var nextIndex = index + 1
            while nextIndex < lines.count, body.count < 4 {
                let next = lines[nextIndex]
                if runFollowUpLooksLikeReproductionBoundary(next) {
                    break
                }
                let stripped = runFollowUpStrippedHeadingPrefix(runFollowUpStrippedListPrefix(next))
                guard !stripped.isEmpty else { break }
                body.append(runFollowUpCompactedEvidenceLine(stripped))
                nextIndex += 1
            }
            if !body.isEmpty {
                notes.append("\(label): \(body.joined(separator: " | "))")
                index = nextIndex
                continue
            }
        }
        index += 1
    }

    return dedupedFollowUpCommands(notes).prefix(5).map { $0 }
}

private func runFollowUpReproductionLine(from line: String) -> String? {
    let stripped = runFollowUpStrippedHeadingPrefix(runFollowUpStrippedListPrefix(line))
    guard !stripped.isEmpty else { return nil }
    for separator in [":", "："] {
        guard let range = stripped.range(of: separator) else { continue }
        let field = String(stripped[..<range.lowerBound])
        let body = runFollowUpCompactedEvidenceLine(String(stripped[range.upperBound...]))
        guard let label = runFollowUpReproductionLabel(for: field),
              !body.isEmpty else {
            continue
        }
        return "\(label): \(body)"
    }
    return nil
}

private func runFollowUpReproductionSectionLabel(from line: String) -> String? {
    let stripped = runFollowUpStrippedHeadingPrefix(runFollowUpStrippedListPrefix(line))
    guard stripped.hasSuffix(":") || stripped.hasSuffix("：") else {
        return nil
    }
    return runFollowUpReproductionLabel(for: String(stripped.dropLast()))
}

private func runFollowUpReproductionLabel(for value: String) -> String? {
    let normalized = value
        .gitTrimmed
        .lowercased()
        .replacingOccurrences(of: "_", with: " ")
        .replacingOccurrences(of: "-", with: " ")
    switch normalized {
    case "repro", "reproduction", "steps", "steps to reproduce", "reproduction steps", "str":
        return "Steps"
    case "observed", "observed behavior", "observed result":
        return "Observed"
    case "actual", "actual behavior", "actual result", "actual outcome":
        return "Actual"
    case "expected", "expected behavior", "expected result", "expected outcome":
        return "Expected"
    default:
        return nil
    }
}

private func runFollowUpLooksLikeReproductionBoundary(_ line: String) -> Bool {
    if runFollowUpReproductionLine(from: line) != nil {
        return true
    }
    if runFollowUpReproductionSectionLabel(from: line) != nil {
        return true
    }
    let stripped = runFollowUpStrippedHeadingPrefix(runFollowUpStrippedListPrefix(line))
    guard stripped.hasSuffix(":") || stripped.hasSuffix("：") else {
        return false
    }
    let heading = String(stripped.dropLast())
        .gitTrimmed
        .lowercased()
        .replacingOccurrences(of: "_", with: " ")
        .replacingOccurrences(of: "-", with: " ")
    return runFollowUpKnownSectionHeadings.contains(heading)
}

private func runFollowUpDiagnosisNotes(from output: String) -> [String] {
    let lines = output
        .split(whereSeparator: \.isNewline)
        .map { String($0).gitTrimmed }
        .filter { !$0.isEmpty }
    var notes: [String] = []
    var index = 0

    while index < lines.count {
        let line = lines[index]
        if let note = runFollowUpDiagnosisLine(from: line) {
            notes.append(note)
            index += 1
            continue
        }
        if let label = runFollowUpDiagnosisSectionLabel(from: line) {
            var body: [String] = []
            var nextIndex = index + 1
            while nextIndex < lines.count, body.count < 4 {
                let next = lines[nextIndex]
                if runFollowUpLooksLikeDiagnosisBoundary(next) {
                    break
                }
                let stripped = runFollowUpStrippedHeadingPrefix(runFollowUpStrippedListPrefix(next))
                guard !stripped.isEmpty else { break }
                body.append(runFollowUpCompactedEvidenceLine(stripped))
                nextIndex += 1
            }
            if !body.isEmpty {
                notes.append("\(label): \(body.joined(separator: " | "))")
                index = nextIndex
                continue
            }
        }
        index += 1
    }

    return dedupedFollowUpCommands(notes).prefix(5).map { $0 }
}

private func runFollowUpDiagnosisLine(from line: String) -> String? {
    let stripped = runFollowUpStrippedHeadingPrefix(runFollowUpStrippedListPrefix(line))
    guard !stripped.isEmpty else { return nil }
    for separator in [":", "："] {
        guard let range = stripped.range(of: separator) else { continue }
        let field = String(stripped[..<range.lowerBound])
        let body = runFollowUpCompactedEvidenceLine(String(stripped[range.upperBound...]))
        guard let label = runFollowUpDiagnosisLabel(for: field),
              !body.isEmpty else {
            continue
        }
        return "\(label): \(body)"
    }
    return nil
}

private func runFollowUpDiagnosisSectionLabel(from line: String) -> String? {
    let stripped = runFollowUpStrippedHeadingPrefix(runFollowUpStrippedListPrefix(line))
    guard stripped.hasSuffix(":") || stripped.hasSuffix("：") else {
        return nil
    }
    return runFollowUpDiagnosisLabel(for: String(stripped.dropLast()))
}

private func runFollowUpDiagnosisLabel(for value: String) -> String? {
    let normalized = value
        .gitTrimmed
        .lowercased()
        .replacingOccurrences(of: "_", with: " ")
        .replacingOccurrences(of: "-", with: " ")
    switch normalized {
    case "diagnosis":
        return "Diagnosis"
    case "root cause":
        return "Root cause"
    case "cause", "likely cause", "suspected cause":
        return "Likely cause"
    case "seam", "likely seam", "implementation seam", "affected seam", "suspect seam":
        return "Likely seam"
    case "hypothesis", "working hypothesis":
        return "Hypothesis"
    case "impact", "customer impact", "user impact", "blast radius":
        return "Impact"
    case "fix", "fix path", "fix plan", "proposed fix", "smallest fix", "smallest safe fix", "remediation":
        return "Fix path"
    default:
        return nil
    }
}

private func runFollowUpLooksLikeDiagnosisBoundary(_ line: String) -> Bool {
    if runFollowUpDiagnosisLine(from: line) != nil || runFollowUpDiagnosisSectionLabel(from: line) != nil {
        return true
    }
    if runFollowUpReproductionLine(from: line) != nil || runFollowUpReproductionSectionLabel(from: line) != nil {
        return true
    }
    let stripped = runFollowUpStrippedHeadingPrefix(runFollowUpStrippedListPrefix(line))
    guard stripped.hasSuffix(":") || stripped.hasSuffix("：") else {
        return false
    }
    let heading = String(stripped.dropLast())
        .gitTrimmed
        .lowercased()
        .replacingOccurrences(of: "_", with: " ")
        .replacingOccurrences(of: "-", with: " ")
    return runFollowUpKnownSectionHeadings.contains(heading)
}

private func runFollowUpReviewFindings(from output: String) -> [String] {
    let findings = output
        .split(whereSeparator: \.isNewline)
        .compactMap { runFollowUpReviewFinding(from: String($0)) }
    return dedupedFollowUpCommands(findings).prefix(5).map { $0 }
}

private func runFollowUpReviewFinding(from line: String) -> String? {
    let stripped = runFollowUpStrippedHeadingPrefix(runFollowUpStrippedListPrefix(line))
    guard !stripped.isEmpty else { return nil }
    let lower = stripped.lowercased()

    if lower.hasPrefix("no findings")
        || lower.hasPrefix("no issues found")
        || lower.hasPrefix("no blocking findings") {
        return runFollowUpCompactedEvidenceLine(stripped)
    }
    if let severityFinding = runFollowUpSeverityFinding(from: stripped) {
        return severityFinding
    }
    return runFollowUpLabeledReviewFinding(from: stripped)
}

private func runFollowUpSeverityFinding(from value: String) -> String? {
    guard let regex = try? NSRegularExpression(pattern: #"^(?:finding\s*)?\[P[0-3]\]\s*[:\-–—]?\s*.+"#, options: [.caseInsensitive]) else {
        return nil
    }
    let range = NSRange(value.startIndex..<value.endIndex, in: value)
    return regex.firstMatch(in: value, range: range) == nil
        ? nil
        : runFollowUpCompactedEvidenceLine(value)
}

private func runFollowUpLabeledReviewFinding(from value: String) -> String? {
    for separator in [":", "：", " - ", " – ", " — "] {
        guard let range = value.range(of: separator) else { continue }
        let field = String(value[..<range.lowerBound])
            .gitTrimmed
            .lowercased()
            .replacingOccurrences(of: "_", with: " ")
            .replacingOccurrences(of: "-", with: " ")
        let body = runFollowUpCompactedEvidenceLine(String(value[range.upperBound...]))
        guard !body.isEmpty,
              ["finding", "review finding", "mr finding", "review comment"].contains(field) else {
            continue
        }
        return "Finding: \(body)"
    }
    return nil
}

private func runFollowUpHandoffDrafts(from output: String) -> [String] {
    let lines = output
        .split(whereSeparator: \.isNewline)
        .map { String($0).gitTrimmed }
        .filter { !$0.isEmpty }
    var drafts: [String] = []
    var index = 0

    while index < lines.count {
        let stripped = runFollowUpStrippedHeadingPrefix(runFollowUpStrippedListPrefix(lines[index]))
        guard let heading = runFollowUpHandoffHeading(from: stripped) else {
            index += 1
            continue
        }

        var body = heading.body.map { [$0] } ?? []
        var nextIndex = index + 1
        while nextIndex < lines.count, body.count < 5 {
            let next = runFollowUpStrippedListPrefix(lines[nextIndex])
            let normalizedNext = runFollowUpStrippedHeadingPrefix(next)
            if runFollowUpHandoffHeading(from: normalizedNext) != nil {
                break
            }
            if runFollowUpLooksLikeNonHandoffSection(normalizedNext), !body.isEmpty {
                break
            }
            body.append(runFollowUpCompactedEvidenceLine(next))
            nextIndex += 1
        }

        let summary = body
            .map(runFollowUpCompactedEvidenceLine(_:))
            .filter { !$0.isEmpty }
            .joined(separator: " | ")
        if !summary.isEmpty {
            drafts.append("\(heading.label): \(summary)")
        }
        index = max(nextIndex, index + 1)
    }

    return dedupedFollowUpCommands(drafts).prefix(3).map { $0 }
}

private func runFollowUpHandoffHeading(from line: String) -> (label: String, body: String?)? {
    let stripped = line.gitTrimmed
    guard !stripped.isEmpty else { return nil }

    for separator in [":", "："] {
        guard let range = stripped.range(of: separator) else { continue }
        let field = String(stripped[..<range.lowerBound])
        guard let label = runFollowUpHandoffLabel(for: field) else { continue }
        let body = runFollowUpCompactedEvidenceLine(String(stripped[range.upperBound...]))
        return (label, body.isEmpty ? nil : body)
    }

    guard !stripped.contains(":"),
          !stripped.contains("：") else {
        return nil
    }
    guard let label = runFollowUpHandoffLabel(for: stripped) else { return nil }
    return (label, nil)
}

private func runFollowUpHandoffLabel(for value: String) -> String? {
    let normalized = value
        .gitTrimmed
        .lowercased()
        .replacingOccurrences(of: "_", with: " ")
        .replacingOccurrences(of: "-", with: " ")
    let compact = normalized.replacingOccurrences(of: " ", with: "")

    if normalized.contains("jira"),
       normalized.contains("update") || normalized.contains("comment") {
        return "Jira draft"
    }
    if normalized.contains("merge request")
        || normalized.contains("pull request")
        || normalized.contains("mr ") {
        if normalized.contains("review") || normalized.contains("comment") || normalized.contains("approval") {
            return "MR draft"
        }
    }
    if normalized.contains("review comment") || normalized.contains("approval note") {
        return "Review draft"
    }
    if normalized.contains("bug handoff") || normalized.contains("bug report") {
        return "Bug handoff"
    }
    if normalized.contains("paste ready") || normalized == "handoff" || compact == "handoffdraft" {
        return "Handoff draft"
    }
    return nil
}

private func runFollowUpLooksLikeNonHandoffSection(_ line: String) -> Bool {
    guard line.hasSuffix(":") || line.hasSuffix("：") else { return false }
    let heading = String(line.dropLast()).gitTrimmed.lowercased()
    return runFollowUpKnownSectionHeadings.contains(heading)
}

private func runFollowUpExternalLinks(from output: String) -> [String] {
    let lines = output
        .split(whereSeparator: \.isNewline)
        .map { String($0).gitTrimmed }
        .filter { !$0.isEmpty }
    var links: [String] = []

    for line in lines {
        let candidates = runFollowUpMarkdownLinkTargets(in: line)
            + line.split(whereSeparator: { $0.isWhitespace || $0.isNewline }).map(String.init)
        for candidate in candidates {
            guard let link = runFollowUpExternalLink(from: candidate) else { continue }
            links.append(link)
        }
    }

    return dedupedFollowUpCommands(links).prefix(6).map { $0 }
}

private func runFollowUpExternalLink(from candidate: String) -> String? {
    var value = candidate
        .gitTrimmed
        .trimmingCharacters(in: runFollowUpExternalLinkTrimCharacters)
    while let scalar = value.unicodeScalars.last,
          runFollowUpExternalLinkTrailingCharacters.contains(scalar) {
        value = String(value.dropLast())
    }
    let lower = value.lowercased()
    guard lower.hasPrefix("http://") || lower.hasPrefix("https://") else {
        return nil
    }
    let canonical = runFollowUpCanonicalExternalURL(value)
    return "\(runFollowUpExternalLinkLabel(for: canonical)): \(canonical)"
}

private func runFollowUpCanonicalExternalURL(_ value: String) -> String {
    var url = value
    let lower = url.lowercased()
    guard lower.contains("/merge_requests/") || lower.contains("/-/merge_requests/") else {
        return url
    }
    for suffix in ["/diffs", "/commits", "/pipelines"] {
        let currentLower = url.lowercased()
        if currentLower.hasSuffix(suffix) {
            url = String(url.dropLast(suffix.count))
        } else if let range = currentLower.range(of: "\(suffix)?") {
            url = String(url[..<range.lowerBound])
        } else if let range = currentLower.range(of: "\(suffix)#") {
            url = String(url[..<range.lowerBound])
        }
    }
    return url
}

private func runFollowUpExternalLinkLabel(for value: String) -> String {
    let lower = value.lowercased()
    if lower.contains("/browse/") || lower.contains("atlassian.net/browse/") {
        return "Jira"
    }
    if lower.contains("/-/merge_requests/") || lower.contains("/merge_requests/") {
        return "MR"
    }
    if lower.contains("/pull/") || lower.contains("/pulls/") {
        return "PR"
    }
    if lower.contains("/issues/") || lower.contains("/-/issues/") {
        return "Issue"
    }
    if lower.contains("/pipelines/") || lower.contains("/-/pipelines/") {
        return "Pipeline"
    }
    return "Link"
}

private let runFollowUpExternalLinkTrimCharacters = CharacterSet.whitespacesAndNewlines
    .union(CharacterSet(charactersIn: "\"'`()[]{}<>"))

private let runFollowUpExternalLinkTrailingCharacters = CharacterSet(charactersIn: ".,;)]}")

private func runFollowUpArtifactRefs(from output: String) -> [String] {
    let lines = output
        .split(whereSeparator: \.isNewline)
        .map { String($0).gitTrimmed }
        .filter { !$0.isEmpty }
    var refs: [String] = []

    for line in lines {
        let candidates = runFollowUpBacktickValues(in: line)
            + runFollowUpMarkdownLinkTargets(in: line)
            + runFollowUpObsidianPathCandidates(in: line)
            + line.split(whereSeparator: { $0.isWhitespace || $0.isNewline }).map(String.init)
        for candidate in candidates {
            guard let ref = runFollowUpArtifactRef(from: candidate) else { continue }
            refs.append(ref)
        }
    }

    return dedupedFollowUpCommands(refs).prefix(6).map { $0 }
}

private func runFollowUpObsidianPathCandidates(in line: String) -> [String] {
    guard let vaultRange = line.range(of: "/Obsidian Vault/", options: [.caseInsensitive]) else {
        return []
    }
    let beforeVault = line[..<vaultRange.lowerBound]
    let pathStart = beforeVault.lastIndex(where: { $0.isWhitespace }).map { line.index(after: $0) } ?? line.startIndex
    guard pathStart < line.endIndex,
          line[pathStart] == "/" else {
        return []
    }
    let path = String(line[pathStart...])
    let extensions = [".markdown", ".md"]
    for fileExtension in extensions {
        guard let extensionRange = path.range(of: fileExtension, options: [.caseInsensitive, .backwards]) else {
            continue
        }
        return [String(path[..<extensionRange.upperBound])]
    }
    return []
}

private func runFollowUpArtifactRef(from candidate: String) -> String? {
    var value = candidate
        .gitTrimmed
        .trimmingCharacters(in: runFollowUpArtifactRefTrimCharacters)
    while let scalar = value.unicodeScalars.last,
          runFollowUpArtifactRefTrailingCharacters.contains(scalar) {
        value = String(value.dropLast())
    }
    guard !value.isEmpty else { return nil }

    let lower = value.lowercased()
    if lower.hasPrefix("pikiclaw://artifacts/") {
        return "Pikiclaw artifact: \(value)"
    }
    if lower.hasPrefix("pikiclaw://runs/") {
        return "Pikiclaw run: \(value)"
    }
    if lower.hasPrefix("pikiclaw://") {
        return "Pikiclaw: \(value)"
    }
    if lower.hasPrefix("obsidian://") {
        return "Obsidian: \(value)"
    }
    if lower.contains("/obsidian vault/"),
       lower.hasSuffix(".md") || lower.hasSuffix(".markdown") {
        return "Obsidian: \(value)"
    }
    return nil
}

private let runFollowUpArtifactRefTrimCharacters = CharacterSet.whitespacesAndNewlines
    .union(CharacterSet(charactersIn: "\"'`()[]{}<>"))

private let runFollowUpArtifactRefTrailingCharacters = CharacterSet(charactersIn: ".,;)]}")

private func runFollowUpGitRefs(run: AgentRun, output: String) -> [String] {
    let values = [
        run.promptSnapshot,
        output
    ]
    let refs = values.flatMap(runFollowUpGitRefs(in:))
    return dedupedFollowUpCommands(refs).prefix(6).map { $0 }
}

private func runFollowUpGitRefs(in value: String) -> [String] {
    let lines = value
        .split(whereSeparator: \.isNewline)
        .map { String($0).gitTrimmed }
        .filter { !$0.isEmpty }
    var refs: [String] = []

    for line in lines {
        refs.append(contentsOf: runFollowUpGitBranchRefs(in: line))
        refs.append(contentsOf: runFollowUpGitCommitRefs(in: line))
    }

    return refs
}

private func runFollowUpGitBranchRefs(in line: String) -> [String] {
    let candidates = runFollowUpBacktickValues(in: line)
        + runFollowUpMarkdownLinkTargets(in: line)
        + line.split(whereSeparator: { $0.isWhitespace || $0.isNewline }).map(String.init)
    let isBranchLine = runFollowUpLooksLikeGitBranchLine(line)
    return candidates.compactMap { candidate in
        let branch = runFollowUpGitBranchRef(from: candidate)
        if branch != nil { return branch }
        guard isBranchLine else { return nil }
        return runFollowUpNamedGitBranchRef(from: candidate)
    }
}

private func runFollowUpGitBranchRef(from candidate: String) -> String? {
    let value = runFollowUpCleanedGitRefCandidate(candidate)
    guard let regex = try? NSRegularExpression(pattern: #"^(?:codex|feature|fix|bugfix|hotfix|release|chore|dev)/[A-Za-z0-9][A-Za-z0-9._/-]{0,80}$"#) else {
        return nil
    }
    let range = NSRange(value.startIndex..<value.endIndex, in: value)
    return regex.firstMatch(in: value, range: range) == nil ? nil : "branch \(value)"
}

private func runFollowUpNamedGitBranchRef(from candidate: String) -> String? {
    let value = runFollowUpCleanedGitRefCandidate(candidate)
    let knownBranches: Set<String> = ["main", "master", "develop"]
    return knownBranches.contains(value) ? "branch \(value)" : nil
}

private func runFollowUpGitCommitRefs(in line: String) -> [String] {
    let lower = line.lowercased()
    guard lower.contains("commit")
        || lower.contains("sha")
        || lower.contains("head") else {
        return []
    }
    guard let regex = try? NSRegularExpression(pattern: #"\b[0-9a-f]{7,40}\b"#) else {
        return []
    }
    let range = NSRange(line.startIndex..<line.endIndex, in: line)
    return regex.matches(in: line, range: range).compactMap { match in
        guard let range = Range(match.range, in: line) else { return nil }
        return "commit \(line[range])"
    }
}

private func runFollowUpLooksLikeGitBranchLine(_ line: String) -> Bool {
    let lower = line.lowercased()
    return lower.contains("branch")
        || lower.contains("git switch")
        || lower.contains("git checkout")
}

private func runFollowUpCleanedGitRefCandidate(_ candidate: String) -> String {
    var value = candidate
        .gitTrimmed
        .trimmingCharacters(in: runFollowUpGitRefTrimCharacters)
    for prefix in ["branch=", "branch:", "head=", "head:", "source_branch="] {
        if value.lowercased().hasPrefix(prefix) {
            value = String(value.dropFirst(prefix.count))
                .gitTrimmed
                .trimmingCharacters(in: runFollowUpGitRefTrimCharacters)
        }
    }
    if value.hasPrefix("origin/") {
        value = String(value.dropFirst("origin/".count))
    }
    return value
}

private let runFollowUpGitRefTrimCharacters = CharacterSet.whitespacesAndNewlines
    .union(CharacterSet(charactersIn: "\"'`()[]{}<>,;."))

private func runFollowUpEnvironmentRefs(run: AgentRun, output: String) -> [String] {
    let values = [
        run.promptSnapshot,
        output
    ]
    let refs = values.flatMap(runFollowUpEnvironmentRefs(in:))
    return dedupedFollowUpCommands(refs).prefix(8).map { $0 }
}

private func runFollowUpEnvironmentRefs(in value: String) -> [String] {
    let lines = value
        .split(whereSeparator: \.isNewline)
        .map { String($0).gitTrimmed }
        .filter { !$0.isEmpty }
    var refs: [String] = []

    for line in lines {
        refs.append(contentsOf: runFollowUpEnvironmentAssignments(in: line))
        refs.append(contentsOf: runFollowUpEnvironmentFlagRefs(in: line))
        if let lineRef = runFollowUpEnvironmentFieldLine(from: line) {
            refs.append(lineRef)
        }
    }

    return refs
}

private func runFollowUpEnvironmentAssignments(in line: String) -> [String] {
    let candidates = runFollowUpBacktickValues(in: line)
        + runFollowUpMarkdownLinkTargets(in: line)
        + line.split(whereSeparator: { $0.isWhitespace || $0.isNewline }).map(String.init)
    return candidates.compactMap(runFollowUpEnvironmentAssignment(from:))
}

private func runFollowUpEnvironmentAssignment(from candidate: String) -> String? {
    let value = candidate
        .gitTrimmed
        .trimmingCharacters(in: runFollowUpEnvironmentRefTrimCharacters)
    guard !value.isEmpty,
          !value.lowercased().hasPrefix("http://"),
          !value.lowercased().hasPrefix("https://"),
          let regex = try? NSRegularExpression(pattern: #"^([A-Za-z][A-Za-z0-9_-]{1,24})[:=]([A-Za-z0-9_.@/-]{2,96})$"#) else {
        return nil
    }
    let range = NSRange(value.startIndex..<value.endIndex, in: value)
    guard let match = regex.firstMatch(in: value, range: range),
          let keyRange = Range(match.range(at: 1), in: value),
          let valueRange = Range(match.range(at: 2), in: value),
          let key = runFollowUpEnvironmentKey(String(value[keyRange])) else {
        return nil
    }
    return "\(key)=\(value[valueRange])"
}

private func runFollowUpEnvironmentFlagRefs(in line: String) -> [String] {
    let tokens = (runFollowUpBacktickValues(in: line) + [line])
        .flatMap { $0.split(whereSeparator: { $0.isWhitespace || $0.isNewline }).map(String.init) }
    var refs: [String] = []
    for index in tokens.indices {
        let token = tokens[index]
            .gitTrimmed
            .trimmingCharacters(in: runFollowUpEnvironmentRefTrimCharacters)
        let lower = token.lowercased()
        if lower.hasPrefix("--env=") {
            let env = String(token.dropFirst("--env=".count))
            if let ref = runFollowUpEnvironmentValueRef(key: "env", value: env) {
                refs.append(ref)
            }
        } else if lower == "--env", tokens.indices.contains(tokens.index(after: index)) {
            let env = tokens[tokens.index(after: index)]
            if let ref = runFollowUpEnvironmentValueRef(key: "env", value: env) {
                refs.append(ref)
            }
        }
    }
    return refs
}

private func runFollowUpEnvironmentFieldLine(from line: String) -> String? {
    let stripped = runFollowUpStrippedHeadingPrefix(runFollowUpStrippedListPrefix(line))
    for separator in [":", "："] {
        guard let range = stripped.range(of: separator) else { continue }
        let field = String(stripped[..<range.lowerBound])
        let body = String(stripped[range.upperBound...])
            .gitTrimmed
            .trimmingCharacters(in: runFollowUpEnvironmentRefTrimCharacters)
        guard let key = runFollowUpEnvironmentKey(field),
              let ref = runFollowUpEnvironmentValueRef(key: key, value: body) else {
            continue
        }
        return ref
    }
    return nil
}

private func runFollowUpEnvironmentValueRef(key: String, value: String) -> String? {
    let cleaned = value
        .gitTrimmed
        .trimmingCharacters(in: runFollowUpEnvironmentRefTrimCharacters)
    guard cleaned.count >= 2,
          cleaned.count <= 96,
          !cleaned.contains("://"),
          cleaned.range(of: #"^[A-Za-z0-9_.@/-]+$"#, options: .regularExpression) != nil else {
        return nil
    }
    return "\(key)=\(cleaned)"
}

private func runFollowUpEnvironmentKey(_ value: String) -> String? {
    let normalized = value
        .gitTrimmed
        .lowercased()
        .replacingOccurrences(of: "_", with: "")
        .replacingOccurrences(of: "-", with: "")
        .replacingOccurrences(of: " ", with: "")
    switch normalized {
    case "env", "environment":
        return "env"
    case "profile", "envprofile", "environmentprofile":
        return "profile"
    case "region", "zone":
        return "region"
    case "cluster":
        return "cluster"
    case "accountid", "rcaccountid":
        return "accountId"
    case "assistantid":
        return "assistantId"
    default:
        return nil
    }
}

private let runFollowUpEnvironmentRefTrimCharacters = CharacterSet.whitespacesAndNewlines
    .union(CharacterSet(charactersIn: "\"'`()[]{}<>,;."))

private func runFollowUpTicketRefs(run: AgentRun, workItem: WorkItem?, output: String) -> [String] {
    var values = [
        run.promptSnapshot,
        output
    ]
    if let workItem {
        values.append(workItem.title)
        values.append(workItem.description)
        if let jiraKey = workItem.jira?.key {
            values.append(jiraKey)
        }
        values.append(contentsOf: workItem.sourceRefs.flatMap { [$0.label, $0.uri ?? ""] })
        values.append(contentsOf: workItem.externalRefs.flatMap { [$0.label, $0.uri ?? ""] })
    }

    let refs = values.flatMap(runFollowUpTicketRefs(in:))
    return dedupedFollowUpCommands(refs).prefix(6).map { $0 }
}

private func runFollowUpTicketRefs(in value: String) -> [String] {
    let text = value.gitTrimmed
    guard !text.isEmpty,
          let regex = try? NSRegularExpression(pattern: #"\b[A-Z][A-Z0-9]{1,12}-[0-9]{1,8}\b"#) else {
        return []
    }
    let range = NSRange(text.startIndex..<text.endIndex, in: text)
    return regex.matches(in: text, range: range).compactMap { match in
        guard let range = Range(match.range, in: text) else { return nil }
        return String(text[range])
    }
}

private func runFollowUpSkillRefs(run: AgentRun, output: String) -> [String] {
    let values = [
        run.promptSnapshot,
        output
    ]
    let refs = values.flatMap(runFollowUpSkillRefs(in:))
    return dedupedFollowUpCommands(refs).prefix(8).map { $0 }
}

private func runFollowUpSkillRefs(in value: String) -> [String] {
    let lines = value
        .split(whereSeparator: \.isNewline)
        .map { String($0).gitTrimmed }
        .filter { !$0.isEmpty }
    var refs: [String] = []

    for line in lines {
        let candidates = runFollowUpBacktickValues(in: line)
            + runFollowUpMarkdownLinkTargets(in: line)
            + line.split(whereSeparator: { $0.isWhitespace || $0.isNewline }).map(String.init)
        for candidate in candidates {
            if let command = runFollowUpSkillSlashCommand(from: candidate) {
                refs.append(command)
            }
            if let path = runFollowUpSkillPath(from: candidate) {
                refs.append(path)
            }
        }
        refs.append(contentsOf: runFollowUpSkillEnvVars(in: line))
    }

    return refs
}

private func runFollowUpSkillSlashCommand(from candidate: String) -> String? {
    let cleaned = candidate
        .gitTrimmed
        .trimmingCharacters(in: runFollowUpSkillRefTrimCharacters)
    guard let first = cleaned.split(whereSeparator: { $0.isWhitespace || $0.isNewline }).first else {
        return nil
    }
    let command = String(first).trimmingCharacters(in: runFollowUpSkillRefTrimCharacters)
    guard command.hasPrefix("/"),
          !command.hasPrefix("//"),
          !command.contains("://"),
          let regex = try? NSRegularExpression(pattern: #"^/[a-z][a-z0-9_-]{1,40}$"#) else {
        return nil
    }
    let range = NSRange(command.startIndex..<command.endIndex, in: command)
    return regex.firstMatch(in: command, range: range) == nil ? nil : command
}

private func runFollowUpSkillPath(from candidate: String) -> String? {
    let value = candidate
        .gitTrimmed
        .trimmingCharacters(in: runFollowUpSkillRefTrimCharacters)
    guard !value.lowercased().hasPrefix("http://"),
          !value.lowercased().hasPrefix("https://"),
          let range = value.range(of: "SKILL.md", options: [.caseInsensitive]) else {
        return nil
    }
    return String(value[..<range.upperBound])
}

private func runFollowUpSkillEnvVars(in value: String) -> [String] {
    guard let regex = try? NSRegularExpression(pattern: #"\b[A-Z][A-Z0-9]+(?:_[A-Z0-9]+)+\b"#) else {
        return []
    }
    let range = NSRange(value.startIndex..<value.endIndex, in: value)
    return regex.matches(in: value, range: range).compactMap { match in
        guard let range = Range(match.range, in: value) else { return nil }
        return String(value[range])
    }
}

private let runFollowUpSkillRefTrimCharacters = CharacterSet.whitespacesAndNewlines
    .union(CharacterSet(charactersIn: "\"'`()[]{}<>,;."))

private func runFollowUpFailureSignals(from output: String) -> [String] {
    let signals = output
        .split(whereSeparator: \.isNewline)
        .compactMap { runFollowUpFailureSignal(from: String($0)) }
    return dedupedFollowUpCommands(signals).prefix(5).map { $0 }
}

private func runFollowUpFailureSignal(from line: String) -> String? {
    let stripped = runFollowUpStrippedListPrefix(line)
    guard !stripped.isEmpty else { return nil }
    let lower = stripped.lowercased()

    let hasFailureSignal = lower.hasPrefix("error:")
        || lower.hasPrefix("fatal:")
        || lower.hasPrefix("exception:")
        || lower.hasPrefix("traceback")
        || lower.contains(" error:")
        || lower.contains(" failed")
        || lower.contains(" failure")
        || lower.contains("timed out")
        || lower.contains("timeout")
        || lower.contains("permission denied")
        || lower.contains("not found")
        || lower.contains("could not ")
        || lower.contains("cannot ")
        || lower.contains("unable to ")
        || lower.contains("exit code ")
        || lower.contains("with code ")
        || lower.contains("exited with code")
        || lower.contains("nonzero exit")
        || lower.contains("assertion failed")

    guard hasFailureSignal else { return nil }
    if lower.contains("0 failed")
        || lower.contains("failed 0")
        || lower.contains("no blocking findings") {
        return nil
    }
    return runFollowUpCompactedEvidenceLine(stripped)
}

private func runFollowUpActionableNotes(from output: String) -> [String] {
    var notes: [String] = []
    var activeSectionLabel: String?

    for rawLine in output.split(whereSeparator: \.isNewline).map(String.init) {
        if let (label, body) = runFollowUpActionableField(from: rawLine) {
            if body.isEmpty {
                activeSectionLabel = label
            } else {
                notes.append("\(label): \(body)")
                activeSectionLabel = nil
            }
            continue
        }

        if let note = runFollowUpActionableLeadPhrase(from: rawLine) {
            notes.append(note)
            activeSectionLabel = nil
            continue
        }

        guard let sectionLabel = activeSectionLabel else { continue }
        let stripped = runFollowUpStrippedHeadingPrefix(runFollowUpStrippedListPrefix(rawLine))
        guard !stripped.isEmpty else { continue }

        if runFollowUpLooksLikeListItem(rawLine) {
            notes.append("\(sectionLabel): \(runFollowUpCompactedEvidenceLine(stripped))")
            continue
        }

        activeSectionLabel = nil
    }

    return dedupedFollowUpCommands(notes).prefix(5).map { $0 }
}

private func runFollowUpActionableField(from line: String) -> (label: String, body: String)? {
    let stripped = runFollowUpStrippedHeadingPrefix(runFollowUpStrippedListPrefix(line))
    guard !stripped.isEmpty else { return nil }

    for separator in [":", "："] {
        guard let range = stripped.range(of: separator) else { continue }
        let field = String(stripped[..<range.lowerBound])
        let body = runFollowUpCompactedEvidenceLine(String(stripped[range.upperBound...]))
        guard let label = runFollowUpActionableLabel(for: field) else { continue }
        return (label, body)
    }

    return nil
}

private func runFollowUpActionableLeadPhrase(from line: String) -> String? {
    let stripped = runFollowUpStrippedHeadingPrefix(runFollowUpStrippedListPrefix(line))
    guard !stripped.isEmpty else { return nil }

    for (prefix, label) in runFollowUpActionableLeadPhrases {
        guard stripped.range(of: prefix, options: [.caseInsensitive, .anchored]) != nil else {
            continue
        }
        let body = runFollowUpCompactedEvidenceLine(String(stripped.dropFirst(prefix.count)))
        guard !body.isEmpty else { continue }
        return "\(label): \(body)"
    }

    return nil
}

private func runFollowUpStrippedHeadingPrefix(_ value: String) -> String {
    var text = value.gitTrimmed
    while text.hasPrefix("#") {
        text = String(text.dropFirst()).gitTrimmed
    }
    return text
}

private func runFollowUpActionableLabel(for value: String) -> String? {
    let normalized = value
        .gitTrimmed
        .lowercased()
        .replacingOccurrences(of: "_", with: " ")
        .replacingOccurrences(of: "-", with: " ")
    switch normalized {
    case "blocker", "blockers", "blocked", "blocking", "blocked by":
        return "Blocker"
    case "risk", "risks", "residual risk", "remaining risk":
        return "Risk"
    case "open question", "open questions", "question", "questions":
        return "Open question"
    case "missing input", "missing inputs", "missing info", "missing information":
        return "Missing input"
    case "next", "next action", "next actions", "next step", "next steps", "next concrete action", "follow up", "followup", "todo", "to do":
        return "Next action"
    case "validation gap", "verification gap", "test gap":
        return "Validation gap"
    default:
        return nil
    }
}

private let runFollowUpActionableLeadPhrases: [(prefix: String, label: String)] = [
    ("Blocked by ", "Blocker"),
    ("Waiting on ", "Blocker"),
    ("Need ", "Next action"),
    ("Needs ", "Next action")
]

private func runFollowUpLooksLikeListItem(_ value: String) -> Bool {
    let text = value.gitTrimmed
    for prefix in ["- ", "* ", "• "] where text.hasPrefix(prefix) {
        return true
    }
    if let dot = text.firstIndex(of: ".") {
        let number = text[..<dot]
        return !number.isEmpty && number.allSatisfy(\.isNumber)
    }
    return false
}

private func runFollowUpFileRefs(from output: String) -> [String] {
    let lines = output
        .split(whereSeparator: \.isNewline)
        .map { String($0).gitTrimmed }
        .filter { !$0.isEmpty }
    var refs: [String] = []

    for line in lines {
        let candidates = runFollowUpFileRefCandidates(from: line)
        for candidate in candidates {
            guard let ref = runFollowUpFileRef(from: candidate) else { continue }
            refs.append(ref)
        }
    }

    return dedupedFollowUpCommands(refs).prefix(6).map { $0 }
}

private func runFollowUpFileRefCandidates(from line: String) -> [String] {
    var candidates = runFollowUpBacktickValues(in: line)
    candidates.append(contentsOf: runFollowUpMarkdownLinkTargets(in: line))
    candidates.append(contentsOf: line.split(whereSeparator: { $0.isWhitespace || $0.isNewline }).map(String.init))
    return candidates
}

private func runFollowUpMarkdownLinkTargets(in value: String) -> [String] {
    var targets: [String] = []
    var remainder = value[...]
    while let marker = remainder.range(of: "](") {
        let start = marker.upperBound
        guard let end = remainder[start...].firstIndex(of: ")") else { break }
        targets.append(String(remainder[start..<end]))
        remainder = remainder[remainder.index(after: end)...]
    }
    return targets
}

private func runFollowUpFileRef(from candidate: String) -> String? {
    var value = candidate
        .gitTrimmed
        .trimmingCharacters(in: runFollowUpFileRefTrimCharacters)
    if value.hasPrefix("file://") {
        value = String(value.dropFirst("file://".count))
    }
    let lower = value.lowercased()
    guard !value.isEmpty,
          !lower.hasPrefix("http://"),
          !lower.hasPrefix("https://"),
          !lower.contains("://") else {
        return nil
    }

    for fileExtension in runFollowUpFileRefExtensions {
        guard let extensionRange = value.range(of: fileExtension, options: [.caseInsensitive, .backwards]) else {
            continue
        }
        let suffix = value[extensionRange.upperBound...]
        let base = String(value[..<extensionRange.upperBound])
        if suffix.isEmpty {
            return base
        }
        if suffix.hasPrefix(":") {
            let line = suffix.dropFirst().prefix { $0.isNumber }
            if !line.isEmpty {
                return "\(base):\(line)"
            }
        }
        if suffix.hasPrefix("#") || suffix.hasPrefix("?") {
            return base
        }
    }
    return nil
}

private let runFollowUpFileRefTrimCharacters = CharacterSet.whitespacesAndNewlines
    .union(CharacterSet(charactersIn: "\"'`()[]{}<>,;"))

private let runFollowUpFileRefExtensions = [
    ".swift", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
    ".py", ".kt", ".java", ".go", ".rs", ".rb", ".sh",
    ".md", ".json", ".yaml", ".yml", ".toml", ".xml",
    ".html", ".css", ".scss"
]

private func runFollowUpValidationEvidence(from output: String) -> [String] {
    var evidence: [String] = []
    let lines = output
        .split(whereSeparator: \.isNewline)
        .map { String($0).gitTrimmed }
        .filter { !$0.isEmpty }

    for line in lines {
        guard let command = runFollowUpValidationCommand(from: line) else { continue }
        let result = runFollowUpValidationResult(from: line)
        let suffix = result.map { " (\($0))" } ?? ""
        evidence.append("\(command)\(suffix)")
    }

    if evidence.isEmpty,
       let resultLine = lines.first(where: runFollowUpLooksLikeValidationResult(_:)) {
        evidence.append(runFollowUpCompactedEvidenceLine(resultLine))
    }

    return dedupedFollowUpCommands(evidence).prefix(4).map { $0 }
}

private func runFollowUpValidationCommand(from line: String) -> String? {
    let stripped = runFollowUpStrippedListPrefix(line)
    if runFollowUpNextCommandBody(from: stripped) != nil,
       runFollowUpValidationResult(from: stripped) == nil {
        return nil
    }
    for candidate in runFollowUpBacktickValues(in: stripped) {
        if let command = runFollowUpValidationCommandValue(candidate) {
            return command
        }
    }
    return runFollowUpValidationCommandValue(stripped)
}

private func runFollowUpValidationCommandValue(_ value: String) -> String? {
    let cleaned = value
        .gitTrimmed
        .trimmingCharacters(in: CharacterSet(charactersIn: "\"'"))
    for prefix in runFollowUpValidationCommandPrefixes {
        guard let range = cleaned.range(of: prefix, options: .caseInsensitive) else { continue }
        let command = String(cleaned[range.lowerBound...])
        return runFollowUpTrimmedValidationCommand(command)
    }
    return nil
}

private func runFollowUpTrimmedValidationCommand(_ value: String) -> String? {
    var command = value.gitTrimmed
    let lower = command.lowercased()
    let resultMarkers = [
        " passed", " pass", " succeeded", " success", " failed", " failure",
        " errored", " timed out", " timeout", " ✅", " ❌"
    ]
    for marker in resultMarkers {
        guard let range = lower.range(of: marker) else { continue }
        command = String(command[..<range.lowerBound]).gitTrimmed
        break
    }
    command = command.trimmingCharacters(in: CharacterSet(charactersIn: "`.,;"))
    return command.isEmpty ? nil : command
}

private func runFollowUpBacktickValues(in value: String) -> [String] {
    var values: [String] = []
    var remainder = value[...]
    while let start = remainder.firstIndex(of: "`") {
        let afterStart = remainder.index(after: start)
        guard let end = remainder[afterStart...].firstIndex(of: "`") else { break }
        values.append(String(remainder[afterStart..<end]))
        remainder = remainder[remainder.index(after: end)...]
    }
    return values
}

private func runFollowUpStrippedListPrefix(_ value: String) -> String {
    var text = value.gitTrimmed
    let prefixes = ["- ", "* ", "• ", "$ ", "> ", "❯ "]
    var stripped = true
    while stripped {
        stripped = false
        for prefix in prefixes where text.hasPrefix(prefix) {
            text = String(text.dropFirst(prefix.count)).gitTrimmed
            stripped = true
        }
        if let dot = text.firstIndex(of: ".") {
            let number = text[..<dot]
            if !number.isEmpty,
               number.allSatisfy(\.isNumber) {
                text = String(text[text.index(after: dot)...]).gitTrimmed
                stripped = true
            }
        }
    }
    return text
}

private func runFollowUpValidationResult(from line: String) -> String? {
    let lower = line.lowercased()
    if lower.contains("failed")
        || lower.contains("failure")
        || lower.contains("errored")
        || lower.contains("timed out")
        || lower.contains("timeout")
        || lower.contains("❌") {
        return "failed"
    }
    if lower.contains("passed")
        || lower.contains("succeeded")
        || lower.contains("success")
        || lower.contains("build complete")
        || lower.contains("✅") {
        return "passed"
    }
    return nil
}

private func runFollowUpLooksLikeValidationResult(_ line: String) -> Bool {
    let lower = line.lowercased()
    guard lower.contains("validation")
        || lower.contains("test")
        || lower.contains("build")
        || lower.contains("check") else {
        return false
    }
    return runFollowUpValidationResult(from: line) != nil
}

private func runFollowUpCompactedEvidenceLine(_ value: String) -> String {
    let compacted = value.gitTrimmed.replacingOccurrences(of: "\n", with: " ")
    let maxLength = 160
    return compacted.count > maxLength ? "\(compacted.prefix(maxLength))..." : compacted
}

private let runFollowUpValidationCommandPrefixes = [
    "swift test",
    "swift build",
    "xcodebuild",
    "npm test",
    "npm run",
    "npx vitest",
    "pnpm test",
    "bun test",
    "pytest",
    "uv run",
    "git diff --check",
    "go test",
    "cargo test"
]

private func runFollowUpNextCommands(run: AgentRun, output: String) -> [String] {
    let lines = output
        .split(whereSeparator: \.isNewline)
        .map { String($0).gitTrimmed }
        .filter { !$0.isEmpty }
    let validationCommands = Set(lines.compactMap(runFollowUpValidationCommand(from:)))
    let logCommands = Set(runFollowUpSuggestedLogCommands(run: run, output: output))
    var commands: [String] = []

    for line in lines {
        guard let command = runFollowUpNextCommand(from: line),
              !validationCommands.contains(command),
              !logCommands.contains(command),
              !runFollowUpIsLogSkillCommand(command) else {
            continue
        }
        commands.append(command)
    }

    return dedupedFollowUpCommands(commands).prefix(4).map { $0 }
}

private func runFollowUpNextCommand(from line: String) -> String? {
    let stripped = runFollowUpStrippedHeadingPrefix(runFollowUpStrippedListPrefix(line))
    let body: String?
    if let labeled = runFollowUpNextCommandBody(from: stripped) {
        body = labeled
    } else if line.gitTrimmed.hasPrefix("$ ") || line.gitTrimmed.hasPrefix("❯ ") {
        body = String(line.gitTrimmed.dropFirst(2))
    } else {
        body = nil
    }
    guard let body else { return nil }

    let candidates = runFollowUpBacktickValues(in: body) + [body]
    for candidate in candidates {
        guard let command = runFollowUpNextCommandValue(candidate) else { continue }
        return command
    }
    return nil
}

private func runFollowUpNextCommandBody(from line: String) -> String? {
    let stripped = runFollowUpStrippedHeadingPrefix(runFollowUpStrippedListPrefix(line))
    for separator in [":", "："] {
        guard let range = stripped.range(of: separator) else { continue }
        let field = String(stripped[..<range.lowerBound])
        guard runFollowUpNextCommandLabel(for: field) != nil else { continue }
        let body = String(stripped[range.upperBound...]).gitTrimmed
        return body.isEmpty ? nil : body
    }
    return nil
}

private func runFollowUpNextCommandLabel(for value: String) -> String? {
    let normalized = value
        .gitTrimmed
        .lowercased()
        .replacingOccurrences(of: "_", with: " ")
        .replacingOccurrences(of: "-", with: " ")
        .replacingOccurrences(of: "  ", with: " ")
    switch normalized {
    case "command", "cmd", "next command", "next cmd", "suggested command", "suggested cmd",
         "run", "try", "retry", "rerun", "re run", "fallback command", "lookup command",
         "repro command", "reproduce command", "smoke command", "manual command":
        return "Command"
    default:
        return nil
    }
}

private func runFollowUpNextCommandValue(_ value: String) -> String? {
    var command = value
        .gitTrimmed
        .trimmingCharacters(in: CharacterSet(charactersIn: "\"'`"))
    while let scalar = command.unicodeScalars.last,
          runFollowUpNextCommandTrailingCharacters.contains(scalar) {
        command = String(command.dropLast()).gitTrimmed
    }
    guard !command.isEmpty,
          runFollowUpLooksLikeShellCommand(command) else {
        return nil
    }
    return command
}

private func runFollowUpLooksLikeShellCommand(_ command: String) -> Bool {
    guard let executable = runFollowUpCommandExecutableToken(command) else {
        return false
    }
    if executable.hasPrefix("./") || executable.hasPrefix("../") {
        return true
    }
    return runFollowUpCommandExecutables.contains(executable.lowercased())
}

private func runFollowUpCommandExecutableToken(_ command: String) -> String? {
    for token in command.split(whereSeparator: { $0.isWhitespace || $0.isNewline }) {
        let value = String(token).trimmingCharacters(in: CharacterSet(charactersIn: ";"))
        guard !value.isEmpty else { continue }
        if runFollowUpLooksLikeEnvironmentAssignment(value) {
            continue
        }
        return value
    }
    return nil
}

private func runFollowUpLooksLikeEnvironmentAssignment(_ value: String) -> Bool {
    guard let equals = value.firstIndex(of: "=") else { return false }
    let key = value[..<equals]
    guard !key.isEmpty else { return false }
    return key.allSatisfy { character in
        character == "_" || character.isLetter || character.isNumber
    }
}

private func runFollowUpIsLogSkillCommand(_ command: String) -> Bool {
    let lower = command.lowercased()
    return lower.hasPrefix("/logtrace") || lower.hasPrefix("/clickhouse")
}

private let runFollowUpNextCommandTrailingCharacters = CharacterSet(charactersIn: ".,;)]}")

private let runFollowUpCommandExecutables: Set<String> = [
    "cd", "codex", "claude", "curl", "git", "gh", "glab", "grep", "jira",
    "just", "make", "mycr", "node", "npm", "npx", "pnpm", "python",
    "python3", "pytest", "rg", "swift", "uv", "xcodebuild", "yarn",
    "bun"
]

private func runFollowUpSuggestedLogCommands(run: AgentRun, output: String) -> [String] {
    let combined = "\(run.promptSnapshot)\n\(output)"
    guard followUpContainsLogSignal(run: run, output: output) else { return [] }

    var commands: [String] = []
    if let argument = runFollowUpLogTraceArgument(from: combined) {
        let command = composerLogTraceDraft(
            command: "/logtrace env=lab conversationId= last=24h",
            argument: argument,
            existingArguments: combined,
            envOverride: composerLogTraceEnvOverride(from: combined),
            lastOverride: composerLogTraceLastOverride(from: combined)
        )
        commands.append(command)
    }

    if let clickHouseCommand = runFollowUpClickHouseCommand(from: combined) {
        commands.append(clickHouseCommand)
    }

    return dedupedFollowUpCommands(commands).prefix(3).map { $0 }
}

private func runFollowUpLogTraceArgument(from value: String) -> String? {
    if let explicit = composerExplicitLogTraceArgument(from: value) {
        return explicit
    }
    if let traceParent = composerBareLogTraceTraceParentArgument(from: value) {
        return traceParent
    }
    for token in value.split(whereSeparator: { $0.isWhitespace || $0.isNewline }) {
        let sanitized = composerSanitizedSkillValue(String(token))
        guard !sanitized.isEmpty else { continue }
        if sanitized.lowercased().hasPrefix("p-v-") {
            return "conversationId=\(sanitized)"
        }
        if sanitized.contains("-"),
           composerLooksLikeTraceId(sanitized.replacingOccurrences(of: "-", with: "")) {
            return "conversationId=\(sanitized)"
        }
    }
    return nil
}

private func runFollowUpClickHouseCommand(from value: String) -> String? {
    let limitOverride = composerClickHouseLimitOverride(from: value)
    if let task = composerClickHouseTraceTask(from: value, limitOverride: limitOverride) {
        return "/clickhouse \(task)"
    }
    let limit = limitOverride ?? "limit=20"
    if let lookup = composerExplicitClickHouseLookup(from: value, limit: limit) {
        return "/clickhouse \(lookup)"
    }
    if let lookup = composerBareClickHouseLookup(from: value, limit: limit) {
        return "/clickhouse \(lookup)"
    }
    return nil
}

private func dedupedFollowUpCommands(_ commands: [String]) -> [String] {
    var seen = Set<String>()
    var out: [String] = []
    for command in commands {
        let trimmed = command.gitTrimmed
        guard !trimmed.isEmpty, !seen.contains(trimmed) else { continue }
        seen.insert(trimmed)
        out.append(trimmed)
    }
    return out
}

private func nonEmptyFollowUpText(_ value: String) -> String? {
    let trimmed = value.gitTrimmed
    return trimmed.isEmpty ? nil : trimmed
}

private func runFollowUpRefsContextLine(title: String, refs: [SourceRef]) -> String? {
    let values = refs
        .compactMap(runFollowUpRefContextValue(_:))
        .prefix(4)
        .joined(separator: "; ")
    guard !values.isEmpty else { return nil }
    return "- \(title): \(values)"
}

private func runFollowUpRefContextValue(_ ref: SourceRef) -> String? {
    let kind = ref.kind.gitTrimmed
    let label = ref.label.gitTrimmed
    let uri = ref.uri?.gitTrimmed ?? ""
    var value = label.isEmpty ? kind : label
    if value.isEmpty {
        value = uri
    } else if !kind.isEmpty, kind.localizedCaseInsensitiveCompare(label) != .orderedSame {
        value = "\(kind): \(value)"
    }
    if !uri.isEmpty, uri != value {
        value += " (\(uri))"
    }
    return value.isEmpty ? nil : value
}

func chatCanCaptureEvidence(run: AgentRun?, assistantText: String) -> Bool {
    guard let run else { return false }
    switch run.state {
    case .queued, .starting, .running, .cancelling, .draft:
        return false
    case .waitingForUser, .completed, .failed, .cancelled, .stale:
        let output = friendlyAgentOutput(assistantText).trimmingCharacters(in: .whitespacesAndNewlines)
        guard !output.isEmpty && output != "No assistant output yet." else {
            return false
        }
        return runFollowUpShouldOfferWorkflowActions(
            run: run,
            workItem: nil,
            output: output
        )
    }
}

private func outputContainsFailureSignal(_ output: String) -> Bool {
    let lower = output.lowercased()
    return lower.contains("failed")
        || lower.contains("failure")
        || lower.contains("error")
        || lower.contains("exception")
        || lower.contains("timed out")
        || lower.contains("timeout")
}

private func followUpContainsLogSignal(run: AgentRun, output: String) -> Bool {
    let combined = "\(run.promptSnapshot)\n\(output)"
    let lower = combined.lowercased()
    let markers = [
        "/logtrace", "logtrace", "/clickhouse", "clickhouse",
        "conversationid", "conversation id",
        "sessionid", "session id",
        "traceid", "trace id",
        "traceparent", "trace parent",
        "requestid", "request id",
        "taskid", "task id",
        "p-v-"
    ]
    if markers.contains(where: { lower.contains($0) }) {
        return true
    }
    return combined
        .split(whereSeparator: { $0.isWhitespace || $0.isNewline })
        .map { composerSanitizedSkillValue(String($0)) }
        .contains { token in
            composerLooksLikeTraceId(token)
                || composerTraceIdFromTraceParentToken(token) != nil
        }
}

private func followUpContainsSkillSignal(run: AgentRun, output: String) -> Bool {
    let combined = "\(run.promptSnapshot)\n\(output)".lowercased()
    let markers = [
        ".pikiclaw/skills",
        "skill.md",
        "/sk_",
        "/logtrace",
        "iva-logtracer",
        "/clickhouse",
        "chsql",
        "skill failed",
        "skill failure",
        "skill error",
        "skill invocation",
        "skill command",
        "skill hardening"
    ]
    return markers.contains { combined.contains($0) }
}

private func followUpContainsJiraSignal(run: AgentRun, output: String) -> Bool {
    let combined = "\(run.promptSnapshot)\n\(output)"
    let lower = combined.lowercased()
    if lower.contains("jira") || lower.contains("atlassian") {
        return true
    }
    return combined.range(
        of: #"\b[A-Z][A-Z0-9]+-\d{2,}\b"#,
        options: .regularExpression
    ) != nil
}

private struct ConversationMessageBubble: View {
    let title: String
    let subtitle: String
    let text: String
    let createdAt: Date?
    let symbol: String
    let accent: Color
    var trailing = false
    var onRerun: (() -> Void)?

    @State private var copied = false

    var body: some View {
        HStack(alignment: .top) {
            if trailing { Spacer(minLength: 72) }
            VStack(alignment: trailing ? .trailing : .leading, spacing: 8) {
                HStack(spacing: 8) {
                    if !trailing { avatar }
                    VStack(alignment: trailing ? .trailing : .leading, spacing: 2) {
                        Text(title)
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundStyle(PKTheme.text)
                        Text(subtitle)
                            .font(.caption2)
                            .foregroundStyle(PKTheme.text3)
                    }
                    if trailing { avatar }
                }

                Text(text.isEmpty ? "..." : text)
                    .font(.system(size: 14))
                    .lineSpacing(3)
                    .foregroundStyle(PKTheme.text2)
                    .textSelection(.enabled)
                    .multilineTextAlignment(trailing ? .trailing : .leading)
                    .padding(13)
                    .background(trailing ? accent.opacity(0.14) : PKTheme.panelAlt.opacity(0.52))
                    .overlay(RoundedRectangle(cornerRadius: 8).stroke(trailing ? accent.opacity(0.28) : PKTheme.edge, lineWidth: 1))
                    .clipShape(RoundedRectangle(cornerRadius: 8))

                MessageActionRow(
                    createdAt: createdAt,
                    copied: copied,
                    alignTrailing: trailing,
                    canRerun: onRerun != nil,
                    onCopy: {
                        copyTextToPasteboard(text)
                        copied = true
                        Task { @MainActor in
                            try? await Task.sleep(nanoseconds: 1_300_000_000)
                            copied = false
                        }
                    },
                    onRerun: onRerun
                )
            }
            .frame(maxWidth: 680, alignment: trailing ? .trailing : .leading)
            if !trailing { Spacer(minLength: 72) }
        }
    }

    private var avatar: some View {
        Image(systemName: symbol)
            .font(.system(size: 13, weight: .semibold))
            .foregroundStyle(PKTheme.primaryText)
            .frame(width: 28, height: 28)
            .background(accent)
            .clipShape(RoundedRectangle(cornerRadius: 7))
    }
}

private struct MessageActionRow: View {
    let createdAt: Date?
    let copied: Bool
    let alignTrailing: Bool
    let canRerun: Bool
    let onCopy: () -> Void
    let onRerun: (() -> Void)?
    var onSaveEvidence: (() -> Void)? = nil

    var body: some View {
        HStack(spacing: 8) {
            if alignTrailing { Spacer(minLength: 0) }

            if let createdAt {
                Text(createdAt.formatted(date: .abbreviated, time: .shortened))
                    .font(.system(size: 10, weight: .medium))
                    .foregroundStyle(PKTheme.text4)
            }

            MessageActionButton(
                systemImage: copied ? "checkmark" : "doc.on.doc",
                help: copied ? "Copied" : "Copy",
                action: onCopy
            )

            if let onSaveEvidence {
                MessageActionButton(
                    systemImage: "archivebox.fill",
                    help: "Save output as evidence",
                    action: onSaveEvidence
                )
            }

            if canRerun {
                MessageActionButton(
                    systemImage: "arrow.clockwise",
                    help: "Re-run",
                    action: { onRerun?() }
                )
            }

            if !alignTrailing { Spacer(minLength: 0) }
        }
        .frame(maxWidth: .infinity, alignment: alignTrailing ? .trailing : .leading)
    }
}

private struct MessageActionButton: View {
    let systemImage: String
    let help: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: systemImage)
                .font(.system(size: 10.5, weight: .semibold))
                .foregroundStyle(PKTheme.text3)
                .frame(width: 24, height: 22)
                .background(PKTheme.control.opacity(0.52))
                .overlay(RoundedRectangle(cornerRadius: 6).stroke(PKTheme.controlBorder.opacity(0.75), lineWidth: 1))
                .clipShape(RoundedRectangle(cornerRadius: 6))
        }
        .buttonStyle(.plain)
        .help(help)
    }
}

private struct AgentOutputReviewStrip: View {
    let presentation: AgentResponsePresentation
    let followUpCount: Int
    let canSaveEvidence: Bool
    let accent: Color

    private var finalText: String {
        presentation.finalText
    }

    private var signalSummary: AgentOutputReviewSignalSummary {
        agentOutputReviewSignalSummary(finalText)
    }

    private var reviewColor: Color {
        if presentation.isActive { return PKTheme.warn }
        if signalSummary.hasDecisionOrAction { return PKTheme.warn }
        if canSaveEvidence { return PKTheme.ok }
        if finalText.isEmpty { return PKTheme.text3 }
        return accent
    }

    private var reviewTitle: String {
        if presentation.isActive { return "Output running" }
        if signalSummary.hasDecisionOrAction { return "Actionable output" }
        if canSaveEvidence { return "Evidence ready" }
        if finalText.isEmpty { return "No reusable output yet" }
        return "Output review"
    }

    private var reviewSubtitle: String {
        if presentation.isActive { return "Watch activity before saving or following up." }
        if signalSummary.hasDecisionOrAction { return "Use decisions, blockers, and next actions to continue." }
        if canSaveEvidence { return "Save this result to the work item when it is useful." }
        if finalText.isEmpty { return "Wait for a final response before capture." }
        return "Use follow-up actions or copy the cleaned result."
    }

    private var statusText: String {
        if signalSummary.hasDecisionOrAction { return "ACTION" }
        if canSaveEvidence { return "CAPTURE" }
        if followUpCount > 0 { return "\(followUpCount) NEXT" }
        return presentation.phaseTitle.uppercased()
    }

    var body: some View {
        HStack(spacing: 9) {
            Image(systemName: canSaveEvidence ? "archivebox.fill" : "doc.text.magnifyingglass")
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(PKTheme.primaryText)
                .frame(width: 26, height: 26)
                .background(reviewColor)
                .clipShape(RoundedRectangle(cornerRadius: 7))

            VStack(alignment: .leading, spacing: 1) {
                Text(reviewTitle)
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(PKTheme.text2)
                Text(reviewSubtitle)
                    .font(.system(size: 10.5, weight: .medium))
                    .foregroundStyle(PKTheme.text4)
                    .lineLimit(1)
            }

            Spacer(minLength: 0)

            StatusPill(text: statusText, color: reviewColor)
        }
        .padding(10)
        .background(PKTheme.inset.opacity(0.58))
        .overlay(RoundedRectangle(cornerRadius: 8).stroke(reviewColor.opacity(0.22), lineWidth: 1))
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }
}

struct AgentOutputReviewSignalSummary: Equatable {
    let validationSignalCount: Int
    let codeReferenceCount: Int
    let decisionSignalCount: Int
    let actionableNoteCount: Int

    var hasDecisionOrAction: Bool {
        decisionSignalCount > 0 || actionableNoteCount > 0
    }
}

func agentOutputReviewSignalSummary(_ text: String) -> AgentOutputReviewSignalSummary {
    let outputLines = text
        .components(separatedBy: .newlines)
        .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
        .filter { !$0.isEmpty }
    let validationSignalCount = outputLines.filter { line in
        let lower = line.lowercased()
        return lower.contains("test")
            || lower.contains("build")
            || lower.contains("passed")
            || lower.contains("failed")
            || lower.contains("验证")
            || lower.contains("构建")
    }.count
    let codeReferenceCount = outputLines.filter { line in
        let lower = line.lowercased()
        return lower.contains(".swift")
            || lower.contains(".ts")
            || lower.contains(".tsx")
            || lower.contains(".js")
            || lower.contains(".json")
            || lower.contains("/")
    }.count
    return AgentOutputReviewSignalSummary(
        validationSignalCount: validationSignalCount,
        codeReferenceCount: codeReferenceCount,
        decisionSignalCount: runFollowUpDecisionSignals(from: text).count,
        actionableNoteCount: runFollowUpActionableNotes(from: text).count
    )
}

private struct AssistantResponseCard: View {
    let title: String
    let text: String
    let createdAt: Date?
    let state: RunState?
    let isRunning: Bool
    let accent: Color
    var followUpActions: [RunFollowUpAction] = []
    var onRerun: (() -> Void)?
    var onFollowUp: ((RunFollowUpAction) -> Void)?
    var onFollowUpSideChat: ((RunFollowUpAction) -> Void)?
    var onSaveEvidence: (() -> Void)?

    @State private var copied = false

    private var cleanedText: String {
        friendlyAgentOutput(text)
    }

    private var presentation: AgentResponsePresentation {
        AgentResponsePresentation(text: cleanedText, state: state, isRunning: isRunning)
    }

    private var showsOutputReview: Bool {
        !presentation.isActive
            && presentation.showsFinalResponse
            && (onSaveEvidence != nil || !followUpActions.isEmpty)
    }

    var body: some View {
        HStack(alignment: .top) {
            VStack(alignment: .leading, spacing: 12) {
                HStack(spacing: 9) {
                    Image(systemName: "sparkles")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(PKTheme.primaryText)
                        .frame(width: 30, height: 30)
                        .background(accent)
                        .clipShape(RoundedRectangle(cornerRadius: 7))
                    VStack(alignment: .leading, spacing: 2) {
                        Text(title)
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(PKTheme.text)
                        Text(agentOutputSubtitle(state: state, isRunning: isRunning))
                            .font(.caption2)
                            .foregroundStyle(PKTheme.text3)
                    }
                    Spacer()
                    StatusPill(text: state?.rawValue ?? "starting", color: runStateColor(state))
                }

                if presentation.showsFinalResponse {
                    Text(presentation.finalText)
                        .font(.system(size: 13))
                        .lineSpacing(4)
                        .foregroundStyle(PKTheme.text2)
                        .textSelection(.enabled)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(14)
                        .background(PKTheme.inset.opacity(0.78))
                        .overlay(RoundedRectangle(cornerRadius: 8).stroke(PKTheme.edge, lineWidth: 1))
                        .clipShape(RoundedRectangle(cornerRadius: 8))
                }

                if !presentation.activityItems.isEmpty {
                    AgentActivityTimeline(
                        items: presentation.activityItems,
                        accent: accent,
                        startsExpanded: !presentation.showsFinalResponse
                    )
                } else if !presentation.showsFinalResponse {
                    AgentExecutionProgressCard(
                        presentation: presentation,
                        accent: accent
                    )
                }

                if showsOutputReview {
                    AgentOutputReviewStrip(
                        presentation: presentation,
                        followUpCount: followUpActions.count,
                        canSaveEvidence: onSaveEvidence != nil,
                        accent: accent
                    )
                }

                if presentation.activityItems.isEmpty && !presentation.generativeItems.isEmpty {
                    GenerativeUIRail(items: presentation.generativeItems, accent: accent)
                }

                if !followUpActions.isEmpty, let onFollowUp {
                    RunFollowUpActionRow(
                        actions: followUpActions,
                        accent: accent,
                        select: onFollowUp,
                        startSideChat: onFollowUpSideChat
                    )
                }

                MessageActionRow(
                    createdAt: createdAt,
                    copied: copied,
                    alignTrailing: false,
                    canRerun: onRerun != nil,
                    onCopy: {
                        copyTextToPasteboard(cleanedText.isEmpty ? text : cleanedText)
                        copied = true
                        Task { @MainActor in
                            try? await Task.sleep(nanoseconds: 1_300_000_000)
                            copied = false
                        }
                    },
                    onRerun: onRerun,
                    onSaveEvidence: onSaveEvidence
                )
            }
            .frame(maxWidth: 760, alignment: .leading)
            .padding(14)
            .background(PKTheme.panelAlt.opacity(0.42))
            .overlay(RoundedRectangle(cornerRadius: 8).stroke(accent.opacity(0.18), lineWidth: 1))
            .clipShape(RoundedRectangle(cornerRadius: 8))

            Spacer(minLength: 72)
        }
    }
}

private struct RunFollowUpActionRow: View {
    let actions: [RunFollowUpAction]
    let accent: Color
    let select: (RunFollowUpAction) -> Void
    var startSideChat: ((RunFollowUpAction) -> Void)?

    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            HStack(spacing: 7) {
                Text("NEXT ACTIONS")
                    .font(.system(size: 9, weight: .heavy))
                    .foregroundStyle(PKTheme.text4)
                CountBadge(value: actions.count)
                Spacer()
            }

            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(actions) { action in
                        HStack(spacing: 0) {
                            Button {
                                select(action)
                            } label: {
                                HStack(spacing: 8) {
                                    Image(systemName: action.symbol)
                                        .font(.system(size: 11, weight: .bold))
                                        .frame(width: 14)
                                    VStack(alignment: .leading, spacing: 1) {
                                        Text(action.title)
                                            .font(.system(size: 11.5, weight: .semibold))
                                            .foregroundStyle(accent)
                                            .lineLimit(1)
                                        Text(action.detail)
                                            .font(.system(size: 8.5, weight: .bold))
                                            .foregroundStyle(accent.opacity(0.68))
                                            .lineLimit(1)
                                            .minimumScaleFactor(0.78)
                                    }
                                }
                                .padding(.leading, 10)
                                .padding(.trailing, startSideChat == nil ? 10 : 8)
                                .frame(height: 38)
                            }
                            .buttonStyle(.plain)
                            .help("\(action.title): \(action.detail)")

                            if let startSideChat {
                                Rectangle()
                                    .fill(accent.opacity(0.20))
                                    .frame(width: 1, height: 22)
                                Button {
                                    startSideChat(action)
                                } label: {
                                    Image(systemName: "rectangle.split.2x1")
                                        .font(.system(size: 10.5, weight: .bold))
                                        .frame(width: 30, height: 38)
                                }
                                .buttonStyle(.plain)
                                .help("Start \(action.title) as side chat")
                            }
                        }
                        .foregroundStyle(accent)
                        .background(accent.opacity(0.11))
                        .overlay(RoundedRectangle(cornerRadius: 7).stroke(accent.opacity(0.24), lineWidth: 1))
                        .clipShape(RoundedRectangle(cornerRadius: 7))
                    }
                }
                .padding(.vertical, 1)
            }
        }
    }
}

private struct AgentResponsePresentation {
    let text: String
    let state: RunState?
    let isRunning: Bool

    private var lines: [String] {
        text
            .components(separatedBy: .newlines)
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
    }

    var isActive: Bool {
        if isRunning { return true }
        switch state {
        case .queued, .starting, .running, .cancelling:
            return true
        default:
            return false
        }
    }

    var showsFinalResponse: Bool {
        !isActive && !finalText.isEmpty
    }

    var finalText: String {
        lines
            .filter { line in
                !line.hasPrefix("Thinking:")
                    && !line.hasPrefix("Tool:")
                    && !line.hasPrefix("Tool result:")
                    && !line.hasPrefix("Artifact:")
                    && !line.hasPrefix("File:")
                    && !line.hasPrefix("Files:")
                    && !line.hasPrefix("Completed exit code")
            }
            .joined(separator: "\n")
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    var thinkingText: String {
        lines
            .filter { $0.hasPrefix("Thinking:") }
            .map { $0.replacingOccurrences(of: "Thinking:", with: "").trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
            .suffix(2)
            .joined(separator: "\n")
    }

    var generativeItems: [GenerativeUIItem] {
        lines.compactMap { line in
            if line.hasPrefix("Tool result:") {
                return GenerativeUIItem(symbol: "checkmark.circle", title: "Tool result", detail: line.replacingOccurrences(of: "Tool result:", with: "").trimmingCharacters(in: .whitespacesAndNewlines))
            }
            if line.hasPrefix("Tool:") {
                return GenerativeUIItem(symbol: "wrench.and.screwdriver", title: "Tool", detail: line.replacingOccurrences(of: "Tool:", with: "").trimmingCharacters(in: .whitespacesAndNewlines))
            }
            if line.hasPrefix("Artifact:") {
                return GenerativeUIItem(symbol: "shippingbox", title: "Artifact", detail: line.replacingOccurrences(of: "Artifact:", with: "").trimmingCharacters(in: .whitespacesAndNewlines))
            }
            if line.hasPrefix("File:") || line.hasPrefix("Files:") {
                let parts = line.split(separator: ":", maxSplits: 1).map(String.init)
                return GenerativeUIItem(symbol: "doc.text", title: parts.first ?? "File", detail: parts.dropFirst().first?.trimmingCharacters(in: .whitespacesAndNewlines) ?? line)
            }
            return nil
        }
        .suffix(4)
    }

    var activityItems: [AgentActivityItem] {
        lines.compactMap { line in
            if line.hasPrefix("Thinking:") {
                let detail = line.replacingOccurrences(of: "Thinking:", with: "").trimmingCharacters(in: .whitespacesAndNewlines)
                return detail.isEmpty ? nil : AgentActivityItem(symbol: "brain.head.profile", title: "Thinking", detail: detail)
            }
            if line.hasPrefix("Tool result:") {
                let detail = line.replacingOccurrences(of: "Tool result:", with: "").trimmingCharacters(in: .whitespacesAndNewlines)
                return AgentActivityItem(symbol: "checkmark.circle", title: "Ran a command", detail: detail)
            }
            if line.hasPrefix("Tool:") {
                let detail = line.replacingOccurrences(of: "Tool:", with: "").trimmingCharacters(in: .whitespacesAndNewlines)
                return AgentActivityItem(symbol: "terminal", title: "Running tool", detail: detail)
            }
            if line.hasPrefix("Artifact:") {
                let detail = line.replacingOccurrences(of: "Artifact:", with: "").trimmingCharacters(in: .whitespacesAndNewlines)
                return AgentActivityItem(symbol: "shippingbox", title: "Created artifact", detail: detail)
            }
            if line.hasPrefix("File:") || line.hasPrefix("Files:") {
                let parts = line.split(separator: ":", maxSplits: 1).map(String.init)
                return AgentActivityItem(
                    symbol: "square.and.pencil",
                    title: parts.first == "Files" ? "Edited files" : "Edited a file",
                    detail: parts.dropFirst().first?.trimmingCharacters(in: .whitespacesAndNewlines) ?? line
                )
            }
            return nil
        }
    }

    var progress: Double {
        switch state {
        case .queued: return 0.18
        case .starting: return 0.34
        case .running: return 0.62
        case .waitingForUser: return 0.82
        case .cancelling: return 0.90
        case .completed: return 1.0
        case .failed, .cancelled, .stale: return 1.0
        case .draft, .none: return text.isEmpty ? 0.08 : 0.20
        }
    }

    var phaseTitle: String {
        switch state {
        case .queued: return "Queued"
        case .starting: return "Starting agent"
        case .running: return "Thinking"
        case .waitingForUser: return "Waiting for input"
        case .cancelling: return "Cancelling"
        case .completed: return finalText.isEmpty ? "Completed without message" : "Ready"
        case .failed: return "Run failed"
        case .cancelled: return "Cancelled"
        case .stale: return "Stale"
        case .draft, .none: return "Preparing"
        }
    }

    var phaseDetail: String {
        if !thinkingText.isEmpty {
            return thinkingText
        }
        switch state {
        case .queued: return "Waiting for the runner to accept the request."
        case .starting: return "Preparing workspace, model, tools, and execution context."
        case .running: return "The agent is working. The final answer will appear as one complete message."
        case .waitingForUser: return "The agent needs your input before it can continue."
        case .cancelling: return "Stopping the active run."
        case .failed: return finalText.isEmpty ? "The run ended before producing a final response." : "Review the final response and run details."
        default: return text.isEmpty ? "No response text has been emitted yet." : "Preparing the response."
        }
    }
}

private struct AgentExecutionProgressCard: View {
    let presentation: AgentResponsePresentation
    let accent: Color

    var body: some View {
        VStack(alignment: .leading, spacing: 11) {
            HStack(spacing: 11) {
                ProgressView()
                    .controlSize(.small)
                    .tint(accent)
                    .opacity(presentation.isActive ? 1 : 0.45)
                VStack(alignment: .leading, spacing: 3) {
                    Text(presentation.phaseTitle)
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(PKTheme.text2)
                    Text(presentation.phaseDetail)
                        .font(.caption)
                        .lineLimit(3)
                        .foregroundStyle(PKTheme.text3)
                }
                Spacer()
            }

            GeometryReader { proxy in
                ZStack(alignment: .leading) {
                    RoundedRectangle(cornerRadius: 3)
                        .fill(PKTheme.control.opacity(0.75))
                    RoundedRectangle(cornerRadius: 3)
                        .fill(accent.opacity(0.82))
                        .frame(width: max(6, proxy.size.width * presentation.progress))
                }
            }
            .frame(height: 6)
        }
        .padding(14)
        .background(PKTheme.inset.opacity(0.78))
        .overlay(RoundedRectangle(cornerRadius: 8).stroke(accent.opacity(0.20), lineWidth: 1))
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }
}

private struct AgentActivityItem: Hashable {
    let symbol: String
    let title: String
    let detail: String
}

private struct AgentActivityTimeline: View {
    let items: [AgentActivityItem]
    let accent: Color
    @State private var isExpanded: Bool

    init(items: [AgentActivityItem], accent: Color, startsExpanded: Bool = true) {
        self.items = items
        self.accent = accent
        _isExpanded = State(initialValue: startsExpanded)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 11) {
            Button {
                withAnimation(.easeInOut(duration: 0.16)) {
                    isExpanded.toggle()
                }
            } label: {
                HStack(spacing: 8) {
                    Image(systemName: isExpanded ? "chevron.down" : "chevron.right")
                        .font(.system(size: 9, weight: .bold))
                        .foregroundStyle(accent)
                        .frame(width: 14)
                    Text("Thinking & tools")
                        .font(.system(size: 11.5, weight: .semibold))
                        .foregroundStyle(PKTheme.text3)
                    CountBadge(value: items.count)
                    Spacer(minLength: 0)
                }
            }
            .buttonStyle(.plain)
            .help(isExpanded ? "Hide thinking and tool activity" : "Show thinking and tool activity")

            if isExpanded {
                ForEach(Array(items.enumerated()), id: \.offset) { _, item in
                    HStack(alignment: .top, spacing: 10) {
                        Image(systemName: item.symbol)
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundStyle(accent.opacity(0.9))
                            .frame(width: 18, height: 18)
                            .padding(.top, 1)

                        VStack(alignment: .leading, spacing: 4) {
                            Text(item.title)
                                .font(.system(size: 11.5, weight: .semibold))
                                .foregroundStyle(PKTheme.text3)
                            Text(item.detail)
                                .font(.system(size: 13))
                                .lineSpacing(3)
                                .foregroundStyle(PKTheme.text2)
                                .textSelection(.enabled)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
            }
        }
        .padding(14)
        .background(PKTheme.inset.opacity(0.58))
        .overlay(RoundedRectangle(cornerRadius: 8).stroke(PKTheme.edge.opacity(0.82), lineWidth: 1))
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }
}

private struct GenerativeUIItem: Hashable {
    let symbol: String
    let title: String
    let detail: String
}

private struct GenerativeUIRail: View {
    let items: [GenerativeUIItem]
    let accent: Color

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            ForEach(Array(items.enumerated()), id: \.offset) { _, item in
                HStack(spacing: 9) {
                    Image(systemName: item.symbol)
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(accent)
                        .frame(width: 22, height: 22)
                        .background(accent.opacity(0.10))
                        .clipShape(RoundedRectangle(cornerRadius: 6))
                    VStack(alignment: .leading, spacing: 2) {
                        Text(item.title)
                            .font(.system(size: 11, weight: .semibold))
                            .foregroundStyle(PKTheme.text2)
                            .lineLimit(1)
                        Text(item.detail.isEmpty ? "Updated" : item.detail)
                            .font(.caption2)
                            .foregroundStyle(PKTheme.text3)
                            .lineLimit(1)
                    }
                    Spacer()
                }
                .padding(9)
                .background(PKTheme.control.opacity(0.36))
                .overlay(RoundedRectangle(cornerRadius: 7).stroke(PKTheme.edge.opacity(0.78), lineWidth: 1))
                .clipShape(RoundedRectangle(cornerRadius: 7))
            }
        }
    }
}

private struct AgentThinkingState: View {
    let isRunning: Bool
    let state: RunState?
    let accent: Color

    var body: some View {
        AgentExecutionProgressCard(
            presentation: AgentResponsePresentation(text: "", state: state, isRunning: isRunning),
            accent: accent
        )
    }
}

private struct ConversationReplyComposer: View {
    let snapshot: NativeStoreSnapshot
    @Binding var selectedWorkspaceId: EntityID?
    let contextWorkspaceId: EntityID?
    @Binding var text: String
    let statusLine: String
    let isRunning: Bool
    let accent: Color
    var branchOptions: [String] = []
    var branchStatus: String?
    var switchBranch: (String) -> Void = { _ in }
    let send: () -> Void
    @FocusState private var focused: Bool
    @State private var editorFocused = false
    @State private var imageAttachments: [ComposerImageAttachment] = []
    @State private var attachmentError: String?

    private var canSend: Bool {
        !isRunning && (!text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || !imageAttachments.isEmpty)
    }

    private var composerFocused: Bool {
        focused || editorFocused
    }

    private var composerWorkspaceId: EntityID? {
        contextWorkspaceId ?? selectedWorkspaceId
    }

    private var placeholderText: String {
        if isRunning {
            return "Agent is working..."
        }
        return "Ask for the next action, validation, or follow-up"
    }

    var body: some View {
        VStack(spacing: 0) {
            ZStack(alignment: .topLeading) {
                if text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !composerFocused {
                    Text(placeholderText)
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(PKTheme.text4.opacity(0.72))
                        .padding(.top, 5)
                        .padding(.leading, 10)
                        .allowsHitTesting(false)
                }
                NativeSendingTextEditor(
                    text: $text,
                    focused: $focused,
                    fontSize: 13,
                    lineSpacing: 1,
                    textContainerInset: NSSize(width: 0, height: 3),
                    onSend: sendWithAttachments,
                    onPasteImages: pasteImagesFromClipboard,
                    onFocusChange: { editorFocused = $0 }
                )
                    .frame(minHeight: 38, maxHeight: 56)
                    .padding(.horizontal, 10)
                    .padding(.top, 4)
                    .padding(.bottom, 0)
            }
            .contentShape(Rectangle())
            .onTapGesture {
                focused = true
            }

            if !imageAttachments.isEmpty || attachmentError != nil {
                ComposerImageAttachmentStrip(
                    attachments: imageAttachments,
                    error: attachmentError,
                    remove: { attachment in
                        imageAttachments.removeAll { $0.id == attachment.id }
                    },
                    clearError: { attachmentError = nil },
                    compact: true
                )
                .padding(.horizontal, 10)
                .padding(.bottom, 8)
            }

            HStack(spacing: 7) {
                if let contextWorkspaceId {
                    ProjectContextChip(
                        snapshot: snapshot,
                        workspaceId: contextWorkspaceId,
                        accent: accent,
                        compact: true
                    )
                } else {
                    ProjectPickerChip(
                        snapshot: snapshot,
                        selectedWorkspaceId: $selectedWorkspaceId,
                        accent: accent,
                        compact: true
                    )
                }

                if let branch = branchTitle(for: composerWorkspaceId, snapshot: snapshot) {
                    BranchPickerChip(
                        currentBranch: branch,
                        branchOptions: branchOptions,
                        branchStatus: branchStatus,
                        compact: true,
                        switchBranch: switchBranch
                    )
                }

                if isRunning {
                    StatusPill(text: "RUNNING", color: PKTheme.warn)
                } else if imageAttachments.isEmpty && text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    StatusPill(text: "READY", color: PKTheme.ok)
                } else if !imageAttachments.isEmpty {
                    StatusPill(text: "\(imageAttachments.count) IMAGE\(imageAttachments.count == 1 ? "" : "S")", color: accent)
                } else if !statusLine.isEmpty && statusLine != "New chat ready" {
                    Text(statusLine)
                        .font(.caption)
                        .foregroundStyle(PKTheme.text3)
                        .lineLimit(1)
                }
                Spacer()
                ComposerIconButton(symbol: "paperclip", title: "Attach Images") {
                    addAttachments(ComposerImageAttachmentStore.pickImageFiles())
                }
                ComposerIconButton(symbol: "doc.on.clipboard", title: "Paste Image") {
                    addAttachments(ComposerImageAttachmentStore.importImagesFromPasteboard())
                }
                Button(action: sendWithAttachments) {
                    Image(systemName: isRunning ? "hourglass" : "arrow.up")
                        .font(.system(size: 13, weight: .bold))
                        .foregroundStyle(canSend ? PKTheme.primaryText : PKTheme.text4)
                        .frame(width: 30, height: 30)
                        .background(canSend ? accent : PKTheme.control.opacity(0.86))
                        .clipShape(RoundedRectangle(cornerRadius: 8))
                }
                .buttonStyle(.plain)
                .disabled(!canSend)
                .keyboardShortcut(.return, modifiers: .command)
                .help(isRunning ? "Running" : "Send follow-up")
            }
            .padding(.horizontal, 8)
            .padding(.bottom, 8)
        }
        .background(
            LinearGradient(
                colors: [
                    accent.opacity(0.06),
                    PKTheme.surfaceRaised.opacity(0.92)
                ],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
        )
        .overlay(RoundedRectangle(cornerRadius: 8).stroke(focused ? accent.opacity(0.62) : PKTheme.edgeStrong.opacity(0.48), lineWidth: 1))
        .clipShape(RoundedRectangle(cornerRadius: 8))
        .onPasteCommand(of: [.image, .fileURL]) { _ in
            addAttachments(ComposerImageAttachmentStore.importImagesFromPasteboard())
            refocusComposer()
        }
        .onChange(of: isRunning) { _, running in
            if !running {
                refocusComposer()
            }
        }
    }

    private func addAttachments(_ result: ComposerImageAttachmentImportResult) {
        if !result.attachments.isEmpty {
            imageAttachments.append(contentsOf: result.attachments)
            attachmentError = nil
        }
        if let message = result.message {
            attachmentError = message
        }
    }

    private func pasteImagesFromClipboard() -> Bool {
        guard ComposerImageAttachmentStore.canImportImagesFromPasteboard() else { return false }
        addAttachments(ComposerImageAttachmentStore.importImagesFromPasteboard())
        refocusComposer()
        return true
    }

    private func sendWithAttachments() {
        guard canSend else { return }
        text = ComposerAttachmentPrompt.appendImageRefs(
            to: text,
            images: imageAttachments.map { ComposerImageAttachmentRef(name: $0.name, path: $0.url.path) }
        )
        imageAttachments = []
        attachmentError = nil
        send()
        refocusComposer()
    }

    private func refocusComposer() {
        DispatchQueue.main.async {
            focused = true
        }
    }
}

private struct ContextTerminalPage: View {
    let snapshot: NativeStoreSnapshot
    let selectedWorkspace: Workspace?
    let selectedWorkItem: WorkItem?
    let selectedAgentKind: NativeAgentKind
    let selectedPermissionMode: PermissionMode
    let activeRun: AgentRun?
    @ObservedObject var model: NativeAppModel
    let openChat: () -> Void
    let openWorkItem: () -> Void
    let refreshBranches: () -> Void

    var body: some View {
        PageFrame(route: .terminal) {
            HStack(alignment: .top, spacing: 14) {
                ContextTerminalPane(
                    selectedWorkspace: selectedWorkspace,
                    selectedWorkItem: selectedWorkItem,
                    selectedAgentKind: selectedAgentKind,
                    selectedPermissionMode: selectedPermissionMode,
                    activeRun: activeRun,
                    model: model,
                    openChat: openChat
                )
                .frame(minWidth: 560)

                VStack(alignment: .leading, spacing: 12) {
                    InspectorSection(title: "Context") {
                        InspectorMetric(label: "Project", value: selectedWorkspace?.name ?? "No project")
                        if let branch = selectedWorkspace?.currentBranch {
                            InspectorMetric(label: "Branch", value: branch)
                        }
                        InspectorMetric(label: "Agent", value: agentShortLabel(selectedAgentKind))
                        InspectorMetric(label: "Permission", value: permissionLabel(selectedPermissionMode))
                    }

                    InspectorSection(title: "Work Item") {
                        if let selectedWorkItem {
                            InspectorRow(symbol: "checklist", title: selectedWorkItem.title, subtitle: selectedWorkItem.state.rawValue)
                        } else {
                            EmptyMiniState(title: "No work item selected", subtitle: "Terminal will attach to the selected project.")
                        }
                    }

                    InspectorSection(title: "Recent Runs") {
                        ForEach(snapshot.runs.prefix(3)) { run in
                            InspectorRow(
                                symbol: agentSymbol(agentKind(for: run, snapshot: snapshot)),
                                title: run.promptSnapshot.firstLineFallback("Conversation"),
                                subtitle: run.state.rawValue
                            )
                        }
                        if snapshot.runs.isEmpty {
                            EmptyMiniState(title: "No runs yet", subtitle: "Agent output will appear after a chat starts.")
                        }
                    }
                }
                .frame(width: 320)
            }
        } actions: {
            SecondaryButton(title: "Native Shell", systemImage: "terminal", action: {
                model.openNativeTerminal(workspace: selectedWorkspace)
            })
            SecondaryButton(title: "Refresh", systemImage: "arrow.clockwise", action: refreshBranches)
            SecondaryButton(title: "Work Item", systemImage: "checklist", action: openWorkItem)
            PrimaryButton(title: "Back to Chat", systemImage: "text.bubble", action: openChat)
        }
    }
}

private struct ContextTerminalPane: View {
    let selectedWorkspace: Workspace?
    let selectedWorkItem: WorkItem?
    let selectedAgentKind: NativeAgentKind
    let selectedPermissionMode: PermissionMode
    let activeRun: AgentRun?
    @ObservedObject var model: NativeAppModel
    let openChat: () -> Void
    var compact = false
    @FocusState private var commandFocused: Bool

    private var accent: Color {
        agentTint(selectedAgentKind)
    }

    private var canRun: Bool {
        selectedWorkspace != nil
            && !model.terminalIsRunning
            && !model.terminalCommand.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    var body: some View {
        VStack(alignment: .leading, spacing: compact ? 10 : 14) {
            HStack(spacing: 11) {
                Image(systemName: "terminal")
                    .font(.system(size: compact ? 13 : 15, weight: .semibold))
                    .foregroundStyle(PKTheme.primaryText)
                    .frame(width: compact ? 30 : 36, height: compact ? 30 : 36)
                    .background(accent)
                    .clipShape(RoundedRectangle(cornerRadius: 8))

                VStack(alignment: .leading, spacing: 3) {
                    Text(selectedWorkspace?.name ?? "Context Terminal")
                        .font(.system(size: compact ? 13 : 16, weight: .semibold))
                        .foregroundStyle(PKTheme.text)
                        .lineLimit(1)
                    Text(contextSubtitle)
                        .font(.caption)
                        .foregroundStyle(PKTheme.text3)
                        .lineLimit(1)
                }

                Spacer(minLength: 0)

                StatusPill(text: model.terminalIsRunning ? "RUNNING" : permissionLabel(selectedPermissionMode), color: model.terminalIsRunning ? PKTheme.warn : accent)
                ComposerIconButton(symbol: "terminal", title: "Open Native Shell", action: openNativeShell)
            }

            ScrollViewReader { reader in
                ScrollView {
                    Text(terminalText)
                        .font(.system(size: compact ? 11 : 12, design: .monospaced))
                        .foregroundStyle(PKTheme.text2)
                        .textSelection(.enabled)
                        .frame(maxWidth: .infinity, alignment: .topLeading)
                        .padding(compact ? 10 : 13)
                        .id("terminal-output")
                }
                .frame(minHeight: compact ? 126 : 300, maxHeight: compact ? 180 : 420)
                .background(PKTheme.inset.opacity(0.92))
                .overlay(RoundedRectangle(cornerRadius: 8).stroke(PKTheme.edge, lineWidth: 1))
                .clipShape(RoundedRectangle(cornerRadius: 8))
                .onChange(of: model.terminalTranscript) { _, _ in
                    withAnimation(.easeOut(duration: 0.14)) {
                        reader.scrollTo("terminal-output", anchor: .bottom)
                    }
                }
            }

            HStack(spacing: 8) {
                Text("\(model.terminalDisplayDirectory(for: selectedWorkspace)) $")
                    .font(.system(size: 13, weight: .semibold, design: .monospaced))
                    .foregroundStyle(accent)
                    .lineLimit(1)
                    .truncationMode(.middle)
                    .frame(maxWidth: compact ? 120 : 220, alignment: .leading)
                TextField("git status --short", text: $model.terminalCommand)
                    .textFieldStyle(.plain)
                    .font(.system(size: 13, design: .monospaced))
                    .foregroundStyle(PKTheme.text)
                    .focused($commandFocused)
                    .onSubmit(runCommand)
                    .disabled(model.terminalIsRunning || selectedWorkspace == nil)
                Button(action: runCommand) {
                    Image(systemName: model.terminalIsRunning ? "hourglass" : "arrow.up")
                        .font(.system(size: 12, weight: .bold))
                        .foregroundStyle(canRun ? PKTheme.primaryText : PKTheme.text4)
                        .frame(width: 30, height: 28)
                        .background(canRun ? accent : PKTheme.control.opacity(0.86))
                        .clipShape(RoundedRectangle(cornerRadius: 7))
                }
                .buttonStyle(.plain)
                .disabled(!canRun)
                .help("Run Command")
            }
            .padding(.horizontal, 10)
            .frame(height: 38)
            .background(PKTheme.control.opacity(0.72))
            .overlay(RoundedRectangle(cornerRadius: 8).stroke(commandFocused ? accent.opacity(0.52) : PKTheme.edge, lineWidth: 1))
            .clipShape(RoundedRectangle(cornerRadius: 8))

            HStack(spacing: 8) {
                ForEach(terminalSuggestions, id: \.self) { command in
                    TerminalSuggestionButton(command: command, tint: accent) {
                        model.terminalCommand = command
                        refocusCommand()
                    }
                }
                Spacer(minLength: 0)
                ComposerIconButton(symbol: "terminal", title: "Open Native Shell", action: openNativeShell)
                ComposerIconButton(symbol: "text.bubble", title: "Stage Output to Chat") {
                    if model.stageTerminalTranscriptForChat(
                        workspace: selectedWorkspace,
                        workItem: selectedWorkItem,
                        activeRun: activeRun,
                        agentKind: selectedAgentKind,
                        permissionMode: selectedPermissionMode
                    ) {
                        openChat()
                    }
                }
                ComposerIconButton(symbol: "doc.on.doc", title: "Copy Output") {
                    copyTextToPasteboard(model.terminalTranscript)
                }
                ComposerIconButton(symbol: "trash", title: "Clear Terminal") {
                    model.clearTerminal()
                    refocusCommand()
                }
            }
        }
        .padding(compact ? 12 : 16)
        .background(
            LinearGradient(
                colors: [
                    accent.opacity(0.08),
                    PKTheme.panel.opacity(0.84)
                ],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
        )
        .overlay(RoundedRectangle(cornerRadius: 8).stroke(accent.opacity(0.24), lineWidth: 1))
        .clipShape(RoundedRectangle(cornerRadius: 8))
        .onAppear {
            refocusCommand()
        }
        .onChange(of: model.terminalIsRunning) { _, isRunning in
            if !isRunning {
                refocusCommand()
            }
        }
        .onChange(of: selectedWorkspace?.id) { _, _ in
            refocusCommand()
        }
    }

    private var contextSubtitle: String {
        let project = model.terminalDisplayDirectory(for: selectedWorkspace)
        if let selectedWorkItem {
            return "\(selectedWorkItem.title) · cwd \(project)"
        }
        if let activeRun {
            return "\(activeRun.state.rawValue) run · cwd \(project)"
        }
        return selectedWorkspace == nil ? "No workspace selected" : "cwd \(project)"
    }

    private var terminalText: String {
        let transcript = model.terminalTranscript.gitTrimmed
        if !transcript.isEmpty {
            return transcript
        }
        guard let selectedWorkspace else {
            return "$ add a project first"
        }
        return [
            "\(model.terminalDisplayDirectory(for: selectedWorkspace)) $ pwd",
            selectedWorkspace.pathDisplay,
            "\(model.terminalDisplayDirectory(for: selectedWorkspace)) $ # \(agentShortLabel(selectedAgentKind)) · \(permissionLabel(selectedPermissionMode))"
        ].joined(separator: "\n")
    }

    private var terminalSuggestions: [String] {
        NativeAppModel.terminalSuggestions(for: selectedWorkspace)
    }

    private func runCommand() {
        guard canRun else { return }
        let command = model.terminalCommand
        Task { @MainActor in
            await model.runTerminalCommand(command, workspace: selectedWorkspace)
            refocusCommand()
        }
    }

    private func openNativeShell() {
        model.openNativeTerminal(workspace: selectedWorkspace)
        refocusCommand()
    }

    private func refocusCommand() {
        guard selectedWorkspace != nil else { return }
        DispatchQueue.main.async {
            commandFocused = true
        }
    }
}

private struct TerminalSuggestionButton: View {
    let command: String
    let tint: Color
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(command)
                .font(.system(size: 11, weight: .semibold, design: .monospaced))
                .foregroundStyle(tint)
                .lineLimit(1)
                .padding(.horizontal, 8)
                .frame(height: 28)
                .background(tint.opacity(0.10))
                .overlay(RoundedRectangle(cornerRadius: 7).stroke(tint.opacity(0.22), lineWidth: 1))
                .clipShape(RoundedRectangle(cornerRadius: 7))
        }
        .buttonStyle(.plain)
        .help(command)
    }
}

private struct ComposerImageAttachment: Identifiable, Hashable {
    let id: UUID
    let name: String
    let url: URL

    init(id: UUID = UUID(), name: String, url: URL) {
        self.id = id
        self.name = name
        self.url = url
    }
}

private struct ComposerImageAttachmentImportResult {
    var attachments: [ComposerImageAttachment]
    var message: String?

    static let empty = ComposerImageAttachmentImportResult(attachments: [], message: nil)
}

@MainActor
private enum ComposerImageAttachmentStore {
    private static let imageURLReadingOptions: [NSPasteboard.ReadingOptionKey: Any] = [
        .urlReadingContentsConformToTypes: [UTType.image.identifier]
    ]

    static func pickImageFiles() -> ComposerImageAttachmentImportResult {
        let panel = NSOpenPanel()
        panel.canChooseFiles = true
        panel.canChooseDirectories = false
        panel.allowsMultipleSelection = true
        panel.allowedContentTypes = [.image]
        panel.prompt = "Attach"

        guard panel.runModal() == .OK else {
            return .empty
        }

        let attachments = panel.urls.compactMap(makeAttachment)
        if attachments.isEmpty {
            return ComposerImageAttachmentImportResult(attachments: [], message: "No supported image files were selected.")
        }
        return ComposerImageAttachmentImportResult(attachments: attachments, message: nil)
    }

    static func canImportImagesFromPasteboard(_ pasteboard: NSPasteboard = .general) -> Bool {
        if pasteboard.canReadObject(forClasses: [NSURL.self], options: imageURLReadingOptions) {
            return true
        }
        if pasteboard.canReadObject(forClasses: [NSImage.self], options: nil) {
            return true
        }
        return pasteboard.types?.contains { pasteboardType in
            guard let type = UTType(pasteboardType.rawValue) else { return false }
            return type.conforms(to: .image)
        } ?? false
    }

    static func importImagesFromPasteboard(_ pasteboard: NSPasteboard = .general) -> ComposerImageAttachmentImportResult {
        var attachments: [ComposerImageAttachment] = []

        if let urls = pasteboard.readObjects(forClasses: [NSURL.self], options: imageURLReadingOptions) as? [NSURL] {
            attachments.append(contentsOf: urls.map { $0 as URL }.compactMap(makeAttachment))
        }

        if attachments.isEmpty, let image = NSImage(pasteboard: pasteboard) ?? imageFromPasteboardData(pasteboard) {
            do {
                let url = try writePastedImage(image)
                attachments.append(ComposerImageAttachment(name: url.lastPathComponent, url: url))
            } catch {
                return ComposerImageAttachmentImportResult(attachments: [], message: "Could not save pasted image: \(error.localizedDescription)")
            }
        }

        if attachments.isEmpty {
            return ComposerImageAttachmentImportResult(attachments: [], message: "No image found on the clipboard.")
        }
        return ComposerImageAttachmentImportResult(attachments: attachments, message: nil)
    }

    private static func imageFromPasteboardData(_ pasteboard: NSPasteboard) -> NSImage? {
        for pasteboardType in pasteboard.types ?? [] {
            guard let type = UTType(pasteboardType.rawValue),
                  type.conforms(to: .image),
                  let data = pasteboard.data(forType: pasteboardType),
                  let image = NSImage(data: data) else { continue }
            return image
        }
        return nil
    }

    private static func makeAttachment(url: URL) -> ComposerImageAttachment? {
        guard isSupportedImageURL(url) else { return nil }
        return ComposerImageAttachment(name: url.lastPathComponent, url: url)
    }

    private static func isSupportedImageURL(_ url: URL) -> Bool {
        if let type = UTType(filenameExtension: url.pathExtension), type.conforms(to: .image) {
            return true
        }
        return NSImage(contentsOf: url) != nil
    }

    private static func writePastedImage(_ image: NSImage) throws -> URL {
        let directory = try attachmentDirectory()
        let filename = "pasted-image-\(Int(Date().timeIntervalSince1970 * 1000)).png"
        let url = directory.appendingPathComponent(filename)

        guard let tiff = image.tiffRepresentation,
              let bitmap = NSBitmapImageRep(data: tiff),
              let data = bitmap.representation(using: .png, properties: [:]) else {
            throw ComposerImageAttachmentError.unwritableImage
        }

        try data.write(to: url, options: .atomic)
        return url
    }

    private static func attachmentDirectory() throws -> URL {
        let appSupport = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
            ?? URL(fileURLWithPath: NSHomeDirectory()).appendingPathComponent("Library/Application Support")
        let directory = appSupport
            .appendingPathComponent("PikiclawMacNative", isDirectory: true)
            .appendingPathComponent("ComposerAttachments", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true, attributes: nil)
        return directory
    }
}

private enum ComposerImageAttachmentError: LocalizedError {
    case unwritableImage

    var errorDescription: String? {
        switch self {
        case .unwritableImage:
            return "The pasted image could not be converted to PNG."
        }
    }
}

private struct ComposerImageAttachmentStrip: View {
    let attachments: [ComposerImageAttachment]
    let error: String?
    let remove: (ComposerImageAttachment) -> Void
    let clearError: () -> Void
    var compact = false

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if !attachments.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(attachments) { attachment in
                            ComposerImageAttachmentChip(
                                attachment: attachment,
                                compact: compact,
                                remove: { remove(attachment) }
                            )
                        }
                    }
                    .padding(.vertical, 1)
                }
            }

            if let error {
                HStack(spacing: 7) {
                    Image(systemName: "exclamationmark.triangle")
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(PKTheme.warn)
                    Text(error)
                        .font(.system(size: 11))
                        .foregroundStyle(PKTheme.text3)
                        .lineLimit(2)
                    Spacer(minLength: 0)
                    Button(action: clearError) {
                        Image(systemName: "xmark")
                            .font(.system(size: 10, weight: .semibold))
                            .foregroundStyle(PKTheme.text3)
                    }
                    .buttonStyle(.plain)
                }
                .padding(8)
                .background(PKTheme.warn.opacity(0.08))
                .overlay(RoundedRectangle(cornerRadius: 7).stroke(PKTheme.warn.opacity(0.22), lineWidth: 1))
                .clipShape(RoundedRectangle(cornerRadius: 7))
            }
        }
    }
}

private struct ComposerImageAttachmentChip: View {
    let attachment: ComposerImageAttachment
    let compact: Bool
    let remove: () -> Void

    private var thumbnail: NSImage? {
        NSImage(contentsOf: attachment.url)
    }

    var body: some View {
        HStack(spacing: 8) {
            ZStack {
                RoundedRectangle(cornerRadius: 7)
                    .fill(PKTheme.inset.opacity(0.88))
                if let thumbnail {
                    Image(nsImage: thumbnail)
                        .resizable()
                        .scaledToFill()
                } else {
                    Image(systemName: "photo")
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(PKTheme.primary)
                }
            }
            .frame(width: compact ? 34 : 42, height: compact ? 30 : 36)
            .clipShape(RoundedRectangle(cornerRadius: 7))

            VStack(alignment: .leading, spacing: 2) {
                Text(attachment.name)
                    .font(.system(size: compact ? 10 : 11, weight: .semibold))
                    .foregroundStyle(PKTheme.text2)
                    .lineLimit(1)
                Text("Image")
                    .font(.system(size: 9, weight: .medium))
                    .foregroundStyle(PKTheme.text4)
            }
            .frame(maxWidth: compact ? 100 : 140, alignment: .leading)

            Button(action: remove) {
                Image(systemName: "xmark.circle.fill")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(PKTheme.text3)
            }
            .buttonStyle(.plain)
        }
        .padding(.horizontal, 8)
        .frame(height: compact ? 42 : 48)
        .background(PKTheme.panelAlt.opacity(0.52))
        .overlay(RoundedRectangle(cornerRadius: 8).stroke(PKTheme.edge, lineWidth: 1))
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }
}

private struct CompactPicker<Content: View>: View {
    let title: String
    @ViewBuilder var content: Content

    var body: some View {
        HStack(spacing: 8) {
            Text(title.uppercased())
                .font(.system(size: 10, weight: .semibold))
                .foregroundStyle(PKTheme.text3)
            content
                .frame(maxWidth: .infinity)
        }
        .padding(.horizontal, 10)
        .frame(height: 38)
        .background(PKTheme.control.opacity(0.70))
        .overlay(RoundedRectangle(cornerRadius: 7).stroke(PKTheme.controlBorder, lineWidth: 1))
        .clipShape(RoundedRectangle(cornerRadius: 7))
    }
}

private struct QuickActionButton: View {
    let title: String
    let symbol: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Label(title, systemImage: symbol)
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(PKTheme.text2)
                .padding(.horizontal, 12)
                .frame(height: 34)
                .frame(maxWidth: .infinity)
                .background(PKTheme.panel.opacity(0.62))
                .overlay(RoundedRectangle(cornerRadius: 7).stroke(PKTheme.edge, lineWidth: 1))
                .clipShape(RoundedRectangle(cornerRadius: 7))
        }
        .buttonStyle(.plain)
    }
}

private struct RecentChatList: View {
    let snapshot: NativeStoreSnapshot

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("RECENT CHATS")
                .font(.system(size: 10, weight: .semibold))
                .foregroundStyle(PKTheme.text3)
            ForEach(snapshot.runs.prefix(4)) { run in
                HStack {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(run.promptSnapshot.firstLineFallback("Conversation"))
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(PKTheme.text)
                            .lineLimit(1)
                        Text(run.state.rawValue)
                            .font(.caption)
                            .foregroundStyle(PKTheme.text3)
                    }
                    Spacer()
                    Image(systemName: "arrow.right")
                        .foregroundStyle(PKTheme.text3)
                }
                .padding(11)
                .background(PKTheme.panel.opacity(0.52))
                .overlay(RoundedRectangle(cornerRadius: 8).stroke(PKTheme.edge, lineWidth: 1))
                .clipShape(RoundedRectangle(cornerRadius: 8))
            }
            if snapshot.runs.isEmpty {
                EmptyMiniState(title: "No chats yet", subtitle: "Send a prompt to start in this window.")
            }
        }
    }
}

private func runStateColor(_ state: RunState?) -> Color {
    switch state {
    case .running, .completed: PKTheme.ok
    case .waitingForUser, .queued, .starting: PKTheme.warn
    case .failed, .cancelled: PKTheme.err
    case .draft: PKTheme.primary
    default: PKTheme.text3
    }
}

private func agentOutputSubtitle(state: RunState?, isRunning: Bool) -> String {
    if isRunning {
        return "Streaming native runner output"
    }
    switch state {
    case .completed:
        return "Completed"
    case .failed:
        return "Needs attention"
    case .cancelled:
        return "Cancelled"
    case .waitingForUser:
        return "Waiting for input"
    case .draft:
        return "Conversation open"
    case .queued, .starting, .running:
        return "Preparing response"
    default:
        return "Agent output"
    }
}

func friendlyAgentOutput(_ text: String) -> String {
    let withoutAnsi = text.replacingOccurrences(
        of: #"\u001B\[[0-9;?]*[ -/]*[@-~]"#,
        with: "",
        options: .regularExpression
    )
    var toolNamesByCallId: [String: String] = [:]
    let lines = withoutAnsi
        .components(separatedBy: .newlines)
        .map { line -> String? in
            let trimmed = line.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !trimmed.isEmpty else { return nil }
            if isHiddenAgentCLIDiagnosticLine(trimmed) { return nil }
            if let eventLine = friendlyCodexEventLine(trimmed, toolNamesByCallId: &toolNamesByCallId) {
                return eventLine.isEmpty ? nil : eventLine
            }
            if trimmed.hasPrefix("{") && trimmed.contains(#""type""#) {
                return nil
            }
            if trimmed == "[completed with exit code 0]" { return nil }
            if trimmed.hasPrefix("[completed with exit code ") {
                return "Completed \(trimmed.replacingOccurrences(of: "[completed with ", with: "").replacingOccurrences(of: "]", with: ""))"
            }
            if trimmed.hasPrefix("[failed] ") {
                return "Failed: \(trimmed.replacingOccurrences(of: "[failed] ", with: ""))"
            }
            if trimmed.hasPrefix("[runner failed] ") {
                return "Runner failed: \(trimmed.replacingOccurrences(of: "[runner failed] ", with: ""))"
            }
            if trimmed.hasPrefix("[tool] ") {
                return "Tool: \(trimmed.replacingOccurrences(of: "[tool] ", with: ""))"
            }
            if trimmed.hasPrefix("[artifact] ") {
                return "Artifact: \(trimmed.replacingOccurrences(of: "[artifact] ", with: ""))"
            }
            return line
        }
        .compactMap { $0 }

    return lines.joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines)
}

private func isHiddenAgentCLIDiagnosticLine(_ trimmed: String) -> Bool {
    let lower = trimmed.lowercased()
    if lower == "reading additional input from stdin..." || lower == "reading prompt from stdin..." {
        return true
    }
    if lower == "plugin.json" || lower == "sessionstart" { return true }
    if lower.hasPrefix("hook: ") { return true }
    if lower.hasPrefix("path=") && lower.contains("/.codex/") { return true }
    if lower.contains("codex_core_plugins::manifest") || lower.contains("codex_core_skills::loader") {
        return true
    }
    if lower.contains("/.codex/.tmp/plugins/") && lower.contains("plugin.json") {
        return true
    }

    let pieces = trimmed.split(separator: " ", maxSplits: 2, omittingEmptySubsequences: true)
    if pieces.count == 3,
       pieces[0].contains("T"),
       pieces[0].hasSuffix("Z"),
       ["WARN", "INFO", "DEBUG", "TRACE"].contains(String(pieces[1])),
       pieces[2].hasPrefix("codex") {
        return true
    }
    return false
}

private func friendlyCodexEventLine(_ line: String, toolNamesByCallId: inout [String: String]) -> String? {
    guard line.first == "{",
          let data = line.data(using: .utf8),
          let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
          let type = object["type"] as? String else {
        return nil
    }

    switch type {
    case "response_item":
        guard let payload = object["payload"] as? [String: Any],
              let payloadType = payload["type"] as? String else {
            return ""
        }
        return friendlyCodexResponseItem(payload, payloadType: payloadType, toolNamesByCallId: &toolNamesByCallId)
    case "error":
        return "Failed: \(codexString(object["message"]) ?? "Codex reported an error")"
    case "session_meta", "event_msg":
        return ""
    default:
        if type.hasPrefix("thread.") || type.hasPrefix("turn.") {
            return ""
        }
        return nil
    }
}

private func friendlyCodexResponseItem(
    _ payload: [String: Any],
    payloadType: String,
    toolNamesByCallId: inout [String: String]
) -> String {
    switch payloadType {
    case "message":
        guard codexString(payload["role"]) == "assistant" else { return "" }
        let text = codexText(from: payload["content"])
        guard !text.isEmpty else { return "" }
        return codexString(payload["phase"]) == "commentary" ? "Thinking: \(text)" : text
    case "reasoning":
        let text = [codexText(from: payload["summary"]), codexText(from: payload["content"])]
            .filter { !$0.isEmpty }
            .joined(separator: "\n")
        return text.isEmpty ? "" : "Thinking: \(text)"
    case "function_call", "custom_tool_call":
        let name = codexString(payload["name"]) ?? codexString(payload["tool_name"]) ?? "tool"
        if let callId = codexString(payload["call_id"]), !callId.isEmpty {
            toolNamesByCallId[callId] = name
        }
        return "Tool: \(friendlyToolName(name))"
    case "function_call_output":
        guard let callId = codexString(payload["call_id"]),
              let name = toolNamesByCallId[callId] else {
            return ""
        }
        return "Tool result: \(friendlyToolName(name))"
    case "fileChange", "file_change":
        return friendlyCodexFileChange(payload)
    default:
        return ""
    }
}

private func friendlyCodexFileChange(_ payload: [String: Any]) -> String {
    if let path = codexString(payload["path"]) ?? codexString(payload["file"]) ?? codexString(payload["filename"]),
       !path.isEmpty {
        return "File: \(URL(fileURLWithPath: path).lastPathComponent)"
    }
    if let changes = payload["changes"] as? [Any], !changes.isEmpty {
        return changes.count == 1 ? "File: 1 change" : "Files: \(changes.count) changes"
    }
    return "Files changed"
}

private func friendlyToolName(_ name: String) -> String {
    let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty else { return "tool" }
    return trimmed
        .replacingOccurrences(of: "functions.", with: "")
        .replacingOccurrences(of: "mcp__", with: "")
}

private func codexString(_ value: Any?) -> String? {
    if let string = value as? String {
        let trimmed = string.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }
    return nil
}

private func codexText(from value: Any?) -> String {
    if let string = value as? String {
        return string.trimmingCharacters(in: .whitespacesAndNewlines)
    }
    if let array = value as? [Any] {
        return array
            .map(codexText(from:))
            .filter { !$0.isEmpty }
            .joined(separator: "\n")
    }
    if let object = value as? [String: Any] {
        if let text = codexString(object["text"]) ?? codexString(object["content"]) {
            return text
        }
        return [codexText(from: object["summary"]), codexText(from: object["content"])]
            .filter { !$0.isEmpty }
            .joined(separator: "\n")
    }
    return ""
}

private struct ComposerPanel: View {
    let snapshot: NativeStoreSnapshot
    @Binding var selectedWorkspaceId: EntityID?
    @Binding var selectedWorkItemId: EntityID?
    var commandFocused: FocusState<Bool>.Binding
    @ObservedObject var model: NativeAppModel

    var body: some View {
        VStack(spacing: 13) {
            TextEditor(text: $model.draftPrompt)
                .focused(commandFocused)
                .font(.system(size: 17))
                .foregroundStyle(PKTheme.text)
                .scrollContentBackground(.hidden)
                .frame(minHeight: 96, maxHeight: 128)
                .padding(12)
                .background(PKTheme.control.opacity(0.62))
                .overlay(RoundedRectangle(cornerRadius: 8).stroke(PKTheme.controlBorder, lineWidth: 1))
                .clipShape(RoundedRectangle(cornerRadius: 8))

            PickerRow(label: "PROJECT") {
                Picker("Project", selection: Binding(
                    get: { selectedWorkspaceId ?? snapshot.workspaces.first?.id ?? "" },
                    set: { selectedWorkspaceId = $0 }
                )) {
                    ForEach(snapshot.workspaces) { workspace in
                        Text(workspace.name).tag(workspace.id)
                    }
                }
                .labelsHidden()
                .frame(maxWidth: .infinity)
            }

            PickerRow(label: "TARGET") {
                Picker("Target", selection: Binding(
                    get: { selectedWorkItemId ?? snapshot.workItems.first?.id ?? "" },
                    set: { selectedWorkItemId = $0 }
                )) {
                    Text("MR Review Assistant").tag(EntityID("assistant-mr-review"))
                    ForEach(snapshot.workItems) { item in
                        Text(item.title).tag(item.id)
                    }
                }
                .labelsHidden()
                .frame(maxWidth: .infinity)
            }

            HStack(spacing: 10) {
                PickerRow(label: "AGENT") {
                    Picker("Agent", selection: $model.selectedAgentKind) {
                        ForEach(enabledAgentProfiles(in: snapshot)) { profile in
                            Text(profile.displayName).tag(profile.kind)
                        }
                    }
                    .labelsHidden()
                    .disabled(enabledAgentProfiles(in: snapshot).isEmpty)
                }

                PickerRow(label: "PERMISSION") {
                    Picker("Permission", selection: $model.selectedPermissionMode) {
                        Text("Read").tag(PermissionMode.readOnly)
                        Text("Ask").tag(PermissionMode.askBeforeEdit)
                        Text("Autopilot").tag(PermissionMode.autopilot)
                    }
                    .labelsHidden()
                }
            }

            HStack {
                SecondaryButton(title: "Attach files", systemImage: "paperclip") {}
                SecondaryButton(title: "Capture Work Item", systemImage: "tray.and.arrow.down") {
                    Task {
                        await model.createWorkItem(workspaceId: selectedWorkspaceId)
                        selectedWorkItemId = model.snapshot.workItems.first?.id
                    }
                }
                Spacer()
                PrimaryButton(title: model.isRunning ? "Running" : "Send", systemImage: "arrow.right") {
                    Task { await model.run(workItemId: selectedWorkItemId) }
                }
                .disabled(model.isRunning)
            }
        }
        .padding(16)
        .background(PKTheme.panel.opacity(0.78))
        .overlay(RoundedRectangle(cornerRadius: 10).stroke(PKTheme.edgeStrong.opacity(0.72), lineWidth: 1))
        .clipShape(RoundedRectangle(cornerRadius: 10))
    }
}

private struct PickerRow<Content: View>: View {
    let label: String
    @ViewBuilder var content: Content

    var body: some View {
        HStack(spacing: 12) {
            Text(label)
                .font(.system(size: 10, weight: .semibold))
                .foregroundStyle(PKTheme.text3)
                .frame(width: 82, alignment: .leading)
            content
        }
        .padding(.horizontal, 12)
        .frame(minHeight: 42)
        .background(PKTheme.control.opacity(0.72))
        .overlay(RoundedRectangle(cornerRadius: 7).stroke(PKTheme.controlBorder, lineWidth: 1))
        .clipShape(RoundedRectangle(cornerRadius: 7))
    }
}

private struct RuntimeCard: View {
    let title: String
    let value: String
    let subtitle: String
    let color: Color

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Dot(color: color)
                Text(title)
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(PKTheme.text3)
            }
            Text(value)
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(PKTheme.text)
                .lineLimit(1)
            Text(subtitle)
                .font(.caption)
                .foregroundStyle(PKTheme.text3)
                .lineLimit(1)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(14)
        .background(PKTheme.panelAlt.opacity(0.86))
        .overlay(RoundedRectangle(cornerRadius: 8).stroke(PKTheme.edge, lineWidth: 1))
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }
}

private struct NextActionStrip: View {
    let snapshot: NativeStoreSnapshot
    @Binding var selectedWorkItemId: EntityID?
    let navigate: (NativeRoute) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 11) {
            Text("NEXT ACTIONS")
                .font(.system(size: 10, weight: .semibold))
                .foregroundStyle(PKTheme.text3)

            HStack(spacing: 12) {
                ActionTile(title: "Open Work Items", subtitle: "Review inbox, queue, and workbench", symbol: "square.grid.2x2") {
                    navigate(.workItems)
                }
                ActionTile(title: "Open keyboard command center", subtitle: "Jump without leaving the chat flow", symbol: "command") {
                    navigate(.chat)
                }
                ActionTile(title: "Launch workflow", subtitle: "Run repeatable engineering patterns", symbol: "point.3.connected.trianglepath.dotted") {
                    navigate(.workflows)
                }
            }

            if let item = snapshot.workItems.first {
                Button {
                    selectedWorkItemId = item.id
                    navigate(.workItems)
                } label: {
                    HStack {
                        Label(item.title, systemImage: "checklist")
                            .font(.system(size: 13, weight: .semibold))
                        Spacer()
                        Text(item.state.rawValue)
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(PKTheme.primary)
                    }
                    .foregroundStyle(PKTheme.text2)
                    .padding(12)
                    .background(PKTheme.panel.opacity(0.62))
                    .overlay(RoundedRectangle(cornerRadius: 8).stroke(PKTheme.edge, lineWidth: 1))
                    .clipShape(RoundedRectangle(cornerRadius: 8))
                }
                .buttonStyle(.plain)
            }
        }
    }
}

private struct ActionTile: View {
    let title: String
    let subtitle: String
    let symbol: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 10) {
                Image(systemName: symbol)
                    .foregroundStyle(PKTheme.primary)
                    .frame(width: 28, height: 28)
                    .background(PKTheme.primary.opacity(0.12))
                    .clipShape(RoundedRectangle(cornerRadius: 6))
                VStack(alignment: .leading, spacing: 4) {
                    Text(title)
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(PKTheme.text)
                    Text(subtitle)
                        .font(.caption)
                        .foregroundStyle(PKTheme.text3)
                        .lineLimit(1)
                }
                Spacer()
                Image(systemName: "arrow.right")
                    .foregroundStyle(PKTheme.text3)
            }
            .padding(12)
            .frame(maxWidth: .infinity)
            .background(PKTheme.panel.opacity(0.7))
            .overlay(RoundedRectangle(cornerRadius: 8).stroke(PKTheme.edge, lineWidth: 1))
            .clipShape(RoundedRectangle(cornerRadius: 8))
        }
        .buttonStyle(.plain)
    }
}

private struct AssistantInspector: View {
    let snapshot: NativeStoreSnapshot
    let selectedWorkspace: Workspace?
    @Binding var selectedWorkspaceId: EntityID?
    @Binding var selectedWorkItemId: EntityID?
    let selectedWorkItem: WorkItem?
    @ObservedObject var model: NativeAppModel
    let activeRun: AgentRun?
    let close: () -> Void
    let navigate: (NativeRoute) -> Void
    @StateObject private var voice = VoiceCaptureController()
    @StateObject private var speaker = VoiceReportSpeaker()
    @State private var delegatedUtterance = ""
    @State private var lastSpokenRunId: EntityID?

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                VStack(alignment: .leading, spacing: 3) {
                    Text("Voice Assistant")
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundStyle(PKTheme.text)
                    Text(stageLabel)
                        .font(.caption)
                        .foregroundStyle(stageColor)
                }
                Spacer()
                StatusPill(text: report.headline, color: reportColor)
                Button(action: close) {
                    Image(systemName: "xmark")
                }
                .buttonStyle(.plain)
                .foregroundStyle(PKTheme.text3)
            }

            VoiceProgressStrip(stage: stage)
            VoiceAssistantHero(
                stage: stage,
                transcript: delegatedUtterance,
                report: report.spokenText,
                isLive: voice.isRecording || model.isRunning,
                canListen: true,
                isRecording: voice.isRecording,
                toggleListen: { voice.toggleRecording() }
            )

            VoiceStatusCard(
                title: statusTitle,
                subtitle: statusSubtitle,
                symbol: statusSymbol,
                color: stageColor
            )

            JiraTicketQuickCard(
                snapshot: snapshot,
                selectedWorkspaceId: $selectedWorkspaceId,
                selectedWorkItemId: $selectedWorkItemId,
                model: model,
                parentRunId: activeRun?.id,
                focusComposer: {
                    navigate(.chat)
                }
            )

            HStack(spacing: 8) {
                Button {
                    voice.toggleRecording()
                } label: {
                    Label(voice.isRecording ? "Stop" : "Listen", systemImage: voice.isRecording ? "stop.fill" : "mic.fill")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(voice.isRecording ? PKTheme.primaryText : PKTheme.text2)
                        .frame(maxWidth: .infinity)
                        .frame(height: 34)
                        .background(voice.isRecording ? PKTheme.err : PKTheme.control.opacity(0.78))
                        .overlay(RoundedRectangle(cornerRadius: 8).stroke(voice.isRecording ? PKTheme.err.opacity(0.7) : PKTheme.edge, lineWidth: 1))
                        .clipShape(RoundedRectangle(cornerRadius: 8))
                }
                .buttonStyle(.plain)
                .help(voice.isRecording ? "Stop listening" : "Start listening")

                VoiceLanguagePicker(
                    selection: $voice.recognitionLanguage,
                    disabled: voice.isRecording
                )
                .frame(width: 96)

                Button {
                    delegatedUtterance = ""
                    voice.transcript = ""
                } label: {
                    Image(systemName: "xmark.circle")
                        .font(.system(size: 13, weight: .semibold))
                        .frame(width: 38, height: 34)
                        .foregroundStyle(PKTheme.text2)
                        .background(PKTheme.control.opacity(0.78))
                        .overlay(RoundedRectangle(cornerRadius: 8).stroke(PKTheme.edge, lineWidth: 1))
                        .clipShape(RoundedRectangle(cornerRadius: 8))
                }
                .buttonStyle(.plain)
                .disabled(delegatedUtterance.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                .help("Clear brief")

                Button {
                    speaker.speak(report.spokenText)
                } label: {
                    Image(systemName: speaker.isSpeaking ? "speaker.slash.fill" : "speaker.wave.2.fill")
                        .font(.system(size: 13, weight: .semibold))
                        .frame(width: 38, height: 34)
                        .foregroundStyle(speaker.isSpeaking ? PKTheme.warn : PKTheme.text2)
                        .background(PKTheme.control.opacity(0.78))
                        .overlay(RoundedRectangle(cornerRadius: 8).stroke(PKTheme.edge, lineWidth: 1))
                        .clipShape(RoundedRectangle(cornerRadius: 8))
                }
                .buttonStyle(.plain)
                .help("Speak current report")
            }

            if let readiness = voice.nativeSpeechReadinessMessage, !voice.isRecording {
                VoiceHintBanner(text: readiness)
            }

            VStack(alignment: .leading, spacing: 8) {
                HStack {
                    Text("Intent Brief")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(PKTheme.text2)
                    Spacer()
                    Text(voice.statusLine)
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(stageColor)
                }

                ZStack(alignment: .topLeading) {
                    if delegatedUtterance.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                        Text("Tell me what to get done. I will turn it into an agent run and report back.")
                            .font(.system(size: 12))
                            .foregroundStyle(PKTheme.text3)
                            .padding(.top, 9)
                            .padding(.leading, 8)
                            .allowsHitTesting(false)
                    }
                    TextEditor(text: $delegatedUtterance)
                        .font(.system(size: 12))
                        .foregroundStyle(PKTheme.text)
                        .scrollContentBackground(.hidden)
                        .frame(height: 92)
                        .padding(4)
                }
                .background(PKTheme.inset.opacity(0.82))
                .overlay(RoundedRectangle(cornerRadius: 8).stroke(PKTheme.edge, lineWidth: 1))
                .clipShape(RoundedRectangle(cornerRadius: 8))
            }

            InspectorSection(title: "Delegation Plan") {
                VoiceStepRow(symbol: "folder", title: "Project", value: selectedWorkspace?.name ?? "No project", color: selectedWorkspace == nil ? PKTheme.warn : PKTheme.primary)
                VoiceStepRow(symbol: agentSymbol(plan.suggestedAgentKind), title: "Agent", value: agentShortLabel(plan.suggestedAgentKind), color: agentTint(plan.suggestedAgentKind))
                VoiceStepRow(symbol: "checkmark.shield", title: "Permission", value: permissionLabel(plan.permissionMode), color: PKTheme.warn)
                VoiceStepRow(symbol: "list.bullet.clipboard", title: "Criteria", value: "\(plan.acceptanceCriteria.count) checks", color: PKTheme.text3)
                if let selectedWorkItem {
                    VoiceStepRow(symbol: "checklist", title: "Context", value: selectedWorkItem.title, color: PKTheme.text3)
                }
            }

            InspectorSection(title: "Report") {
                Text(report.spokenText)
                    .font(.system(size: 12))
                    .foregroundStyle(PKTheme.text2)
                    .lineSpacing(3)
                    .fixedSize(horizontal: false, vertical: true)
                if let activeRun {
                    Divider().overlay(PKTheme.edge)
                    VoiceStepRow(symbol: "waveform.path.ecg", title: "Run", value: activeRun.state.rawValue, color: runStateColor(activeRun.state))
                }
            }

            if activeRun != nil {
                HStack(spacing: 8) {
                    SecondaryButton(title: "Open Chat", systemImage: "text.bubble") {
                        navigate(.chat)
                    }
                    SecondaryButton(title: "Work Item", systemImage: "checklist") {
                        if let itemId = activeRun?.workItemId {
                            selectedWorkItemId = itemId
                        }
                        navigate(.workItems)
                    }
                }
            }

            Button {
                launchDelegation()
            } label: {
                Label(model.isRunning ? "Supervising" : "Delegate to Agent", systemImage: model.isRunning ? "eye.fill" : "arrow.up.forward.circle.fill")
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(canDelegate ? PKTheme.primaryText : PKTheme.text4)
                    .frame(maxWidth: .infinity)
                    .frame(height: 38)
                    .background(canDelegate ? PKTheme.primary : PKTheme.control.opacity(0.78))
                    .clipShape(RoundedRectangle(cornerRadius: 8))
            }
            .buttonStyle(.plain)
            .disabled(!canDelegate)
            .help(canDelegate ? "Create a chat window and delegate this task" : "Add an intent brief first")

            Spacer()

            PrimaryButton(title: "Mission Control", systemImage: "gauge.with.dots.needle.67percent") {
                navigate(.missionControl)
            }
        }
        .padding(16)
        .background(PKTheme.panel.opacity(0.72))
        .overlay(RoundedRectangle(cornerRadius: 10).stroke(PKTheme.edge, lineWidth: 1))
        .clipShape(RoundedRectangle(cornerRadius: 10))
        .onChange(of: voice.transcript) { _, next in
            let trimmed = next.trimmingCharacters(in: .whitespacesAndNewlines)
            if !trimmed.isEmpty {
                delegatedUtterance = trimmed
            }
        }
        .onChange(of: activeRun?.state) { _, state in
            guard let activeRun, let state, state == .completed || state == .failed || state == .waitingForUser else { return }
            guard lastSpokenRunId != activeRun.id else { return }
            lastSpokenRunId = activeRun.id
            speaker.speak(report.spokenText)
        }
    }

    private var plan: VoiceDelegationPlan {
        VoiceAssistantPlanner.makePlan(
            utterance: planningInput,
            workspace: selectedWorkspace,
            preferredAgent: model.selectedAgentKind,
            recentWorkItem: selectedWorkItem
        )
    }

    private var planningInput: String {
        let trimmed = delegatedUtterance.trimmingCharacters(in: .whitespacesAndNewlines)
        if !trimmed.isEmpty {
            return trimmed
        }
        return activeRun?.promptSnapshot ?? ""
    }

    private var report: VoiceDelegationReport {
        VoiceAssistantPlanner.report(for: plan, run: activeRun)
    }

    private var canDelegate: Bool {
        selectedWorkspace != nil
            && !delegatedUtterance.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    private var statusTitle: String {
        switch stage {
        case .listening: return "Listening to your request"
        case .understanding: return "Turning speech into a brief"
        case .planning: return "Review and delegate"
        case .running: return "\(agentShortLabel(plan.suggestedAgentKind)) is working"
        case .needsUser: return "Decision needed"
        case .reporting: return report.headline
        case .idle: return "Ready for a voice task"
        }
    }

    private var statusSubtitle: String {
        switch stage {
        case .listening:
            return "Speak naturally. Stop when the request is complete."
        case .understanding:
            return "I am capturing the intent and preparing the agent brief."
        case .planning:
            return "Check the project, agent, and permission mode, then delegate."
        case .running:
            return "The chat window is active. I will keep watching state changes."
        case .needsUser:
            return "Open the chat or Work Item to answer the agent's question."
        case .reporting:
            return report.spokenText
        case .idle:
            return "Use Listen, or type a brief directly if microphone access is not ready."
        }
    }

    private var statusSymbol: String {
        switch stage {
        case .listening, .understanding: return "mic.fill"
        case .planning: return "list.bullet.clipboard"
        case .running: return "eye.fill"
        case .needsUser: return "person.crop.circle.badge.exclamationmark"
        case .reporting: return "speaker.wave.2.fill"
        case .idle: return "waveform.circle"
        }
    }

    private var stageLabel: String {
        switch stage {
        case .listening: return "Listening"
        case .understanding: return "Understanding"
        case .planning: return "Voice Assistant ready"
        case .running: return "Supervising"
        case .needsUser: return "Needs you"
        case .reporting: return "Reporting"
        case .idle: return "Standing by"
        }
    }

    private var stage: VoiceDelegationStage {
        if voice.isRecording { return .listening }
        if activeRun?.state == .waitingForUser { return .needsUser }
        if model.isRunning { return .running }
        if activeRun?.state == .completed || activeRun?.state == .failed { return .reporting }
        if !delegatedUtterance.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { return .planning }
        return .idle
    }

    private var stageColor: Color {
        switch stage {
        case .listening, .understanding: return PKTheme.primary
        case .planning: return PKTheme.warn
        case .running: return PKTheme.ok
        case .needsUser: return PKTheme.warn
        case .reporting: return reportColor
        case .idle: return PKTheme.text3
        }
    }

    private var reportColor: Color {
        switch report.tone {
        case "active": return PKTheme.ok
        case "attention": return PKTheme.warn
        case "done": return PKTheme.ok
        case "failed": return PKTheme.err
        default: return PKTheme.text3
        }
    }

    private func launchDelegation() {
        let preparedPlan = plan
        Task {
            if let runId = await model.startVoiceDelegation(
                preparedPlan,
                workspaceId: selectedWorkspaceId,
                targetWorkItemId: selectedWorkItemId
            ),
               let run = model.snapshot.runs.first(where: { $0.id == runId }) {
                selectedWorkItemId = run.workItemId
            }
        }
    }
}

private struct VoiceProgressStrip: View {
    let stage: VoiceDelegationStage

    private let steps: [(VoiceDelegationStage, String, String)] = [
        (.listening, "Listen", "mic.fill"),
        (.planning, "Plan", "list.bullet.clipboard"),
        (.running, "Run", "play.fill"),
        (.reporting, "Report", "speaker.wave.2.fill")
    ]

    var body: some View {
        HStack(spacing: 7) {
            ForEach(steps, id: \.0.rawValue) { item in
                let active = isActive(item.0)
                HStack(spacing: 5) {
                    Image(systemName: item.2)
                        .font(.system(size: 10, weight: .semibold))
                    Text(item.1)
                        .font(.system(size: 11, weight: .semibold))
                        .lineLimit(1)
                }
                .foregroundStyle(active ? PKTheme.primaryText : PKTheme.text3)
                .frame(maxWidth: .infinity)
                .frame(height: 28)
                .background(active ? progressColor.opacity(0.92) : PKTheme.control.opacity(0.58))
                .overlay(RoundedRectangle(cornerRadius: 7).stroke(active ? progressColor.opacity(0.95) : PKTheme.edge, lineWidth: 1))
                .clipShape(RoundedRectangle(cornerRadius: 7))
            }
        }
    }

    private var progressColor: Color {
        switch stage {
        case .listening, .understanding, .planning: return PKTheme.primary
        case .running: return PKTheme.ok
        case .needsUser: return PKTheme.warn
        case .reporting: return PKTheme.ok
        case .idle: return PKTheme.text3
        }
    }

    private func isActive(_ item: VoiceDelegationStage) -> Bool {
        switch (stage, item) {
        case (.listening, .listening), (.understanding, .listening):
            return true
        case (.planning, .planning):
            return true
        case (.running, .running), (.needsUser, .running):
            return true
        case (.reporting, .reporting):
            return true
        default:
            return false
        }
    }
}

private struct VoiceStatusCard: View {
    let title: String
    let subtitle: String
    let symbol: String
    let color: Color

    var body: some View {
        HStack(alignment: .top, spacing: 11) {
            Image(systemName: symbol)
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(color)
                .frame(width: 34, height: 34)
                .background(color.opacity(0.12))
                .clipShape(RoundedRectangle(cornerRadius: 8))
            VStack(alignment: .leading, spacing: 4) {
                Text(title)
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(PKTheme.text)
                    .lineLimit(1)
                Text(subtitle)
                    .font(.system(size: 12))
                    .foregroundStyle(PKTheme.text3)
                    .lineLimit(3)
            }
            Spacer(minLength: 0)
        }
        .padding(12)
        .background(PKTheme.panelAlt.opacity(0.48))
        .overlay(RoundedRectangle(cornerRadius: 8).stroke(color.opacity(0.24), lineWidth: 1))
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }
}

private struct VoiceHintBanner: View {
    let text: String

    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            Image(systemName: "info.circle")
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(PKTheme.warn)
                .padding(.top, 1)
            Text(text)
                .font(.system(size: 11))
                .foregroundStyle(PKTheme.text3)
                .lineLimit(3)
            Spacer(minLength: 0)
        }
        .padding(10)
        .background(PKTheme.warn.opacity(0.08))
        .overlay(RoundedRectangle(cornerRadius: 8).stroke(PKTheme.warn.opacity(0.20), lineWidth: 1))
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }
}

private struct VoiceAssistantHero: View {
    let stage: VoiceDelegationStage
    let transcript: String
    let report: String
    let isLive: Bool
    let canListen: Bool
    let isRecording: Bool
    let toggleListen: () -> Void

    private var heroText: String {
        let trimmed = transcript.trimmingCharacters(in: .whitespacesAndNewlines)
        if !trimmed.isEmpty {
            return trimmed
        }
        return report
    }

    var body: some View {
        ZStack(alignment: .top) {
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .fill(
                    LinearGradient(
                        colors: [
                            PKTheme.panelAlt.opacity(0.78),
                            PKTheme.inset.opacity(0.88)
                        ],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    )
                )
                .overlay(
                    RoundedRectangle(cornerRadius: 18, style: .continuous)
                        .stroke(PKTheme.edgeStrong.opacity(0.48), lineWidth: 1)
                )
                .frame(height: 164)
                .padding(.top, 54)

            VStack(spacing: 8) {
                Button(action: toggleListen) {
                    ZStack {
                        VoiceRippleHalo(isLive: isLive, color: stageColor)
                        VoiceRobotAvatar(size: 124, isLive: isLive, stage: stage)
                    }
                    .frame(width: 150, height: 118)
                }
                .buttonStyle(.plain)
                .disabled(!canListen)
                .help(isRecording ? "Stop listening" : "Start listening")

                VStack(spacing: 7) {
                    HStack(spacing: 7) {
                        Image(systemName: isRecording ? "mic.fill" : "sparkle.magnifyingglass")
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundStyle(stageColor)
                        Text(isRecording ? "Listening..." : heroTitle)
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(PKTheme.text)
                            .lineLimit(1)
                        Spacer(minLength: 0)
                    }

                    Text(heroText)
                        .font(.system(size: 12))
                        .foregroundStyle(PKTheme.text3)
                        .lineSpacing(2)
                        .lineLimit(3)
                        .frame(maxWidth: .infinity, alignment: .leading)

                    VoiceWaveform(isLive: isLive, color: stageColor)
                        .frame(height: 30)
                }
                .padding(.horizontal, 16)
                .padding(.bottom, 12)
            }
        }
        .frame(height: 218)
    }

    private var heroTitle: String {
        switch stage {
        case .listening, .understanding: return "I am catching the request"
        case .planning: return "Ready to hand this to an agent"
        case .running: return "Watching the agent work"
        case .needsUser: return "I need you for a decision"
        case .reporting: return "Here is the report"
        case .idle: return "Tap the robot or Listen"
        }
    }

    private var stageColor: Color {
        switch stage {
        case .listening, .understanding, .planning: return PKTheme.primary
        case .running: return PKTheme.ok
        case .needsUser: return PKTheme.warn
        case .reporting: return PKTheme.ok
        case .idle: return PKTheme.text3
        }
    }
}

private struct VoiceListeningOrb: View {
    let level: Double
    let isListening: Bool
    let isThinking: Bool
    let isSpeaking: Bool
    let color: Color
    var compact: Bool = false

    private var isActive: Bool {
        isListening || isThinking || isSpeaking
    }

    private var displayLevel: Double {
        if isListening { return level }
        if isSpeaking { return 0.56 }
        if isThinking { return 0.32 }
        return 0.10
    }

    var body: some View {
        ZStack {
            Circle()
                .fill(
                    RadialGradient(
                        colors: [
                            Color.white.opacity(0.88),
                            color.opacity(isActive ? 0.34 : 0.18),
                            PKTheme.panelAlt.opacity(0.84)
                        ],
                        center: .topLeading,
                        startRadius: compact ? 2 : 10,
                        endRadius: compact ? 34 : 118
                    )
                )
                .overlay(Circle().stroke(Color.white.opacity(0.22), lineWidth: 1))
                .shadow(color: color.opacity(isActive ? 0.28 : 0.12), radius: compact ? 10 : 24, y: compact ? 5 : 14)
                .scaleEffect(1 + CGFloat(displayLevel) * (compact ? 0.035 : 0.055))

            VoiceLevelWaveform(
                level: displayLevel,
                isLive: isActive,
                color: compact ? PKTheme.primaryText.opacity(0.95) : Color.black.opacity(0.74),
                barCount: compact ? 9 : 19,
                maxHeight: compact ? 22 : 58,
                barWidth: compact ? 3 : 4,
                spacing: compact ? 2.5 : 4
            )
            .padding(.horizontal, compact ? 9 : 30)
        }
        .animation(.spring(response: 0.22, dampingFraction: 0.72), value: displayLevel)
        .accessibilityLabel(isListening ? "Voice is listening" : isSpeaking ? "Voice is speaking" : "Voice")
    }
}

private struct VoiceDockButton: View {
    let isLive: Bool
    var isSelected: Bool = false
    @State private var hovering = false
    @State private var pulse = false

    private var accent: Color {
        isLive ? PKTheme.ok : PKTheme.primary
    }

    var body: some View {
        ZStack(alignment: .topTrailing) {
            RoundedRectangle(cornerRadius: 11, style: .continuous)
                .fill(isSelected ? PKTheme.primary : hovering ? PKTheme.control.opacity(0.72) : PKTheme.panel.opacity(0.62))
                .overlay(
                    RoundedRectangle(cornerRadius: 11, style: .continuous)
                        .stroke(isSelected ? PKTheme.primary.opacity(0.95) : accent.opacity(hovering ? 0.74 : 0.36), lineWidth: 1)
                )
                .shadow(color: accent.opacity(isSelected || hovering ? 0.16 : 0.0), radius: 12, y: 6)

            VStack(spacing: 4) {
                Image(systemName: isLive ? "waveform.path.ecg" : "waveform")
                    .font(.system(size: 15, weight: .semibold))
                    .frame(width: 28, height: 24)
                    .scaleEffect(isLive && pulse ? 1.06 : 1)
                Text("Voice")
                    .font(.system(size: 9, weight: .semibold))
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
            }
            .frame(width: 54, height: 52)
            .foregroundStyle(isSelected ? PKTheme.primaryText : accent)

            if isLive || isSelected {
                Circle()
                    .fill(accent)
                    .frame(width: 6, height: 6)
                    .padding(7)
                    .opacity(isLive && pulse ? 0.62 : 1)
            }
        }
        .frame(width: 54, height: 52)
        .clipShape(RoundedRectangle(cornerRadius: 11, style: .continuous))
        .onHover { inside in
            withAnimation(.easeInOut(duration: 0.14)) {
                hovering = inside
            }
        }
        .onAppear {
            pulse = isLive
        }
        .onChange(of: isLive) { _, live in
            pulse = live
        }
        .animation(isLive ? .easeInOut(duration: 0.9).repeatForever(autoreverses: true) : .default, value: pulse)
        .animation(.easeInOut(duration: 0.14), value: isSelected)
    }
}

private struct VoiceRippleHalo: View {
    let isLive: Bool
    let color: Color
    var compact: Bool = false
    @State private var pulse = false

    var body: some View {
        ZStack {
            ForEach(0..<3, id: \.self) { index in
                Circle()
                    .stroke(color.opacity(isLive ? 0.24 : 0.09), lineWidth: compact ? 1 : 1.4)
                    .scaleEffect(pulse && isLive ? 1.0 + CGFloat(index) * 0.20 : 0.62 + CGFloat(index) * 0.08)
                    .opacity(isLive ? (pulse ? 0.12 : 0.36) : 0.12)
                    .animation(
                        .easeOut(duration: compact ? 1.0 : 1.35)
                            .repeatForever(autoreverses: false)
                            .delay(Double(index) * 0.18),
                        value: pulse
                    )
            }
            Circle()
                .fill(color.opacity(isLive ? 0.12 : 0.05))
                .scaleEffect(isLive ? 0.72 : 0.56)
        }
        .frame(width: compact ? 46 : 150, height: compact ? 46 : 150)
        .onAppear { pulse = true }
    }
}

private struct VoiceRobotAvatar: View {
    let size: CGFloat
    let isLive: Bool
    let stage: VoiceDelegationStage
    @State private var bob = false

    private var accent: Color {
        switch stage {
        case .running, .reporting: return PKTheme.ok
        case .needsUser: return PKTheme.warn
        case .idle: return PKTheme.primary
        default: return PKTheme.primary
        }
    }

    var body: some View {
        ZStack {
            ears
                .offset(y: -size * 0.22)

            RoundedRectangle(cornerRadius: size * 0.24, style: .continuous)
                .fill(
                    LinearGradient(
                        colors: [
                            Color.white.opacity(0.96),
                            PKTheme.surfaceRaised.opacity(0.88),
                            PKTheme.panelAlt.opacity(0.76)
                        ],
                        startPoint: .top,
                        endPoint: .bottom
                    )
                )
                .overlay(
                    RoundedRectangle(cornerRadius: size * 0.24, style: .continuous)
                        .stroke(PKTheme.edgeStrong.opacity(0.54), lineWidth: max(1, size * 0.018))
                )
                .frame(width: size * 0.78, height: size * 0.52)
                .shadow(color: Color.black.opacity(0.18), radius: size * 0.11, y: size * 0.05)
                .offset(y: size * 0.03)

            RoundedRectangle(cornerRadius: size * 0.16, style: .continuous)
                .fill(
                    LinearGradient(
                        colors: [
                            Color.black.opacity(0.88),
                            Color(red: 0.11, green: 0.16, blue: 0.17).opacity(0.94)
                        ],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    )
                )
                .frame(width: size * 0.62, height: size * 0.32)
                .overlay(face)
                .offset(y: size * 0.06)

            headphones
                .offset(y: size * 0.06)

            RoundedRectangle(cornerRadius: size * 0.08, style: .continuous)
                .fill(PKTheme.surfaceRaised.opacity(0.92))
                .frame(width: size * 0.82, height: size * 0.11)
                .offset(y: size * 0.34)
                .overlay(
                    RoundedRectangle(cornerRadius: size * 0.08, style: .continuous)
                        .stroke(PKTheme.edge.opacity(0.8), lineWidth: 1)
                        .offset(y: size * 0.34)
                )
        }
        .frame(width: size, height: size * 0.86)
        .offset(y: bob && isLive ? -size * 0.025 : size * 0.01)
        .animation(.easeInOut(duration: 0.9).repeatForever(autoreverses: true), value: bob)
        .onAppear { bob = true }
    }

    private var ears: some View {
        HStack(spacing: size * 0.36) {
            robotEar(rotation: -20)
            robotEar(rotation: 20)
        }
    }

    private func robotEar(rotation: Double) -> some View {
        RoundedRectangle(cornerRadius: size * 0.06, style: .continuous)
            .fill(
                LinearGradient(
                    colors: [
                        PKTheme.surfaceRaised.opacity(0.95),
                        PKTheme.text3.opacity(0.45)
                    ],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                )
            )
            .overlay(
                RoundedRectangle(cornerRadius: size * 0.05, style: .continuous)
                    .fill(Color.black.opacity(0.64))
                    .padding(size * 0.04)
            )
            .frame(width: size * 0.20, height: size * 0.30)
            .rotationEffect(.degrees(rotation))
    }

    private var face: some View {
        HStack(spacing: size * 0.13) {
            Capsule(style: .continuous)
                .fill(accent)
                .frame(width: size * 0.035, height: isLive ? size * 0.15 : size * 0.11)
                .shadow(color: accent.opacity(0.72), radius: size * 0.025)
            Image(systemName: stage == .needsUser ? "exclamationmark" : "sparkle")
                .font(.system(size: size * 0.14, weight: .bold))
                .foregroundStyle(accent)
                .shadow(color: accent.opacity(0.6), radius: size * 0.025)
            Capsule(style: .continuous)
                .fill(accent)
                .frame(width: size * 0.035, height: isLive ? size * 0.15 : size * 0.11)
                .shadow(color: accent.opacity(0.72), radius: size * 0.025)
        }
    }

    private var headphones: some View {
        HStack(spacing: size * 0.62) {
            headphoneCup
            headphoneCup
        }
    }

    private var headphoneCup: some View {
        RoundedRectangle(cornerRadius: size * 0.08, style: .continuous)
            .fill(
                LinearGradient(
                    colors: [
                        Color.black.opacity(0.72),
                        PKTheme.text3.opacity(0.56),
                        Color.white.opacity(0.36)
                    ],
                    startPoint: .leading,
                    endPoint: .trailing
                )
            )
            .overlay(
                RoundedRectangle(cornerRadius: size * 0.06, style: .continuous)
                    .stroke(PKTheme.edgeStrong.opacity(0.55), lineWidth: 1)
            )
            .frame(width: size * 0.14, height: size * 0.30)
    }
}

private struct VoiceWaveform: View {
    let isLive: Bool
    let color: Color
    var level: Double = 0

    var body: some View {
        VoiceLevelWaveform(
            level: level,
            isLive: isLive,
            color: color,
            barCount: 24,
            maxHeight: 42
        )
        .frame(maxWidth: .infinity)
        .frame(height: 44)
        .background(PKTheme.inset.opacity(0.62))
        .overlay(RoundedRectangle(cornerRadius: 8).stroke(color.opacity(isLive ? 0.40 : 0.18), lineWidth: 1))
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }
}

private struct VoiceLevelWaveform: View {
    let level: Double
    let isLive: Bool
    let color: Color
    var barCount: Int = 20
    var maxHeight: CGFloat = 44
    var barWidth: CGFloat = 4
    var spacing: CGFloat = 4

    var body: some View {
        TimelineView(.animation) { timeline in
            let time = timeline.date.timeIntervalSinceReferenceDate
            HStack(alignment: .center, spacing: spacing) {
                ForEach(0..<barCount, id: \.self) { index in
                    RoundedRectangle(cornerRadius: barWidth / 2)
                        .fill(color.opacity(isLive ? 0.88 : 0.34))
                        .frame(width: barWidth, height: barHeight(index, time: time))
                }
            }
            .frame(maxWidth: .infinity)
        }
    }

    private func barHeight(_ index: Int, time: TimeInterval) -> CGFloat {
        let normalized = max(0, min(1, level))
        let activity = isLive ? max(0.18, normalized) : 0.08
        let center = Double(barCount - 1) / 2
        let distance = abs(Double(index) - center) / max(center, 1)
        let envelope = 1 - min(0.82, distance * 0.72)
        let ripple = (sin(time * 7.6 + Double(index) * 0.74) + 1) / 2
        let liveBoost = activity * (0.42 + ripple * 0.72) * envelope
        let idle = 0.16 + envelope * 0.18
        return max(6, maxHeight * CGFloat(isLive ? liveBoost : idle))
    }
}

private struct VoiceStepRow: View {
    let symbol: String
    let title: String
    let value: String
    let color: Color

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: symbol)
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(color)
                .frame(width: 24, height: 24)
                .background(color.opacity(0.12))
                .clipShape(RoundedRectangle(cornerRadius: 6))
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(PKTheme.text3)
                Text(value)
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(PKTheme.text2)
                    .lineLimit(1)
            }
            Spacer(minLength: 0)
        }
    }
}

private struct VoiceLanguagePicker: View {
    @Binding var selection: VoiceRecognitionLanguage
    let disabled: Bool

    var body: some View {
        Picker("Speech Language", selection: $selection) {
            ForEach(VoiceRecognitionLanguage.allCases) { language in
                Text(language.displayName).tag(language)
            }
        }
        .pickerStyle(.menu)
        .controlSize(.small)
        .labelsHidden()
        .disabled(disabled)
        .help("Speech language: \(selection.displayName)")
    }
}

private struct VoiceAssistantPage: View {
    let snapshot: NativeStoreSnapshot
    @Binding var selectedWorkspaceId: EntityID?
    @Binding var selectedWorkItemId: EntityID?
    @ObservedObject var model: NativeAppModel
    let navigate: (NativeRoute) -> Void
    @StateObject private var voice = VoiceCaptureController()
    @StateObject private var speaker = VoiceReportSpeaker()
    @State private var delegatedUtterance = ""
    @State private var lastSpokenRunId: EntityID?

    private var selectedWorkspace: Workspace? {
        if let selectedWorkspaceId,
           let workspace = snapshot.workspaces.first(where: { $0.id == selectedWorkspaceId }) {
            return workspace
        }
        return snapshot.workspaces.first
    }

    private var selectedWorkItem: WorkItem? {
        snapshot.workItems.first(where: { $0.id == selectedWorkItemId })
    }

    private var activeRun: AgentRun? {
        guard let activeRunId = model.activeRunId else { return nil }
        return snapshot.runs.first(where: { $0.id == activeRunId })
    }

    var body: some View {
        HStack(spacing: 0) {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    voiceHeader

                    VStack(spacing: 16) {
                        VoiceAssistantHero(
                            stage: stage,
                            transcript: delegatedUtterance,
                            report: report.spokenText,
                            isLive: voice.isRecording || model.isRunning,
                            canListen: true,
                            isRecording: voice.isRecording,
                            toggleListen: { voice.toggleRecording() }
                        )
                        .frame(maxWidth: 760)

                        VoiceProgressStrip(stage: stage)
                            .frame(maxWidth: 760)

                        voiceActions
                            .frame(maxWidth: 760)

                        if let readiness = voice.nativeSpeechReadinessMessage, !voice.isRecording {
                            VoiceHintBanner(text: readiness)
                                .frame(maxWidth: 760)
                        }

                        capturedBriefPanel
                            .frame(maxWidth: 760)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.top, 8)
                }
                .padding(28)
                .frame(maxWidth: .infinity, alignment: .topLeading)
            }

            Divider().overlay(PKTheme.edge)

            voiceSidebar
                .frame(width: 344)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(PKTheme.surface.opacity(0.2))
        .onChange(of: voice.transcript) { _, next in
            let trimmed = next.trimmingCharacters(in: .whitespacesAndNewlines)
            if !trimmed.isEmpty {
                delegatedUtterance = trimmed
            }
        }
        .onChange(of: activeRun?.state) { _, state in
            guard let activeRun, let state, state == .completed || state == .failed || state == .waitingForUser else { return }
            guard lastSpokenRunId != activeRun.id else { return }
            lastSpokenRunId = activeRun.id
            speaker.speak(report.spokenText)
        }
    }

    private var voiceHeader: some View {
        HStack(alignment: .center, spacing: 14) {
            ZStack {
                VoiceRippleHalo(isLive: voice.isRecording || model.isRunning, color: stageColor, compact: true)
                VoiceRobotAvatar(size: 50, isLive: voice.isRecording || model.isRunning, stage: stage)
            }
            .frame(width: 58, height: 52)

            VStack(alignment: .leading, spacing: 4) {
                Text("Voice Assistant")
                    .font(.system(size: 26, weight: .semibold))
                    .foregroundStyle(PKTheme.text)
                Text("Speak the outcome. I will open the right agent chat, supervise it, and report back.")
                    .font(.system(size: 13))
                    .foregroundStyle(PKTheme.text3)
                    .lineLimit(2)
            }

            Spacer()

            StatusPill(text: stageLabel, color: stageColor)
            StatusPill(text: selectedWorkspace?.name ?? "No Project", color: selectedWorkspace == nil ? PKTheme.warn : PKTheme.primary)
        }
    }

    private var voiceActions: some View {
        HStack(spacing: 10) {
            Button {
                voice.toggleRecording()
            } label: {
                Label(voice.isRecording ? "Stop" : "Listen", systemImage: voice.isRecording ? "stop.fill" : "mic.fill")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(voice.isRecording ? PKTheme.primaryText : PKTheme.text)
                    .frame(maxWidth: .infinity)
                    .frame(height: 42)
                    .background(voice.isRecording ? PKTheme.err : PKTheme.primary.opacity(0.92))
                    .overlay(RoundedRectangle(cornerRadius: 9).stroke((voice.isRecording ? PKTheme.err : PKTheme.primary).opacity(0.72), lineWidth: 1))
                    .clipShape(RoundedRectangle(cornerRadius: 9))
            }
            .buttonStyle(.plain)
            .help(voice.isRecording ? "Stop listening" : "Start listening")

            VoiceLanguagePicker(
                selection: $voice.recognitionLanguage,
                disabled: voice.isRecording
            )
            .frame(width: 112)

            Button {
                launchDelegation()
            } label: {
                Label(model.isRunning ? "Supervising" : "Delegate", systemImage: model.isRunning ? "eye.fill" : "arrow.up.forward.circle.fill")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(canDelegate ? PKTheme.primaryText : PKTheme.text4)
                    .frame(maxWidth: .infinity)
                    .frame(height: 42)
                    .background(canDelegate ? PKTheme.ok.opacity(0.92) : PKTheme.control.opacity(0.72))
                    .overlay(RoundedRectangle(cornerRadius: 9).stroke(canDelegate ? PKTheme.ok.opacity(0.72) : PKTheme.edge, lineWidth: 1))
                    .clipShape(RoundedRectangle(cornerRadius: 9))
            }
            .buttonStyle(.plain)
            .disabled(!canDelegate)
            .help(canDelegate ? "Create an agent chat from this voice task" : "Capture a voice task first")

            Button {
                if speaker.isSpeaking {
                    speaker.stop()
                } else {
                    speaker.speak(report.spokenText)
                }
            } label: {
                Image(systemName: speaker.isSpeaking ? "speaker.slash.fill" : "speaker.wave.2.fill")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(speaker.isSpeaking ? PKTheme.warn : PKTheme.text2)
                    .frame(width: 44, height: 42)
                    .background(PKTheme.control.opacity(0.78))
                    .overlay(RoundedRectangle(cornerRadius: 9).stroke(PKTheme.edge, lineWidth: 1))
                    .clipShape(RoundedRectangle(cornerRadius: 9))
            }
            .buttonStyle(.plain)
            .help("Speak current report")

            Button {
                delegatedUtterance = ""
                voice.transcript = ""
            } label: {
                Image(systemName: "xmark.circle")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(PKTheme.text2)
                    .frame(width: 44, height: 42)
                    .background(PKTheme.control.opacity(0.78))
                    .overlay(RoundedRectangle(cornerRadius: 9).stroke(PKTheme.edge, lineWidth: 1))
                    .clipShape(RoundedRectangle(cornerRadius: 9))
            }
            .buttonStyle(.plain)
            .disabled(delegatedUtterance.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            .help("Clear captured brief")
        }
    }

    private var capturedBriefPanel: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Label("Captured Request", systemImage: "quote.bubble")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(PKTheme.text2)
                Spacer()
                Text(voice.statusLine)
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(stageColor)
            }

            Text(capturedBriefText)
                .font(.system(size: 14, weight: delegatedUtterance.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? .medium : .regular))
                .foregroundStyle(delegatedUtterance.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? PKTheme.text3 : PKTheme.text)
                .lineSpacing(3)
                .frame(maxWidth: .infinity, minHeight: 68, alignment: .topLeading)
                .padding(14)
            .background(PKTheme.inset.opacity(0.82))
            .overlay(RoundedRectangle(cornerRadius: 10).stroke(PKTheme.edge, lineWidth: 1))
            .clipShape(RoundedRectangle(cornerRadius: 10))
        }
        .padding(16)
        .background(PKTheme.panel.opacity(0.68))
        .overlay(RoundedRectangle(cornerRadius: 11).stroke(PKTheme.edgeStrong.opacity(0.42), lineWidth: 1))
        .clipShape(RoundedRectangle(cornerRadius: 11))
    }

    private var capturedBriefText: String {
        let trimmed = delegatedUtterance.trimmingCharacters(in: .whitespacesAndNewlines)
        if !trimmed.isEmpty {
            return trimmed
        }
        return "The robot will show what it hears here. Try: Help me add image paste support to the input composer and verify it."
    }

    private var voiceSidebar: some View {
        VStack(alignment: .leading, spacing: 14) {
            VoiceStatusCard(
                title: statusTitle,
                subtitle: statusSubtitle,
                symbol: statusSymbol,
                color: stageColor
            )

            if voice.nativeSpeechReadinessMessage != nil || !delegatedUtterance.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                fallbackBriefEditor
            }

            InspectorSection(title: "Delegation Plan") {
                VoiceStepRow(symbol: "folder", title: "Project", value: selectedWorkspace?.name ?? "No project", color: selectedWorkspace == nil ? PKTheme.warn : PKTheme.primary)
                VoiceStepRow(symbol: agentSymbol(plan.suggestedAgentKind), title: "Agent", value: agentShortLabel(plan.suggestedAgentKind), color: agentTint(plan.suggestedAgentKind))
                VoiceStepRow(symbol: "checkmark.shield", title: "Permission", value: permissionLabel(plan.permissionMode), color: PKTheme.warn)
                VoiceStepRow(symbol: "list.bullet.clipboard", title: "Criteria", value: "\(plan.acceptanceCriteria.count) checks", color: PKTheme.text3)
                if let selectedWorkItem {
                    VoiceStepRow(symbol: "checklist", title: "Context", value: selectedWorkItem.title, color: PKTheme.text3)
                }
            }

            InspectorSection(title: "Report") {
                Text(report.spokenText)
                    .font(.system(size: 12))
                    .foregroundStyle(PKTheme.text2)
                    .lineSpacing(3)
                    .fixedSize(horizontal: false, vertical: true)
                if let activeRun {
                    Divider().overlay(PKTheme.edge)
                    VoiceStepRow(symbol: "waveform.path.ecg", title: "Run", value: activeRun.state.rawValue, color: runStateColor(activeRun.state))
                }
            }

            HStack(spacing: 8) {
                SecondaryButton(title: "Chat", systemImage: "text.bubble") {
                    navigate(.chat)
                }
                SecondaryButton(title: "Mission", systemImage: "gauge.with.dots.needle.67percent") {
                    navigate(.missionControl)
                }
            }

            if activeRun != nil {
                SecondaryButton(title: "Open Work Item", systemImage: "checklist") {
                    if let itemId = activeRun?.workItemId {
                        selectedWorkItemId = itemId
                    }
                    navigate(.workItems)
                }
            }

            Spacer()
        }
        .padding(18)
        .background(PKTheme.panel.opacity(0.52))
    }

    private var fallbackBriefEditor: some View {
        InspectorSection(title: "Manual Fallback") {
            TextEditor(text: $delegatedUtterance)
                .font(.system(size: 12))
                .foregroundStyle(PKTheme.text)
                .lineSpacing(2)
                .scrollContentBackground(.hidden)
                .frame(height: 66)
                .padding(6)
                .background(PKTheme.inset.opacity(0.78))
                .overlay(RoundedRectangle(cornerRadius: 8).stroke(PKTheme.edge, lineWidth: 1))
                .clipShape(RoundedRectangle(cornerRadius: 8))
        }
    }

    private var plan: VoiceDelegationPlan {
        VoiceAssistantPlanner.makePlan(
            utterance: planningInput,
            workspace: selectedWorkspace,
            preferredAgent: model.selectedAgentKind,
            recentWorkItem: selectedWorkItem
        )
    }

    private var planningInput: String {
        let trimmed = delegatedUtterance.trimmingCharacters(in: .whitespacesAndNewlines)
        if !trimmed.isEmpty {
            return trimmed
        }
        return activeRun?.promptSnapshot ?? ""
    }

    private var report: VoiceDelegationReport {
        VoiceAssistantPlanner.report(for: plan, run: activeRun)
    }

    private var canDelegate: Bool {
        selectedWorkspace != nil
            && !delegatedUtterance.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    private var statusTitle: String {
        switch stage {
        case .listening: return "Listening to your request"
        case .understanding: return "Turning speech into a Pikiclaw action"
        case .planning: return "Voice Assistant ready"
        case .running: return "Voice Assistant is working"
        case .needsUser: return "Decision needed"
        case .reporting: return report.headline
        case .idle: return "Ready for a Pikiclaw request"
        }
    }

    private var statusSubtitle: String {
        switch stage {
        case .listening:
            return "Speak naturally. The robot will keep the task brief here."
        case .understanding:
            return "I am shaping the request into an agent-ready brief."
        case .planning:
            return "Review the target and hand it to the selected agent."
        case .running:
            return "The chat window is active. I will keep watching state changes."
        case .needsUser:
            return "Open the chat or Work Item to answer the agent's question."
        case .reporting:
            return report.spokenText
        case .idle:
            return "Tap the robot or Listen to start a voice delegation."
        }
    }

    private var statusSymbol: String {
        switch stage {
        case .listening, .understanding: return "mic.fill"
        case .planning: return "list.bullet.clipboard"
        case .running: return "eye.fill"
        case .needsUser: return "person.crop.circle.badge.exclamationmark"
        case .reporting: return "speaker.wave.2.fill"
        case .idle: return "waveform.circle"
        }
    }

    private var stageLabel: String {
        switch stage {
        case .listening: return "LISTENING"
        case .understanding: return "UNDERSTANDING"
        case .planning: return "READY"
        case .running: return "SUPERVISING"
        case .needsUser: return "NEEDS YOU"
        case .reporting: return "REPORT"
        case .idle: return "VOICE"
        }
    }

    private var stage: VoiceDelegationStage {
        if voice.isRecording { return .listening }
        if activeRun?.state == .waitingForUser { return .needsUser }
        if model.isRunning { return .running }
        if activeRun?.state == .completed || activeRun?.state == .failed { return .reporting }
        if !delegatedUtterance.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { return .planning }
        return .idle
    }

    private var stageColor: Color {
        switch stage {
        case .listening, .understanding: return PKTheme.primary
        case .planning: return PKTheme.warn
        case .running: return PKTheme.ok
        case .needsUser: return PKTheme.warn
        case .reporting: return reportColor
        case .idle: return PKTheme.primary
        }
    }

    private var reportColor: Color {
        switch report.tone {
        case "active": return PKTheme.ok
        case "attention": return PKTheme.warn
        case "done": return PKTheme.ok
        case "failed": return PKTheme.err
        default: return PKTheme.text3
        }
    }

    private func launchDelegation() {
        let preparedPlan = plan
        Task {
            if let runId = await model.startVoiceDelegation(
                preparedPlan,
                workspaceId: selectedWorkspaceId,
                targetWorkItemId: selectedWorkItemId
            ),
               let run = model.snapshot.runs.first(where: { $0.id == runId }) {
                selectedWorkItemId = run.workItemId
            }
        }
    }
}

private struct VoiceAssistantOverlay: View {
    let snapshot: NativeStoreSnapshot
    @Binding var selectedWorkspaceId: EntityID?
    @Binding var selectedWorkItemId: EntityID?
    @ObservedObject var model: NativeAppModel
    let autoStart: Bool
    let close: () -> Void
    let navigate: (NativeRoute) -> Void

    @StateObject private var voice = ContinuousVoiceSessionController()
    @StateObject private var speaker = VoiceReportSpeaker()
    @AppStorage("PikiclawMac.voiceboxEnabled") private var voiceboxEnabled = true
    @AppStorage("PikiclawMac.voiceboxBaseURL") private var voiceboxBaseURL = "http://127.0.0.1:17493"
    @AppStorage("PikiclawMac.voiceboxProfile") private var voiceboxProfile = ""
    @AppStorage("PikiclawMac.voiceboxSTTModel") private var voiceboxSTTModel = "turbo"
    @AppStorage("PikiclawMac.voiceboxTTSEngine") private var voiceboxTTSEngine = ""
    @AppStorage("PikiclawMac.voiceboxPersonality") private var voiceboxPersonality = false
    @AppStorage("PikiclawMac.systemSpeechVoiceIdentifier") private var systemSpeechVoiceIdentifier = ""
    @AppStorage("PikiclawMac.systemSpeechVoiceTone") private var systemSpeechVoiceTone = VoiceReportTone.natural.rawValue
    @AppStorage("PikiclawMac.voiceAutoDelegate") private var voiceAutoDelegate = true
    @State private var delegatedUtterance = ""
    @State private var conversationTurns: [VoiceConversationTurn] = []
    @State private var assistantThinking = false
    @State private var engineSettingsExpanded = false
    @State private var voiceOutputMuted = false
    @State private var inputMode: VoiceAssistantInputMode = .voice
    @State private var lastCommittedUtterance = ""
    @State private var lastSpokenRunId: EntityID?
    @State private var didAutoStart = false
    @State private var didGreet = false
    @State private var isOpeningGreeting = false
    @State private var openingGreetingTask: Task<Void, Never>?
    @State private var transcriptCommitTask: Task<Void, Never>?
    @State private var speechResumeTask: Task<Void, Never>?
    @State private var voiceConversationRunId: EntityID?
    @FocusState private var briefFocused: Bool

    private var selectedWorkspace: Workspace? {
        if let selectedWorkspaceId,
           let workspace = snapshot.workspaces.first(where: { $0.id == selectedWorkspaceId }) {
            return workspace
        }
        return snapshot.workspaces.first
    }

    private var selectedWorkItem: WorkItem? {
        snapshot.workItems.first(where: { $0.id == selectedWorkItemId })
    }

    private var activeRun: AgentRun? {
        if let voiceConversationRunId,
           let run = snapshot.runs.first(where: { $0.id == voiceConversationRunId }) {
            return run
        }
        if let activeRunId = model.activeRunId,
           let run = snapshot.runs.first(where: { $0.id == activeRunId }) {
            return run
        }
        return nil
    }

    private var activeVoiceRuns: [AgentRun] {
        snapshot.runs.filter { run in
            NativeAppModel.isActiveExecutionState(run.state)
                && run.contextRefs.contains(where: { $0.kind == "voice" })
        }
    }

    private var activeVoiceTaskCount: Int {
        activeVoiceRuns.count
    }

    private var trackedVoiceRuns: [AgentRun] {
        activeVoiceRuns.sorted { lhs, rhs in
            (lhs.startedAt ?? .distantPast) > (rhs.startedAt ?? .distantPast)
        }
    }

    private var voiceboxConfiguration: VoiceboxConfiguration {
        VoiceboxConfiguration(
            enabled: voiceboxEnabled,
            baseURLString: voiceboxBaseURL,
            profile: voiceboxProfile,
            sttModel: voiceboxSTTModel,
            ttsEngine: voiceboxTTSEngine,
            personality: voiceboxPersonality
        )
    }

    private var systemSpeechVoiceOptions: [SystemSpeechVoiceOption] {
        SystemSpeechVoiceOption.options(for: voice.recognitionLanguage)
    }

    private var selectedSystemVoiceName: String {
        SystemSpeechVoiceOption.displayName(
            for: systemSpeechVoiceIdentifier,
            language: voice.recognitionLanguage
        )
    }

    private var selectedSpeechTone: VoiceReportTone {
        VoiceReportTone.normalized(systemSpeechVoiceTone)
    }

    private var selectedVoiceLabel: String {
        if voiceboxEnabled {
            guard voice.voiceboxOnline else {
                return "Apple fallback · \(selectedSystemVoiceName) · \(selectedSpeechTone.displayName)"
            }
            let profile = voiceboxProfile.trimmingCharacters(in: .whitespacesAndNewlines)
            return profile.isEmpty ? "Voicebox Default" : profile
        }
        return "\(selectedSystemVoiceName) · \(selectedSpeechTone.displayName)"
    }

    private var voiceEngineBadge: String {
        if voiceboxEnabled {
            return voice.voiceboxOnline ? "Voicebox" : "Apple fallback"
        }
        return "Apple"
    }

    private var voiceEngineColor: Color {
        if voiceboxEnabled {
            return voice.voiceboxOnline ? PKTheme.ok : PKTheme.warn
        }
        return PKTheme.text3
    }

    private var voiceEngineStatusLabel: String {
        if voiceboxEnabled {
            return voice.voiceboxOnline ? voice.voiceboxStatus : "\(voice.voiceboxStatus) · Apple fallback"
        }
        return "Apple Speech fallback"
    }

    private var voiceVisualColor: Color {
        switch stage {
        case .running:
            return Color(red: 0.28, green: 0.96, blue: 0.72)
        case .needsUser:
            return Color(red: 1.0, green: 0.70, blue: 0.28)
        case .reporting:
            return Color(red: 0.42, green: 0.88, blue: 1.0)
        default:
            return Color(red: 0.94, green: 0.24, blue: 1.0)
        }
    }

    private var isVoiceSurfaceLive: Bool {
        voice.isConversationActive || assistantThinking || speaker.isSpeaking || voice.isVoiceboxSpeaking || model.isRunning
    }

    var body: some View {
        GeometryReader { proxy in
            ZStack {
                Color.black.opacity(0.70)
                    .ignoresSafeArea()

                VoiceOverlayAtmosphere(
                    color: stageColor,
                    isLive: voice.isConversationActive || assistantThinking || speaker.isSpeaking || voice.isVoiceboxSpeaking || model.isRunning
                )
                .ignoresSafeArea()

                voiceImmersivePanel
                    .frame(
                        width: min(540, max(390, proxy.size.width - 96)),
                        height: min(820, max(620, proxy.size.height - 76))
                    )
                    .padding(.vertical, 28)
            }
        }
        .onChange(of: voice.transcript) { _, next in
            guard inputMode == .voice else { return }
            let trimmed = next.trimmingCharacters(in: .whitespacesAndNewlines)
            if !trimmed.isEmpty {
                interruptAssistantSpeechIfNeeded()
                delegatedUtterance = trimmed
                scheduleTranscriptAutoCommit(trimmed)
            }
        }
        .onChange(of: voice.finalizedTurn?.id) { _, _ in
            guard inputMode == .voice else { return }
            guard let turn = voice.finalizedTurn else { return }
            handleFinalizedTurn(turn)
        }
        .onChange(of: voice.isCapturingTurn) { _, isCapturing in
            guard inputMode == .voice else { return }
            if isCapturing {
                interruptAssistantSpeechIfNeeded()
            } else if !currentTranscript.isEmpty {
                scheduleTranscriptAutoCommit(currentTranscript)
            }
        }
        .onChange(of: voice.isTranscribing) { _, isTranscribing in
            guard inputMode == .voice else { return }
            if !isTranscribing, !currentTranscript.isEmpty {
                scheduleTranscriptAutoCommit(currentTranscript)
            }
        }
        .onChange(of: voice.interruptionCount) { _, _ in
            interruptAssistantSpeechIfNeeded()
        }
        .onChange(of: speaker.isSpeaking) { _, isSpeaking in
            if !isSpeaking {
                isOpeningGreeting = false
            }
        }
        .onChange(of: activeRun?.state) { _, state in
            guard let activeRun, let state, state == .completed || state == .failed || state == .waitingForUser else { return }
            guard lastSpokenRunId != activeRun.id else { return }
            lastSpokenRunId = activeRun.id
            appendAssistantTurn(report.spokenText, caption: report.headline)
            speakAssistantText(report.spokenText)
        }
        .onChange(of: model.isRunning) { _, isRunning in
            if isRunning {
                assistantThinking = false
            }
        }
        .onAppear {
            voice.applyConfiguration(voiceboxConfiguration)
            Task { await voice.refreshVoicebox(configuration: voiceboxConfiguration) }
            if autoStart && !didAutoStart {
                didAutoStart = true
                startOpeningGreeting(autoListen: true)
            } else {
                startOpeningGreeting(autoListen: false)
            }
        }
        .onChange(of: voiceboxConfiguration) { _, next in
            voice.applyConfiguration(next)
            Task { await voice.refreshVoicebox(configuration: next) }
        }
        .onDisappear {
            openingGreetingTask?.cancel()
            openingGreetingTask = nil
            transcriptCommitTask?.cancel()
            transcriptCommitTask = nil
            speechResumeTask?.cancel()
            speechResumeTask = nil
            speaker.stop()
            voice.stopConversation()
        }
    }

    private var voiceImmersivePanel: some View {
        ZStack {
            VoiceImmersiveBackground(color: voiceVisualColor, isLive: isVoiceSurfaceLive)

            VStack(spacing: 0) {
                HStack(alignment: .center) {
                    VoiceGlassIconButton(symbol: "chevron.left", help: "Close Voice Chat", action: close)

                    Spacer()

                    VoiceModePill(
                        title: "Pikiclaw Voice Agent",
                        badge: voiceEngineBadge,
                        color: voiceVisualColor
                    )

                    Spacer()

                    VoiceGlassIconButton(symbol: "arrow.clockwise", help: "Refresh Voice Engine") {
                        Task { await voice.refreshVoicebox(configuration: voiceboxConfiguration) }
                    }
                }
                .padding(.horizontal, 32)
                .padding(.top, 28)

                Spacer(minLength: 10)

                VoiceFluidOrb(
                    level: voice.audioLevel,
                    isListening: voice.isListening || voice.isCapturingTurn,
                    isThinking: assistantThinking || voice.isTranscribing || model.isRunning,
                    isSpeaking: speaker.isSpeaking || voice.isVoiceboxSpeaking,
                    color: voiceVisualColor
                )
                .frame(width: 154, height: 154)
                .padding(.bottom, 14)

                VoiceSpeakHistoryPanel(
                    entries: speakHistoryEntries,
                    activity: bottomVoiceStatus,
                    color: voiceVisualColor,
                    isLive: voice.isListening
                        || voice.isCapturingTurn
                        || speaker.isSpeaking
                        || voice.isVoiceboxSpeaking
                        || !currentTranscript.isEmpty
                )
                .frame(maxWidth: 430)
                .frame(height: inputMode == .text ? 226 : 282)
                .padding(.horizontal, 28)

                VoiceInputModeSwitch(
                    mode: inputMode,
                    color: voiceVisualColor,
                    setMode: setInputMode
                )
                .frame(maxWidth: 238)
                .padding(.top, 14)

                VoiceTaskTrackerCard(
                    runs: Array(trackedVoiceRuns.prefix(2)),
                    overflowCount: max(0, activeVoiceTaskCount - 2),
                    agentProfiles: snapshot.agentProfiles,
                    color: voiceVisualColor
                )
                .frame(maxWidth: 390)
                .padding(.horizontal, 36)
                .padding(.top, 16)

                Spacer(minLength: 14)

                if inputMode == .text {
                    VoiceTextInputCard(
                        text: $delegatedUtterance,
                        focused: $briefFocused,
                        canSubmit: canUseCommandAction,
                        color: voiceVisualColor,
                        submit: submitTextInput
                    )
                    .frame(maxWidth: 390)
                    .padding(.horizontal, 36)
                    .padding(.bottom, 12)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
                }

                if engineSettingsExpanded {
                    voiceboxSettingsCard
                        .padding(.horizontal, 28)
                        .padding(.bottom, 22)
                        .transition(.move(edge: .bottom).combined(with: .opacity))
                }

                Text(bottomVoiceStatus)
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Color.white.opacity(0.58))
                    .padding(.bottom, 18)

                HStack(alignment: .center) {
                    VoiceFloatingControlButton(
                        symbol: voiceOutputMuted || speaker.isSpeaking || voice.isVoiceboxSpeaking ? "speaker.slash.fill" : "speaker.wave.2.fill",
                        color: voiceOutputMuted ? PKTheme.warn : voiceVisualColor,
                        isActive: voiceOutputMuted || speaker.isSpeaking || voice.isVoiceboxSpeaking,
                        help: voiceOutputMuted ? "Unmute Voice Output" : "Mute Voice Output",
                        action: toggleVoiceOutputMute
                    )

                    Spacer()

                    VoiceMicControlButton(
                        isActive: voice.isConversationActive,
                        isCapturing: voice.isCapturingTurn,
                        isThinking: assistantThinking || voice.isTranscribing || model.isRunning,
                        color: voiceVisualColor
                    ) {
                        if inputMode == .text {
                            setInputMode(.voice)
                        } else {
                            voice.toggleConversation(configuration: voiceboxConfiguration)
                        }
                    }

                    Spacer()

                    VoiceFloatingControlButton(
                        symbol: canUseCommandAction ? commandActionSymbol : "slider.horizontal.3",
                        color: canUseCommandAction ? PKTheme.ok : voiceVisualColor,
                        isActive: canUseCommandAction || engineSettingsExpanded,
                        help: canUseCommandAction ? commandActionTitle : "Voice Settings"
                    ) {
                        if canUseCommandAction {
                            performCommandAction()
                        } else {
                            withAnimation(.easeInOut(duration: 0.18)) {
                                engineSettingsExpanded.toggle()
                            }
                        }
                    }
                }
                .padding(.horizontal, 54)
                .padding(.bottom, 30)
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: 46, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 46, style: .continuous)
                .stroke(Color.white.opacity(0.18), lineWidth: 1.2)
        )
        .shadow(color: voiceVisualColor.opacity(0.28), radius: 54, y: 26)
        .shadow(color: Color.black.opacity(0.45), radius: 44, y: 28)
    }

    private var voiceProblemText: String? {
        let status = voice.statusLine.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !status.isEmpty else { return nil }
        let lower = status.lowercased()
        let isProblem = lower.contains("failed")
            || lower.contains("permission")
            || lower.contains("unavailable")
            || lower.contains("timed out")
        return isProblem ? status : nil
    }

    private var bottomVoiceStatus: String {
        if inputMode == .text { return currentTranscript.isEmpty ? "Text Input" : "Text Ready" }
        if voiceOutputMuted { return voice.isListening ? "Muted · Listening" : "Muted" }
        if voice.isCapturingTurn { return "Capturing" }
        if voice.isTranscribing { return "Transcribing" }
        if assistantThinking { return "Thinking" }
        if speaker.isSpeaking || voice.isVoiceboxSpeaking { return "Speaking" }
        if voice.isListening && activeVoiceTaskCount > 0 { return "I'm Listening · \(activeVoiceTaskCount) task(s) running" }
        if voice.isListening { return "I'm Listening · \(Int((voice.audioLevel * 100).rounded()))%" }
        if model.isRunning { return "\(agentShortLabel(plan.suggestedAgentKind)) Working" }
        if voice.isConversationActive { return "Ready" }
        return "Tap to Speak"
    }

    private var voiceWindowHeader: some View {
        HStack(spacing: 13) {
            VoiceListeningOrb(
                level: voice.audioLevel,
                isListening: voice.isListening || voice.isCapturingTurn,
                isThinking: assistantThinking || voice.isTranscribing,
                isSpeaking: speaker.isSpeaking || voice.isVoiceboxSpeaking,
                color: stageColor,
                compact: true
            )
            .frame(width: 48, height: 48)

            VStack(alignment: .leading, spacing: 3) {
                Text("Voice Chat")
                    .font(.system(size: 20, weight: .semibold))
                    .foregroundStyle(PKTheme.text)
                Text(statusSubtitle)
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(PKTheme.text3)
                    .lineLimit(1)
                    .truncationMode(.tail)
            }

            Spacer(minLength: 12)

            StatusPill(text: stageLabel.uppercased(), color: stageColor)
            StatusPill(text: voiceEngineBadge, color: voiceEngineColor)

            Button {
                withAnimation(.easeInOut(duration: 0.16)) {
                    engineSettingsExpanded.toggle()
                }
            } label: {
                Image(systemName: engineSettingsExpanded ? "slider.horizontal.3" : "slider.horizontal.below.rectangle")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(PKTheme.text2)
                    .frame(width: 34, height: 34)
                    .background(PKTheme.control.opacity(0.54))
                    .overlay(RoundedRectangle(cornerRadius: 8).stroke(PKTheme.edge, lineWidth: 1))
                    .clipShape(RoundedRectangle(cornerRadius: 8))
            }
            .buttonStyle(.plain)
            .help("Voice settings")

            Button(action: close) {
                Image(systemName: "xmark")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(PKTheme.text3)
                    .frame(width: 34, height: 34)
                    .background(PKTheme.control.opacity(0.54))
                    .overlay(RoundedRectangle(cornerRadius: 8).stroke(PKTheme.edge, lineWidth: 1))
                    .clipShape(RoundedRectangle(cornerRadius: 8))
            }
            .buttonStyle(.plain)
            .keyboardShortcut(.cancelAction)
            .help("Close Voice Chat")
        }
        .padding(.horizontal, 18)
        .padding(.top, 18)
    }

    private var overlayCommandBar: some View {
        HStack(spacing: 12) {
            Button {
                voice.toggleConversation(configuration: voiceboxConfiguration)
            } label: {
                VoiceListeningOrb(
                    level: voice.audioLevel,
                    isListening: voice.isListening || voice.isCapturingTurn,
                    isThinking: assistantThinking || voice.isTranscribing,
                    isSpeaking: speaker.isSpeaking || voice.isVoiceboxSpeaking,
                    color: stageColor,
                    compact: true
                )
                .frame(width: 50, height: 44)
            }
            .buttonStyle(.plain)
            .help(voice.isConversationActive ? "Stop Voice Lens" : "Start Voice Lens")

            Image(systemName: "wand.and.stars")
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(PKTheme.text)

            ZStack(alignment: .leading) {
                if delegatedUtterance.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    Text("Tell Pikiclaw what to do...")
                        .font(.system(size: 18, weight: .medium))
                        .foregroundStyle(PKTheme.text3)
                        .allowsHitTesting(false)
                }
                TextField("", text: $delegatedUtterance)
                    .textFieldStyle(.plain)
                    .font(.system(size: 18, weight: .medium))
                    .foregroundStyle(PKTheme.text)
                    .focused($briefFocused)
                    .onSubmit {
                        if canDelegate && !plan.needsConfirmation {
                            launchDelegation()
                        } else {
                            sendConversationTurn()
                        }
                    }
            }
            .frame(maxWidth: .infinity)

            VoiceLanguagePicker(
                selection: $voice.recognitionLanguage,
                disabled: voice.isConversationActive
            )
            .frame(width: 112)

            Button {
                voice.toggleConversation(configuration: voiceboxConfiguration)
            } label: {
                Label(voice.isConversationActive ? "Stop" : "Listen", systemImage: voice.isConversationActive ? "stop.fill" : "mic.fill")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(voice.isConversationActive ? PKTheme.primaryText : PKTheme.text2)
                    .padding(.horizontal, 12)
                    .frame(height: 36)
                    .background(voice.isConversationActive ? PKTheme.err : PKTheme.control.opacity(0.78))
                    .overlay(RoundedRectangle(cornerRadius: 9).stroke(voice.isConversationActive ? PKTheme.err.opacity(0.72) : PKTheme.edge, lineWidth: 1))
                    .clipShape(RoundedRectangle(cornerRadius: 9))
            }
            .buttonStyle(.plain)

            Button {
                if canDelegate && !plan.needsConfirmation {
                    launchDelegation()
                } else {
                    sendConversationTurn()
                }
            } label: {
                Label(commandActionTitle, systemImage: commandActionSymbol)
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(canUseCommandAction ? PKTheme.primaryText : PKTheme.text4)
                    .padding(.horizontal, 12)
                    .frame(height: 36)
                    .background(canUseCommandAction ? PKTheme.primary : PKTheme.control.opacity(0.58))
                    .overlay(RoundedRectangle(cornerRadius: 9).stroke(canUseCommandAction ? PKTheme.primary.opacity(0.78) : PKTheme.edge, lineWidth: 1))
                    .clipShape(RoundedRectangle(cornerRadius: 9))
            }
            .buttonStyle(.plain)
            .disabled(!canUseCommandAction)
        }
        .padding(.horizontal, 18)
        .padding(.vertical, 12)
        .background(.regularMaterial)
        .overlay(RoundedRectangle(cornerRadius: 13, style: .continuous).stroke(Color.white.opacity(0.16), lineWidth: 1))
        .clipShape(RoundedRectangle(cornerRadius: 13, style: .continuous))
        .shadow(color: Color.black.opacity(0.28), radius: 28, y: 16)
    }

    private var conversationCard: some View {
        VoiceOverlayCard {
            VStack(alignment: .leading, spacing: 14) {
                HStack {
                    Label("Voice Assistant Agent", systemImage: "bubble.left.and.bubble.right")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(PKTheme.text2)
                    Spacer()
                    Text(voice.statusLine)
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(stageColor)
                }

                if conversationTurns.isEmpty && currentTranscript.isEmpty && !assistantThinking {
                    VoiceConversationBubble(
                        role: .assistant,
                        text: "我在。直接说你想完成的事，我会判断是继续聊、看状态，还是自动交给合适的智能体。",
                        caption: voiceboxEnabled ? "Voicebox Lens" : "Voice Lens",
                        color: PKTheme.primary,
                        isLive: false
                    )
                }

                ForEach(conversationTurns) { turn in
                    VoiceConversationBubble(
                        role: turn.role,
                        text: turn.text,
                        caption: turn.caption,
                        color: turn.role == .assistant ? PKTheme.primary : PKTheme.ok,
                        isLive: false
                    )
                }

                if !currentTranscript.isEmpty {
                        VoiceConversationBubble(
                            role: .user,
                            text: currentTranscript,
                            caption: voice.isConversationActive ? "Current turn" : "Ready to send",
                            color: PKTheme.ok,
                            isLive: voice.isCapturingTurn || voice.isTranscribing
                        )
                    }

                if assistantThinking {
                    VoiceThinkingBubble()
                }
            }
        }
    }

    private var assistantStatusCard: some View {
        VoiceOverlayCard {
            VStack(alignment: .center, spacing: 16) {
                HStack {
                    StatusPill(text: stageLabel.uppercased(), color: stageColor)
                    StatusPill(text: voice.recognitionLanguage.displayName, color: PKTheme.text3)
                    StatusPill(text: voiceEngineBadge, color: voiceEngineColor)
                    Spacer()
                    Text(voice.statusLine)
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(stageColor)
                }

                VoiceListeningOrb(
                    level: voice.audioLevel,
                    isListening: voice.isListening || voice.isCapturingTurn,
                    isThinking: assistantThinking || voice.isTranscribing,
                    isSpeaking: speaker.isSpeaking || voice.isVoiceboxSpeaking,
                    color: stageColor
                )
                .frame(width: 172, height: 172)

                VStack(spacing: 7) {
                    Text(statusTitle)
                        .font(.system(size: 25, weight: .semibold))
                        .foregroundStyle(PKTheme.text)
                    Text(statusSubtitle)
                        .font(.system(size: 13))
                        .foregroundStyle(PKTheme.text3)
                        .multilineTextAlignment(.center)
                        .lineSpacing(2)
                        .fixedSize(horizontal: false, vertical: true)
                }

                VStack(alignment: .leading, spacing: 8) {
                    HStack {
                        Label("Live Transcript", systemImage: "quote.bubble")
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundStyle(PKTheme.text2)
                        Spacer()
                        Text(voice.activityLabel)
                            .font(.caption2.weight(.semibold))
                            .foregroundStyle(stageColor)
                    }
                    Text(liveTranscriptText)
                        .font(.system(size: 15, weight: currentTranscript.isEmpty ? .medium : .regular))
                        .foregroundStyle(currentTranscript.isEmpty ? PKTheme.text3 : PKTheme.text)
                        .lineSpacing(3)
                        .frame(maxWidth: .infinity, minHeight: 46, alignment: .topLeading)
                }
                .padding(14)
                .background(PKTheme.inset.opacity(0.70))
                .overlay(RoundedRectangle(cornerRadius: 11).stroke(stageColor.opacity((voice.isListening || voice.isCapturingTurn) ? 0.38 : 0.18), lineWidth: 1))
                .clipShape(RoundedRectangle(cornerRadius: 11))

                VoiceWaveform(
                    isLive: voice.isConversationActive || assistantThinking || speaker.isSpeaking || voice.isVoiceboxSpeaking || model.isRunning,
                    color: stageColor,
                    level: voice.audioLevel
                )
                .frame(height: 48)

                VoiceProgressStrip(stage: stage)

                if let readiness = voice.nativeSpeechReadinessMessage, !voice.isConversationActive {
                    VoiceHintBanner(text: readiness)
                }
            }
        }
    }

    private var voiceboxSettingsCard: some View {
        VoiceOverlayCard {
            VStack(alignment: .leading, spacing: 12) {
                HStack(spacing: 10) {
                    Label("Engine", systemImage: "waveform.badge.magnifyingglass")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(PKTheme.text2)
                    Spacer()
                    Toggle("Auto-route", isOn: $voiceAutoDelegate)
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(PKTheme.text3)
                    Button {
                        withAnimation(.easeInOut(duration: 0.16)) {
                            engineSettingsExpanded.toggle()
                        }
                    } label: {
                        Image(systemName: engineSettingsExpanded ? "chevron.up" : "slider.horizontal.3")
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundStyle(PKTheme.text3)
                            .frame(width: 26, height: 24)
                            .background(PKTheme.control.opacity(0.54))
                            .overlay(RoundedRectangle(cornerRadius: 7).stroke(PKTheme.edge, lineWidth: 1))
                            .clipShape(RoundedRectangle(cornerRadius: 7))
                    }
                    .buttonStyle(.plain)
                    Toggle("", isOn: $voiceboxEnabled)
                        .toggleStyle(.switch)
                        .labelsHidden()
                }

                HStack(spacing: 10) {
                    VoiceOverlayMetric(
                        label: "Status",
                        value: voiceEngineStatusLabel,
                        color: voiceEngineColor
                    )
                    VoiceOverlayMetric(
                        label: "Voice",
                        value: selectedVoiceLabel,
                        color: PKTheme.primary
                    )
                    VoiceOverlayMetric(label: "STT", value: voiceboxSTTModel, color: PKTheme.text3)
                }

                if engineSettingsExpanded {
                    VStack(spacing: 10) {
                        VStack(alignment: .leading, spacing: 5) {
                            Text(voice.inputDeviceLine)
                                .font(.system(size: 11, weight: .semibold))
                                .foregroundStyle(PKTheme.primary)
                                .lineLimit(2)
                                .fixedSize(horizontal: false, vertical: true)
                            Text(voice.diagnosticLine)
                                .font(.system(size: 11, weight: .semibold))
                                .foregroundStyle(PKTheme.text2)
                                .lineLimit(2)
                                .fixedSize(horizontal: false, vertical: true)
                            Text(voice.lastTurnDebugLine)
                                .font(.system(size: 11))
                                .foregroundStyle(PKTheme.text3)
                                .lineLimit(3)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(10)
                        .background(PKTheme.inset.opacity(0.62))
                        .overlay(RoundedRectangle(cornerRadius: 8).stroke(PKTheme.edge.opacity(0.82), lineWidth: 1))
                        .clipShape(RoundedRectangle(cornerRadius: 8))

                        TextField("http://127.0.0.1:17493", text: $voiceboxBaseURL)
                            .textFieldStyle(.plain)
                            .font(.system(size: 12))
                            .foregroundStyle(PKTheme.text)
                            .padding(.horizontal, 10)
                            .frame(height: 32)
                            .background(PKTheme.inset.opacity(0.72))
                            .overlay(RoundedRectangle(cornerRadius: 8).stroke(PKTheme.edge, lineWidth: 1))
                            .clipShape(RoundedRectangle(cornerRadius: 8))

                        HStack(spacing: 10) {
                            Picker("Voicebox Voice", selection: $voiceboxProfile) {
                                Text("Default").tag("")
                                ForEach(voice.voiceboxProfiles) { profile in
                                    Text(profile.name).tag(profile.name)
                                }
                            }
                            .labelsHidden()
                            .frame(maxWidth: .infinity)

                            Picker("STT", selection: $voiceboxSTTModel) {
                                Text("Turbo").tag("turbo")
                                Text("Large").tag("large")
                                Text("Medium").tag("medium")
                                Text("Small").tag("small")
                                Text("Base").tag("base")
                            }
                            .labelsHidden()
                            .frame(width: 108)
                        }

                        Picker("Apple Voice", selection: $systemSpeechVoiceIdentifier) {
                            Text("Apple Auto").tag("")
                            if !systemSpeechVoiceIdentifier.isEmpty,
                               !systemSpeechVoiceOptions.contains(where: { $0.id == systemSpeechVoiceIdentifier }) {
                                Text(selectedSystemVoiceName).tag(systemSpeechVoiceIdentifier)
                            }
                            ForEach(systemSpeechVoiceOptions) { option in
                                Text(option.displayName).tag(option.id)
                            }
                        }
                        .labelsHidden()

                        Picker("Tone", selection: $systemSpeechVoiceTone) {
                            ForEach(VoiceReportTone.allCases) { tone in
                                Text("\(tone.displayName) · \(tone.detail)").tag(tone.rawValue)
                            }
                        }
                        .labelsHidden()

                        HStack(spacing: 10) {
                            TextField("TTS engine auto", text: $voiceboxTTSEngine)
                                .textFieldStyle(.plain)
                                .font(.system(size: 12))
                                .foregroundStyle(PKTheme.text)
                                .padding(.horizontal, 10)
                                .frame(height: 30)
                                .background(PKTheme.inset.opacity(0.72))
                                .overlay(RoundedRectangle(cornerRadius: 8).stroke(PKTheme.edge, lineWidth: 1))
                                .clipShape(RoundedRectangle(cornerRadius: 8))

                            Toggle("Personality", isOn: $voiceboxPersonality)
                                .font(.system(size: 12, weight: .semibold))
                                .foregroundStyle(PKTheme.text2)
                        }

                        SecondaryButton(title: "Refresh Engine", systemImage: "arrow.clockwise") {
                            Task { await voice.refreshVoicebox(configuration: voiceboxConfiguration) }
                        }
                    }
                }
            }
        }
    }

    private var delegationPlanCard: some View {
        VoiceOverlayCard {
            HStack(alignment: .top, spacing: 14) {
                VoiceOverlayAvatar(symbol: "wand.and.stars", color: PKTheme.text, isAssistant: true)

                VStack(alignment: .leading, spacing: 14) {
                    Text(plan.routeSummary)
                        .font(.system(size: 18, weight: .medium))
                        .foregroundStyle(PKTheme.text)
                        .lineSpacing(2)
                        .fixedSize(horizontal: false, vertical: true)

                    HStack(spacing: 10) {
                        VoiceOverlayMetric(label: "Intent", value: plan.intent.rawValue.capitalized, color: intentColor)
                        VoiceOverlayMetric(label: "Agent", value: agentShortLabel(plan.suggestedAgentKind), color: agentTint(plan.suggestedAgentKind))
                        VoiceOverlayMetric(label: "Project", value: selectedWorkspace?.name ?? "No project", color: selectedWorkspace == nil ? PKTheme.warn : PKTheme.primary)
                        VoiceOverlayMetric(label: "Confidence", value: confidenceLabel, color: plan.needsConfirmation ? PKTheme.warn : PKTheme.ok)
                    }

                    VStack(alignment: .leading, spacing: 8) {
                        ForEach(Array(plan.acceptanceCriteria.prefix(3)), id: \.self) { item in
                            HStack(alignment: .top, spacing: 8) {
                                Image(systemName: "checkmark.circle.fill")
                                    .font(.system(size: 12, weight: .semibold))
                                    .foregroundStyle(PKTheme.ok)
                                    .padding(.top, 2)
                                Text(item)
                                    .font(.system(size: 12))
                                    .foregroundStyle(PKTheme.text3)
                                    .fixedSize(horizontal: false, vertical: true)
                            }
                        }
                    }

                    Button {
                        launchDelegation()
                    } label: {
                        Label(delegationButtonTitle, systemImage: model.isRunning ? "eye.fill" : "arrow.up.forward.circle.fill")
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(canDelegate ? PKTheme.primaryText : PKTheme.text4)
                            .frame(maxWidth: .infinity)
                            .frame(height: 36)
                            .background(canDelegate ? PKTheme.primary : PKTheme.control.opacity(0.58))
                            .overlay(RoundedRectangle(cornerRadius: 9).stroke(canDelegate ? PKTheme.primary.opacity(0.78) : PKTheme.edge, lineWidth: 1))
                            .clipShape(RoundedRectangle(cornerRadius: 9))
                    }
                    .buttonStyle(.plain)
                    .disabled(!canDelegate)
                }

                Spacer(minLength: 0)
            }
        }
    }

    private var reportCard: some View {
        VoiceOverlayCard {
            HStack(alignment: .top, spacing: 14) {
                VoiceOverlayAvatar(symbol: reportSymbol, color: reportColor, isAssistant: true)

                VStack(alignment: .leading, spacing: 12) {
                    Text(report.headline)
                        .font(.system(size: 18, weight: .semibold))
                        .foregroundStyle(PKTheme.text)
                    Text(report.spokenText)
                        .font(.system(size: 14))
                        .foregroundStyle(PKTheme.text2)
                        .lineSpacing(3)
                        .fixedSize(horizontal: false, vertical: true)

                    if let activeRun {
                        HStack(spacing: 10) {
                            VoiceOverlayMetric(label: "Run", value: activeRun.state.rawValue, color: runStateColor(activeRun.state))
                            if let selectedWorkItem {
                                VoiceOverlayMetric(label: "Work Item", value: selectedWorkItem.title, color: PKTheme.text3)
                            }
                        }
                    }

                    HStack(spacing: 8) {
                        SecondaryButton(title: (speaker.isSpeaking || voice.isVoiceboxSpeaking) ? "Stop" : "Speak", systemImage: (speaker.isSpeaking || voice.isVoiceboxSpeaking) ? "speaker.slash.fill" : "speaker.wave.2.fill") {
                            if speaker.isSpeaking || voice.isVoiceboxSpeaking {
                                speaker.stop()
                                voice.isVoiceboxSpeaking = false
                                voice.resumeListening()
                            } else {
                                speakAssistantText(report.spokenText)
                            }
                        }

                        if activeRun != nil {
                            SecondaryButton(title: "Open Chat", systemImage: "text.bubble") {
                                navigate(.chat)
                            }
                            SecondaryButton(title: "Work Item", systemImage: "checklist") {
                                if let itemId = activeRun?.workItemId {
                                    selectedWorkItemId = itemId
                                }
                                navigate(.workItems)
                            }
                        }
                    }
                }

                Spacer(minLength: 0)
            }
        }
    }

    private var capturedBriefText: String {
        let trimmed = delegatedUtterance.trimmingCharacters(in: .whitespacesAndNewlines)
        if !trimmed.isEmpty {
            return trimmed
        }
        return "Speak naturally. For example: help me add image paste support to the input composer, verify it, then report back."
    }

    private var openingGreetingText: String {
        "你好，我在。有什么可以帮你？"
    }

    private var speakHistoryEntries: [VoiceSpeakHistoryEntry] {
        var entries = Array(conversationTurns.suffix(12)).map { turn in
            VoiceSpeakHistoryEntry(
                id: "turn-\(turn.id.uuidString)",
                role: turn.role,
                text: turn.text,
                caption: turn.caption,
                isLive: false
            )
        }

        if entries.isEmpty && currentTranscript.isEmpty && !assistantThinking {
            entries.append(
                VoiceSpeakHistoryEntry(
                    id: "empty-greeting",
                    role: .assistant,
                    text: openingGreetingText,
                    caption: voiceboxEnabled && voice.voiceboxOnline ? "Voicebox" : "Voice",
                    isLive: isOpeningGreeting || speaker.isSpeaking || voice.isVoiceboxSpeaking
                )
            )
        }

        if !currentTranscript.isEmpty {
            entries.append(
                VoiceSpeakHistoryEntry(
                    id: "current-input",
                    role: .user,
                    text: currentTranscript,
                    caption: inputMode == .text ? "You · Text" : "You · Live",
                    isLive: voice.isCapturingTurn || voice.isTranscribing || inputMode == .text
                )
            )
        }

        if assistantThinking {
            entries.append(
                VoiceSpeakHistoryEntry(
                    id: "assistant-thinking",
                    role: .assistant,
                    text: "我在整理。",
                    caption: "Thinking",
                    isLive: true
                )
            )
        }

        return entries
    }

    private var liveTranscriptText: String {
        if speaker.isSpeaking || voice.isVoiceboxSpeaking {
            return conversationTurns.last(where: { $0.role == .assistant })?.text ?? openingGreetingText
        }
        if !currentTranscript.isEmpty {
            return currentTranscript
        }
        if inputMode == .text {
            return "输入后我会提交并跟进。"
        }
        if voice.isCapturingTurn {
            return "你说，我在听。"
        }
        if assistantThinking {
            return "我在整理。"
        }
        if voice.isTranscribing {
            return "我在识别。"
        }
        if isOpeningGreeting {
            return openingGreetingText
        }
        if stage == .reporting || stage == .needsUser {
            return report.spokenText
        }
        if model.isRunning {
            return "已提交到后台。我会跟进。"
        }
        return "我在等你说话。"
    }

    private var liveTranscriptCaption: String {
        if speaker.isSpeaking || voice.isVoiceboxSpeaking {
            return "Speaking"
        }
        if inputMode == .text {
            return currentTranscript.isEmpty ? "Text Input" : "Text Ready"
        }
        if !currentTranscript.isEmpty {
            return voice.isCapturingTurn ? "Listening" : "Heard"
        }
        if voice.isCapturingTurn || voice.isListening {
            return "Listening"
        }
        if voice.isTranscribing {
            return "Transcribing"
        }
        if assistantThinking {
            return "Thinking"
        }
        if model.isRunning {
            return "Tracking"
        }
        return "Voice"
    }

    private var plan: VoiceDelegationPlan {
        VoiceAssistantPlanner.makePlan(
            utterance: planningInput,
            workspace: selectedWorkspace,
            preferredAgent: preferredVoiceAgentKind,
            recentWorkItem: selectedWorkItem
        )
    }

    private var preferredVoiceAgentKind: NativeAgentKind {
        snapshot.agentProfiles.first(where: \.isEnabled)?.kind ?? model.selectedAgentKind
    }

    private var planningInput: String {
        let latest = latestUserUtterance.trimmingCharacters(in: .whitespacesAndNewlines)
        if !latest.isEmpty { return latest }
        return activeRun?.promptSnapshot ?? ""
    }

    private var report: VoiceDelegationReport {
        VoiceAssistantPlanner.report(for: plan, run: activeRun)
    }

    private var canDelegate: Bool {
        selectedWorkspace != nil
            && plan.intent == .delegate
            && !latestUserUtterance.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    private var canSendConversation: Bool {
        !assistantThinking
            && !voice.isTranscribing
            && !speaker.isSpeaking
            && !voice.isVoiceboxSpeaking
            && !currentTranscript.isEmpty
            && currentTranscript != lastCommittedUtterance
    }

    private var canUseCommandAction: Bool {
        if canDelegate {
            return true
        }
        return canSendConversation
    }

    private var commandActionTitle: String {
        if canDelegate {
            return voiceAutoDelegate ? "Auto Route" : "Route"
        }
        return assistantThinking ? "Thinking" : "Send"
    }

    private var commandActionSymbol: String {
        if canDelegate {
            return "arrow.up.forward.circle.fill"
        }
        return assistantThinking ? "ellipsis" : "return"
    }

    private var shouldAutoDelegateCurrentTurn: Bool {
        voiceAutoDelegate
            && canDelegate
            && !assistantThinking
            && !speaker.isSpeaking
            && !voice.isVoiceboxSpeaking
    }

    private var confidenceLabel: String {
        "\(Int((plan.routeConfidence * 100).rounded()))%"
    }

    private var delegationButtonTitle: String {
        if canDelegate && model.isRunning { return voiceAutoDelegate ? "Auto Route New Task" : "Delegate New Task" }
        if canDelegate && voiceAutoDelegate { return "Auto Route Ready" }
        if canDelegate { return "Delegate Agent" }
        if model.isRunning { return "Supervising Agent" }
        switch plan.intent {
        case .status: return "Status Intent"
        case .cancel: return "No Run"
        case .converse: return "Keep Talking"
        case .delegate: return "Need Task"
        }
    }

    private var statusTitle: String {
        if isOpeningGreeting {
            return "你好，我在"
        }
        switch stage {
        case .listening: return "我在听"
        case .understanding: return "我在处理"
        case .planning: return "准备好了"
        case .running: return "\(agentShortLabel(plan.suggestedAgentKind)) is working"
        case .needsUser: return "The agent needs you"
        case .reporting: return report.headline
        case .idle: return "你好，我在"
        }
    }

    private var statusSubtitle: String {
        if isOpeningGreeting {
            return "有什么可以帮你？"
        }
        switch stage {
        case .listening:
            return voice.isCapturingTurn ? "继续说。" : "直接说你的指令。"
        case .understanding:
            return "我在整理。"
        case .planning:
            return "可以继续说，也可以让我开始。"
        case .running:
            return activeVoiceTaskCount > 0 ? "后台有 \(activeVoiceTaskCount) 个任务，我会跟进。" : "我会跟进后台任务。"
        case .needsUser:
            return "需要你确认一下。"
        case .reporting:
            return report.spokenText
        case .idle:
            return "有什么可以帮你？"
        }
    }

    private var statusSymbol: String {
        switch stage {
        case .listening, .understanding: return "mic.fill"
        case .planning: return "paperplane.fill"
        case .running: return "eye.fill"
        case .needsUser: return "person.crop.circle.badge.exclamationmark"
        case .reporting: return "speaker.wave.2.fill"
        case .idle: return "waveform.circle"
        }
    }

    private var reportSymbol: String {
        switch stage {
        case .needsUser: return "person.crop.circle.badge.exclamationmark"
        case .reporting: return "checkmark.seal.fill"
        case .running: return "eye.fill"
        default: return "sparkle"
        }
    }

    private var stageLabel: String {
        if isOpeningGreeting {
            return "Greeting"
        }
        switch stage {
        case .listening: return "Listening"
        case .understanding: return "Understanding"
        case .planning: return "Ready"
        case .running: return "Supervising"
        case .needsUser: return "Needs You"
        case .reporting: return "Report"
        case .idle: return "Voice"
        }
    }

    private var stage: VoiceDelegationStage {
        if voice.isTranscribing { return .understanding }
        if voice.isListening || voice.isCapturingTurn { return .listening }
        if activeRun?.state == .waitingForUser { return .needsUser }
        if model.isRunning { return .running }
        if speaker.isSpeaking || voice.isVoiceboxSpeaking || activeRun?.state == .completed || activeRun?.state == .failed { return .reporting }
        if assistantThinking { return .understanding }
        if !currentTranscript.isEmpty || !latestUserUtterance.isEmpty { return .planning }
        return .idle
    }

    private var stageColor: Color {
        if isOpeningGreeting {
            return PKTheme.primary
        }
        switch stage {
        case .listening, .understanding: return PKTheme.primary
        case .planning: return PKTheme.warn
        case .running: return PKTheme.ok
        case .needsUser: return PKTheme.warn
        case .reporting: return reportColor
        case .idle: return PKTheme.primary
        }
    }

    private var reportColor: Color {
        switch report.tone {
        case "active": return PKTheme.ok
        case "attention": return PKTheme.warn
        case "done": return PKTheme.ok
        case "failed": return PKTheme.err
        default: return PKTheme.text3
        }
    }

    private var intentColor: Color {
        switch plan.intent {
        case .delegate: return plan.needsConfirmation ? PKTheme.warn : PKTheme.ok
        case .status: return PKTheme.primary
        case .cancel: return PKTheme.err
        case .converse: return PKTheme.text3
        }
    }

    private func startOpeningGreeting(autoListen: Bool) {
        guard !didGreet else { return }
        didGreet = true
        isOpeningGreeting = true
        let greeting = openingGreetingText
        let greetingCaption = voiceboxEnabled && voice.voiceboxOnline ? "Voicebox Greeting" : "Voice Greeting"
        openingGreetingTask?.cancel()
        openingGreetingTask = Task {
            let runId = await ensureVoiceConversationOpened()
            _ = await model.appendVoiceConversationTurn(
                runId: runId,
                role: "assistant voice",
                text: greeting,
                caption: greetingCaption
            )
            guard !Task.isCancelled else { return }
            if autoListen {
                await voice.startConversation(configuration: voiceboxConfiguration)
                guard !Task.isCancelled else { return }
            }
            await MainActor.run {
                appendAssistantTurn(greeting, caption: greetingCaption)
                speakAssistantText(greeting)
            }
        }
    }

    private func ensureVoiceConversationOpened() async -> EntityID? {
        if let voiceConversationRunId,
           let run = model.snapshot.runs.first(where: { $0.id == voiceConversationRunId }),
           !NativeAppModel.isActiveExecutionState(run.state) {
            return voiceConversationRunId
        }
        let runId = await model.ensureVoiceConversation(workspaceId: selectedWorkspaceId, focus: false)
        await MainActor.run {
            voiceConversationRunId = runId
            if let runId,
               let run = model.snapshot.runs.first(where: { $0.id == runId }),
               let workItemId = run.workItemId {
                selectedWorkItemId = workItemId
            }
        }
        return runId
    }

    private func handleFinalizedTurn(_ turn: ContinuousVoiceSessionController.FinalizedTurn) {
        transcriptCommitTask?.cancel()
        delegatedUtterance = turn.text
        let caption = "You · \(turn.backend.rawValue)"
        if shouldAutoDelegateCurrentTurn {
            launchDelegation(autoTriggered: true, userCaption: caption, speakStart: false)
        } else {
            commitCurrentTranscript(caption: caption)
        }
    }

    private func scheduleTranscriptAutoCommit(_ transcript: String) {
        let trimmed = transcript.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, trimmed != lastCommittedUtterance else { return }
        transcriptCommitTask?.cancel()
        transcriptCommitTask = Task {
            try? await Task.sleep(nanoseconds: 1_150_000_000)
            await MainActor.run {
                guard currentTranscript == trimmed else { return }
                guard !voice.isCapturingTurn, !voice.isTranscribing else { return }
                guard !assistantThinking else { return }
                guard !speaker.isSpeaking, !voice.isVoiceboxSpeaking else { return }
                if shouldAutoDelegateCurrentTurn {
                    launchDelegation(autoTriggered: true, userCaption: "You · Live", speakStart: false)
                } else {
                    commitCurrentTranscript(caption: "You · Live")
                }
            }
        }
    }

    private func performCommandAction() {
        if canDelegate {
            launchDelegation(userCaption: inputCaption)
        } else {
            sendConversationTurn()
        }
    }

    private func submitTextInput() {
        guard !currentTranscript.isEmpty else { return }
        performCommandAction()
    }

    private var inputCaption: String {
        inputMode == .text ? "You · Text" : "You"
    }

    private var inputTranscriptRole: String {
        inputMode == .text ? "user text" : "user voice"
    }

    private func setInputMode(_ mode: VoiceAssistantInputMode) {
        guard inputMode != mode else { return }
        transcriptCommitTask?.cancel()
        if mode == .text {
            voice.stopConversation()
            voice.transcript = ""
            withAnimation(.easeInOut(duration: 0.18)) {
                inputMode = .text
                engineSettingsExpanded = false
            }
            briefFocused = true
        } else {
            briefFocused = false
            withAnimation(.easeInOut(duration: 0.18)) {
                inputMode = .voice
            }
            Task {
                await voice.startConversation(configuration: voiceboxConfiguration)
            }
        }
    }

    private func toggleVoiceOutputMute() {
        if speaker.isSpeaking || voice.isVoiceboxSpeaking {
            stopAssistantSpeech()
        }
        voiceOutputMuted.toggle()
    }

    private func stopAssistantSpeech() {
        speechResumeTask?.cancel()
        speechResumeTask = nil
        speaker.stop()
        voice.cancelVoiceboxSpeechForInterruption()
        isOpeningGreeting = false
        voice.resumeListening()
    }

    private func launchDelegation(autoTriggered: Bool = false, userCaption: String = "You", speakStart: Bool = true) {
        let submittedInputRole = inputTranscriptRole
        commitCurrentTranscript(reply: false, caption: userCaption)
        voice.pauseForAgentRun()
        briefFocused = false
        let preparedPlan = plan
        let message = autoTriggered
            ? "好，我交给 \(agentShortLabel(preparedPlan.suggestedAgentKind))。"
            : "好的，交给 \(agentShortLabel(preparedPlan.suggestedAgentKind))。"
        appendAssistantTurn(message, caption: autoTriggered ? "Auto Route" : "Delegating")
        if speakStart {
            speakAssistantText(message)
        }
        assistantThinking = true
        Task {
            let preservedRunId = model.activeRunId
            let conversationRunId = await ensureVoiceConversationOpened()
            if let runId = await model.submitVoiceTurn(
                preparedPlan,
                conversationRunId: conversationRunId,
                workspaceId: selectedWorkspaceId,
                targetWorkItemId: selectedWorkItemId,
                preserveActiveRunId: preservedRunId,
                inputRole: submittedInputRole
            ),
               let run = model.snapshot.runs.first(where: { $0.id == runId }) {
                voiceConversationRunId = run.id
                if let workItemId = run.workItemId {
                    selectedWorkItemId = workItemId
                }
                assistantThinking = false
                let runningCount = max(1, activeVoiceTaskCount)
                let submittedMessage = runningCount > 1
                    ? "已提交。现在有 \(runningCount) 个后台任务，我会跟进。"
                    : "已提交。我会跟进，你可以继续说。"
                appendAssistantTurn(submittedMessage, caption: "Listening")
                if !speakStart {
                    speakAssistantText(submittedMessage)
                }
            } else {
                let message = model.statusLine.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                    ? "我没能启动智能体。请检查当前项目和智能体配置。"
                    : model.statusLine
                assistantThinking = false
                appendAssistantTurn(message, caption: "Voice")
                speakAssistantText(message)
            }
        }
    }

    private var currentTranscript: String {
        delegatedUtterance.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private var latestUserUtterance: String {
        if !currentTranscript.isEmpty { return currentTranscript }
        return conversationTurns.last(where: { $0.role == .user })?.text ?? ""
    }

    private func sendConversationTurn() {
        commitCurrentTranscript(caption: inputCaption)
    }

    private func commitCurrentTranscript(reply: Bool = true, caption: String = "You") {
        transcriptCommitTask?.cancel()
        let utterance = currentTranscript
        guard !utterance.isEmpty, utterance != lastCommittedUtterance else { return }
        conversationTurns.append(
            VoiceConversationTurn(role: .user, text: utterance, caption: caption)
        )
        lastCommittedUtterance = utterance
        delegatedUtterance = ""
        voice.transcript = ""
        if reply {
            persistVoiceConversationTurn(role: inputTranscriptRole, text: utterance, caption: caption)
            startAssistantReply(to: utterance)
        }
    }

    private func startAssistantReply(to utterance: String) {
        assistantThinking = true
        let reply = assistantReply(for: utterance)
        Task {
            try? await Task.sleep(nanoseconds: 620_000_000)
            await MainActor.run {
                assistantThinking = false
                let replyCaption = voiceboxEnabled ? "Voicebox Lens" : "Voice Lens"
                appendAssistantTurn(reply, caption: replyCaption)
                persistVoiceConversationTurn(role: "assistant voice", text: reply, caption: replyCaption)
                speakAssistantText(reply)
            }
        }
    }

    private func speakAssistantText(_ text: String) {
        guard !voiceOutputMuted else { return }
        voice.pauseForOutput(allowBargeIn: false)
        Task {
            let spokeWithVoicebox = voice.voiceboxOnline
                ? await voice.speakWithVoiceboxIfAvailable(text, configuration: voiceboxConfiguration, allowBargeIn: false)
                : false
            guard !spokeWithVoicebox else { return }
            await MainActor.run {
                speakWithAppleVoice(text, allowBargeIn: false)
            }
        }
    }

    private func speakWithAppleVoice(_ text: String, allowBargeIn: Bool) {
        speechResumeTask?.cancel()
        voice.pauseForOutput(allowBargeIn: allowBargeIn)
        speaker.speak(
            text,
            voiceIdentifier: systemSpeechVoiceIdentifier,
            language: voice.recognitionLanguage,
            tone: selectedSpeechTone
        )
        let waitSeconds = estimatedAppleSpeechSeconds(for: text) + 0.75
        speechResumeTask = Task {
            try? await Task.sleep(nanoseconds: UInt64(waitSeconds * 1_000_000_000))
            await MainActor.run {
                isOpeningGreeting = false
                guard !voice.isCapturingTurn, !voice.isTranscribing else { return }
                voice.resumeListening()
            }
        }
    }

    private func interruptAssistantSpeechIfNeeded() {
        guard speaker.isSpeaking || voice.isVoiceboxSpeaking else { return }
        stopAssistantSpeech()
    }

    private func estimatedAppleSpeechSeconds(for text: String) -> Double {
        let characters = max(12, text.trimmingCharacters(in: .whitespacesAndNewlines).count)
        return min(18, max(2.0, Double(characters) / 7.8))
    }

    private func appendAssistantTurn(_ text: String, caption: String) {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        if conversationTurns.last?.role == .assistant && conversationTurns.last?.text == trimmed {
            return
        }
        conversationTurns.append(VoiceConversationTurn(role: .assistant, text: trimmed, caption: caption))
    }

    private func assistantReply(for utterance: String) -> String {
        let lower = utterance.lowercased()
        let agent = agentShortLabel(plan.suggestedAgentKind)
        if isCapabilityQuestion(lower) {
            return "我是 Pikiclaw 的语音智能体。你直接说目标，我会使用当前的 Conversation、任务、agent 和状态跟进能力来完成，并把结果告诉你。"
        }
        if isVoiceSelectionQuestion(lower) {
            return "可以。点右下角设置，可以切换 Voicebox 或 Apple 语音，也可以选择不同音色。"
        }
        if isActiveWorkStatusQuestion(lower) {
            return activeWorkStatusReply()
        }
        if lower.contains("开始") || lower.contains("执行") || lower.contains("帮我做") || lower.contains("实现") || lower.contains("fix") || lower.contains("build") {
            return "我听到了。这件事可以交给 \(agent)：\(shortUtterance(utterance))。"
        }
        if lower.contains("进度") || lower.contains("状态") || lower.contains("status") {
            if let activeRun {
                return "当前状态是 \(activeRun.state.rawValue)。我会继续跟进。"
            }
            return "现在没有后台任务。你可以直接告诉我要做什么。"
        }
        if lower.contains("不用") || lower.contains("取消") || lower.contains("stop") || lower.contains("cancel") {
            return "好的，先不提交。"
        }
        return "我听到了：\(shortUtterance(utterance))。"
    }

    private func isActiveWorkStatusQuestion(_ lower: String) -> Bool {
        let signals = [
            "当前还在工作", "还在工作的任务", "正在工作的任务", "当前任务", "还在工作", "运行中的任务",
            "active task", "active tasks", "running task", "running tasks", "current task", "current tasks",
            "进度", "状态", "status", "progress"
        ]
        return signals.contains(where: lower.contains)
    }

    private func activeWorkStatusReply() -> String {
        let activeRuns = snapshot.runs
            .filter { NativeAppModel.isActiveExecutionState($0.state) }
            .sorted { lhs, rhs in
                (lhs.startedAt ?? .distantPast) > (rhs.startedAt ?? .distantPast)
            }

        if !activeRuns.isEmpty {
            let summaries = activeRuns.prefix(3).map(activeRunSummary)
            let overflow = activeRuns.count > 3 ? "，另外还有 \(activeRuns.count - 3) 个任务" : ""
            return "当前还在工作的任务有 \(activeRuns.count) 个：\(summaries.joined(separator: "；"))\(overflow)。"
        }

        let activeItems = snapshot.workItems
            .filter { item in
                item.state == .active || item.state == .blocked || item.state == .review
            }
            .sorted { $0.updatedAt > $1.updatedAt }

        if !activeItems.isEmpty {
            let summaries = activeItems.prefix(3).map { item in
                "\(item.title)（\(item.state.rawValue)）"
            }
            let overflow = activeItems.count > 3 ? "，另外还有 \(activeItems.count - 3) 个任务" : ""
            return "当前没有正在运行的 agent，但工作队列里还有 \(activeItems.count) 个未完成任务：\(summaries.joined(separator: "；"))\(overflow)。"
        }

        return "当前没有正在运行的 agent，也没有标记为 active、blocked 或 review 的任务。"
    }

    private func activeRunSummary(_ run: AgentRun) -> String {
        let title: String
        if let workItemId = run.workItemId,
           let item = snapshot.workItems.first(where: { $0.id == workItemId }) {
            title = item.title
        } else {
            title = run.promptSnapshot.firstLineFallback("未命名任务")
        }
        let workspace = workspaceName(for: run.workspaceId, snapshot: snapshot)
        return "\(title)（\(run.state.rawValue)，\(workspace)）"
    }

    private func persistVoiceConversationTurn(role: String, text: String, caption: String) {
        Task {
            let runId = await ensureVoiceConversationOpened()
            _ = await model.appendVoiceConversationTurn(
                runId: runId,
                role: role,
                text: text,
                caption: caption
            )
        }
    }

    private func isCapabilityQuestion(_ lower: String) -> Bool {
        lower.contains("你可以做什么")
            || lower.contains("你能做什么")
            || lower.contains("你会做什么")
            || lower.contains("可以帮我做什么")
            || lower.contains("能帮我做什么")
            || lower.contains("what can you do")
            || lower.contains("what are you able to do")
    }

    private func isVoiceSelectionQuestion(_ lower: String) -> Bool {
        (lower.contains("语音") || lower.contains("声音") || lower.contains("voice"))
            && (lower.contains("选择") || lower.contains("换") || lower.contains("其他") || lower.contains("音色") || lower.contains("select") || lower.contains("change"))
    }

    private func shortUtterance(_ utterance: String) -> String {
        let trimmed = utterance.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.count <= 48 { return trimmed }
        return "\(trimmed.prefix(48))..."
    }
}

private enum VoiceConversationRole {
    case user
    case assistant
}

private struct VoiceConversationTurn: Identifiable {
    let id = UUID()
    var role: VoiceConversationRole
    var text: String
    var caption: String
}

private struct VoiceSpeakHistoryEntry: Identifiable, Equatable {
    let id: String
    var role: VoiceConversationRole
    var text: String
    var caption: String
    var isLive: Bool
}

private enum VoiceAssistantInputMode {
    case voice
    case text
}

private struct VoiceInputModeSwitch: View {
    let mode: VoiceAssistantInputMode
    let color: Color
    let setMode: (VoiceAssistantInputMode) -> Void

    var body: some View {
        HStack(spacing: 4) {
            modeButton(.voice, symbol: "mic.fill", title: "语音")
            modeButton(.text, symbol: "keyboard", title: "文本")
        }
        .padding(4)
        .background(Color.black.opacity(0.20))
        .overlay(Capsule().stroke(Color.white.opacity(0.15), lineWidth: 1))
        .clipShape(Capsule())
    }

    private func modeButton(_ target: VoiceAssistantInputMode, symbol: String, title: String) -> some View {
        let selected = mode == target
        return Button {
            setMode(target)
        } label: {
            Label(title, systemImage: symbol)
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(selected ? Color.white.opacity(0.94) : Color.white.opacity(0.54))
                .frame(maxWidth: .infinity)
                .frame(height: 30)
                .background(selected ? color.opacity(0.42) : Color.clear)
                .clipShape(Capsule())
        }
        .buttonStyle(.plain)
        .help(title == "文本" ? "Switch to text input" : "Switch to voice input")
    }
}

private struct VoiceTextInputCard: View {
    @Binding var text: String
    var focused: FocusState<Bool>.Binding
    let canSubmit: Bool
    let color: Color
    let submit: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            HStack(spacing: 8) {
                Image(systemName: "keyboard")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(color)
                Text("文本输入")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(Color.white.opacity(0.78))
                Spacer()
                Button(action: submit) {
                    Image(systemName: "arrow.up")
                        .font(.system(size: 12, weight: .bold))
                        .foregroundStyle(canSubmit ? Color.white : Color.white.opacity(0.34))
                        .frame(width: 29, height: 29)
                        .background(canSubmit ? color.opacity(0.72) : Color.white.opacity(0.08))
                        .clipShape(Circle())
                }
                .buttonStyle(.plain)
                .keyboardShortcut(.return, modifiers: [.command])
                .disabled(!canSubmit)
                .help("Submit text")
            }

            ZStack(alignment: .topLeading) {
                if text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    Text("输入要交给 Pikiclaw 的指令...")
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(Color.white.opacity(0.34))
                        .padding(.horizontal, 5)
                        .padding(.vertical, 8)
                        .allowsHitTesting(false)
                }

                TextEditor(text: $text)
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(Color.white.opacity(0.88))
                    .lineSpacing(3)
                    .scrollContentBackground(.hidden)
                    .focused(focused)
                    .frame(height: 48)
            }
        }
        .padding(10)
        .background(Color.black.opacity(0.24))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).stroke(Color.white.opacity(0.16), lineWidth: 1))
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
    }
}

private struct VoiceConversationBubble: View {
    let role: VoiceConversationRole
    let text: String
    let caption: String
    let color: Color
    let isLive: Bool

    private var alignment: HorizontalAlignment {
        role == .user ? .trailing : .leading
    }

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            if role == .assistant {
                VoiceOverlayAvatar(symbol: "sparkle", color: color, isAssistant: true)
            } else {
                Spacer(minLength: 64)
            }

            VStack(alignment: alignment, spacing: 6) {
                HStack(spacing: 6) {
                    if isLive {
                        Circle()
                            .fill(color)
                            .frame(width: 6, height: 6)
                    }
                    Text(caption)
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(isLive ? color : PKTheme.text3)
                }
                Text(text)
                    .font(.system(size: 15))
                    .foregroundStyle(PKTheme.text)
                    .lineSpacing(3)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.horizontal, 13)
                    .padding(.vertical, 10)
                    .background(role == .user ? color.opacity(0.14) : PKTheme.control.opacity(0.48))
                    .overlay(RoundedRectangle(cornerRadius: 10).stroke(color.opacity(isLive ? 0.46 : 0.20), lineWidth: 1))
                    .clipShape(RoundedRectangle(cornerRadius: 10))
            }
            .frame(maxWidth: 650, alignment: role == .user ? .trailing : .leading)

            if role == .user {
                VoiceOverlayAvatar(symbol: "person.fill", color: color, isAssistant: false)
            } else {
                Spacer(minLength: 64)
            }
        }
    }
}

private struct VoiceThinkingBubble: View {
    @State private var pulse = false

    var body: some View {
        HStack(alignment: .center, spacing: 10) {
            VoiceOverlayAvatar(symbol: "sparkle", color: PKTheme.primary, isAssistant: true)
            HStack(spacing: 5) {
                ForEach(0..<3, id: \.self) { index in
                    Circle()
                        .fill(PKTheme.primary.opacity(0.75))
                        .frame(width: 6, height: 6)
                        .scaleEffect(pulse ? 1.0 : 0.62)
                        .animation(
                            .easeInOut(duration: 0.62)
                                .repeatForever(autoreverses: true)
                                .delay(Double(index) * 0.12),
                            value: pulse
                        )
                }
                Text("Thinking")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(PKTheme.text3)
                    .padding(.leading, 4)
            }
            .padding(.horizontal, 13)
            .padding(.vertical, 10)
            .background(PKTheme.control.opacity(0.48))
            .overlay(RoundedRectangle(cornerRadius: 10).stroke(PKTheme.primary.opacity(0.20), lineWidth: 1))
            .clipShape(RoundedRectangle(cornerRadius: 10))
            Spacer(minLength: 0)
        }
        .onAppear { pulse = true }
    }
}

private struct VoiceImmersiveBackground: View {
    let color: Color
    let isLive: Bool

    var body: some View {
        ZStack {
            LinearGradient(
                colors: [
                    Color(red: 0.06, green: 0.04, blue: 0.08),
                    Color.black,
                    Color(red: 0.02, green: 0.02, blue: 0.03)
                ],
                startPoint: .top,
                endPoint: .bottom
            )

            RadialGradient(
                colors: [
                    color.opacity(isLive ? 0.82 : 0.58),
                    Color(red: 0.62, green: 0.25, blue: 1.0).opacity(isLive ? 0.35 : 0.22),
                    Color.clear
                ],
                center: .top,
                startRadius: 20,
                endRadius: 430
            )

            RadialGradient(
                colors: [
                    Color.white.opacity(0.12),
                    color.opacity(0.12),
                    Color.clear
                ],
                center: .center,
                startRadius: 40,
                endRadius: 390
            )
            .offset(y: -120)

            VoiceNoiseField()
                .opacity(0.18)
        }
    }
}

private struct VoiceNoiseField: View {
    var body: some View {
        GeometryReader { proxy in
            let width = max(proxy.size.width, 1)
            let height = max(proxy.size.height, 1)
            Canvas { context, _ in
                for index in 0..<230 {
                    let x = seededUnit(index * 17 + 11) * width
                    let y = seededUnit(index * 29 + 7) * height
                    let alpha = 0.12 + seededUnit(index * 13 + 5) * 0.22
                    let size = 0.7 + seededUnit(index * 31 + 3) * 1.2
                    let rect = CGRect(x: x, y: y, width: size, height: size)
                    context.fill(Path(ellipseIn: rect), with: .color(Color.white.opacity(alpha)))
                }
            }
        }
        .allowsHitTesting(false)
    }

    private func seededUnit(_ seed: Int) -> CGFloat {
        let value = sin(Double(seed) * 12.9898) * 43758.5453
        return CGFloat(value - floor(value))
    }
}

private struct VoiceModePill: View {
    let title: String
    let badge: String
    let color: Color

    var body: some View {
        HStack(spacing: 10) {
            Text(title)
                .font(.system(size: 17, weight: .semibold))
                .foregroundStyle(Color.white.opacity(0.94))
                .lineLimit(1)

            Text(badge)
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(Color.white.opacity(0.90))
                .padding(.horizontal, 12)
                .frame(height: 30)
                .background(Color.white.opacity(0.12))
                .overlay(Capsule().stroke(Color.white.opacity(0.22), lineWidth: 1))
                .clipShape(Capsule())
        }
        .padding(.leading, 22)
        .padding(.trailing, 8)
        .frame(height: 46)
        .background(
            LinearGradient(
                colors: [
                    color.opacity(0.84),
                    Color(red: 0.77, green: 0.18, blue: 1.0).opacity(0.76)
                ],
                startPoint: .leading,
                endPoint: .trailing
            )
        )
        .overlay(Capsule().stroke(Color.white.opacity(0.26), lineWidth: 1))
        .clipShape(Capsule())
        .shadow(color: color.opacity(0.44), radius: 22, y: 10)
    }
}

private struct VoiceGlassIconButton: View {
    let symbol: String
    let help: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(.system(size: 18, weight: .semibold))
                .foregroundStyle(Color.white.opacity(0.90))
                .frame(width: 55, height: 55)
                .background(Color.white.opacity(0.10))
                .overlay(Circle().stroke(Color.white.opacity(0.28), lineWidth: 1))
                .clipShape(Circle())
                .shadow(color: Color.black.opacity(0.22), radius: 14, y: 10)
        }
        .buttonStyle(.plain)
        .help(help)
    }
}

private struct VoiceSpeakHistoryPanel: View {
    let entries: [VoiceSpeakHistoryEntry]
    let activity: String
    let color: Color
    let isLive: Bool

    private var latestId: String? {
        entries.last?.id
    }

    var body: some View {
        VStack(spacing: 12) {
            HStack(alignment: .center, spacing: 10) {
                ZStack {
                    Circle()
                        .fill(color.opacity(isLive ? 0.22 : 0.10))
                        .frame(width: 20, height: 20)
                    Circle()
                        .fill(isLive ? color : Color.white.opacity(0.28))
                        .frame(width: 7, height: 7)
                        .shadow(color: isLive ? color.opacity(0.70) : .clear, radius: 9)
                }

                VStack(alignment: .leading, spacing: 1) {
                    Text("Voice Chat")
                        .font(.system(size: 13, weight: .bold))
                        .foregroundStyle(Color.white.opacity(0.92))

                    Text("Pikiclaw Assistant")
                        .font(.system(size: 9, weight: .semibold))
                        .foregroundStyle(color.opacity(0.72))
                }

                Spacer(minLength: 12)

                Text(activity)
                    .font(.system(size: 10, weight: .bold))
                    .foregroundStyle(Color.white.opacity(0.44))
                    .lineLimit(1)
                    .padding(.horizontal, 9)
                    .padding(.vertical, 5)
                    .background(Color.white.opacity(0.07))
                    .clipShape(Capsule())
            }

            ScrollViewReader { proxy in
                ScrollView(showsIndicators: false) {
                    LazyVStack(spacing: 10) {
                        ForEach(entries) { entry in
                            VoiceSpeakHistoryRow(entry: entry, color: color)
                                .id(entry.id)
                        }
                    }
                    .padding(.top, 1)
                    .padding(.bottom, 3)
                    .frame(maxWidth: .infinity, alignment: .bottom)
                }
                .frame(maxHeight: .infinity)
                .onAppear {
                    scrollToLatest(proxy)
                }
                .onChange(of: latestId) { _, _ in
                    scrollToLatest(proxy)
                }
            }
        }
        .padding(.horizontal, 18)
        .padding(.vertical, 14)
        .background(
            ZStack {
                Color.black.opacity(0.20)
                LinearGradient(
                    colors: [color.opacity(0.12), Color.white.opacity(0.03), Color.black.opacity(0.12)],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                )
            }
        )
        .overlay(RoundedRectangle(cornerRadius: 24, style: .continuous).stroke(Color.white.opacity(0.14), lineWidth: 1))
        .clipShape(RoundedRectangle(cornerRadius: 24, style: .continuous))
        .shadow(color: color.opacity(isLive ? 0.18 : 0.08), radius: 22, y: 12)
    }

    private func scrollToLatest(_ proxy: ScrollViewProxy) {
        guard let latestId else { return }
        DispatchQueue.main.async {
            withAnimation(.easeOut(duration: 0.16)) {
                proxy.scrollTo(latestId, anchor: .bottom)
            }
        }
    }
}

private struct VoiceSpeakHistoryRow: View {
    let entry: VoiceSpeakHistoryEntry
    let color: Color

    private var isUser: Bool {
        entry.role == .user
    }

    private var entryColor: Color {
        isUser ? Color(red: 0.28, green: 0.96, blue: 0.72) : color
    }

    var body: some View {
        HStack(alignment: .bottom, spacing: 8) {
            if isUser {
                Spacer(minLength: 32)
            }

            VStack(alignment: isUser ? .trailing : .leading, spacing: 3) {
                HStack(spacing: 5) {
                    if entry.isLive {
                        Circle()
                            .fill(entryColor)
                            .frame(width: 5, height: 5)
                    }
                    Text(entry.caption)
                        .font(.system(size: 9, weight: .semibold))
                        .foregroundStyle(entry.isLive ? entryColor.opacity(0.92) : Color.white.opacity(0.36))
                }

                Text(entry.text)
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(Color.white.opacity(0.88))
                    .lineSpacing(3)
                    .multilineTextAlignment(isUser ? .trailing : .leading)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.horizontal, 13)
                    .padding(.vertical, 9)
                    .background(isUser ? entryColor.opacity(0.20) : Color.black.opacity(0.26))
                    .overlay(RoundedRectangle(cornerRadius: 15, style: .continuous).stroke(entryColor.opacity(entry.isLive ? 0.52 : 0.18), lineWidth: 1))
                    .clipShape(RoundedRectangle(cornerRadius: 15, style: .continuous))
            }
            .frame(maxWidth: isUser ? 318 : 350, alignment: isUser ? .trailing : .leading)

            if !isUser {
                Spacer(minLength: 18)
            }
        }
    }
}

private struct VoiceTaskTrackerCard: View {
    let runs: [AgentRun]
    let overflowCount: Int
    let agentProfiles: [AgentProfile]
    let color: Color

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                Image(systemName: runs.isEmpty ? "checkmark.circle" : "list.bullet.clipboard")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(color)
                    .frame(width: 18, height: 18)
                Text(runs.isEmpty ? "没有后台任务" : "\(runs.count + overflowCount) 个后台任务")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(Color.white.opacity(0.82))
                Spacer()
                if overflowCount > 0 {
                    Text("+\(overflowCount)")
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(color)
                }
            }

            if runs.isEmpty {
                Text("说出要做的事，我会提交并跟进。")
                    .font(.system(size: 11, weight: .medium))
                    .foregroundStyle(Color.white.opacity(0.42))
            } else {
                VStack(spacing: 8) {
                    ForEach(runs) { run in
                        VoiceTaskTrackerRow(
                            run: run,
                            title: taskTitle(for: run),
                            agentName: agentName(for: run),
                            progress: progress(for: run.state),
                            color: color
                        )
                    }
                }
            }
        }
        .padding(12)
        .background(Color.black.opacity(0.22))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).stroke(Color.white.opacity(0.16), lineWidth: 1))
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
    }

    private func agentName(for run: AgentRun) -> String {
        agentProfiles.first(where: { $0.id == run.agentProfileId })?.displayName ?? "Agent"
    }

    private func taskTitle(for run: AgentRun) -> String {
        let lines = run.promptSnapshot
            .split(whereSeparator: \.isNewline)
            .map { String($0).trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
        if let delegated = lines.first(where: { $0.hasPrefix("Voice delegated request:") }) {
            return delegated.replacingOccurrences(of: "Voice delegated request:", with: "").trimmingCharacters(in: .whitespacesAndNewlines)
        }
        if let assistantRequest = lines.first(where: { $0.hasPrefix("Voice Assistant request:") }) {
            return assistantRequest.replacingOccurrences(of: "Voice Assistant request:", with: "").trimmingCharacters(in: .whitespacesAndNewlines)
        }
        return lines.first(where: { !$0.hasPrefix("You are") }) ?? "Voice task"
    }

    private func progress(for state: RunState) -> Double {
        switch state {
        case .draft: return 0.04
        case .queued: return 0.14
        case .starting: return 0.28
        case .running: return 0.62
        case .waitingForUser: return 0.82
        case .cancelling: return 0.88
        case .completed: return 1.0
        case .failed, .cancelled, .stale: return 1.0
        }
    }
}

private struct VoiceTaskTrackerRow: View {
    let run: AgentRun
    let title: String
    let agentName: String
    let progress: Double
    let color: Color

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 8) {
                Text(title)
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(Color.white.opacity(0.82))
                    .lineLimit(1)
                    .truncationMode(.tail)
                Spacer(minLength: 8)
                Text("\(agentName) · \(run.state.rawValue)")
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(runStateColor(run.state).opacity(0.92))
                    .lineLimit(1)
            }

            GeometryReader { proxy in
                ZStack(alignment: .leading) {
                    RoundedRectangle(cornerRadius: 3)
                        .fill(Color.white.opacity(0.10))
                    RoundedRectangle(cornerRadius: 3)
                        .fill(
                            LinearGradient(
                                colors: [color.opacity(0.92), runStateColor(run.state).opacity(0.78)],
                                startPoint: .leading,
                                endPoint: .trailing
                            )
                        )
                        .frame(width: max(5, proxy.size.width * progress))
                }
            }
            .frame(height: 5)
        }
    }
}

private struct VoiceFluidOrb: View {
    let level: Double
    let isListening: Bool
    let isThinking: Bool
    let isSpeaking: Bool
    let color: Color

    private var isActive: Bool {
        isListening || isThinking || isSpeaking
    }

    private var activity: Double {
        if isListening { return max(level, 0.30) }
        if isSpeaking { return 0.58 }
        if isThinking { return 0.42 }
        return 0.20
    }

    var body: some View {
        TimelineView(.animation) { timeline in
            let seconds = timeline.date.timeIntervalSinceReferenceDate
            ZStack {
                ForEach(0..<3, id: \.self) { index in
                    Circle()
                        .stroke(color.opacity(isActive ? 0.16 : 0.08), lineWidth: 1)
                        .scaleEffect(1.0 + CGFloat(index) * 0.12 + CGFloat(activity) * 0.05)
                        .blur(radius: CGFloat(index) * 3)
                }

                Circle()
                    .fill(
                        RadialGradient(
                            colors: [
                                Color.white.opacity(0.92),
                                color.opacity(0.72),
                                Color(red: 0.43, green: 0.16, blue: 1.0).opacity(0.90),
                                Color(red: 0.12, green: 0.05, blue: 0.24).opacity(0.92)
                            ],
                            center: .topLeading,
                            startRadius: 6,
                            endRadius: 172
                        )
                    )
                    .overlay(Circle().stroke(Color.white.opacity(0.45), lineWidth: 1.4))
                    .shadow(color: color.opacity(isActive ? 0.72 : 0.42), radius: isActive ? 44 : 28)
                    .scaleEffect(1 + CGFloat(activity) * 0.045)

                VoiceOrbRibbonField(color: color, activity: activity, seconds: seconds)
                    .clipShape(Circle())
                    .padding(10)

                Circle()
                    .fill(
                        LinearGradient(
                            colors: [Color.white.opacity(0.42), Color.clear],
                            startPoint: .topLeading,
                            endPoint: .center
                        )
                    )
                    .scaleEffect(0.92)
                    .offset(x: -18, y: -20)
                    .blur(radius: 10)
                    .opacity(0.74)
            }
        }
        .animation(.spring(response: 0.24, dampingFraction: 0.72), value: level)
        .accessibilityLabel(isListening ? "Voice is listening" : isSpeaking ? "Voice is speaking" : "Voice")
    }
}

private struct VoiceOrbRibbonField: View {
    let color: Color
    let activity: Double
    let seconds: TimeInterval

    var body: some View {
        Canvas { context, size in
            let center = CGPoint(x: size.width / 2, y: size.height / 2)
            let radius = min(size.width, size.height) * 0.36
            for ribbon in 0..<8 {
                var path = Path()
                let phase = seconds * (0.64 + Double(ribbon) * 0.035) + Double(ribbon) * 0.78
                for step in 0...96 {
                    let t = Double(step) / 96.0
                    let angle = t * .pi * 2
                    let wobble = sin(angle * (2.0 + Double(ribbon % 3)) + phase) * (0.18 + activity * 0.10)
                    let secondary = cos(angle * 3.0 - phase * 0.7) * (0.08 + activity * 0.06)
                    let x = center.x + CGFloat(cos(angle + phase * 0.12) * radius * (1 + wobble))
                    let y = center.y + CGFloat(sin(angle * (0.72 + secondary) + phase * 0.10) * radius * (0.58 + activity * 0.20))
                    if step == 0 {
                        path.move(to: CGPoint(x: x, y: y))
                    } else {
                        path.addLine(to: CGPoint(x: x, y: y))
                    }
                }
                context.stroke(
                    path,
                    with: .linearGradient(
                        Gradient(colors: [
                            Color.white.opacity(0.72),
                            color.opacity(0.68),
                            Color.white.opacity(0.34)
                        ]),
                        startPoint: CGPoint(x: 0, y: 0),
                        endPoint: CGPoint(x: size.width, y: size.height)
                    ),
                    lineWidth: CGFloat(1.2 + activity * 2.8)
                )
            }
        }
        .blur(radius: 0.45)
    }
}

private struct VoiceMicControlButton: View {
    let isActive: Bool
    let isCapturing: Bool
    let isThinking: Bool
    let color: Color
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            ZStack {
                ForEach(0..<3, id: \.self) { index in
                    Circle()
                        .fill(color.opacity(isActive ? 0.16 - Double(index) * 0.035 : 0.07))
                        .frame(width: 78 + CGFloat(index) * 20, height: 78 + CGFloat(index) * 20)
                        .scaleEffect(isCapturing ? 1.08 : 1.0)
                }

                Circle()
                    .fill(
                        RadialGradient(
                            colors: [
                                Color.white.opacity(0.60),
                                color.opacity(isActive ? 0.98 : 0.72),
                                Color(red: 0.62, green: 0.12, blue: 0.92)
                            ],
                            center: .topLeading,
                            startRadius: 2,
                            endRadius: 60
                        )
                    )
                    .frame(width: 66, height: 66)
                    .overlay(Circle().stroke(Color.white.opacity(0.32), lineWidth: 1))
                    .shadow(color: color.opacity(isActive ? 0.58 : 0.28), radius: 22, y: 10)

                Image(systemName: isActive ? "stop.fill" : "mic.fill")
                    .font(.system(size: isActive ? 22 : 28, weight: .semibold))
                    .foregroundStyle(Color.white)
                    .symbolEffect(.pulse, options: .repeating, value: isCapturing || isThinking)
            }
            .frame(width: 112, height: 112)
        }
        .buttonStyle(.plain)
        .help(isActive ? "Stop Listening" : "Start Listening")
    }
}

private struct VoiceFloatingControlButton: View {
    let symbol: String
    let color: Color
    let isActive: Bool
    let help: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(.system(size: 18, weight: .semibold))
                .foregroundStyle(Color.white.opacity(0.92))
                .frame(width: 56, height: 56)
                .background(Color.white.opacity(isActive ? 0.17 : 0.09))
                .overlay(Circle().stroke((isActive ? color : Color.white).opacity(isActive ? 0.44 : 0.22), lineWidth: 1))
                .clipShape(Circle())
                .shadow(color: (isActive ? color : Color.black).opacity(isActive ? 0.24 : 0.18), radius: 14, y: 9)
        }
        .buttonStyle(.plain)
        .help(help)
    }
}

private struct VoiceOverlayCard<Content: View>: View {
    let content: Content

    init(@ViewBuilder content: () -> Content) {
        self.content = content()
    }

    var body: some View {
        content
            .padding(20)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(.regularMaterial)
            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(Color.white.opacity(0.13), lineWidth: 1))
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            .shadow(color: Color.black.opacity(0.18), radius: 18, y: 10)
    }
}

private struct VoiceOverlayAvatar: View {
    let symbol: String
    let color: Color
    let isAssistant: Bool

    var body: some View {
        Image(systemName: symbol)
            .font(.system(size: 15, weight: .semibold))
            .foregroundStyle(isAssistant ? Color.white : color)
            .frame(width: 34, height: 34)
            .background(isAssistant ? Color.black.opacity(0.88) : color.opacity(0.14))
            .overlay(RoundedRectangle(cornerRadius: 8).stroke(isAssistant ? Color.white.opacity(0.12) : color.opacity(0.22), lineWidth: 1))
            .clipShape(RoundedRectangle(cornerRadius: 8))
    }
}

private struct VoiceOverlayMetric: View {
    let label: String
    let value: String
    let color: Color

    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            Text(label)
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(PKTheme.text3)
                .lineLimit(1)
            Text(value)
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(PKTheme.text)
                .lineLimit(1)
                .minimumScaleFactor(0.72)
            Capsule()
                .fill(color.opacity(0.85))
                .frame(width: 30, height: 3)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(12)
        .background(PKTheme.control.opacity(0.48))
        .overlay(RoundedRectangle(cornerRadius: 8).stroke(PKTheme.edge, lineWidth: 1))
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }
}

private struct ProjectsPage: View {
    let snapshot: NativeStoreSnapshot
    @Binding var selectedWorkspaceId: EntityID?
    @Binding var selectedWorkItemId: EntityID?
    @ObservedObject var model: NativeAppModel
    let newProject: () -> Void
    let navigate: (NativeRoute) -> Void
    @State private var contextVisible = true

    private var selectedWorkspace: Workspace? {
        if let selectedWorkspaceId,
           let workspace = snapshot.workspaces.first(where: { $0.id == selectedWorkspaceId }) {
            return workspace
        }
        return snapshot.workspaces.first
    }

    private var selectedProject: Project? {
        guard let selectedWorkspace else { return snapshot.projects.first }
        return snapshot.projects.first(where: { $0.workspaceIds.contains(selectedWorkspace.id) }) ?? snapshot.projects.first
    }

    private var activeProjectRun: AgentRun? {
        guard let activeRunId = model.activeRunId,
              let run = snapshot.runs.first(where: { $0.id == activeRunId }) else {
            return nil
        }
        guard let selectedWorkspace else { return run }
        return run.workspaceId == selectedWorkspace.id ? run : nil
    }

    var body: some View {
        HStack(spacing: 0) {
            ProjectTreePane(
                snapshot: snapshot,
                selectedWorkspaceId: $selectedWorkspaceId,
                newProject: newProject,
                selectWorkspace: selectWorkspace,
                moveProject: { projectId, targetProjectId in
                    Task { await model.moveProject(projectId, before: targetProjectId) }
                },
                moveWorkspace: { workspaceId, targetWorkspaceId in
                    Task { await model.moveWorkspace(workspaceId, before: targetWorkspaceId) }
                },
                deleteProject: deleteProject,
                deleteWorkspace: deleteWorkspace
            )
            .frame(width: 292)

            Divider().overlay(PKTheme.edge)

            ProjectChatPane(
                snapshot: snapshot,
                selectedWorkspace: selectedWorkspace,
                selectedProject: selectedProject,
                activeRun: activeProjectRun,
                selectedWorkspaceId: $selectedWorkspaceId,
                selectedWorkItemId: $selectedWorkItemId,
                model: model,
                navigate: navigate
            )
            .frame(maxWidth: .infinity, maxHeight: .infinity)

            Divider().overlay(PKTheme.edge)

            if contextVisible {
                ProjectContextSidebar(
                    snapshot: snapshot,
                    selectedWorkspace: selectedWorkspace,
                    selectedProject: selectedProject,
                    selectedAgentKind: model.selectedAgentKind,
                    branchOptions: selectedWorkspace.map { model.branchOptionsByWorkspace[$0.id] ?? [] } ?? [],
                    branchStatus: selectedWorkspace.flatMap { model.branchStatusByWorkspace[$0.id] },
                    activeRunId: model.activeRunId,
                    hideContext: { withAnimation(.easeInOut(duration: 0.16)) { contextVisible = false } },
                    refreshBranches: { Task { await model.refreshBranches(for: selectedWorkspace) } },
                    switchBranch: { branch in Task { await model.switchBranch(branch, workspace: selectedWorkspace) } },
                    selectChat: selectRecentChat,
                    stageOutput: stageOutputFollowUp,
                    saveKnowledge: saveOutputKnowledge
                )
                .frame(width: 300)
                .transition(.move(edge: .trailing).combined(with: .opacity))
            } else {
                ContextRevealRail {
                    withAnimation(.easeInOut(duration: 0.16)) {
                        contextVisible = true
                    }
                }
                .frame(width: 42)
                .transition(.opacity)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(PKTheme.panel.opacity(0.24))
        .task(id: selectedWorkspace?.id) {
            await model.refreshBranches(for: selectedWorkspace)
        }
    }

    private func selectWorkspace(_ workspaceId: EntityID) {
        selectedWorkspaceId = workspaceId
        model.prepareNewChat()
    }

    private func deleteProject(_ project: Project) {
        if let selectedWorkspaceId, project.workspaceIds.contains(selectedWorkspaceId) {
            self.selectedWorkspaceId = snapshot.workspaces.first(where: { !project.workspaceIds.contains($0.id) })?.id
        }
        Task { await model.deleteProject(project.id) }
    }

    private func deleteWorkspace(_ workspace: Workspace) {
        if selectedWorkspaceId == workspace.id {
            selectedWorkspaceId = snapshot.workspaces.first(where: { $0.id != workspace.id })?.id
        }
        if selectedWorkItemId.flatMap({ id in snapshot.workItems.first(where: { $0.id == id })?.workspaceId }) == workspace.id {
            selectedWorkItemId = nil
        }
        Task { await model.deleteWorkspace(workspace.id) }
    }

    private func selectRecentChat(_ run: AgentRun) {
        selectedWorkspaceId = run.workspaceId
        selectedWorkItemId = run.workItemId
        model.activeRunId = run.id
        model.draftPrompt = ""
        if let workspace = snapshot.workspaces.first(where: { $0.id == run.workspaceId }) {
            Task { await model.refreshBranches(for: workspace) }
        }
    }

    private func stageOutputFollowUp(_ artifact: Artifact) {
        let run = artifactSourceRun(artifact, snapshot: snapshot)
        let item = artifactWorkItem(artifact, snapshot: snapshot)
        selectedWorkspaceId = artifact.workspaceId
        selectedWorkItemId = item?.id ?? artifact.workItemId
        _ = model.stageAssistantPrompt(
            title: "Output follow-up",
            prompt: artifactFollowUpPrompt(artifact: artifact, run: run, workItem: item),
            agentKind: .codex,
            workspaceId: artifact.workspaceId,
            workItemId: item?.id ?? artifact.workItemId
        )
        navigate(.chat)
    }

    private func saveOutputKnowledge(_ artifact: Artifact) {
        Task { await model.saveArtifactKnowledgeNote(artifactId: artifact.id) }
    }
}

private struct ProjectTreePane: View {
    let snapshot: NativeStoreSnapshot
    @Binding var selectedWorkspaceId: EntityID?
    let newProject: () -> Void
    let selectWorkspace: (EntityID) -> Void
    let moveProject: (EntityID, EntityID) -> Void
    let moveWorkspace: (EntityID, EntityID) -> Void
    let deleteProject: (Project) -> Void
    let deleteWorkspace: (Workspace) -> Void
    @State private var addHovering = false
    @State private var draggingProjectId: EntityID?
    @State private var draggingWorkspaceId: EntityID?

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 10) {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Projects")
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundStyle(PKTheme.text)
                    Text("Project tree")
                        .font(.caption)
                        .foregroundStyle(PKTheme.text3)
                }
                Spacer()
                Button(action: newProject) {
                    Image(systemName: "plus")
                        .font(.system(size: 13, weight: .semibold))
                        .frame(width: 30, height: 30)
                        .background(addHovering ? PKTheme.primary.opacity(0.88) : PKTheme.primary)
                        .foregroundStyle(PKTheme.primaryText)
                        .clipShape(RoundedRectangle(cornerRadius: 7))
                        .overlay(RoundedRectangle(cornerRadius: 7).stroke(Color.white.opacity(addHovering ? 0.28 : 0.10), lineWidth: 1))
                        .shadow(color: PKTheme.primary.opacity(addHovering ? 0.22 : 0), radius: addHovering ? 12 : 0, y: 6)
                }
                .buttonStyle(.plain)
                .help("Add Project")
                .onHover { hovering in
                    withAnimation(.easeInOut(duration: 0.14)) {
                        addHovering = hovering
                    }
                }
            }
            .padding(16)
            .overlay(alignment: .bottom) { Rectangle().fill(PKTheme.edge).frame(height: 1) }

            ScrollView {
                LazyVStack(alignment: .leading, spacing: 10) {
                    if snapshot.projects.isEmpty && snapshot.workspaces.isEmpty {
                        EmptyMiniState(title: "No projects", subtitle: "Add a workspace to start a project chat.")
                    }

                    ForEach(snapshot.projects) { project in
                        ProjectTreeProjectGroup(
                            project: project,
                            workspaces: workspaces(for: project),
                            selectedWorkspaceId: selectedWorkspaceId,
                            selectWorkspace: selectWorkspace,
                            draggingProjectId: $draggingProjectId,
                            draggingWorkspaceId: $draggingWorkspaceId,
                            moveProject: moveProject,
                            moveWorkspace: moveWorkspace,
                            deleteProject: { deleteProject(project) },
                            deleteWorkspace: deleteWorkspace
                        )
                    }

                    let orphanWorkspaces = snapshot.workspaces.filter { workspace in
                        !snapshot.projects.contains { $0.workspaceIds.contains(workspace.id) }
                    }
                    if !orphanWorkspaces.isEmpty {
                        ProjectTreeWorkspaceSection(
                            title: "Loose Workspaces",
                            workspaces: orphanWorkspaces,
                            selectedWorkspaceId: selectedWorkspaceId,
                            selectWorkspace: selectWorkspace,
                            draggingWorkspaceId: $draggingWorkspaceId,
                            moveWorkspace: moveWorkspace,
                            deleteWorkspace: deleteWorkspace
                        )
                    }
                }
                .padding(12)
            }
        }
        .background(PKTheme.panel.opacity(0.48))
    }

    private func workspaces(for project: Project) -> [Workspace] {
        project.workspaceIds.compactMap { workspaceId in
            snapshot.workspaces.first(where: { $0.id == workspaceId })
        }
    }
}

private struct ProjectTreeProjectGroup: View {
    let project: Project
    let workspaces: [Workspace]
    let selectedWorkspaceId: EntityID?
    let selectWorkspace: (EntityID) -> Void
    @Binding var draggingProjectId: EntityID?
    @Binding var draggingWorkspaceId: EntityID?
    let moveProject: (EntityID, EntityID) -> Void
    let moveWorkspace: (EntityID, EntityID) -> Void
    let deleteProject: () -> Void
    let deleteWorkspace: (Workspace) -> Void
    @State private var hovering = false

    private var selected: Bool {
        guard let selectedWorkspaceId else { return false }
        return project.workspaceIds.contains(selectedWorkspaceId)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            Button {
                if let workspaceId = project.workspaceIds.first {
                    selectWorkspace(workspaceId)
                }
            } label: {
                HStack(spacing: 9) {
                    Image(systemName: "folder")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(selected || hovering ? PKTheme.primary : PKTheme.text3)
                        .frame(width: 24, height: 24)
                    VStack(alignment: .leading, spacing: 3) {
                        Text(project.name)
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(selected || hovering ? PKTheme.text : PKTheme.text2)
                            .lineLimit(1)
                        Text(workspaces.isEmpty ? "No workspace linked" : "\(workspaces.count) workspace\(workspaces.count == 1 ? "" : "s")")
                            .font(.caption2)
                            .foregroundStyle(hovering ? PKTheme.text2 : PKTheme.text3)
                    }
                    Spacer()
                    if selected {
                        Dot(color: PKTheme.primary)
                    }
                    Image(systemName: "line.3.horizontal")
                        .font(.system(size: 10, weight: .semibold))
                        .foregroundStyle(hovering ? PKTheme.text3 : PKTheme.text3.opacity(0.55))
                    if hovering {
                        Button(role: .destructive, action: deleteProject) {
                            Image(systemName: "trash")
                                .font(.system(size: 10, weight: .semibold))
                                .foregroundStyle(PKTheme.err)
                                .frame(width: 18, height: 18)
                        }
                        .buttonStyle(.plain)
                        .help("Delete Project")
                    }
                }
                .padding(10)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(
                    selected
                        ? PKTheme.primary.opacity(hovering ? 0.15 : 0.10)
                        : PKTheme.panelAlt.opacity(hovering ? 0.54 : 0.36)
                )
                .overlay(RoundedRectangle(cornerRadius: 8).stroke(selected || hovering ? PKTheme.primary.opacity(selected ? 0.42 : 0.28) : PKTheme.edge, lineWidth: 1))
                .clipShape(RoundedRectangle(cornerRadius: 8))
                .shadow(color: PKTheme.primary.opacity(hovering ? 0.10 : 0), radius: hovering ? 12 : 0, y: 6)
            }
            .buttonStyle(.plain)
            .onHover { isHovering in
                withAnimation(.easeInOut(duration: 0.14)) {
                    hovering = isHovering
                }
            }
            .onDrag {
                draggingProjectId = project.id
                return NSItemProvider(object: project.id.rawValue as NSString)
            }
            .onDrop(
                of: [.text],
                delegate: ProjectDropDelegate(
                    targetProjectId: project.id,
                    draggingProjectId: $draggingProjectId,
                    moveProject: moveProject
                )
            )
            .contextMenu {
                Button("Delete Project", systemImage: "trash", role: .destructive, action: deleteProject)
            }

            VStack(spacing: 5) {
                ForEach(workspaces) { workspace in
                    ProjectTreeWorkspaceRow(
                        workspace: workspace,
                        selected: selectedWorkspaceId == workspace.id,
                        action: { selectWorkspace(workspace.id) },
                        draggingWorkspaceId: $draggingWorkspaceId,
                        moveWorkspace: moveWorkspace,
                        delete: { deleteWorkspace(workspace) }
                    )
                }
            }
            .padding(.leading, 16)
        }
    }
}

private struct ProjectTreeWorkspaceSection: View {
    let title: String
    let workspaces: [Workspace]
    let selectedWorkspaceId: EntityID?
    let selectWorkspace: (EntityID) -> Void
    @Binding var draggingWorkspaceId: EntityID?
    let moveWorkspace: (EntityID, EntityID) -> Void
    let deleteWorkspace: (Workspace) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            Text(title.uppercased())
                .font(.system(size: 10, weight: .semibold))
                .foregroundStyle(PKTheme.text3)
                .padding(.horizontal, 2)

            ForEach(workspaces) { workspace in
                ProjectTreeWorkspaceRow(
                    workspace: workspace,
                    selected: selectedWorkspaceId == workspace.id,
                    action: { selectWorkspace(workspace.id) },
                    draggingWorkspaceId: $draggingWorkspaceId,
                    moveWorkspace: moveWorkspace,
                    delete: { deleteWorkspace(workspace) }
                )
            }
        }
    }
}

private struct ProjectTreeWorkspaceRow: View {
    let workspace: Workspace
    let selected: Bool
    let action: () -> Void
    @Binding var draggingWorkspaceId: EntityID?
    let moveWorkspace: (EntityID, EntityID) -> Void
    let delete: () -> Void
    @State private var hovering = false

    var body: some View {
        Button(action: action) {
            HStack(spacing: 8) {
                Image(systemName: "folder.badge.gearshape")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(selected || hovering ? PKTheme.primary : PKTheme.text3)
                    .frame(width: 18)
                VStack(alignment: .leading, spacing: 2) {
                    Text(workspace.name)
                        .font(.system(size: 12, weight: selected ? .semibold : .medium))
                        .foregroundStyle(selected || hovering ? PKTheme.text : PKTheme.text2)
                        .lineLimit(1)
                    Text(workspace.currentBranch ?? workspace.kind)
                        .font(.caption2)
                        .foregroundStyle(hovering ? PKTheme.text2 : PKTheme.text3)
                        .lineLimit(1)
                }
                Spacer()
                Image(systemName: "line.3.horizontal")
                    .font(.system(size: 9, weight: .semibold))
                    .foregroundStyle(hovering ? PKTheme.text3 : PKTheme.text3.opacity(0.45))
                if hovering {
                    Button(role: .destructive, action: delete) {
                        Image(systemName: "trash")
                            .font(.system(size: 9, weight: .semibold))
                            .foregroundStyle(PKTheme.err)
                            .frame(width: 16, height: 16)
                    }
                    .buttonStyle(.plain)
                    .help("Remove Workspace")
                }
            }
            .padding(.horizontal, 9)
            .frame(height: 42)
            .background(selected ? PKTheme.selected.opacity(hovering ? 1 : 0.88) : PKTheme.control.opacity(hovering ? 0.58 : 0.36))
            .overlay(RoundedRectangle(cornerRadius: 7).stroke(selected || hovering ? PKTheme.edgeStrong : PKTheme.edge.opacity(0.65), lineWidth: 1))
            .clipShape(RoundedRectangle(cornerRadius: 7))
            .shadow(color: PKTheme.primary.opacity(hovering ? 0.08 : 0), radius: hovering ? 9 : 0, y: 5)
        }
        .buttonStyle(.plain)
        .onHover { isHovering in
            withAnimation(.easeInOut(duration: 0.14)) {
                hovering = isHovering
            }
        }
        .onDrag {
            draggingWorkspaceId = workspace.id
            return NSItemProvider(object: workspace.id.rawValue as NSString)
        }
        .onDrop(
            of: [.text],
            delegate: WorkspaceDropDelegate(
                targetWorkspaceId: workspace.id,
                draggingWorkspaceId: $draggingWorkspaceId,
                moveWorkspace: moveWorkspace
            )
        )
        .contextMenu {
            Button("Remove Workspace", systemImage: "trash", role: .destructive, action: delete)
        }
    }
}

private struct ProjectDropDelegate: DropDelegate {
    let targetProjectId: EntityID
    @Binding var draggingProjectId: EntityID?
    let moveProject: (EntityID, EntityID) -> Void

    func validateDrop(info: DropInfo) -> Bool {
        info.hasItemsConforming(to: [.text])
    }

    func dropEntered(info: DropInfo) {
        guard let draggingProjectId, draggingProjectId != targetProjectId else { return }
        moveProject(draggingProjectId, targetProjectId)
    }

    func performDrop(info: DropInfo) -> Bool {
        draggingProjectId = nil
        return true
    }
}

private struct WorkspaceDropDelegate: DropDelegate {
    let targetWorkspaceId: EntityID
    @Binding var draggingWorkspaceId: EntityID?
    let moveWorkspace: (EntityID, EntityID) -> Void

    func validateDrop(info: DropInfo) -> Bool {
        info.hasItemsConforming(to: [.text])
    }

    func dropEntered(info: DropInfo) {
        guard let draggingWorkspaceId, draggingWorkspaceId != targetWorkspaceId else { return }
        moveWorkspace(draggingWorkspaceId, targetWorkspaceId)
    }

    func performDrop(info: DropInfo) -> Bool {
        draggingWorkspaceId = nil
        return true
    }
}

private struct ProjectChatPane: View {
    let snapshot: NativeStoreSnapshot
    let selectedWorkspace: Workspace?
    let selectedProject: Project?
    let activeRun: AgentRun?
    @Binding var selectedWorkspaceId: EntityID?
    @Binding var selectedWorkItemId: EntityID?
    @ObservedObject var model: NativeAppModel
    let navigate: (NativeRoute) -> Void

    var body: some View {
        ZStack {
            if let selectedWorkspace {
                if let activeRun {
                    ConversationWorkspace(
                        run: activeRun,
                        snapshot: snapshot,
                        selectedWorkspace: selectedWorkspace,
                        selectedWorkspaceId: $selectedWorkspaceId,
                        selectedWorkItemId: $selectedWorkItemId,
                        model: model,
                        immersive: true,
                        newChat: model.prepareNewChat,
                        openWorkItem: { navigate(.workItems) }
                    )
                    .padding(.horizontal, 24)
                    .padding(.top, 12)
                    .padding(.bottom, 24)
                } else {
                    ProjectChatStarter(
                        snapshot: snapshot,
                        workspace: selectedWorkspace,
                        project: selectedProject,
                        selectedWorkspaceId: $selectedWorkspaceId,
                        selectedPermissionMode: $model.selectedPermissionMode,
                        selectedAgentKind: model.selectedAgentKind,
                        draftPrompt: $model.draftPrompt,
                        isRunning: model.isRunning,
                        branchOptions: model.branchOptionsByWorkspace[selectedWorkspace.id] ?? [],
                        branchStatus: model.branchStatusByWorkspace[selectedWorkspace.id],
                        openTerminal: {
                            navigate(.terminal)
                        },
                        captureWorkItem: {
                            Task { _ = await model.createWorkItem(workspaceId: selectedWorkspaceId ?? selectedWorkspace.id) }
                        },
                        switchBranch: { branch in
                            Task { await model.switchBranch(branch, workspace: selectedWorkspace) }
                        },
                        send: sendProjectChat
                    )
                    .padding(24)
                }
            } else {
                EmptyProjectChatState(addProject: {
                    NotificationCenter.default.post(name: .pikiclawAddWorkspace, object: nil)
                })
                .padding(24)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func sendProjectChat() {
        Task {
            if let runId = await model.startChat(
                workspaceId: selectedWorkspaceId ?? selectedWorkspace?.id,
                targetWorkItemId: selectedWorkItemId
            ),
               let run = model.snapshot.runs.first(where: { $0.id == runId }) {
                selectedWorkItemId = run.workItemId
            }
        }
    }
}

private struct ProjectChatStarter: View {
    let snapshot: NativeStoreSnapshot
    let workspace: Workspace
    let project: Project?
    @Binding var selectedWorkspaceId: EntityID?
    @Binding var selectedPermissionMode: PermissionMode
    let selectedAgentKind: NativeAgentKind
    @Binding var draftPrompt: String
    let isRunning: Bool
    let branchOptions: [String]
    let branchStatus: String?
    let openTerminal: () -> Void
    let captureWorkItem: () -> Void
    let switchBranch: (String) -> Void
    let send: () -> Void
    @FocusState private var focused: Bool

    private var accent: Color {
        agentTint(selectedAgentKind)
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                HStack(spacing: 14) {
                    Image(systemName: agentSymbol(selectedAgentKind))
                        .font(.system(size: 17, weight: .semibold))
                        .foregroundStyle(PKTheme.primaryText)
                        .frame(width: 46, height: 46)
                        .background(accent)
                        .clipShape(RoundedRectangle(cornerRadius: 9))
                    VStack(alignment: .leading, spacing: 5) {
                        Text(project?.name ?? workspace.name)
                            .font(.system(size: 24, weight: .semibold))
                            .foregroundStyle(PKTheme.text)
                            .lineLimit(1)
                        Text(projectSubtitle)
                            .font(.system(size: 12, weight: .medium))
                            .foregroundStyle(PKTheme.text3)
                            .lineLimit(1)
                    }
                    Spacer()
                    StatusPill(text: agentShortLabel(selectedAgentKind), color: agentTint(selectedAgentKind))
                    StatusPill(text: isRunning ? "RUNNING" : "READY", color: isRunning ? PKTheme.warn : PKTheme.primary)
                    ComposerIconButton(symbol: "terminal", title: "Terminal", action: openTerminal)
                }

                NewChatCategoryStrip(mode: .engineering) { action in
                    applyPrompt(action.prompt)
                }

                MinimalChatComposer(
                    snapshot: snapshot,
                    selectedWorkspaceId: $selectedWorkspaceId,
                    selectedPermissionMode: $selectedPermissionMode,
                    text: $draftPrompt,
                    placeholder: "Message \(agentShortLabel(selectedAgentKind)) in \(project?.name ?? workspace.name)",
                    focused: $focused,
                    selectedAgentKind: selectedAgentKind,
                    isRunning: isRunning,
                    openTerminal: openTerminal,
                    captureWorkItem: captureWorkItem,
                    send: send
                )

                NewChatTemplateGallery(mode: .engineering) { template in
                    applyPrompt(template.prompt)
                }
            }
            .frame(maxWidth: 980, alignment: .leading)
            .padding(.vertical, 36)
            .frame(maxWidth: .infinity)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var projectSubtitle: String {
        if let branch = workspace.currentBranch, !branch.isEmpty {
            return "\(project?.name ?? workspace.name) · \(branch)"
        }
        return workspace.pathDisplay
    }

    private func applyPrompt(_ prompt: String) {
        let projectName = project?.name ?? workspace.name
        draftPrompt = prompt
            .replacingOccurrences(of: "{project}", with: projectName)
            .replacingOccurrences(of: "{agent}", with: agentShortLabel(selectedAgentKind))
        focused = true
    }
}

private struct EmptyProjectChatState: View {
    let addProject: () -> Void

    var body: some View {
        VStack(spacing: 14) {
            Spacer()
            Image(systemName: "folder.badge.plus")
                .font(.system(size: 26, weight: .semibold))
                .foregroundStyle(PKTheme.primary)
                .frame(width: 56, height: 56)
                .background(PKTheme.primary.opacity(0.12))
                .clipShape(RoundedRectangle(cornerRadius: 10))
            Text("Add a project to start")
                .font(.system(size: 20, weight: .semibold))
                .foregroundStyle(PKTheme.text)
            Text("Project chat starts from a selected workspace and keeps the right sidebar scoped to that project.")
                .font(.system(size: 13))
                .foregroundStyle(PKTheme.text3)
                .multilineTextAlignment(.center)
                .frame(maxWidth: 360)
            PrimaryButton(title: "Add Project", systemImage: "plus", action: addProject)
            Spacer()
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

private struct ProjectContextSidebar: View {
    let snapshot: NativeStoreSnapshot
    let selectedWorkspace: Workspace?
    let selectedProject: Project?
    let selectedAgentKind: NativeAgentKind
    let branchOptions: [String]
    let branchStatus: String?
    let activeRunId: EntityID?
    let hideContext: () -> Void
    let refreshBranches: () -> Void
    let switchBranch: (String) -> Void
    let selectChat: (AgentRun) -> Void
    let stageOutput: (Artifact) -> Void
    let saveKnowledge: (Artifact) -> Void

    private var workspaceIds: [EntityID] {
        if let selectedProject, !selectedProject.workspaceIds.isEmpty {
            return selectedProject.workspaceIds
        }
        if let selectedWorkspace {
            return [selectedWorkspace.id]
        }
        return []
    }

    private var runs: [AgentRun] {
        snapshot.runs
            .filter { workspaceIds.isEmpty || workspaceIds.contains($0.workspaceId) }
            .sorted { ($0.startedAt ?? .distantPast) > ($1.startedAt ?? .distantPast) }
    }

    private var chatGroups: [NativeChatRunGroup] {
        nativeChatRunGroups(from: runs)
    }

    private var artifacts: [Artifact] {
        snapshot.artifacts.filter { workspaceIds.isEmpty || workspaceIds.contains($0.workspaceId) }
    }

    private var currentBranch: String? {
        selectedWorkspace?.currentBranch ?? branchOptions.first
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                HStack {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Context")
                            .font(.system(size: 16, weight: .semibold))
                            .foregroundStyle(PKTheme.text)
                        Text(selectedProject?.name ?? selectedWorkspace?.name ?? "No project")
                            .font(.caption)
                            .foregroundStyle(PKTheme.text3)
                            .lineLimit(1)
                    }
                    Spacer()
                    StatusPill(text: agentShortLabel(selectedAgentKind), color: agentTint(selectedAgentKind))
                    Button(action: hideContext) {
                        Image(systemName: "sidebar.right")
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundStyle(PKTheme.text3)
                            .frame(width: 30, height: 30)
                            .background(PKTheme.control.opacity(0.72))
                            .overlay(RoundedRectangle(cornerRadius: 8).stroke(PKTheme.edge, lineWidth: 1))
                            .clipShape(RoundedRectangle(cornerRadius: 8))
                    }
                    .buttonStyle(.plain)
                    .help("Hide Context")
                }

                InspectorSection(title: "Project") {
                    InspectorMetric(label: "Workspace", value: selectedWorkspace?.name ?? "None")
                    if let currentBranch {
                        ProjectBranchPicker(
                            currentBranch: currentBranch,
                            branches: branchOptions,
                            status: branchStatus,
                            refresh: refreshBranches,
                            switchBranch: switchBranch
                        )
                    }
                    InspectorMetric(label: "Trust", value: selectedWorkspace?.trustState.rawValue ?? "unknown")
                    if let path = selectedWorkspace?.pathDisplay {
                        Text(path)
                            .font(.caption)
                            .foregroundStyle(PKTheme.text3)
                            .lineLimit(2)
                            .textSelection(.enabled)
                    }
                }

                InspectorSection(title: "Recent Chats") {
                    ForEach(chatGroups.prefix(4)) { group in
                        ProjectRecentChatGroupRow(
                            group: group,
                            selectedRunId: activeRunId,
                            selectChat: selectChat
                        )
                    }
                    if chatGroups.isEmpty {
                        EmptyMiniState(title: "No project chats", subtitle: "Send a message to start this project chat.")
                    }
                }

                InspectorSection(title: "Outputs") {
                    if !artifacts.isEmpty {
                        OutputPanelSummary(outputs: artifacts)
                    }
                    ForEach(Array(artifacts.prefix(4))) { artifact in
                        let run = artifactSourceRun(artifact, snapshot: snapshot)
                        let item = artifactWorkItem(artifact, snapshot: snapshot)
                        ArtifactOutputRow(
                            artifact: artifact,
                            sourceRun: run,
                            workItem: item,
                            openRun: run.map { sourceRun in
                                { selectChat(sourceRun) }
                            },
                            copySummary: {
                                copyTextToPasteboard(artifactClipboardSummary(
                                    artifact: artifact,
                                    run: run,
                                    workItem: item
                                ))
                            },
                            stageFollowUp: {
                                stageOutput(artifact)
                            },
                            saveKnowledge: {
                                saveKnowledge(artifact)
                            }
                        )
                    }
                    if artifacts.isEmpty {
                        EmptyMiniState(title: "No outputs", subtitle: "Artifacts and notes will appear here.")
                    }
                }
            }
            .padding(16)
        }
        .background(PKTheme.panel.opacity(0.42))
    }
}

private struct ProjectRecentChatGroupRow: View {
    let group: NativeChatRunGroup
    let selectedRunId: EntityID?
    let selectChat: (AgentRun) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            InspectorActionRow(
                symbol: group.children.isEmpty ? "text.bubble" : "rectangle.split.2x1",
                title: group.parent.promptSnapshot.firstLineFallback("Conversation"),
                subtitle: group.children.isEmpty ? group.parent.state.rawValue : "\(group.children.count + 1) windows · \(group.parent.state.rawValue)",
                selected: selectedRunId == group.parent.id || group.children.contains(where: { $0.id == selectedRunId }),
                action: { selectChat(group.parent) }
            )
            if !group.children.isEmpty {
                VStack(spacing: 4) {
                    ForEach(group.children.prefix(3)) { child in
                        Button {
                            selectChat(group.parent)
                        } label: {
                            HStack(spacing: 6) {
                                Image(systemName: "text.bubble")
                                    .font(.system(size: 9, weight: .semibold))
                                    .foregroundStyle(PKTheme.primary)
                                Text(child.promptSnapshot.firstLineFallback("Side chat"))
                                    .font(.caption2.weight(.semibold))
                                    .foregroundStyle(PKTheme.text3)
                                    .lineLimit(1)
                                Spacer()
                            }
                            .padding(.horizontal, 8)
                            .frame(height: 24)
                            .background(PKTheme.panel.opacity(0.32))
                            .clipShape(RoundedRectangle(cornerRadius: 6))
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(.leading, 11)
            }
        }
    }
}

private struct ProjectBranchPicker: View {
    let currentBranch: String
    let branches: [String]
    let status: String?
    let refresh: () -> Void
    let switchBranch: (String) -> Void
    @State private var branchPickerOpen = false

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text("Branch")
                    .font(.caption)
                    .foregroundStyle(PKTheme.text3)
                Spacer()
                Button {
                    branchPickerOpen.toggle()
                } label: {
                    HStack(spacing: 5) {
                        Text(currentBranch)
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(PKTheme.text2)
                            .lineLimit(1)
                            .truncationMode(.middle)
                        Image(systemName: "chevron.down")
                            .font(.system(size: 8, weight: .bold))
                            .foregroundStyle(PKTheme.primary)
                    }
                    .frame(maxWidth: 172, alignment: .trailing)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .popover(isPresented: $branchPickerOpen, arrowEdge: .trailing) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Branch")
                            .font(.system(size: 9.5, weight: .semibold))
                            .foregroundStyle(PKTheme.text4)
                            .padding(.horizontal, 7)
                            .padding(.top, 3)

                        if branches.isEmpty {
                            Button {
                                refresh()
                            } label: {
                                Label("Refresh Branches", systemImage: "arrow.clockwise")
                                    .font(.system(size: 11, weight: .semibold))
                                    .frame(maxWidth: .infinity, alignment: .leading)
                            }
                            .buttonStyle(.plain)

                            Text("No local branches")
                                .font(.system(size: 11, weight: .medium))
                                .foregroundStyle(PKTheme.text3)
                        } else {
                            ScrollView {
                                VStack(spacing: 2) {
                                    ForEach(branches, id: \.self) { branch in
                                        BranchPickerRow(
                                            branch: branch,
                                            selected: branch == currentBranch
                                        ) {
                                            if branch != currentBranch {
                                                switchBranch(branch)
                                            }
                                            branchPickerOpen = false
                                        }
                                    }
                                }
                                .padding(3)
                            }
                            .frame(maxHeight: 150)

                            Divider()
                                .padding(.vertical, 1)

                            Button {
                                refresh()
                            } label: {
                                Label("Refresh Branches", systemImage: "arrow.clockwise")
                                    .font(.system(size: 11, weight: .semibold))
                                    .frame(maxWidth: .infinity, alignment: .leading)
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    .padding(4)
                    .frame(width: 218)
                    .background(PKTheme.panel.opacity(0.98))
                }
                .help("Switch Branch")
            }

            if let status {
                Text(status)
                    .font(.caption2)
                    .foregroundStyle(status.hasPrefix("Switching") ? PKTheme.primary : PKTheme.warn)
                    .lineLimit(2)
            }
        }
    }
}

private struct ContextRevealRail: View {
    let showContext: () -> Void

    var body: some View {
        VStack(spacing: 10) {
            Button(action: showContext) {
                Image(systemName: "sidebar.right")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(PKTheme.primary)
                    .frame(width: 30, height: 30)
                    .background(PKTheme.primary.opacity(0.10))
                    .overlay(RoundedRectangle(cornerRadius: 8).stroke(PKTheme.primary.opacity(0.24), lineWidth: 1))
                    .clipShape(RoundedRectangle(cornerRadius: 8))
            }
            .buttonStyle(.plain)
            .help("Show Context")
            .padding(.top, 14)

            Spacer()
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(PKTheme.panel.opacity(0.34))
    }
}

private struct ProjectCard: View {
    let workspace: Workspace
    let workCount: Int
    let selected: Bool
    let select: () -> Void
    let openChat: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 13) {
            HStack(spacing: 12) {
                Text(initials(workspace.name))
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(PKTheme.text2)
                    .frame(width: 44, height: 44)
                    .background(PKTheme.control.opacity(0.84))
                    .overlay(RoundedRectangle(cornerRadius: 7).stroke(PKTheme.edge, lineWidth: 1))
                    .clipShape(RoundedRectangle(cornerRadius: 7))
                VStack(alignment: .leading, spacing: 4) {
                    Text(workspace.name)
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(PKTheme.text)
                    Text(workspace.pathDisplay)
                        .font(.caption)
                        .foregroundStyle(PKTheme.text3)
                        .lineLimit(1)
                }
            }

            ContextMeter()

            HStack(spacing: 8) {
                MetricBox(label: "CHATS", value: "\(max(workCount, 1))")
                MetricBox(label: "AGENT", value: "Runtime default")
            }

            HStack(spacing: 8) {
                PrimaryButton(title: "Open", systemImage: "folder") {
                    select()
                }
                SecondaryButton(title: "New Chat", systemImage: "text.bubble") {
                    select()
                    openChat()
                }
            }

            Button(action: select) {
                HStack {
                    Text(selected ? "Selected" : "Manage")
                    Spacer()
                    Image(systemName: "chevron.down")
                }
                .font(.system(size: 12))
                .foregroundStyle(PKTheme.text3)
                .padding(.horizontal, 12)
                .frame(height: 34)
                .background(PKTheme.control.opacity(0.6))
                .overlay(RoundedRectangle(cornerRadius: 7).stroke(PKTheme.edge, lineWidth: 1))
                .clipShape(RoundedRectangle(cornerRadius: 7))
            }
            .buttonStyle(.plain)
        }
        .padding(16)
        .background(PKTheme.panel.opacity(0.72))
        .overlay(RoundedRectangle(cornerRadius: 8).stroke(selected ? PKTheme.primary.opacity(0.65) : PKTheme.edge, lineWidth: 1))
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }
}

private struct WorkItemsPage: View {
    let snapshot: NativeStoreSnapshot
    @Binding var selectedWorkItemId: EntityID?
    @Binding var selectedWorkspaceId: EntityID?
    @Binding var detailTab: DetailTab
    @ObservedObject var model: NativeAppModel
    let navigate: (NativeRoute) -> Void
    @State private var jiraQuery = ""
    @State private var selectedJiraRunId: EntityID?

    private var jiraItems: [WorkItem] {
        jiraTicketQueueItems(from: snapshot.workItems)
    }

    private var filteredJiraItems: [WorkItem] {
        jiraItems.filter { jiraTicketMatchesQuery($0, query: jiraQuery) }
    }

    private var selectedJiraItem: WorkItem? {
        if let selected = snapshot.workItems.first(where: { $0.id == selectedWorkItemId && $0.sourceType == .jira }) {
            return selected
        }
        return jiraItems.first
    }

    var body: some View {
        PageFrame(route: .workItems, showsHeader: false) {
            HStack(alignment: .top, spacing: 14) {
                JiraTicketSidebar(
                    items: filteredJiraItems,
                    totalCount: jiraItems.count,
                    query: $jiraQuery,
                    selectedWorkItemId: $selectedWorkItemId,
                    selectedWorkspaceId: $selectedWorkspaceId,
                    syncSummary: jiraSyncSummary,
                    isSyncing: model.jiraSyncIsRunning,
                    sync: syncJira
                )
                .frame(width: 340)

                JiraTicketChatWorkbench(
                    item: selectedJiraItem,
                    snapshot: snapshot,
                    selectedRunId: $selectedJiraRunId,
                    isRunning: model.isRunning,
                    isSyncing: model.jiraSyncIsRunning,
                    sync: syncJira,
                    start: startSelectedTicket,
                    copyBrief: copySelectedJiraBrief,
                    copyUpdate: copySelectedJiraUpdate,
                    openJira: openSelectedJiraTicket,
                    openChat: {
                        if let selectedJiraItem {
                            selectedWorkItemId = selectedJiraItem.id
                            selectedWorkspaceId = selectedJiraItem.workspaceId
                            _ = model.stageJiraTicketForChat(workItemId: selectedJiraItem.id)
                        }
                        navigate(.chat)
                    },
                    openRunInChat: openRunInChat(_:),
                    copyOutput: copyOutputSummary(_:),
                    stageOutput: stageOutputFollowUp(_:),
                    saveKnowledge: saveOutputKnowledge(_:)
                )
                .frame(maxWidth: .infinity)
            }
        } actions: {
            SecondaryButton(title: "Sync Jira", systemImage: "arrow.clockwise") {
                Task {
                    if let itemId = await model.syncJiraTickets(scope: .currentSprint, workspaceId: selectedWorkspaceId) {
                        selectedWorkItemId = itemId
                    }
                }
            }
            SecondaryButton(title: "Capture", systemImage: "tray.and.arrow.down") {
                Task {
                    await model.createWorkItem(workspaceId: selectedWorkspaceId)
                    selectedWorkItemId = model.snapshot.workItems.first?.id
                }
            }
            PrimaryButton(title: "Run", systemImage: "play.fill") {
                Task { await model.run(workItemId: selectedWorkItemId) }
            }
            .disabled(model.isRunning)
        }
    }

    private var jiraSyncSummary: String {
        let sync = snapshot.jiraSync ?? JiraSyncState()
        if model.jiraSyncIsRunning { return "Syncing current sprint" }
        if sync.status == .failed, let error = sync.lastError {
            return error
        }
        if let date = sync.lastSyncAt {
            return "\(sync.ticketCount) tickets - \(date.formatted(date: .abbreviated, time: .shortened))"
        }
        return "Current sprint not synced yet"
    }

    private func syncJira() {
        Task {
            if let itemId = await model.syncJiraTickets(scope: .currentSprint, workspaceId: selectedWorkspaceId) {
                selectedWorkItemId = itemId
                selectedWorkspaceId = model.snapshot.workItems.first(where: { $0.id == itemId })?.workspaceId ?? selectedWorkspaceId
            }
        }
    }

    private func startSelectedTicket() {
        Task {
            let itemId = selectedJiraItem?.id ?? selectedWorkItemId
            if let runId = await model.startJiraTicketWork(workItemId: itemId) {
                selectedJiraRunId = runId
                if let run = model.snapshot.runs.first(where: { $0.id == runId }) {
                    selectedWorkItemId = run.workItemId
                    selectedWorkspaceId = run.workspaceId
                }
            }
        }
    }

    private func copySelectedJiraBrief() {
        guard let item = selectedJiraItem else {
            model.statusLine = "Select a Jira ticket first"
            return
        }
        let workspace = model.snapshot.workspaces.first { $0.id == item.workspaceId }
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(jiraTicketAgentBrief(for: item, workspace: workspace), forType: .string)
        model.statusLine = "\(item.jira?.key ?? "Jira ticket") brief copied"
    }

    private func copySelectedJiraUpdate() {
        guard let item = selectedJiraItem else {
            model.statusLine = "Select a Jira ticket first"
            return
        }
        let workspace = model.snapshot.workspaces.first { $0.id == item.workspaceId }
        copyTextToPasteboard(jiraTicketUpdateDraft(for: item, snapshot: model.snapshot, workspace: workspace).comment)
        model.statusLine = "\(item.jira?.key ?? "Jira ticket") update copied"
    }

    private func openSelectedJiraTicket() {
        guard let url = selectedJiraItem?.jira?.url.flatMap(URL.init(string:)) else {
            model.statusLine = "Selected Jira ticket has no URL"
            return
        }
        NSWorkspace.shared.open(url)
        model.statusLine = "Opened Jira ticket"
    }

    private func openRunInChat(_ run: AgentRun) {
        selectedWorkItemId = run.workItemId
        selectedWorkspaceId = run.workspaceId
        selectedJiraRunId = run.id
        model.activeRunId = run.id
        model.draftPrompt = ""
        Task { await model.markChatRead(runId: run.id) }
        navigate(.chat)
    }

    private func copyOutputSummary(_ artifact: Artifact) {
        let run = artifactSourceRun(artifact, snapshot: snapshot)
        let item = artifactWorkItem(artifact, snapshot: snapshot)
        copyTextToPasteboard(artifactClipboardSummary(
            artifact: artifact,
            run: run,
            workItem: item
        ))
        model.statusLine = "\(artifact.title) copied"
    }

    private func stageOutputFollowUp(_ artifact: Artifact) {
        let run = artifactSourceRun(artifact, snapshot: snapshot)
        let item = artifactWorkItem(artifact, snapshot: snapshot) ?? selectedJiraItem
        selectedWorkspaceId = artifact.workspaceId
        selectedWorkItemId = item?.id ?? artifact.workItemId
        if let run {
            selectedJiraRunId = run.id
        }
        _ = model.stageAssistantPrompt(
            title: item?.sourceType == .jira ? "Jira output follow-up" : "Output follow-up",
            prompt: artifactFollowUpPrompt(artifact: artifact, run: run, workItem: item),
            agentKind: .codex,
            workspaceId: artifact.workspaceId,
            workItemId: item?.id ?? artifact.workItemId
        )
        navigate(.chat)
    }

    private func saveOutputKnowledge(_ artifact: Artifact) {
        Task { await model.saveArtifactKnowledgeNote(artifactId: artifact.id) }
    }
}

private struct JiraTicketSidebar: View {
    let items: [WorkItem]
    let totalCount: Int
    @Binding var query: String
    @Binding var selectedWorkItemId: EntityID?
    @Binding var selectedWorkspaceId: EntityID?
    let syncSummary: String
    let isSyncing: Bool
    let sync: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 10) {
                VStack(alignment: .leading, spacing: 4) {
                    HStack(spacing: 8) {
                        Text("Jira")
                            .font(.system(size: 22, weight: .semibold))
                            .foregroundStyle(PKTheme.text)
                        CountBadge(value: totalCount)
                    }
                    Text(syncSummary)
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(PKTheme.text3)
                        .lineLimit(1)
                }
                Spacer()
                Button(action: sync) {
                    Image(systemName: isSyncing ? "arrow.triangle.2.circlepath" : "arrow.clockwise")
                        .font(.system(size: 13, weight: .semibold))
                        .frame(width: 34, height: 32)
                }
                .buttonStyle(.plain)
                .foregroundStyle(PKTheme.text2)
                .background(PKTheme.control.opacity(0.78))
                .overlay(RoundedRectangle(cornerRadius: 8).stroke(PKTheme.edge, lineWidth: 1))
                .clipShape(RoundedRectangle(cornerRadius: 8))
                .disabled(isSyncing)
                .help("Sync current sprint")
            }

            HStack(spacing: 8) {
                Image(systemName: "magnifyingglass")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(PKTheme.text4)
                TextField("Filter tickets", text: $query)
                    .textFieldStyle(.plain)
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(PKTheme.text)
            }
            .padding(.horizontal, 11)
            .frame(height: 34)
            .background(PKTheme.control.opacity(0.54))
            .overlay(RoundedRectangle(cornerRadius: 8).stroke(PKTheme.edge, lineWidth: 1))
            .clipShape(RoundedRectangle(cornerRadius: 8))

            ScrollView {
                LazyVStack(spacing: 9) {
                    ForEach(items) { item in
                        JiraWorkspaceTicketRow(
                            item: item,
                            selected: selectedWorkItemId == item.id
                        ) {
                            selectedWorkItemId = item.id
                            selectedWorkspaceId = item.workspaceId
                        }
                    }

                    if items.isEmpty {
                        EmptyMiniState(
                            title: totalCount == 0 ? "No Jira tickets" : "No matching tickets",
                            subtitle: totalCount == 0 ? "Sync the current sprint to fill this list." : "Try a key, assignee, sprint, or status."
                        )
                    }
                }
            }
        }
        .padding(16)
        .frame(maxHeight: .infinity, alignment: .top)
        .background(PKTheme.panel.opacity(0.72))
        .overlay(RoundedRectangle(cornerRadius: 8).stroke(PKTheme.edge, lineWidth: 1))
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }
}

private struct JiraWorkspaceTicketRow: View {
    let item: WorkItem
    let selected: Bool
    let action: () -> Void

    private var tint: Color {
        switch item.state {
        case .active, .done: return PKTheme.ok
        case .blocked, .review: return PKTheme.warn
        case .cancelled, .archived: return PKTheme.text4
        default: return PKTheme.primary
        }
    }

    var body: some View {
        Button(action: action) {
            HStack(alignment: .top, spacing: 12) {
                RoundedRectangle(cornerRadius: 3)
                    .fill(tint)
                    .frame(width: 4)

                VStack(alignment: .leading, spacing: 8) {
                    HStack(spacing: 8) {
                        Text(item.jira?.key ?? "Jira")
                            .font(.system(size: 11, weight: .bold))
                            .foregroundStyle(tint)
                            .lineLimit(1)
                        StatusPill(text: item.jira?.status ?? item.state.rawValue, color: tint)
                        Spacer(minLength: 0)
                    }

                    Text(item.title)
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(PKTheme.text)
                        .lineLimit(2)
                        .fixedSize(horizontal: false, vertical: true)

                    HStack(spacing: 10) {
                        if let assignee = item.jira?.assignee, !assignee.isEmpty {
                            Label(assignee, systemImage: "person")
                        }
                        if let sprint = item.jira?.sprint, !sprint.isEmpty {
                            Label(sprint, systemImage: "figure.run")
                        }
                        if let priority = item.jira?.priority, !priority.isEmpty {
                            Label(priority, systemImage: "flag")
                        }
                    }
                    .font(.system(size: 10, weight: .medium))
                    .foregroundStyle(PKTheme.text3)
                    .lineLimit(1)
                }
            }
            .padding(11)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(selected ? PKTheme.primary.opacity(0.13) : PKTheme.surfaceRaised.opacity(0.54))
            .overlay(RoundedRectangle(cornerRadius: 8).stroke(selected ? PKTheme.primary.opacity(0.50) : PKTheme.edge, lineWidth: 1))
            .clipShape(RoundedRectangle(cornerRadius: 8))
        }
        .buttonStyle(.plain)
    }
}

private struct JiraTicketChatWorkbench: View {
    let item: WorkItem?
    let snapshot: NativeStoreSnapshot
    @Binding var selectedRunId: EntityID?
    let isRunning: Bool
    let isSyncing: Bool
    let sync: () -> Void
    let start: () -> Void
    let copyBrief: () -> Void
    let copyUpdate: () -> Void
    let openJira: () -> Void
    let openChat: () -> Void
    let openRunInChat: (AgentRun) -> Void
    let copyOutput: (Artifact) -> Void
    let stageOutput: (Artifact) -> Void
    let saveKnowledge: (Artifact) -> Void

    private var runs: [AgentRun] {
        guard let item else { return [] }
        return snapshot.runs
            .filter { $0.workItemId == item.id }
            .sorted { ($0.startedAt ?? .distantPast) > ($1.startedAt ?? .distantPast) }
    }

    private var selectedRun: AgentRun? {
        if let selectedRunId,
           let run = runs.first(where: { $0.id == selectedRunId }) {
            return run
        }
        return runs.first
    }

    private var artifacts: [Artifact] {
        guard let item else { return [] }
        return snapshot.artifacts.filter { $0.workItemId == item.id }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            if let item {
                header(item)

                HStack(alignment: .top, spacing: 12) {
                    VStack(alignment: .leading, spacing: 12) {
                        ticketBrief(item)
                        chatList
                    }
                    .frame(width: 280)

                    JiraRunConversationPane(
                        run: selectedRun,
                        item: item,
                        snapshot: snapshot,
                        artifacts: artifacts,
                        openRunInChat: openRunInChat,
                        copyOutput: copyOutput,
                        stageOutput: stageOutput,
                        saveKnowledge: saveKnowledge
                    )
                        .frame(maxWidth: .infinity, minHeight: 480, alignment: .topLeading)
                }
            } else {
                EmptyMiniState(title: "No Jira ticket selected", subtitle: "Sync the current sprint, then choose a ticket from the list.")
            }

            Spacer(minLength: 0)
        }
        .padding(18)
        .frame(maxWidth: .infinity, minHeight: 620, alignment: .topLeading)
        .background(PKTheme.panel.opacity(0.72))
        .overlay(RoundedRectangle(cornerRadius: 8).stroke(PKTheme.edge, lineWidth: 1))
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }

    private func header(_ item: WorkItem) -> some View {
        HStack(alignment: .top, spacing: 12) {
            VStack(alignment: .leading, spacing: 8) {
                HStack(spacing: 8) {
                    Text(item.jira?.key ?? "Jira")
                        .font(.system(size: 12, weight: .bold))
                        .foregroundStyle(PKTheme.primary)
                    StatusPill(text: item.jira?.status ?? item.state.rawValue, color: statusColor(item.state))
                    if let issueType = item.jira?.issueType, !issueType.isEmpty {
                        CountBadge(text: issueType)
                    }
                }

                Text(item.title)
                    .font(.system(size: 24, weight: .semibold))
                    .foregroundStyle(PKTheme.text)
                    .lineLimit(3)
                    .fixedSize(horizontal: false, vertical: true)

                HStack(spacing: 12) {
                    if let assignee = item.jira?.assignee, !assignee.isEmpty {
                        Label(assignee, systemImage: "person")
                    }
                    if let sprint = item.jira?.sprint, !sprint.isEmpty {
                        Label(sprint, systemImage: "figure.run")
                    }
                    if let updated = item.jira?.remoteUpdatedAt, !updated.isEmpty {
                        Label(updated, systemImage: "clock")
                    }
                }
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(PKTheme.text3)
                .lineLimit(1)

                JiraTicketContextStrip(
                    item: item,
                    chatCount: runs.count,
                    evidenceSummary: jiraTicketEvidenceSummary(artifacts: artifacts)
                )
            }

            Spacer()

            HStack(spacing: 8) {
                SecondaryButton(title: "Sync", systemImage: "arrow.clockwise", action: sync)
                    .disabled(isSyncing)
                SecondaryButton(title: "Copy Brief", systemImage: "doc.on.doc", action: copyBrief)
                SecondaryButton(title: "Copy Update", systemImage: "text.bubble", action: copyUpdate)
                if item.jira?.url?.isEmpty == false {
                    SecondaryButton(title: "Open Jira", systemImage: "arrow.up.right.square", action: openJira)
                }
                SecondaryButton(title: "Open Chat", systemImage: "text.bubble", action: openChat)
                PrimaryButton(title: isRunning ? "Running" : "Start", systemImage: "play.fill", action: start)
                    .disabled(isRunning)
            }
            .fixedSize(horizontal: true, vertical: false)
        }
    }

    private func ticketBrief(_ item: WorkItem) -> some View {
        VStack(alignment: .leading, spacing: 11) {
            Text("Ticket")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(PKTheme.text2)
            Text(item.description.isEmpty ? "No Jira description synced yet." : item.description)
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(PKTheme.text3)
                .lineLimit(8)
                .fixedSize(horizontal: false, vertical: true)

            if !item.acceptanceCriteria.isEmpty {
                VStack(alignment: .leading, spacing: 6) {
                    Text("Acceptance")
                        .font(.system(size: 11, weight: .bold))
                        .foregroundStyle(PKTheme.text3)
                    ForEach(Array(item.acceptanceCriteria.prefix(3)), id: \.self) { criterion in
                        HStack(alignment: .top, spacing: 7) {
                            Image(systemName: "checkmark.circle")
                                .font(.system(size: 10, weight: .semibold))
                                .foregroundStyle(PKTheme.ok)
                                .padding(.top, 2)
                            Text(criterion)
                                .font(.caption)
                                .foregroundStyle(PKTheme.text3)
                                .lineLimit(2)
                        }
                    }
                }
            }

            JiraTicketRefsView(title: "Source refs", refs: item.sourceRefs)
            JiraTicketRefsView(title: "External refs", refs: item.externalRefs)
        }
        .padding(12)
        .background(PKTheme.control.opacity(0.38))
        .overlay(RoundedRectangle(cornerRadius: 8).stroke(PKTheme.edge, lineWidth: 1))
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }

    private var chatList: some View {
        VStack(alignment: .leading, spacing: 9) {
            HStack {
                Text("Chats")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(PKTheme.text2)
                Spacer()
                CountBadge(value: runs.count)
            }

            ForEach(runs) { run in
                Button {
                    selectedRunId = run.id
                } label: {
                    VStack(alignment: .leading, spacing: 6) {
                        HStack {
                            StatusPill(text: run.state.rawValue, color: run.state == .failed ? PKTheme.err : PKTheme.primary)
                            Spacer()
                            Text((run.startedAt ?? Date()).formatted(date: .omitted, time: .shortened))
                                .font(.system(size: 10, weight: .medium))
                                .foregroundStyle(PKTheme.text4)
                        }
                        Text(run.promptSnapshot.firstLineFallback("Ticket chat"))
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundStyle(PKTheme.text)
                            .lineLimit(2)
                    }
                    .padding(10)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(selectedRun?.id == run.id ? PKTheme.selected : PKTheme.surfaceRaised.opacity(0.42))
                    .overlay(RoundedRectangle(cornerRadius: 8).stroke(selectedRun?.id == run.id ? PKTheme.edgeStrong : PKTheme.edge, lineWidth: 1))
                    .clipShape(RoundedRectangle(cornerRadius: 8))
                }
                .buttonStyle(.plain)
            }

            if runs.isEmpty {
                EmptyMiniState(title: "No chats yet", subtitle: "Start this ticket to create the first working chat.")
            }
        }
    }
}

private struct JiraTicketContextStrip: View {
    let item: WorkItem
    let chatCount: Int
    let evidenceSummary: JiraTicketEvidenceSummary

    var body: some View {
        HStack(spacing: 8) {
            JiraTicketMetricChip(symbol: "flag", label: "Priority", value: item.jira?.priority ?? "P\(item.priority)")
            JiraTicketMetricChip(symbol: "person", label: "Owner", value: item.jira?.assignee ?? "Unassigned")
            JiraTicketMetricChip(symbol: "figure.run", label: "Sprint", value: item.jira?.sprint ?? "No sprint")
            JiraTicketMetricChip(symbol: "checkmark.seal", label: "Checks", value: "\(item.acceptanceCriteria.count)")
            JiraTicketMetricChip(symbol: "text.bubble", label: "Chats", value: "\(chatCount)")
            JiraTicketMetricChip(symbol: "shippingbox", label: "Outputs", value: "\(evidenceSummary.outputCount)")
            if evidenceSummary.actionSignalCount > 0 {
                JiraTicketMetricChip(
                    symbol: "exclamationmark.triangle",
                    label: "Actions",
                    value: evidenceSummary.actionSignalsLabel,
                    helpText: evidenceSummary.actionSignalsHelp
                )
            }
            if !evidenceSummary.validationSignals.isEmpty {
                JiraTicketMetricChip(
                    symbol: "checkmark.circle",
                    label: "Validation",
                    value: evidenceSummary.validationSignalsLabel,
                    helpText: evidenceSummary.validationSignalsHelp
                )
            }
            if evidenceSummary.artifactRefCount > 0 {
                JiraTicketMetricChip(symbol: "link", label: "Refs", value: evidenceSummary.artifactRefsLabel)
            }
            if !evidenceSummary.pendingCommands.isEmpty {
                JiraTicketMetricChip(
                    symbol: "terminal",
                    label: "Next",
                    value: evidenceSummary.pendingCommandsLabel,
                    helpText: evidenceSummary.pendingCommandsHelp
                )
            }
        }
    }
}

private struct JiraTicketMetricChip: View {
    let symbol: String
    let label: String
    let value: String
    var helpText: String?

    var body: some View {
        HStack(spacing: 6) {
            Image(systemName: symbol)
                .font(.system(size: 10, weight: .semibold))
                .foregroundStyle(PKTheme.primary)
            VStack(alignment: .leading, spacing: 1) {
                Text(label.uppercased())
                    .font(.system(size: 8.5, weight: .semibold))
                    .foregroundStyle(PKTheme.text4)
                Text(value.isEmpty ? "None" : value)
                    .font(.system(size: 10.5, weight: .semibold))
                    .foregroundStyle(PKTheme.text2)
                    .lineLimit(1)
            }
        }
        .padding(.horizontal, 8)
        .frame(height: 34)
        .background(PKTheme.control.opacity(0.46))
        .overlay(RoundedRectangle(cornerRadius: 7).stroke(PKTheme.edge.opacity(0.82), lineWidth: 1))
        .clipShape(RoundedRectangle(cornerRadius: 7))
        .help(helpText ?? "\(label): \(value.isEmpty ? "None" : value)")
    }
}

private struct JiraTicketRefsView: View {
    let title: String
    let refs: [SourceRef]

    var body: some View {
        if !refs.isEmpty {
            VStack(alignment: .leading, spacing: 6) {
                Text(title)
                    .font(.system(size: 11, weight: .bold))
                    .foregroundStyle(PKTheme.text3)
                ForEach(Array(refs.prefix(3).enumerated()), id: \.offset) { _, ref in
                    HStack(spacing: 7) {
                        Image(systemName: ref.kind == "mr" ? "arrow.triangle.pull" : "link")
                            .font(.system(size: 10, weight: .semibold))
                            .foregroundStyle(PKTheme.primary)
                        Text(jiraRefLabel(ref))
                            .font(.caption)
                            .foregroundStyle(PKTheme.text3)
                            .lineLimit(1)
                    }
                }
            }
        }
    }
}

private struct JiraRunConversationPane: View {
    let run: AgentRun?
    let item: WorkItem
    let snapshot: NativeStoreSnapshot
    let artifacts: [Artifact]
    let openRunInChat: (AgentRun) -> Void
    let copyOutput: (Artifact) -> Void
    let stageOutput: (Artifact) -> Void
    let saveKnowledge: (Artifact) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text(run?.promptSnapshot.firstLineFallback("Ticket Chat") ?? "Ticket Chat")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(PKTheme.text)
                    .lineLimit(1)
                Spacer()
                if let run {
                    StatusPill(text: run.state.rawValue, color: run.state == .failed ? PKTheme.err : PKTheme.ok)
                }
            }

            JiraRunEvidenceSummary(run: run, artifactCount: artifacts.count)

            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    if let run {
                        ForEach(run.messages) { message in
                            JiraChatMessageRow(message: message)
                        }

                        JiraPromptBubble(title: "Prompt", text: run.promptSnapshot)

                        if !run.transcript.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                            JiraPromptBubble(title: "Output", text: run.transcript)
                        }
                    } else {
                        JiraPromptBubble(title: "Ready", text: item.description.isEmpty ? item.title : item.description)
                    }

                    if !artifacts.isEmpty {
                        VStack(alignment: .leading, spacing: 8) {
                            Text("Outputs")
                                .font(.system(size: 13, weight: .semibold))
                                .foregroundStyle(PKTheme.text2)
                            ForEach(artifacts) { artifact in
                                let sourceRun = artifactSourceRun(artifact, snapshot: snapshot)
                                ArtifactOutputRow(
                                    artifact: artifact,
                                    sourceRun: sourceRun,
                                    workItem: item,
                                    openRun: sourceRun.map { run in
                                        { openRunInChat(run) }
                                    },
                                    copySummary: {
                                        copyOutput(artifact)
                                    },
                                    stageFollowUp: {
                                        stageOutput(artifact)
                                    },
                                    saveKnowledge: {
                                        saveKnowledge(artifact)
                                    }
                                )
                            }
                        }
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .padding(14)
        .background(PKTheme.control.opacity(0.28))
        .overlay(RoundedRectangle(cornerRadius: 8).stroke(PKTheme.edge, lineWidth: 1))
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }
}

private struct JiraRunEvidenceSummary: View {
    let run: AgentRun?
    let artifactCount: Int

    private var messageCount: Int {
        run?.messages.count ?? 0
    }

    private var outputState: String {
        guard let run else { return "Ready" }
        return run.transcript.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? "No output" : "Output captured"
    }

    var body: some View {
        HStack(spacing: 8) {
            MetricBox(label: "MESSAGES", value: "\(messageCount)")
            MetricBox(label: "OUTPUT", value: outputState)
            MetricBox(label: "ARTIFACTS", value: "\(artifactCount)")
        }
    }
}

private struct JiraChatMessageRow: View {
    let message: AgentRunMessage

    private var title: String {
        switch message.role {
        case .user: return "You"
        case .assistant: return "Agent"
        case .system: return "System"
        case .tool: return "Tool"
        }
    }

    var body: some View {
        JiraPromptBubble(title: title, text: message.content)
    }
}

private struct JiraPromptBubble: View {
    let title: String
    let text: String

    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            Text(title)
                .font(.system(size: 11, weight: .bold))
                .foregroundStyle(PKTheme.primary)
            Text(text.isEmpty ? "No content yet." : text)
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(PKTheme.text2)
                .lineLimit(12)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(11)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(PKTheme.surfaceRaised.opacity(0.48))
        .overlay(RoundedRectangle(cornerRadius: 8).stroke(PKTheme.edge, lineWidth: 1))
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }
}

private struct WorkItemsRail: View {
    let title: String
    let subtitle: String
    let items: [WorkItem]
    @Binding var selectedWorkItemId: EntityID?

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                VStack(alignment: .leading, spacing: 3) {
                    Text(title)
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(PKTheme.text)
                    Text(subtitle)
                        .font(.caption)
                        .foregroundStyle(PKTheme.text3)
                        .lineLimit(1)
                }
                Spacer()
                CountBadge(value: items.count)
            }

            ForEach(items.isEmpty ? [] : items) { item in
                WorkItemCompactRow(
                    item: item,
                    selected: selectedWorkItemId == item.id
                ) {
                    selectedWorkItemId = item.id
                }
            }

            if items.isEmpty {
                EmptyMiniState(title: "No items", subtitle: "Capture from chat or promote intake.")
            }
        }
        .padding(14)
        .background(PKTheme.panel.opacity(0.66))
        .overlay(RoundedRectangle(cornerRadius: 8).stroke(PKTheme.edge, lineWidth: 1))
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }
}

private struct WorkItemCompactRow: View {
    let item: WorkItem
    let selected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(alignment: .leading, spacing: 7) {
                HStack {
                    Text(item.title)
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(PKTheme.text)
                        .lineLimit(2)
                    Spacer()
                    StatusPill(text: item.state.rawValue, color: statusColor(item.state))
                }
                Text(item.description.isEmpty ? "No description captured yet." : item.description)
                    .font(.caption)
                    .foregroundStyle(PKTheme.text3)
                    .lineLimit(2)
                HStack(spacing: 8) {
                    Label(sourceLabel(item.sourceType), systemImage: "tray")
                    Label("P\(item.priority)", systemImage: "flag")
                }
                .font(.caption2)
                .foregroundStyle(PKTheme.text3)
            }
            .padding(11)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(selected ? PKTheme.selected : PKTheme.panelAlt.opacity(0.46))
            .overlay(RoundedRectangle(cornerRadius: 8).stroke(selected ? PKTheme.edgeStrong : PKTheme.edge, lineWidth: 1))
            .clipShape(RoundedRectangle(cornerRadius: 8))
        }
        .buttonStyle(.plain)
    }
}

private struct WorkbenchDetail: View {
    let item: WorkItem?
    let snapshot: NativeStoreSnapshot
    @Binding var detailTab: DetailTab
    let run: () -> Void
    let openChat: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            VStack(alignment: .leading, spacing: 12) {
                Text(item?.title ?? "Select a Work Item")
                    .font(.system(size: 21, weight: .semibold))
                    .foregroundStyle(PKTheme.text)
                    .lineLimit(3)
                    .fixedSize(horizontal: false, vertical: true)
                Text(item?.description ?? "Work items keep source evidence, sessions, stage runs, outputs, and verification together.")
                    .font(.system(size: 13))
                    .foregroundStyle(PKTheme.text3)
                    .lineLimit(3)
                HStack {
                    Spacer()
                    SecondaryButton(title: "Chat", systemImage: "text.bubble", action: openChat)
                    PrimaryButton(title: "Run", systemImage: "play.fill", action: run)
                }
            }

            HStack(spacing: 8) {
                ForEach(DetailTab.allCases) { tab in
                    Button {
                        detailTab = tab
                    } label: {
                        Text(tab.title)
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundStyle(detailTab == tab ? PKTheme.primaryText : PKTheme.text3)
                            .lineLimit(1)
                            .minimumScaleFactor(0.8)
                            .frame(width: 70, height: 30)
                            .background(detailTab == tab ? PKTheme.primary : PKTheme.control)
                            .clipShape(RoundedRectangle(cornerRadius: 6))
                    }
                    .buttonStyle(.plain)
                }
                Spacer()
            }

            switch detailTab {
            case .activity:
                ActivityTimeline(item: item, snapshot: snapshot)
            case .sources:
                SourcesPanel(item: item)
            case .outputs:
                OutputsPanel(item: item, snapshot: snapshot)
            }

            Spacer(minLength: 0)
        }
        .padding(18)
        .frame(maxWidth: .infinity, minHeight: 560, alignment: .topLeading)
        .background(PKTheme.panel.opacity(0.72))
        .overlay(RoundedRectangle(cornerRadius: 8).stroke(PKTheme.edge, lineWidth: 1))
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }
}

private struct ActivityTimeline: View {
    let item: WorkItem?
    let snapshot: NativeStoreSnapshot

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            TimelineRow(title: "Captured", subtitle: item?.createdAt.formatted() ?? "Waiting for selection", tone: PKTheme.primary)
            TimelineRow(title: "Source reviewed", subtitle: item?.sourceRefs.first?.label ?? "Attach source evidence from Todo, Jira, note, or chat.", tone: PKTheme.warn)
            ForEach(snapshot.runs.filter { $0.workItemId == item?.id }.prefix(4)) { run in
                TimelineRow(title: run.state.rawValue, subtitle: run.promptSnapshot, tone: run.state == .failed ? PKTheme.err : PKTheme.ok)
            }
            if snapshot.runs.filter({ $0.workItemId == item?.id }).isEmpty {
                TimelineRow(title: "No stage run yet", subtitle: "Run a stage or open chat to create an execution trail.", tone: PKTheme.text3)
            }
        }
    }
}

private struct SourcesPanel: View {
    let item: WorkItem?

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            ForEach(item?.sourceRefs ?? [], id: \.self) { ref in
                InspectorRow(symbol: "link", title: ref.label, subtitle: ref.kind)
            }
            ForEach(item?.externalRefs ?? [], id: \.self) { ref in
                InspectorRow(symbol: "arrow.up.right.square", title: ref.label, subtitle: ref.kind)
            }
            if (item?.sourceRefs.isEmpty ?? true) && (item?.externalRefs.isEmpty ?? true) {
                EmptyMiniState(title: "No source evidence", subtitle: "Attach Jira, note, file, or chat evidence before review.")
            }
        }
    }
}

private struct OutputsPanel: View {
    let item: WorkItem?
    let snapshot: NativeStoreSnapshot
    var openRun: ((AgentRun) -> Void)? = nil
    var copyOutput: ((Artifact) -> Void)? = nil
    var stageOutput: ((Artifact) -> Void)? = nil
    var saveKnowledge: ((Artifact) -> Void)? = nil

    private var outputs: [Artifact] {
        workItemOutputs(for: item, snapshot: snapshot)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            if !outputs.isEmpty {
                OutputPanelSummary(outputs: outputs)
            }

            ForEach(outputs) { artifact in
                let sourceRun = artifactSourceRun(artifact, snapshot: snapshot)
                ArtifactOutputRow(
                    artifact: artifact,
                    sourceRun: sourceRun,
                    workItem: item,
                    openRun: sourceRun.flatMap { run in
                        openRun.map { open in
                            { open(run) }
                        }
                    },
                    copySummary: {
                        if let copyOutput {
                            copyOutput(artifact)
                        } else {
                            copyTextToPasteboard(artifactClipboardSummary(
                                artifact: artifact,
                                run: sourceRun,
                                workItem: item
                            ))
                        }
                    },
                    stageFollowUp: stageOutput.map { stage in
                        { stage(artifact) }
                    },
                    saveKnowledge: saveKnowledge.map { save in
                        { save(artifact) }
                    }
                )
            }
            if outputs.isEmpty {
                EmptyMiniState(title: "No outputs yet", subtitle: "Verification notes, patches, and Obsidian artifacts appear here.")
            }
        }
    }
}

private struct OutputPanelSummary: View {
    let outputs: [Artifact]

    private var readyCount: Int {
        outputs.filter { $0.status == .ready || $0.status == .verified }.count
    }

    private var failedCount: Int {
        outputs.filter { $0.status == .failed }.count
    }

    private var sourceRefCount: Int {
        outputs.reduce(0) { $0 + $1.sourceRefs.count }
    }

    var body: some View {
        HStack(spacing: 8) {
            MetricBox(label: "OUTPUTS", value: "\(outputs.count)")
            MetricBox(label: "READY", value: "\(readyCount)")
            MetricBox(label: "FAILED", value: "\(failedCount)")
            MetricBox(label: "REFS", value: "\(sourceRefCount)")
        }
    }
}

private struct ArtifactOutputRow: View {
    let artifact: Artifact
    let sourceRun: AgentRun?
    let workItem: WorkItem?
    let openRun: (() -> Void)?
    let copySummary: () -> Void
    let stageFollowUp: (() -> Void)?
    let saveKnowledge: (() -> Void)?

    @State private var copied = false

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: artifactOutputSymbol(artifact.kind))
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(artifactStatusColor(artifact.status))
                .frame(width: 28, height: 28)
                .background(artifactStatusColor(artifact.status).opacity(0.12))
                .clipShape(RoundedRectangle(cornerRadius: 6))

            VStack(alignment: .leading, spacing: 5) {
                Text(artifact.title)
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(PKTheme.text)
                    .lineLimit(2)
                    .fixedSize(horizontal: false, vertical: true)

                HStack(spacing: 6) {
                    StatusPill(text: artifactKindLabel(artifact.kind), color: artifactStatusColor(artifact.status))
                    StatusPill(text: artifact.status.rawValue, color: artifactStatusColor(artifact.status))
                    if let sourceRun {
                        StatusPill(text: sourceRun.state.rawValue, color: runStateColor(sourceRun.state))
                    }
                    if !artifact.sourceRefs.isEmpty {
                        StatusPill(text: "\(artifact.sourceRefs.count) refs", color: PKTheme.primary)
                    }
                }

                HStack(spacing: 8) {
                    Label(artifactCreatedLabel(artifact), systemImage: "clock")
                    Label(artifactURIKind(artifact), systemImage: "link")
                    if let sourceRun {
                        Label(artifactSourceLabel(sourceRun, workItem: workItem), systemImage: "text.bubble")
                    }
                }
                .font(.caption2)
                .foregroundStyle(PKTheme.text3)
                .lineLimit(1)

                if !artifact.provenance.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    HStack(alignment: .top, spacing: 6) {
                        Text("Evidence")
                            .font(.system(size: 8, weight: .heavy))
                            .foregroundStyle(PKTheme.primary)
                            .padding(.horizontal, 6)
                            .frame(height: 18)
                            .background(PKTheme.primary.opacity(0.10))
                            .clipShape(RoundedRectangle(cornerRadius: 5))
                        Text(artifact.provenance.firstLineFallback("Evidence captured"))
                            .font(.caption2)
                            .foregroundStyle(PKTheme.text4)
                            .lineLimit(2)
                    }
                }
            }

            Spacer(minLength: 0)

            HStack(spacing: 5) {
                if let stageFollowUp {
                    MessageActionButton(
                        systemImage: "arrow.turn.down.right",
                        help: "Stage follow-up",
                        action: stageFollowUp
                    )
                }
                if let saveKnowledge {
                    MessageActionButton(
                        systemImage: "brain",
                        help: "Save knowledge note",
                        action: saveKnowledge
                    )
                }
                if let openRun {
                    MessageActionButton(
                        systemImage: "text.bubble",
                        help: "Open source chat",
                        action: openRun
                    )
                }
                MessageActionButton(
                    systemImage: copied ? "checkmark" : "doc.on.doc",
                    help: copied ? "Copied" : "Copy evidence summary",
                    action: {
                        copySummary()
                        copied = true
                        Task { @MainActor in
                            try? await Task.sleep(nanoseconds: 1_300_000_000)
                            copied = false
                        }
                    }
                )
            }
        }
        .padding(9)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(PKTheme.surfaceRaised.opacity(0.42))
        .overlay(RoundedRectangle(cornerRadius: 8).stroke(PKTheme.edge, lineWidth: 1))
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }
}

private struct WorkItemInspector: View {
    let item: WorkItem?
    let snapshot: NativeStoreSnapshot

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            InspectorSection(title: "Source Health") {
                InspectorMetric(label: "Evidence", value: "\(item?.sourceRefs.count ?? 0) refs")
                InspectorMetric(label: "External", value: "\(item?.externalRefs.count ?? 0) links")
                InspectorMetric(label: "Acceptance", value: "\(item?.acceptanceCriteria.count ?? 0) checks")
                InspectorMetric(label: "Outputs", value: "\(workItemOutputs(for: item, snapshot: snapshot).count) saved")
            }
            InspectorSection(title: "Stage Runs") {
                let runs = snapshot.runs.filter { $0.workItemId == item?.id }
                ForEach(runs.prefix(4)) { run in
                    InspectorRow(symbol: "terminal", title: run.state.rawValue, subtitle: run.promptSnapshot)
                }
                if runs.isEmpty {
                    EmptyMiniState(title: "No runs", subtitle: "No native runner output yet.")
                }
            }
            InspectorSection(title: "Verification") {
                ForEach(item?.acceptanceCriteria ?? [], id: \.self) { criterion in
                    Label(criterion, systemImage: "checkmark.circle")
                        .font(.caption)
                        .foregroundStyle(PKTheme.text2)
                }
                if item?.acceptanceCriteria.isEmpty ?? true {
                    Text("Add concrete success criteria before shipping.")
                        .font(.caption)
                        .foregroundStyle(PKTheme.text3)
                }
            }
        }
    }
}

private struct WorkPlanPage: View {
    let snapshot: NativeStoreSnapshot
    let promote: () -> Void

    var body: some View {
        PageFrame(route: .workPlan) {
            HStack(alignment: .top, spacing: 12) {
                PlanColumn(title: "Today", subtitle: "Open daily items", rows: [
                    ("Review native parity gaps", "Promote to Work Item"),
                    ("Check active branches", "Attach repo evidence"),
                    ("Summarize pending runs", "Send to Mission Control"),
                ], action: promote)
                PlanColumn(title: "Inbox", subtitle: "Manual captures", rows: snapshot.workItems.prefix(4).map { ($0.title, sourceLabel($0.sourceType)) }, action: promote)
                PlanColumn(title: "Ready", subtitle: "Can become work", rows: [
                    ("Project context cleanup", "Pikiclaw Pro"),
                    ("Workflow audit recipe", "Engineering"),
                    ("Memory source review", "Knowledge"),
                ], action: promote)
            }
        } actions: {
            PrimaryButton(title: "Promote", systemImage: "arrow.up.forward", action: promote)
        }
    }
}

private struct PlanColumn: View {
    let title: String
    let subtitle: String
    let rows: [(String, String)]
    let action: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                VStack(alignment: .leading, spacing: 3) {
                    Text(title)
                        .font(.system(size: 17, weight: .semibold))
                        .foregroundStyle(PKTheme.text)
                    Text(subtitle)
                        .font(.caption)
                        .foregroundStyle(PKTheme.text3)
                }
                Spacer()
                CountBadge(value: rows.count)
            }
            ForEach(Array(rows.enumerated()), id: \.offset) { _, row in
                Button(action: action) {
                    HStack {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(row.0)
                                .font(.system(size: 13, weight: .semibold))
                                .foregroundStyle(PKTheme.text)
                            Text(row.1)
                                .font(.caption)
                                .foregroundStyle(PKTheme.text3)
                        }
                        Spacer()
                        Image(systemName: "arrow.right")
                            .foregroundStyle(PKTheme.text3)
                    }
                    .padding(12)
                    .background(PKTheme.panelAlt.opacity(0.56))
                    .overlay(RoundedRectangle(cornerRadius: 8).stroke(PKTheme.edge, lineWidth: 1))
                    .clipShape(RoundedRectangle(cornerRadius: 8))
                }
                .buttonStyle(.plain)
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .topLeading)
        .background(PKTheme.panel.opacity(0.7))
        .overlay(RoundedRectangle(cornerRadius: 8).stroke(PKTheme.edge, lineWidth: 1))
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }
}

private struct NotesPage: View {
    let snapshot: NativeStoreSnapshot

    var body: some View {
        PageFrame(route: .notes) {
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 260), spacing: 12)], spacing: 12) {
                ForEach(snapshot.artifacts) { artifact in
                    SurfaceCard(symbol: "note.text", title: artifact.title, subtitle: artifact.uri, badge: artifact.status.rawValue)
                }
                SurfaceCard(symbol: "plus", title: "Capture note", subtitle: "Turn a repo observation into source-backed work evidence.", badge: "Local")
            }
        } actions: {
            SecondaryButton(title: "Import", systemImage: "square.and.arrow.down") {}
        }
    }
}

private struct MemoryPage: View {
    let snapshot: NativeStoreSnapshot

    var body: some View {
        PageFrame(route: .memory) {
            HStack(alignment: .top, spacing: 12) {
                VStack(alignment: .leading, spacing: 12) {
                    ForEach(snapshot.knowledgeCards) { card in
                        SurfaceCard(symbol: "brain", title: card.title, subtitle: card.body, badge: card.scope.rawValue)
                    }
                }
                .frame(maxWidth: .infinity)
                InspectorSection(title: "Injection Readiness") {
                    InspectorMetric(label: "Cards", value: "\(snapshot.knowledgeCards.count)")
                    InspectorMetric(label: "Project scope", value: "\(snapshot.knowledgeCards.filter { $0.scope == .workspace }.count)")
                    InspectorMetric(label: "Source refs", value: "\(snapshot.knowledgeCards.flatMap(\.sourceRefs).count)")
                }
                .frame(width: 300)
            }
        } actions: {
            PrimaryButton(title: "Review Memory", systemImage: "checkmark.seal") {}
        }
    }
}

private struct WorkflowPage: View {
    let snapshot: NativeStoreSnapshot
    @Binding var selectedWorkspaceId: EntityID?
    @Binding var selectedWorkItemId: EntityID?
    @ObservedObject var model: NativeAppModel
    let navigate: (NativeRoute) -> Void

    private var selectedWorkspace: Workspace? {
        snapshot.workspaces.first(where: { $0.id == selectedWorkspaceId }) ?? snapshot.workspaces.first
    }

    private var selectedWorkItem: WorkItem? {
        guard let selectedWorkItemId else { return nil }
        return snapshot.workItems.first { item in
            item.id == selectedWorkItemId && selectedWorkspace.map { $0.id == item.workspaceId } != false
        }
    }

    private var categories: [(String, Int)] {
        [
            ("Featured", nativeWorkflowLaunchTemplates.count),
            ("Engineering", nativeWorkflowLaunchTemplates.filter { $0.category == "Engineering" }.count),
            ("Jira", nativeWorkflowLaunchTemplates.filter { $0.category == "Jira" }.count),
            ("Skills", nativeWorkflowLaunchTemplates.filter { $0.category == "Skills" }.count),
            ("Operations", snapshot.automations.count + nativeWorkflowLaunchTemplates.filter { $0.category == "Operations" }.count)
        ]
    }

    var body: some View {
        PageFrame(route: .workflows) {
            VStack(alignment: .leading, spacing: 16) {
                LaunchContextStrip(
                    workspace: selectedWorkspace,
                    workItem: selectedWorkItem,
                    terminalDirectory: selectedWorkspace.flatMap { model.terminalCurrentDirectory(for: $0) },
                    runningCount: snapshot.runs.filter { $0.state == .running || $0.state == .starting || $0.state == .queued }.count,
                    attentionCount: snapshot.runs.filter { $0.state == .waitingForUser || $0.state == .failed }.count
                )

                HStack(alignment: .top, spacing: 16) {
                    VStack(alignment: .leading, spacing: 12) {
                        LibrarySummary(
                            builtInCount: nativeWorkflowLaunchTemplates.count,
                            customCount: snapshot.automations.count
                        )
                        SearchPlaceholder(title: "Search workflow recipes...")
                        ForEach(Array(categories.enumerated()), id: \.offset) { index, category in
                            CategoryRow(title: category.0, count: category.1, selected: index == 0)
                        }
                    }
                    .frame(width: 220)

                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 270), spacing: 12)], spacing: 12) {
                        ForEach(nativeWorkflowLaunchTemplates) { template in
                            WorkflowCard(
                                symbol: template.symbol,
                                title: template.title,
                                description: template.summary,
                                category: template.category,
                                agent: agentShortLabel(template.agentKind),
                                steps: template.steps,
                                outputs: template.outputs,
                                effort: template.effort,
                                actionTitle: "Stage in Chat",
                                action: { launch(template) }
                            )
                        }
                        ForEach(snapshot.automations) { automation in
                            WorkflowCard(
                                symbol: "gearshape.2",
                                title: automation.name,
                                description: "Run this saved automation as a workflow-backed agent task.",
                                category: "Automation",
                                agent: "Codex",
                                steps: 3,
                                outputs: 2,
                                effort: automation.state.rawValue,
                                actionTitle: "Stage Automation",
                                action: { launchAutomation(automation) }
                            )
                        }
                        if snapshot.automations.isEmpty {
                            WorkflowEmptyState(
                                title: "No custom workflows yet",
                                subtitle: "Built-in recipes are ready. Build or import one when a repeated process deserves a shortcut."
                            )
                            .gridCellColumns(1)
                        }
                    }
                }
            }
        } actions: {
            SecondaryButton(title: "Import workflow", systemImage: "square.and.arrow.down") {
                if model.stageWorkflowImport(workspaceId: selectedWorkspaceId, workItemId: selectedWorkItemId) {
                    openChat()
                }
            }
            PrimaryButton(title: "Build workflow", systemImage: "plus") {
                if model.stageWorkflowBuilder(workspaceId: selectedWorkspaceId, workItemId: selectedWorkItemId) {
                    openChat()
                }
            }
            CountBadge(text: "\(nativeWorkflowLaunchTemplates.count + snapshot.automations.count) recipes")
        }
    }

    private func launch(_ template: NativeWorkflowLaunchTemplate) {
        if model.stageWorkflow(template, workspaceId: selectedWorkspaceId, workItemId: selectedWorkItemId) {
            openChat()
        }
    }

    private func launchAutomation(_ automation: Automation) {
        _ = model.stageAssistantPrompt(
            title: automation.name,
            prompt: """
            Run the saved automation workflow "\(automation.name)" for {project}.

            Inspect the current automation state, identify required inputs, execute the workflow as far as current permissions allow, and summarize outputs, blockers, and the next safe action.
            """,
            agentKind: .codex,
            workspaceId: selectedWorkspaceId,
            workItemId: selectedWorkItemId
        )
        openChat()
    }

    private func openChat() {
        navigate(.chat)
        NotificationCenter.default.post(name: .pikiclawFocusCommandCenter, object: nil)
    }
}

private struct MissionControlPage: View {
    let snapshot: NativeStoreSnapshot
    @Binding var selectedWorkspaceId: EntityID?
    @Binding var selectedWorkItemId: EntityID?
    @ObservedObject var model: NativeAppModel
    let navigate: (NativeRoute) -> Void
    let refresh: () -> Void

    private var activeRuns: [AgentRun] {
        snapshot.runs.filter { isLiveRunState($0.state) }
    }

    private var attentionRuns: [AgentRun] {
        snapshot.runs.filter { $0.state == .waitingForUser || $0.state == .failed }
    }

    private var failedRuns: [AgentRun] {
        snapshot.runs.filter { $0.state == .failed }
    }

    private var waitingRuns: [AgentRun] {
        snapshot.runs.filter { $0.state == .waitingForUser }
    }

    private var readyEvidenceCount: Int {
        snapshot.artifacts.filter { $0.status == .ready }.count
    }

    private var prioritizedRuns: [AgentRun] {
        snapshot.runs.sorted { lhs, rhs in
            let lhsRank = missionRunPriority(lhs)
            let rhsRank = missionRunPriority(rhs)
            if lhsRank != rhsRank { return lhsRank < rhsRank }
            return (lhs.startedAt ?? .distantPast) > (rhs.startedAt ?? .distantPast)
        }
    }

    private var healthyCapabilities: Int {
        snapshot.capabilities.filter { $0.healthState == .healthy }.count
    }

    private var checkCapabilities: Int {
        snapshot.capabilities.filter { $0.healthState == .needsConfiguration || $0.healthState == .unknown }.count
    }

    private var missingCapabilities: Int {
        snapshot.capabilities.filter { $0.healthState == .unavailable || $0.healthState == .failed }.count
    }

    private var enterpriseGoalSummary: EnterpriseGoalMissionSummary? {
        AgentEnterpriseAlignment.missionSummary(snapshot: snapshot)
    }

    var body: some View {
        PageFrame(route: .missionControl) {
            VStack(alignment: .leading, spacing: 14) {
                HStack(spacing: 12) {
                    RuntimeCard(title: "ACTIVE", value: "\(activeRuns.count)", subtitle: "Queued, running, or waiting", color: activeRuns.isEmpty ? PKTheme.text3 : PKTheme.ok)
                    RuntimeCard(title: "ATTENTION", value: "\(attentionRuns.count)", subtitle: "\(waitingRuns.count) waiting · \(failedRuns.count) failed", color: attentionRuns.isEmpty ? PKTheme.text3 : PKTheme.warn)
                    RuntimeCard(title: "EVIDENCE", value: "\(readyEvidenceCount)", subtitle: "Ready artifacts", color: readyEvidenceCount == 0 ? PKTheme.text3 : PKTheme.primary)
                    RuntimeCard(title: "HEALTH", value: "\(healthyCapabilities)/\(snapshot.capabilities.count)", subtitle: "\(checkCapabilities) check · \(missingCapabilities) missing", color: missingCapabilities > 0 ? PKTheme.err : checkCapabilities > 0 ? PKTheme.warn : PKTheme.ok)
                }

                MissionAttentionSummary(
                    activeRuns: activeRuns.count,
                    waitingRuns: waitingRuns.count,
                    failedRuns: failedRuns.count,
                    readyEvidenceCount: readyEvidenceCount
                )

                if let enterpriseGoalSummary {
                    MissionEnterpriseGoalCard(
                        summary: enterpriseGoalSummary,
                        openGoal: openEnterpriseGoal,
                        stageAudit: stageEnterpriseParityAudit
                    )
                }

                MissionAgentLoadStrip(snapshot: snapshot)

                HStack(alignment: .top, spacing: 12) {
                    InspectorSection(title: "Runtime Queue") {
                        ForEach(prioritizedRuns.prefix(8)) { run in
                            MissionRunRow(run: run, snapshot: snapshot)
                        }
                    }
                    InspectorSection(title: "Capability Health") {
                        CapabilityHealthSummary(healthy: healthyCapabilities, check: checkCapabilities, missing: missingCapabilities)
                        ForEach(snapshot.capabilities) { capability in
                            MissionCapabilityRow(capability: capability)
                        }
                    }
                }
            }
        } actions: {
            SecondaryButton(title: "Audit", systemImage: "checklist.checked", action: stageEnterpriseParityAudit)
            SecondaryButton(title: "Refresh", systemImage: "arrow.clockwise", action: refresh)
        }
    }

    private func openEnterpriseGoal() {
        guard let summary = enterpriseGoalSummary else { return }
        selectedWorkspaceId = summary.workspaceId
        selectedWorkItemId = summary.workItemId
    }

    private func stageEnterpriseParityAudit() {
        guard let summary = enterpriseGoalSummary else { return }
        selectedWorkspaceId = summary.workspaceId
        selectedWorkItemId = summary.workItemId
        if model.stageEnterpriseParityAudit(workspaceId: summary.workspaceId, workItemId: summary.workItemId) {
            navigate(.chat)
            NotificationCenter.default.post(name: .pikiclawFocusCommandCenter, object: nil)
        }
    }
}

private struct MissionEnterpriseGoalCard: View {
    let summary: EnterpriseGoalMissionSummary
    let openGoal: () -> Void
    let stageAudit: () -> Void

    private var tone: Color {
        if summary.readinessAttention > 0 || summary.capabilityAttention > 0 { return PKTheme.warn }
        return summary.readyArtifactCount > 0 ? PKTheme.ok : PKTheme.primary
    }

    var body: some View {
        HStack(alignment: .center, spacing: 12) {
            Image(systemName: "scope")
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(PKTheme.primaryText)
                .frame(width: 34, height: 34)
                .background(tone)
                .clipShape(RoundedRectangle(cornerRadius: 8))

            VStack(alignment: .leading, spacing: 5) {
                HStack(spacing: 7) {
                    Text(summary.title)
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(PKTheme.text)
                        .lineLimit(1)
                    StatusPill(text: summary.state.rawValue, color: statusColor(summary.state))
                    CountBadge(text: "\(summary.readyArtifactCount)/\(summary.totalArtifactCount) artifacts")
                }

                Text(summary.nextAction)
                    .font(.caption)
                    .foregroundStyle(PKTheme.text3)
                    .lineLimit(1)
            }

            Spacer(minLength: 0)

            HStack(spacing: 8) {
                MetricBox(label: "PARITY", value: summary.coverageLabel)
                MetricBox(label: "READY", value: "\(summary.readinessReady)")
                MetricBox(label: "CHECK", value: "\(summary.readinessAttention + summary.capabilityAttention)")
            }

            HStack(spacing: 8) {
                SecondaryButton(title: "Open", systemImage: "target", action: openGoal)
                PrimaryButton(title: "Audit", systemImage: "checklist.checked", action: stageAudit)
            }
        }
        .padding(12)
        .background(PKTheme.panel.opacity(0.70))
        .overlay(RoundedRectangle(cornerRadius: 8).stroke(tone.opacity(0.26), lineWidth: 1))
        .clipShape(RoundedRectangle(cornerRadius: 8))
        .help("Enterprise parity goal · \(summary.nextAction)")
    }
}

private func missionRunPriority(_ run: AgentRun) -> Int {
    switch run.state {
    case .waitingForUser, .failed:
        return 0
    case .queued, .starting, .running, .cancelling:
        return 1
    case .completed:
        return 2
    case .cancelled, .stale:
        return 3
    case .draft:
        return 4
    }
}

private struct MissionAttentionSummary: View {
    let activeRuns: Int
    let waitingRuns: Int
    let failedRuns: Int
    let readyEvidenceCount: Int

    private var tone: Color {
        if failedRuns > 0 || waitingRuns > 0 { return PKTheme.warn }
        if activeRuns > 0 { return PKTheme.ok }
        return PKTheme.primary
    }

    private var title: String {
        if failedRuns > 0 { return "Failed runs need review" }
        if waitingRuns > 0 { return "Agent is waiting for input" }
        if activeRuns > 0 { return "Agents are working" }
        if readyEvidenceCount > 0 { return "Evidence is ready to reuse" }
        return "Runtime is clear"
    }

    private var detail: String {
        if failedRuns > 0 { return "\(failedRuns) failed run(s), \(waitingRuns) waiting, \(readyEvidenceCount) evidence artifact(s)." }
        if waitingRuns > 0 { return "\(waitingRuns) run(s) need your input before more work stacks up." }
        if activeRuns > 0 { return "\(activeRuns) active run(s). Watch queue order before starting more." }
        if readyEvidenceCount > 0 { return "\(readyEvidenceCount) saved artifact(s) are available for handoff or review." }
        return "No active or blocked agent work in the native snapshot."
    }

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: failedRuns > 0 || waitingRuns > 0 ? "exclamationmark.triangle.fill" : "gauge.with.dots.needle.67percent")
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(PKTheme.primaryText)
                .frame(width: 32, height: 32)
                .background(tone)
                .clipShape(RoundedRectangle(cornerRadius: 8))
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(PKTheme.text)
                Text(detail)
                    .font(.caption)
                    .foregroundStyle(PKTheme.text3)
                    .lineLimit(1)
            }
            Spacer()
            StatusPill(text: failedRuns + waitingRuns > 0 ? "ATTENTION" : "CLEAR", color: tone)
        }
        .padding(12)
        .background(PKTheme.panel.opacity(0.62))
        .overlay(RoundedRectangle(cornerRadius: 8).stroke(tone.opacity(0.24), lineWidth: 1))
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }
}

private struct MissionAgentLoadStrip: View {
    let snapshot: NativeStoreSnapshot

    var body: some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 150), spacing: 10)], spacing: 10) {
            ForEach(enabledAgentProfiles(in: snapshot)) { profile in
                MissionAgentLoadCard(profile: profile, snapshot: snapshot)
            }
        }
    }
}

private struct MissionAgentLoadCard: View {
    let profile: AgentProfile
    let snapshot: NativeStoreSnapshot

    private var runs: [AgentRun] {
        snapshot.runs.filter { $0.agentProfileId == profile.id }
    }

    private var activeCount: Int {
        runs.filter { isLiveRunState($0.state) }.count
    }

    private var attentionCount: Int {
        runs.filter { $0.state == .waitingForUser || $0.state == .failed }.count
    }

    private var health: CapabilityHealthState? {
        agentCapability(for: profile, snapshot: snapshot)?.healthState
    }

    private var tone: Color {
        if attentionCount > 0 { return PKTheme.warn }
        if activeCount > 0 { return PKTheme.ok }
        return agentHealthColor(health)
    }

    var body: some View {
        HStack(spacing: 9) {
            Image(systemName: agentSymbol(profile.kind))
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(PKTheme.primaryText)
                .frame(width: 28, height: 28)
                .background(agentTint(profile.kind))
                .clipShape(RoundedRectangle(cornerRadius: 7))
            VStack(alignment: .leading, spacing: 2) {
                Text(agentShortLabel(profile.kind))
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(PKTheme.text)
                    .lineLimit(1)
                Text("\(activeCount) active · \(attentionCount) attention")
                    .font(.caption2)
                    .foregroundStyle(PKTheme.text3)
                    .lineLimit(1)
            }
            Spacer()
            Dot(color: tone)
        }
        .padding(10)
        .background(PKTheme.panelAlt.opacity(0.70))
        .overlay(RoundedRectangle(cornerRadius: 8).stroke(tone.opacity(0.22), lineWidth: 1))
        .clipShape(RoundedRectangle(cornerRadius: 8))
        .help("\(profile.displayName): \(agentHealthText(health))")
    }
}

private struct MissionRunRow: View {
    let run: AgentRun
    let snapshot: NativeStoreSnapshot

    private var runAgentKind: NativeAgentKind {
        agentKind(for: run, snapshot: snapshot)
    }

    private var agentLabel: String {
        snapshot.agentProfiles.first(where: { $0.id == run.agentProfileId })?.displayName ?? agentShortLabel(runAgentKind)
    }

    private var workspaceLabel: String {
        workspaceName(for: run.workspaceId, snapshot: snapshot)
    }

    private var timestamp: String {
        let date = run.endedAt ?? run.startedAt
        return date?.formatted(date: .abbreviated, time: .shortened) ?? "No time"
    }

    private var subtitle: String {
        "\(workspaceLabel) · \(agentLabel) · \(timestamp)"
    }

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: agentSymbol(runAgentKind))
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(PKTheme.primaryText)
                .frame(width: 30, height: 30)
                .background(agentTint(runAgentKind))
                .clipShape(RoundedRectangle(cornerRadius: 7))
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 7) {
                    Text(run.promptSnapshot.firstLineFallback("Agent run"))
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(PKTheme.text)
                        .lineLimit(1)
                    StatusPill(text: run.state.rawValue, color: runStateColor(run.state))
                }
                Text(subtitle)
                    .font(.caption)
                    .foregroundStyle(PKTheme.text3)
                    .lineLimit(1)
            }
            Spacer(minLength: 0)
        }
        .padding(9)
        .background(PKTheme.surfaceRaised.opacity(missionRunPriority(run) == 0 ? 0.82 : 0.56))
        .overlay(RoundedRectangle(cornerRadius: 8).stroke(runStateColor(run.state).opacity(0.22), lineWidth: 1))
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }
}

private struct CapabilityHealthSummary: View {
    let healthy: Int
    let check: Int
    let missing: Int

    var body: some View {
        HStack(spacing: 8) {
            MetricBox(label: "READY", value: "\(healthy)")
            MetricBox(label: "CHECK", value: "\(check)")
            MetricBox(label: "MISSING", value: "\(missing)")
        }
    }
}

private struct MissionCapabilityRow: View {
    let capability: Capability

    private var tone: Color {
        switch capability.healthState {
        case .healthy: return PKTheme.ok
        case .needsConfiguration, .unknown: return PKTheme.warn
        case .unavailable, .failed: return PKTheme.err
        }
    }

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: "puzzlepiece.extension")
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(tone)
                .frame(width: 28, height: 28)
                .background(tone.opacity(0.10))
                .clipShape(RoundedRectangle(cornerRadius: 6))
            VStack(alignment: .leading, spacing: 3) {
                Text(capability.name)
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(PKTheme.text)
                    .lineLimit(1)
                Text("\(capability.scope.rawValue) · \(capability.trustLevel.rawValue) · \(capability.configState)")
                    .font(.caption)
                    .foregroundStyle(PKTheme.text3)
                    .lineLimit(1)
            }
            Spacer(minLength: 0)
            StatusPill(text: capability.healthState.rawValue, color: tone)
        }
    }
}

private struct AssistantSurfacePage: View {
    let snapshot: NativeStoreSnapshot
    @Binding var selectedWorkspaceId: EntityID?
    @Binding var selectedWorkItemId: EntityID?
    @ObservedObject var model: NativeAppModel
    let navigate: (NativeRoute) -> Void

    private var selectedWorkspace: Workspace? {
        snapshot.workspaces.first(where: { $0.id == selectedWorkspaceId }) ?? snapshot.workspaces.first
    }

    private var selectedWorkItem: WorkItem? {
        model.assistantLaunchContextWorkItem(
            workspaceId: selectedWorkspace?.id,
            workItemId: selectedWorkItemId
        )
    }

    private var assistantContextSummary: AssistantLaunchContextSummary {
        model.assistantLaunchContextSummary(
            workspaceId: selectedWorkspace?.id,
            workItemId: selectedWorkItemId
        )
    }

    private var assistantRecommendation: AssistantLaunchRecommendation? {
        assistantLaunchRecommendation(
            summary: assistantContextSummary,
            workItem: selectedWorkItem
        )
    }

    private func recommendationReason(for template: AssistantLaunchTemplate) -> String? {
        assistantRecommendation?.templateId == template.id ? assistantRecommendation?.reason : nil
    }

    private func templateHelp(_ template: AssistantLaunchTemplate) -> String {
        guard let reason = recommendationReason(for: template) else {
            return "Stage \(template.title)"
        }
        return "Stage \(template.title) - \(reason)"
    }

    var body: some View {
        PageFrame(route: .assistants) {
            VStack(alignment: .leading, spacing: 14) {
                LaunchContextStrip(
                    workspace: selectedWorkspace,
                    workItem: selectedWorkItem,
                    terminalDirectory: selectedWorkspace.flatMap { model.terminalCurrentDirectory(for: $0) },
                    runningCount: snapshot.runs.filter { $0.state == .running || $0.state == .starting || $0.state == .queued }.count,
                    attentionCount: snapshot.runs.filter { $0.state == .waitingForUser || $0.state == .failed }.count
                )

                LazyVGrid(columns: [GridItem(.adaptive(minimum: 280), spacing: 12)], spacing: 12) {
                    ForEach(assistantLaunchTemplates) { template in
                        Button {
                            launch(template)
                        } label: {
                            AssistantTemplateCard(
                                template: template,
                                currentPermissionMode: model.selectedPermissionMode,
                                contextSummary: assistantContextSummary,
                                recommendationReason: recommendationReason(for: template)
                            )
                        }
                        .buttonStyle(.plain)
                        .help(templateHelp(template))
                    }
                }

                JiraTicketQuickCard(
                    snapshot: snapshot,
                    selectedWorkspaceId: $selectedWorkspaceId,
                    selectedWorkItemId: $selectedWorkItemId,
                    model: model,
                    parentRunId: nil,
                    draftContext: { model.draftPrompt },
                    focusComposer: openStagedChat
                )
            }
        } actions: {
            SecondaryButton(title: "Voice", systemImage: "waveform.circle") {
                navigate(.voice)
            }
            PrimaryButton(title: "Bug Assistant", systemImage: "ladybug") {
                if let template = assistantLaunchTemplates.first(where: { $0.id == "bug-analysis" }) {
                    launch(template)
                }
            }
        }
    }

    private func launch(_ template: AssistantLaunchTemplate) {
        _ = model.stageAssistantPrompt(
            title: template.title,
            prompt: template.prompt,
            agentKind: template.agentKind,
            permissionMode: template.permissionMode,
            workspaceId: selectedWorkspaceId,
            workItemId: selectedWorkItemId,
            userInput: model.draftPrompt
        )
        openStagedChat()
    }

    private func openStagedChat() {
        navigate(.chat)
        NotificationCenter.default.post(name: .pikiclawFocusCommandCenter, object: nil)
    }
}

private struct AgentStudioPage: View {
    let snapshot: NativeStoreSnapshot
    @Binding var selectedAgentKind: NativeAgentKind
    @Binding var selectedWorkspaceId: EntityID?
    @Binding var selectedWorkItemId: EntityID?
    @ObservedObject var model: NativeAppModel
    let navigate: (NativeRoute) -> Void

    private var selectedProfile: AgentProfile? {
        snapshot.agentProfiles.first(where: { $0.kind == selectedAgentKind }) ?? snapshot.agentProfiles.first
    }

    private var selectedProvider: ProviderProfile? {
        guard let providerId = selectedProfile?.defaultProviderProfileId else { return nil }
        return snapshot.providerProfiles.first(where: { $0.id == providerId })
    }

    private var selectedCapability: Capability? {
        guard let profile = selectedProfile else { return nil }
        return snapshot.capabilities.first { capability in
            capability.name.localizedCaseInsensitiveContains(profile.displayName)
                || profile.displayName.localizedCaseInsensitiveContains(capability.name.replacingOccurrences(of: " CLI", with: ""))
                || capability.name.localizedCaseInsensitiveContains(profile.executableName)
        }
    }

    var body: some View {
        PageFrame(route: .agents) {
            VStack(alignment: .leading, spacing: 14) {
                HStack(alignment: .top, spacing: 14) {
                    VStack(alignment: .leading, spacing: 10) {
                        Text("AGENTS")
                            .font(.system(size: 10, weight: .semibold))
                            .foregroundStyle(PKTheme.text3)
                            .padding(.horizontal, 2)

                        ForEach(snapshot.agentProfiles) { profile in
                            AgentStudioProfileCard(
                                profile: profile,
                                selected: selectedProfile?.id == profile.id,
                                capability: capability(for: profile)
                            ) {
                                selectedAgentKind = profile.kind
                            }
                        }
                    }
                    .frame(width: 292)

                    HStack(alignment: .top, spacing: 14) {
                        AgentSetupWindow(
                            profile: selectedProfile,
                            provider: selectedProvider,
                            capability: selectedCapability,
                            detect: detectSelectedAgent,
                            login: stageSelectedAgentLogin,
                            test: testSelectedAgent
                        )
                        AgentConfigWindow(
                            profile: selectedProfile,
                            provider: selectedProvider,
                            workspace: snapshot.workspaces.first
                        )
                    }
                }

                EnterpriseAlignmentPanel(
                    readinessRows: AgentEnterpriseAlignment.readinessRows(snapshot: snapshot),
                    parityRows: AgentEnterpriseAlignment.parityRows(snapshot: snapshot),
                    launchAudit: launchEnterpriseParityAudit
                )

                JiraTicketQuickCard(
                    snapshot: snapshot,
                    selectedWorkspaceId: $selectedWorkspaceId,
                    selectedWorkItemId: $selectedWorkItemId,
                    model: model,
                    parentRunId: nil,
                    focusComposer: {
                        navigate(.chat)
                    }
                )
            }
        } actions: {
            SecondaryButton(title: "Detect", systemImage: "dot.viewfinder", action: detectSelectedAgent)
            SecondaryButton(title: "Login", systemImage: "person.badge.key", action: stageSelectedAgentLogin)
            SecondaryButton(title: "Audit", systemImage: "checklist.checked", action: launchEnterpriseParityAudit)
            PrimaryButton(title: "Test Run", systemImage: "play.fill", action: testSelectedAgent)
        }
    }

    private func capability(for profile: AgentProfile) -> Capability? {
        snapshot.capabilities.first { capability in
            capability.name.localizedCaseInsensitiveContains(profile.displayName)
                || profile.displayName.localizedCaseInsensitiveContains(capability.name.replacingOccurrences(of: " CLI", with: ""))
                || capability.name.localizedCaseInsensitiveContains(profile.executableName)
        }
    }

    private func detectSelectedAgent() {
        let kind = selectedProfile?.kind ?? selectedAgentKind
        Task { await model.detectAgent(kind: kind) }
    }

    private func stageSelectedAgentLogin() {
        let kind = selectedProfile?.kind ?? selectedAgentKind
        if model.stageAgentLogin(kind: kind, workspaceId: selectedWorkspaceId) {
            navigate(.terminal)
        }
    }

    private func testSelectedAgent() {
        let kind = selectedProfile?.kind ?? selectedAgentKind
        Task {
            if let runId = await model.startAgentSmokeTest(kind: kind, workspaceId: selectedWorkspaceId),
               let run = model.snapshot.runs.first(where: { $0.id == runId }) {
                selectedWorkItemId = run.workItemId
                selectedWorkspaceId = run.workspaceId
                navigate(.chat)
            }
        }
    }

    private func launchEnterpriseParityAudit() {
        if model.stageEnterpriseParityAudit(workspaceId: selectedWorkspaceId, workItemId: selectedWorkItemId) {
            if let goal = model.snapshot.workItems.first(where: { $0.id == AgentEnterpriseAlignment.goalWorkItemId }) {
                selectedWorkItemId = goal.id
                selectedWorkspaceId = goal.workspaceId
            }
            navigate(.chat)
            NotificationCenter.default.post(name: .pikiclawFocusCommandCenter, object: nil)
        }
    }
}

private struct AgentStudioProfileCard: View {
    let profile: AgentProfile
    let selected: Bool
    let capability: Capability?
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 11) {
                Image(systemName: agentSymbol(profile.kind))
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(selected ? PKTheme.primaryText : agentTint(profile.kind))
                    .frame(width: 36, height: 36)
                    .background(selected ? agentTint(profile.kind) : agentTint(profile.kind).opacity(0.13))
                    .clipShape(RoundedRectangle(cornerRadius: 8))

                VStack(alignment: .leading, spacing: 4) {
                    Text(profile.displayName)
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(PKTheme.text)
                        .lineLimit(1)
                    Text(profile.executableName)
                        .font(.caption)
                        .foregroundStyle(PKTheme.text3)
                        .lineLimit(1)
                }

                Spacer()
                Text(statusText(for: capability, profile: profile))
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(PKTheme.text3)
                    .lineLimit(1)
                Dot(color: statusColor(for: capability, profile: profile))
            }
            .padding(12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(selected ? PKTheme.selected : PKTheme.panel.opacity(0.52))
            .overlay(RoundedRectangle(cornerRadius: 8).stroke(selected ? agentTint(profile.kind).opacity(0.72) : PKTheme.edge, lineWidth: 1))
            .clipShape(RoundedRectangle(cornerRadius: 8))
        }
        .buttonStyle(.plain)
    }

    private func statusColor(for capability: Capability?, profile: AgentProfile) -> Color {
        guard profile.isEnabled else { return PKTheme.text3 }
        switch capability?.healthState {
        case .healthy: return PKTheme.ok
        case .needsConfiguration, .unknown, nil: return PKTheme.warn
        case .unavailable, .failed: return PKTheme.err
        }
    }

    private func statusText(for capability: Capability?, profile: AgentProfile) -> String {
        guard profile.isEnabled else { return "Off" }
        switch capability?.healthState {
        case .healthy: return "Ready"
        case .needsConfiguration, .unknown, nil: return "Check"
        case .unavailable, .failed: return "Missing"
        }
    }
}

private struct AgentSetupWindow: View {
    let profile: AgentProfile?
    let provider: ProviderProfile?
    let capability: Capability?
    let detect: () -> Void
    let login: () -> Void
    let test: () -> Void

    var body: some View {
        AgentStudioWindow(title: "Install & Auth", subtitle: "Detect the local CLI and make it runnable.") {
            VStack(alignment: .leading, spacing: 12) {
                AgentStudioField(label: "Executable", value: profile?.executableName ?? "No agent")
                AgentStudioField(label: "Install", value: capability?.installState.capitalized ?? "Profile ready")
                AgentStudioField(label: "Auth", value: capability?.configState.capitalized ?? "Needs check")
                AgentStudioField(label: "Provider", value: provider?.displayName ?? "Agent default")
                AgentStudioField(label: "Permission", value: permissionLabel(profile?.defaultPermissionMode ?? .askBeforeEdit))

                HStack(spacing: 8) {
                    SecondaryButton(title: "Detect", systemImage: "magnifyingglass", action: detect)
                    SecondaryButton(title: "Login", systemImage: "key", action: login)
                    PrimaryButton(title: "Test", systemImage: agentSymbol(profile?.kind ?? .customCLI), action: test)
                }
                .padding(.top, 4)
            }
        }
    }
}

private struct AgentConfigWindow: View {
    let profile: AgentProfile?
    let provider: ProviderProfile?
    let workspace: Workspace?

    private var preview: String {
        agentConfigPreview(profile: profile, provider: provider, workspace: workspace)
    }

    var body: some View {
        AgentStudioWindow(title: "Config & Launch", subtitle: "Edit the files and preview the native launch boundary.") {
            VStack(alignment: .leading, spacing: 12) {
                HStack(alignment: .center, spacing: 8) {
                    HStack(spacing: 8) {
                        ForEach(agentConfigFiles(for: profile?.kind ?? .customCLI), id: \.self) { file in
                            HeaderChip(title: file)
                        }
                    }
                    .lineLimit(1)
                    Spacer()
                    ComposerIconButton(symbol: "doc.on.doc", title: "Copy Preview") {
                        copyTextToPasteboard(preview)
                    }
                }

                Text(preview)
                    .font(.system(size: 12, design: .monospaced))
                    .foregroundStyle(PKTheme.text2)
                    .textSelection(.enabled)
                    .padding(12)
                    .frame(maxWidth: .infinity, minHeight: 214, alignment: .topLeading)
                    .background(PKTheme.inset.opacity(0.86))
                    .overlay(RoundedRectangle(cornerRadius: 8).stroke(PKTheme.edge, lineWidth: 1))
                    .clipShape(RoundedRectangle(cornerRadius: 8))

                HStack {
                    AgentStudioField(label: "Model", value: provider?.defaultModel ?? "Agent default")
                    AgentStudioField(label: "Workspace", value: workspace?.name ?? "No workspace")
                }
            }
        }
    }
}

private struct EnterpriseAlignmentPanel: View {
    let readinessRows: [EnterpriseReadinessRow]
    let parityRows: [AgentEnterpriseCapabilityRow]
    let launchAudit: () -> Void

    private var visibleParityRows: [AgentEnterpriseCapabilityRow] {
        Array(parityRows.prefix(6))
    }

    var body: some View {
        AgentStudioWindow(title: "Enterprise Alignment", subtitle: "Codex, Claude, and Gemini parity for the native client.") {
            VStack(alignment: .leading, spacing: 14) {
                HStack(alignment: .top, spacing: 10) {
                    ForEach(readinessRows) { row in
                        EnterpriseReadinessTile(row: row)
                    }
                }

                VStack(alignment: .leading, spacing: 8) {
                    HStack {
                        Text("Capability Matrix")
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundStyle(PKTheme.text)
                        Spacer()
                        PrimaryButton(title: "Stage Audit", systemImage: "checklist.checked", action: launchAudit)
                    }

                    ForEach(visibleParityRows) { row in
                        EnterpriseParityRowView(row: row)
                    }

                    if parityRows.count > visibleParityRows.count {
                        Text("+ \(parityRows.count - visibleParityRows.count) more parity checks tracked in the native model")
                            .font(.caption)
                            .foregroundStyle(PKTheme.text3)
                            .padding(.top, 2)
                    }
                }
            }
        }
    }
}

private struct EnterpriseReadinessTile: View {
    let row: EnterpriseReadinessRow

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 6) {
                Dot(color: enterpriseReadinessColor(row))
                Text(row.title)
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(PKTheme.text)
                    .lineLimit(1)
            }
            Text(row.value)
                .font(.system(size: 20, weight: .bold))
                .foregroundStyle(PKTheme.text)
                .lineLimit(1)
            Text(row.detail)
                .font(.caption)
                .foregroundStyle(PKTheme.text3)
                .lineLimit(2)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(10)
        .frame(maxWidth: .infinity, minHeight: 118, alignment: .topLeading)
        .background(PKTheme.control.opacity(0.52))
        .overlay(RoundedRectangle(cornerRadius: 7).stroke(PKTheme.edge, lineWidth: 1))
        .clipShape(RoundedRectangle(cornerRadius: 7))
        .help(row.nextAction)
    }
}

private struct EnterpriseParityRowView: View {
    let row: AgentEnterpriseCapabilityRow

    var body: some View {
        HStack(spacing: 10) {
            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 6) {
                    Text(row.key.title)
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(PKTheme.text)
                    CountBadge(text: row.coverageLabel)
                }
                Text(row.gapSummary)
                    .font(.caption)
                    .foregroundStyle(PKTheme.text3)
                    .lineLimit(1)
            }
            .frame(width: 238, alignment: .leading)

            ForEach(row.cells, id: \.agentKind) { cell in
                HStack(spacing: 5) {
                    Image(systemName: agentSymbol(cell.agentKind))
                        .font(.system(size: 10, weight: .semibold))
                    Text(cell.mode.label)
                        .font(.system(size: 10, weight: .semibold))
                        .lineLimit(1)
                }
                .foregroundStyle(enterpriseModeColor(cell.mode))
                .padding(.horizontal, 8)
                .frame(width: 82, height: 26)
                .background(enterpriseModeColor(cell.mode).opacity(0.12))
                .overlay(RoundedRectangle(cornerRadius: 7).stroke(enterpriseModeColor(cell.mode).opacity(0.45), lineWidth: 1))
                .clipShape(RoundedRectangle(cornerRadius: 7))
                .help("\(cell.agentKind.enterpriseLabel): \(cell.summary) \(cell.nextAction)")
            }

            Spacer()
        }
        .padding(9)
        .background(PKTheme.inset.opacity(0.62))
        .overlay(RoundedRectangle(cornerRadius: 7).stroke(PKTheme.edge, lineWidth: 1))
        .clipShape(RoundedRectangle(cornerRadius: 7))
    }
}

private struct AgentStudioWindow<Content: View>: View {
    let title: String
    let subtitle: String
    @ViewBuilder var content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 8) {
                HStack(spacing: 5) {
                    Circle().fill(PKTheme.err.opacity(0.82)).frame(width: 9, height: 9)
                    Circle().fill(PKTheme.warn.opacity(0.82)).frame(width: 9, height: 9)
                    Circle().fill(PKTheme.ok.opacity(0.82)).frame(width: 9, height: 9)
                }
                VStack(alignment: .leading, spacing: 2) {
                    Text(title)
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(PKTheme.text)
                    Text(subtitle)
                        .font(.caption)
                        .foregroundStyle(PKTheme.text3)
                        .lineLimit(1)
                }
                Spacer()
            }
            .padding(.bottom, 2)

            content
        }
        .padding(16)
        .frame(maxWidth: .infinity, minHeight: 390, alignment: .topLeading)
        .background(PKTheme.panel.opacity(0.74))
        .overlay(RoundedRectangle(cornerRadius: 8).stroke(PKTheme.edgeStrong.opacity(0.54), lineWidth: 1))
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }
}

private struct AgentStudioField: View {
    let label: String
    let value: String

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            Text(label.uppercased())
                .font(.system(size: 10, weight: .semibold))
                .foregroundStyle(PKTheme.text3)
            Text(value)
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(PKTheme.text)
                .lineLimit(1)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(10)
        .background(PKTheme.control.opacity(0.56))
        .overlay(RoundedRectangle(cornerRadius: 7).stroke(PKTheme.edge, lineWidth: 1))
        .clipShape(RoundedRectangle(cornerRadius: 7))
    }
}

private struct SystemSurfacePage: View {
    @AppStorage(PKThemePreference.storageKey) private var themePreferenceRaw = PKThemePreference.dark.rawValue

    let route: NativeRoute
    let snapshot: NativeStoreSnapshot
    let statusLine: String
    let restartBlocked: Bool
    let restart: () -> Void
    let refresh: () -> Void

    private var themePreference: Binding<PKThemePreference> {
        Binding(
            get: { PKThemePreference(rawValue: themePreferenceRaw) ?? .dark },
            set: { themePreferenceRaw = $0.rawValue }
        )
    }

    var body: some View {
        PageFrame(route: route) {
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 280), spacing: 12)], spacing: 12) {
                switch route {
                case .channels:
                    SurfaceCard(symbol: "bubble.left.and.bubble.right", title: "Telegram", subtitle: "IM terminal configured through channel credentials.", badge: "Terminal")
                    SurfaceCard(symbol: "message", title: "Feishu", subtitle: "Enterprise channel remains physically isolated.", badge: "Terminal")
                    SurfaceCard(symbol: "ellipsis.bubble", title: "Dashboard", subtitle: "Native and web dashboard share orchestrator concepts.", badge: "Native")
                case .agents:
                    ForEach(snapshot.agentProfiles) { agent in
                        SurfaceCard(symbol: agentSymbol(agent.kind), title: agent.displayName, subtitle: agent.executableName, badge: agent.isEnabled ? "Ready" : "Off")
                    }
                case .assistants:
                    SurfaceCard(symbol: "person.crop.circle.badge.plus", title: "MR Review Assistant", subtitle: "Review merge requests and attach repo evidence.", badge: "Default")
                    SurfaceCard(symbol: "person.crop.circle.badge.plus", title: "Log Analysis Assistant", subtitle: "Trace logs, session IDs, and runtime failures.", badge: "Ops")
                    SurfaceCard(symbol: "person.crop.circle.badge.plus", title: "Bug Analysis Assistant", subtitle: "Analyze rough bug reports and build reproduction plans.", badge: "QA")
                case .team:
                    SurfaceCard(symbol: "person.2", title: "Chief of Staff", subtitle: "Synthesize git, Jira, sandbox, and session state.", badge: "Coordinator")
                    SurfaceCard(symbol: "arrow.triangle.branch", title: "Handoff", subtitle: "Move a run from one target to another with context.", badge: "Planned")
                case .extensions:
                    ForEach(snapshot.capabilities) { capability in
                        SurfaceCard(symbol: "puzzlepiece.extension", title: capability.name, subtitle: "\(capability.kind.rawValue) · \(capability.configState)", badge: capability.healthState.rawValue)
                    }
                case .settings:
                    AppearanceSettingsCard(selection: themePreference)
                    RestartSettingsCard(
                        statusLine: statusLine,
                        blocked: restartBlocked,
                        restart: restart
                    )
                    ForEach(snapshot.providerProfiles) { profile in
                        SurfaceCard(symbol: "key", title: profile.displayName, subtitle: profile.defaultModel ?? profile.kind.rawValue, badge: profile.healthState.rawValue)
                    }
                    SurfaceCard(symbol: "shield", title: "Permissions", subtitle: "Read, Ask, and Autopilot policies are enforced before runner launch.", badge: "Native")
                default:
                    EmptyView()
                }
            }
        } actions: {
            if route == .settings {
                SecondaryButton(title: restartBlocked ? "Busy" : "Restart", systemImage: "arrow.clockwise", action: restart)
                    .disabled(restartBlocked)
            } else {
                SecondaryButton(title: "Refresh", systemImage: "arrow.clockwise", action: refresh)
            }
        }
    }
}

private struct AppearanceSettingsCard: View {
    @Binding var selection: PKThemePreference

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                Image(systemName: selection.systemImage)
                    .foregroundStyle(PKTheme.primary)
                    .frame(width: 34, height: 34)
                    .background(PKTheme.primary.opacity(0.12))
                    .clipShape(RoundedRectangle(cornerRadius: 7))
                Spacer()
                StatusPill(text: selection.title, color: PKTheme.primary)
            }

            VStack(alignment: .leading, spacing: 4) {
                Text("Appearance")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(PKTheme.text)
                Text(selection.detail)
                    .font(.system(size: 13))
                    .foregroundStyle(PKTheme.text3)
                    .lineLimit(2)
            }

            HStack(spacing: 8) {
                ForEach(PKThemePreference.allCases) { option in
                    Button {
                        selection = option
                    } label: {
                        HStack(spacing: 6) {
                            Image(systemName: option.systemImage)
                                .font(.system(size: 12, weight: .semibold))
                            Text(option.title)
                                .font(.system(size: 12, weight: .semibold))
                                .lineLimit(1)
                        }
                        .frame(maxWidth: .infinity)
                        .frame(height: 32)
                        .foregroundStyle(selection == option ? PKTheme.primaryText : PKTheme.text3)
                        .background(selection == option ? PKTheme.primary : PKTheme.control.opacity(0.72))
                        .overlay(
                            RoundedRectangle(cornerRadius: 7)
                                .stroke(selection == option ? PKTheme.primary.opacity(0.92) : PKTheme.edge, lineWidth: 1)
                        )
                        .clipShape(RoundedRectangle(cornerRadius: 7))
                    }
                    .buttonStyle(.plain)
                    .help("Switch to \(option.title.lowercased()) mode")
                }
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, minHeight: 150, alignment: .topLeading)
        .background(PKTheme.panel.opacity(0.7))
        .overlay(RoundedRectangle(cornerRadius: 8).stroke(PKTheme.edge, lineWidth: 1))
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }
}

private struct RestartSettingsCard: View {
    let statusLine: String
    let blocked: Bool
    let restart: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                Image(systemName: "arrow.clockwise.circle")
                    .foregroundStyle(blocked ? PKTheme.warn : PKTheme.primary)
                    .frame(width: 34, height: 34)
                    .background((blocked ? PKTheme.warn : PKTheme.primary).opacity(0.12))
                    .clipShape(RoundedRectangle(cornerRadius: 7))
                Spacer()
                StatusPill(text: blocked ? "Busy" : "Ready", color: blocked ? PKTheme.warn : PKTheme.primary)
            }

            VStack(alignment: .leading, spacing: 4) {
                Text("Restart")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(PKTheme.text)
                Text(blocked ? "Finish the active run before restarting Pikiclaw." : statusLine)
                    .font(.system(size: 13))
                    .foregroundStyle(PKTheme.text3)
                    .lineLimit(2)
            }

            Button(action: restart) {
                Label(blocked ? "Run active" : "Restart Pikiclaw", systemImage: "arrow.clockwise")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(blocked ? PKTheme.text4 : PKTheme.primaryText)
                    .frame(maxWidth: .infinity)
                    .frame(height: 32)
                    .background(blocked ? PKTheme.control.opacity(0.72) : PKTheme.primary)
                    .overlay(
                        RoundedRectangle(cornerRadius: 7)
                            .stroke(blocked ? PKTheme.edge : PKTheme.primary.opacity(0.92), lineWidth: 1)
                    )
                    .clipShape(RoundedRectangle(cornerRadius: 7))
            }
            .buttonStyle(.plain)
            .disabled(blocked)
            .help(blocked ? "Restart is available after active runs finish." : "Restart Pikiclaw")
        }
        .padding(16)
        .frame(maxWidth: .infinity, minHeight: 150, alignment: .topLeading)
        .background(PKTheme.panel.opacity(0.7))
        .overlay(RoundedRectangle(cornerRadius: 8).stroke(PKTheme.edge, lineWidth: 1))
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }
}

private struct PageFrame<Content: View, Actions: View>: View {
    let route: NativeRoute
    var showsHeader = true
    @ViewBuilder var content: Content
    @ViewBuilder var actions: Actions

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                if showsHeader {
                    HeaderBand(title: route.title, subtitle: route.subtitle, route: route) {
                        actions
                    }
                }
                content
            }
            .padding(.horizontal, 32)
            .padding(.bottom, 32)
            .padding(.top, showsHeader ? 32 : 72)
            .frame(maxWidth: .infinity, alignment: .topLeading)
        }
    }
}

private struct HeaderBand<Actions: View>: View {
    let title: String
    let subtitle: String
    let route: NativeRoute
    @ViewBuilder var actions: Actions

    var body: some View {
        HStack(alignment: .center, spacing: 16) {
            VStack(alignment: .leading, spacing: 8) {
                Text(title)
                    .font(.system(size: route == .chat ? 32 : 28, weight: .semibold))
                    .foregroundStyle(PKTheme.text)
                    .lineLimit(2)
                Text(subtitle)
                    .font(.system(size: 13))
                    .foregroundStyle(PKTheme.text3)
                    .lineLimit(2)
            }
            Spacer()
            HStack(spacing: 9) {
                actions
            }
        }
        .padding(.horizontal, 16)
        .frame(minHeight: 100)
        .background(PKTheme.panel.opacity(0.72))
        .overlay(RoundedRectangle(cornerRadius: 8).stroke(PKTheme.edge, lineWidth: 1))
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }
}

private struct HeaderChip: View {
    let title: String

    var body: some View {
        Text(title)
            .font(.system(size: 12, weight: .semibold))
            .foregroundStyle(PKTheme.text2)
            .padding(.horizontal, 10)
            .frame(height: 30)
            .background(PKTheme.control)
            .overlay(RoundedRectangle(cornerRadius: 6).stroke(PKTheme.edge, lineWidth: 1))
            .clipShape(RoundedRectangle(cornerRadius: 6))
    }
}

private struct LaunchContextStrip: View {
    let workspace: Workspace?
    let workItem: WorkItem?
    let terminalDirectory: String?
    let runningCount: Int
    let attentionCount: Int

    private var workspaceValue: String {
        workspace.map { workspace in
            if let branch = workspace.currentBranch, !branch.isEmpty {
                return "\(workspace.name) · \(branch)"
            }
            return workspace.name
        } ?? "No workspace"
    }

    private var taskValue: String {
        workItem.map { "\($0.title) · \($0.state.rawValue)" } ?? "No selected task"
    }

    private var terminalValue: String {
        terminalDirectory.map(shortDisplayPath(_:)) ?? "Workspace root"
    }

    private var runValue: String {
        if attentionCount > 0 {
            return "\(attentionCount) need attention"
        }
        if runningCount > 0 {
            return "\(runningCount) active"
        }
        return "Clear"
    }

    var body: some View {
        HStack(spacing: 10) {
            LaunchContextChip(symbol: "folder", label: "Workspace", value: workspaceValue, tone: PKTheme.primary)
            LaunchContextChip(symbol: "checklist", label: "Task", value: taskValue, tone: workItem == nil ? PKTheme.text3 : PKTheme.ok)
            LaunchContextChip(symbol: "terminal", label: "cwd", value: terminalValue, tone: PKTheme.text3)
            LaunchContextChip(symbol: attentionCount > 0 ? "exclamationmark.triangle" : "waveform.path.ecg", label: "Runs", value: runValue, tone: attentionCount > 0 ? PKTheme.warn : PKTheme.ok)
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(PKTheme.panel.opacity(0.66))
        .overlay(RoundedRectangle(cornerRadius: 8).stroke(PKTheme.edge, lineWidth: 1))
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }
}

private struct LaunchContextChip: View {
    let symbol: String
    let label: String
    let value: String
    let tone: Color

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: symbol)
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(tone)
                .frame(width: 26, height: 26)
                .background(tone.opacity(0.12))
                .clipShape(RoundedRectangle(cornerRadius: 6))
            VStack(alignment: .leading, spacing: 2) {
                Text(label.uppercased())
                    .font(.system(size: 9, weight: .semibold))
                    .foregroundStyle(PKTheme.text4)
                Text(value)
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(PKTheme.text2)
                    .lineLimit(1)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 10)
        .frame(height: 48)
        .background(PKTheme.control.opacity(0.48))
        .overlay(RoundedRectangle(cornerRadius: 7).stroke(PKTheme.edge.opacity(0.9), lineWidth: 1))
        .clipShape(RoundedRectangle(cornerRadius: 7))
    }
}

private struct SurfaceCard: View {
    let symbol: String
    let title: String
    let subtitle: String
    let badge: String

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Image(systemName: symbol)
                    .foregroundStyle(PKTheme.primary)
                    .frame(width: 34, height: 34)
                    .background(PKTheme.primary.opacity(0.12))
                    .clipShape(RoundedRectangle(cornerRadius: 7))
                Spacer()
                StatusPill(text: badge, color: PKTheme.primary)
            }
            Text(title)
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(PKTheme.text)
            Text(subtitle)
                .font(.system(size: 13))
                .foregroundStyle(PKTheme.text3)
                .lineLimit(3)
        }
        .padding(16)
        .frame(maxWidth: .infinity, minHeight: 150, alignment: .topLeading)
        .background(PKTheme.panel.opacity(0.7))
        .overlay(RoundedRectangle(cornerRadius: 8).stroke(PKTheme.edge, lineWidth: 1))
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }
}

private struct ContextMeter: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("CONTEXT")
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(PKTheme.text3)
                Spacer()
                CountBadge(text: "0/3")
            }
            HStack(spacing: 6) {
                Capsule().fill(PKTheme.text3.opacity(0.24)).frame(height: 5)
                Capsule().fill(PKTheme.text3.opacity(0.16)).frame(height: 5)
                Capsule().fill(PKTheme.text3.opacity(0.16)).frame(height: 5)
            }
            Text("No project context yet")
                .font(.caption)
                .foregroundStyle(PKTheme.text3)
        }
        .padding(12)
        .background(PKTheme.control.opacity(0.42))
        .overlay(RoundedRectangle(cornerRadius: 7).stroke(PKTheme.edge, lineWidth: 1))
        .clipShape(RoundedRectangle(cornerRadius: 7))
    }
}

private struct MetricBox: View {
    let label: String
    let value: String

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label)
                .font(.system(size: 10, weight: .semibold))
                .foregroundStyle(PKTheme.text3)
            Text(value)
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(PKTheme.text)
                .lineLimit(1)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(10)
        .background(PKTheme.control.opacity(0.54))
        .overlay(RoundedRectangle(cornerRadius: 7).stroke(PKTheme.edge, lineWidth: 1))
        .clipShape(RoundedRectangle(cornerRadius: 7))
    }
}

private struct LibrarySummary: View {
    let builtInCount: Int
    let customCount: Int

    private var totalCount: Int {
        builtInCount + customCount
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                VStack(alignment: .leading, spacing: 3) {
                    Text("LIBRARY")
                        .font(.system(size: 10, weight: .semibold))
                        .foregroundStyle(PKTheme.text3)
                    Text("\(totalCount) recipes")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(PKTheme.text)
                }
                Spacer()
                Image(systemName: NativeRoute.workflows.symbol)
                    .foregroundStyle(PKTheme.primary)
                    .frame(width: 32, height: 32)
                    .background(PKTheme.primary.opacity(0.10))
                    .clipShape(RoundedRectangle(cornerRadius: 7))
            }
            HStack(spacing: 8) {
                MetricBox(label: "BUILT IN", value: "\(builtInCount)")
                MetricBox(label: "CUSTOM", value: "\(customCount)")
            }
        }
        .padding(14)
        .background(PKTheme.panel.opacity(0.7))
        .overlay(RoundedRectangle(cornerRadius: 8).stroke(PKTheme.edge, lineWidth: 1))
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }
}

private struct SearchPlaceholder: View {
    let title: String

    var body: some View {
        HStack(spacing: 9) {
            Image(systemName: "magnifyingglass")
            Text(title)
            Spacer()
        }
        .font(.system(size: 13))
        .foregroundStyle(PKTheme.text3)
        .padding(.horizontal, 12)
        .frame(height: 36)
        .background(PKTheme.control.opacity(0.72))
        .overlay(RoundedRectangle(cornerRadius: 7).stroke(PKTheme.edge, lineWidth: 1))
        .clipShape(RoundedRectangle(cornerRadius: 7))
    }
}

private struct CategoryRow: View {
    let title: String
    let count: Int
    let selected: Bool

    var body: some View {
        HStack {
            Text(title)
                .font(.system(size: 12, weight: selected ? .semibold : .regular))
            Spacer()
            CountBadge(value: count)
        }
        .foregroundStyle(selected ? PKTheme.primary : PKTheme.text3)
        .padding(.horizontal, 12)
        .frame(height: 38)
        .background(selected ? PKTheme.primary.opacity(0.11) : .clear)
        .overlay(RoundedRectangle(cornerRadius: 7).stroke(selected ? PKTheme.primary.opacity(0.38) : .clear, lineWidth: 1))
        .clipShape(RoundedRectangle(cornerRadius: 7))
    }
}

private struct WorkflowCard: View {
    let symbol: String
    let title: String
    let description: String
    let category: String
    let agent: String
    let steps: Int
    let outputs: Int
    let effort: String
    let actionTitle: String
    let action: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 13) {
            HStack {
                Image(systemName: symbol)
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(PKTheme.primary)
                    .frame(width: 32, height: 32)
                    .background(PKTheme.primary.opacity(0.12))
                    .clipShape(RoundedRectangle(cornerRadius: 7))
                StatusPill(text: category.uppercased(), color: PKTheme.text3)
                Spacer()
                CountBadge(text: agent)
            }
            Text(title)
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(PKTheme.text)
            Text(description)
                .font(.system(size: 13))
                .foregroundStyle(PKTheme.text3)
                .lineLimit(3)
            HStack(spacing: 8) {
                MetricBox(label: "STEPS", value: "\(steps)")
                MetricBox(label: "OUTPUTS", value: "\(outputs)")
                MetricBox(label: "EFFORT", value: effort)
            }
            Button(action: action) {
                HStack {
                    Spacer()
                    Text(actionTitle)
                    Image(systemName: "arrow.right")
                }
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(PKTheme.primary)
            }
            .buttonStyle(.plain)
        }
        .padding(16)
        .background(PKTheme.panel.opacity(0.72))
        .overlay(RoundedRectangle(cornerRadius: 8).stroke(PKTheme.edge, lineWidth: 1))
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }
}

private struct WorkflowEmptyState: View {
    let title: String
    let subtitle: String

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: "plus.square.dashed")
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(PKTheme.primary)
                .frame(width: 36, height: 36)
                .background(PKTheme.primary.opacity(0.10))
                .clipShape(RoundedRectangle(cornerRadius: 7))
            VStack(alignment: .leading, spacing: 4) {
                Text(title)
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(PKTheme.text)
                Text(subtitle)
                    .font(.caption)
                    .foregroundStyle(PKTheme.text3)
                    .lineLimit(2)
            }
            Spacer(minLength: 0)
        }
        .padding(14)
        .frame(maxWidth: .infinity, minHeight: 82, alignment: .leading)
        .background(PKTheme.panelAlt.opacity(0.48))
        .overlay(RoundedRectangle(cornerRadius: 8).stroke(PKTheme.edge, style: StrokeStyle(lineWidth: 1, dash: [5, 4])))
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }
}

private struct AssistantTemplateCard: View {
    let template: AssistantLaunchTemplate
    let currentPermissionMode: PermissionMode
    let contextSummary: AssistantLaunchContextSummary
    let recommendationReason: String?

    private var isRecommended: Bool {
        recommendationReason != nil
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Image(systemName: template.symbol)
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(PKTheme.primary)
                    .frame(width: 34, height: 34)
                    .background(PKTheme.primary.opacity(0.12))
                    .clipShape(RoundedRectangle(cornerRadius: 7))
                Spacer()
                if isRecommended {
                    StatusPill(text: "Suggested", color: PKTheme.ok)
                }
                StatusPill(text: template.badge, color: PKTheme.primary)
            }
            Text(template.title)
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(PKTheme.text)
            Text(template.subtitle)
                .font(.system(size: 13))
                .foregroundStyle(PKTheme.text3)
                .lineLimit(3)
            AssistantContextPackPreview(summary: contextSummary)
            HStack {
                CountBadge(text: agentShortLabel(template.agentKind))
                CountBadge(text: permissionTitle(assistantTemplatePermissionMode(template, current: currentPermissionMode)))
                Spacer()
                Label("Stage in Chat", systemImage: "arrow.right")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(PKTheme.primary)
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, minHeight: 190, alignment: .topLeading)
        .background(isRecommended ? PKTheme.panelAlt.opacity(0.86) : PKTheme.panel.opacity(0.72))
        .overlay(RoundedRectangle(cornerRadius: 8).stroke(isRecommended ? PKTheme.ok.opacity(0.46) : PKTheme.edge, lineWidth: 1))
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }
}

private struct AssistantContextPackPreview: View {
    let summary: AssistantLaunchContextSummary

    private var columns: [GridItem] {
        [GridItem(.adaptive(minimum: 36, maximum: 48), spacing: 6)]
    }

    private var helpText: String {
        var parts = [
            "Outputs: \(summary.outputCount)",
            "Artifact refs: \(summary.artifactRefCount)",
            "Pending commands: \(summary.pendingCommandCount)",
            "Validation evidence: \(summary.validationEvidenceCount)",
            "Decision signals: \(summary.decisionSignalCount)",
            "Actionable notes: \(summary.actionableNoteCount)",
            "Knowledge cards: \(summary.knowledgeCardCount)",
            "Recent runs: \(summary.recentRunCount)"
        ]
        if !summary.pendingCommands.isEmpty {
            parts.append(summary.pendingCommands.joined(separator: "\n"))
        }
        if !summary.validationEvidence.isEmpty {
            parts.append(summary.validationEvidence.joined(separator: "\n"))
        }
        if !summary.decisionSignals.isEmpty {
            parts.append(summary.decisionSignals.joined(separator: "\n"))
        }
        if !summary.actionableNotes.isEmpty {
            parts.append(summary.actionableNotes.joined(separator: "\n"))
        }
        return parts.joined(separator: "\n")
    }

    var body: some View {
        LazyVGrid(columns: columns, alignment: .leading, spacing: 6) {
            AssistantContextPackChip(symbol: "shippingbox", value: summary.outputCount, title: "Outputs")
            AssistantContextPackChip(symbol: "link", value: summary.artifactRefCount, title: "Artifact refs")
            AssistantContextPackChip(symbol: "terminal", value: summary.pendingCommandCount, title: "Pending commands")
            AssistantContextPackChip(symbol: "checkmark.seal", value: summary.validationEvidenceCount, title: "Validation evidence")
            AssistantContextPackChip(symbol: "exclamationmark.triangle", value: summary.decisionSignalCount, title: "Decision signals")
            AssistantContextPackChip(symbol: "checklist", value: summary.actionableNoteCount, title: "Actionable notes")
            AssistantContextPackChip(symbol: "rectangle.stack", value: summary.knowledgeCardCount, title: "Knowledge cards")
            AssistantContextPackChip(symbol: "text.bubble", value: summary.recentRunCount, title: "Recent runs")
        }
        .help(helpText)
        .accessibilityLabel(summary.hasContextPack ? "Assistant context attached" : "No assistant context attached")
    }
}

private struct AssistantContextPackChip: View {
    let symbol: String
    let value: Int
    let title: String

    private var tone: Color {
        value > 0 ? PKTheme.primary : PKTheme.text4
    }

    var body: some View {
        HStack(spacing: 4) {
            Image(systemName: symbol)
                .font(.system(size: 10, weight: .semibold))
                .foregroundStyle(tone)
            Text("\(value)")
                .font(.system(size: 10, weight: .semibold))
                .foregroundStyle(value > 0 ? PKTheme.text2 : PKTheme.text4)
                .lineLimit(1)
        }
        .frame(minWidth: 36)
        .frame(height: 24)
        .background(PKTheme.control.opacity(value > 0 ? 0.62 : 0.34))
        .overlay(RoundedRectangle(cornerRadius: 6).stroke(PKTheme.edge.opacity(value > 0 ? 0.92 : 0.58), lineWidth: 1))
        .clipShape(RoundedRectangle(cornerRadius: 6))
        .help("\(title): \(value)")
    }
}

private struct InspectorSection<Content: View>: View {
    let title: String
    @ViewBuilder var content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(title)
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(PKTheme.text)
            content
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(PKTheme.panel.opacity(0.72))
        .overlay(RoundedRectangle(cornerRadius: 8).stroke(PKTheme.edge, lineWidth: 1))
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }
}

private struct InspectorMetric: View {
    let label: String
    let value: String

    var body: some View {
        HStack {
            Text(label)
                .font(.caption)
                .foregroundStyle(PKTheme.text3)
            Spacer()
            Text(value)
                .font(.caption.weight(.semibold))
                .foregroundStyle(PKTheme.text2)
        }
    }
}

private struct InspectorRow: View {
    let symbol: String
    let title: String
    let subtitle: String

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: symbol)
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(PKTheme.primary)
                .frame(width: 28, height: 28)
                .background(PKTheme.primary.opacity(0.10))
                .clipShape(RoundedRectangle(cornerRadius: 6))
            VStack(alignment: .leading, spacing: 3) {
                Text(title)
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(PKTheme.text)
                    .lineLimit(1)
                Text(subtitle)
                    .font(.caption)
                    .foregroundStyle(PKTheme.text3)
                    .lineLimit(1)
            }
            Spacer(minLength: 0)
        }
    }
}

private struct InspectorActionRow: View {
    let symbol: String
    let title: String
    let subtitle: String
    let selected: Bool
    let action: () -> Void
    @State private var hovering = false

    var body: some View {
        Button(action: action) {
            InspectorRow(symbol: symbol, title: title, subtitle: subtitle)
                .padding(8)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(selected ? PKTheme.primary.opacity(0.11) : PKTheme.control.opacity(hovering ? 0.42 : 0.0))
                .overlay(
                    RoundedRectangle(cornerRadius: 7)
                        .stroke(selected ? PKTheme.primary.opacity(0.36) : PKTheme.edge.opacity(hovering ? 0.72 : 0.0), lineWidth: 1)
                )
                .clipShape(RoundedRectangle(cornerRadius: 7))
        }
        .buttonStyle(.plain)
        .contentShape(RoundedRectangle(cornerRadius: 7))
        .onHover { hovering = $0 }
        .help("Open Chat")
    }
}

private struct TimelineRow: View {
    let title: String
    let subtitle: String
    let tone: Color

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Circle()
                .fill(tone)
                .frame(width: 8, height: 8)
                .padding(.top, 5)
            VStack(alignment: .leading, spacing: 4) {
                Text(title)
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(PKTheme.text)
                Text(subtitle)
                    .font(.caption)
                    .foregroundStyle(PKTheme.text3)
                    .lineLimit(2)
            }
            Spacer()
        }
        .padding(12)
        .background(PKTheme.panelAlt.opacity(0.52))
        .overlay(RoundedRectangle(cornerRadius: 8).stroke(PKTheme.edge, lineWidth: 1))
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }
}

private struct EmptyMiniState: View {
    let title: String
    let subtitle: String

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            Text(title)
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(PKTheme.text2)
            Text(subtitle)
                .font(.caption)
                .foregroundStyle(PKTheme.text3)
                .lineLimit(2)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(12)
        .background(PKTheme.control.opacity(0.42))
        .overlay(RoundedRectangle(cornerRadius: 8).stroke(PKTheme.edge, lineWidth: 1))
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }
}

private struct CountBadge: View {
    var value: Int? = nil
    var text: String? = nil

    var body: some View {
        Text(text ?? "\(value ?? 0)")
            .font(.caption2.weight(.semibold))
            .foregroundStyle(PKTheme.text3)
            .padding(.horizontal, 7)
            .frame(height: 22)
            .background(PKTheme.control.opacity(0.8))
            .overlay(RoundedRectangle(cornerRadius: 6).stroke(PKTheme.edge, lineWidth: 1))
            .clipShape(RoundedRectangle(cornerRadius: 6))
    }
}

private struct StatusPill: View {
    let text: String
    let color: Color

    var body: some View {
        Text(text)
            .font(.caption2.weight(.semibold))
            .foregroundStyle(color)
            .padding(.horizontal, 7)
            .frame(height: 21)
            .background(color.opacity(0.12))
            .overlay(RoundedRectangle(cornerRadius: 5).stroke(color.opacity(0.24), lineWidth: 1))
            .clipShape(RoundedRectangle(cornerRadius: 5))
    }
}

private struct Dot: View {
    let color: Color

    var body: some View {
        Circle()
            .fill(color)
            .frame(width: 7, height: 7)
            .shadow(color: color.opacity(0.4), radius: 4)
    }
}

private struct PrimaryButton: View {
    let title: String
    let systemImage: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Label(title, systemImage: systemImage)
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(PKTheme.primaryText)
                .padding(.horizontal, 13)
                .frame(height: 32)
                .background(PKTheme.primary)
                .clipShape(RoundedRectangle(cornerRadius: 7))
        }
        .buttonStyle(.plain)
    }
}

private struct SecondaryButton: View {
    let title: String
    let systemImage: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Label(title, systemImage: systemImage)
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(PKTheme.text2)
                .padding(.horizontal, 12)
                .frame(height: 32)
                .background(PKTheme.control.opacity(0.78))
                .overlay(RoundedRectangle(cornerRadius: 7).stroke(PKTheme.edge, lineWidth: 1))
                .clipShape(RoundedRectangle(cornerRadius: 7))
        }
        .buttonStyle(.plain)
    }
}

private struct BrandMark: View {
    var size: CGFloat = 34

    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: size * 0.29, style: .continuous)
                .fill(
                    LinearGradient(
                        colors: [
                            PKTheme.primary.opacity(0.98),
                            PKTheme.primary.opacity(0.78),
                            PKTheme.warn.opacity(0.86),
                        ],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    )
                )
                .overlay(
                    RoundedRectangle(cornerRadius: size * 0.29, style: .continuous)
                        .stroke(PKTheme.edgeStrong.opacity(0.74), lineWidth: 1)
                )

            RoundedRectangle(cornerRadius: size * 0.23, style: .continuous)
                .stroke(PKTheme.primaryText.opacity(0.20), lineWidth: 1)
                .padding(size * 0.14)

            ForEach(0..<3, id: \.self) { index in
                Capsule(style: .continuous)
                    .fill(PKTheme.primaryText.opacity(index == 1 ? 0.92 : 0.76))
                    .frame(width: size * 0.13, height: size * (index == 1 ? 0.58 : 0.47))
                    .rotationEffect(.degrees(27))
                    .offset(
                        x: CGFloat(index - 1) * size * 0.16,
                        y: CGFloat(abs(index - 1)) * size * 0.055
                    )
            }

            Circle()
                .fill(PKTheme.primaryText.opacity(0.88))
                .frame(width: size * 0.16, height: size * 0.16)
                .offset(x: size * 0.22, y: -size * 0.24)
        }
        .frame(width: size, height: size)
        .shadow(color: PKTheme.primary.opacity(0.20), radius: size * 0.24, y: size * 0.07)
    }
}

struct AssistantLaunchTemplate: Identifiable, Hashable {
    let id: String
    let title: String
    let subtitle: String
    let badge: String
    let symbol: String
    let agentKind: NativeAgentKind
    let permissionMode: PermissionMode?
    let prompt: String

    init(
        id: String,
        title: String,
        subtitle: String,
        badge: String,
        symbol: String,
        agentKind: NativeAgentKind,
        permissionMode: PermissionMode? = nil,
        prompt: String
    ) {
        self.id = id
        self.title = title
        self.subtitle = subtitle
        self.badge = badge
        self.symbol = symbol
        self.agentKind = agentKind
        self.permissionMode = permissionMode
        self.prompt = assistantLaunchPrompt(prompt, templateId: id)
    }
}

struct AssistantLaunchRecommendation: Hashable {
    let templateId: String
    let reason: String
}

private func assistantLaunchPrompt(_ prompt: String, templateId: String) -> String {
    [
        runFollowUpNonEmpty(prompt),
        runFollowUpNonEmpty(assistantLaunchOutputContract(for: templateId)),
        runFollowUpNonEmpty(assistantLaunchHandoffContract(for: templateId))
    ]
        .compactMap { $0 }
        .joined(separator: "\n\n")
}

private func assistantLaunchOutputContract(for templateId: String) -> String {
    switch templateId {
    case "mac-native-builder":
        return """
        Output contract:
        - Return sections: selected improvement, files changed, validation, and remaining risk.
        - Keep the improvement tied to mac native user efficiency.
        - Do not include unrelated refactors.
        """
    case "terminal-follow-up":
        return """
        Output contract:
        - Return sections: terminal signal, first actionable cause, next command or edit, and verification.
        - Separate confirmed terminal output from assumptions.
        - Keep the next action bound to the selected workspace or work item.
        """
    case "release-check":
        return """
        Output contract:
        - Return sections: checks run, result, go/no-go, blocking risks, and handoff.
        - Include exact commands and the evidence that changes the ship decision.
        - Keep non-blocking observations separate from release blockers.
        """
    case "bug-analysis", "log-analysis", "skill-hardening", "mr-review", "validation", "jira-update", "capture-evidence":
        return runFollowUpOutputContract(for: templateId)
    case "jira-execution":
        return """
        Output contract:
        - Return sections: ticket boundary, implementation seam, change plan, validation, and Jira update.
        - Keep acceptance criteria and source evidence tied to the selected ticket.
        - Ask before external write-back unless the action explicitly succeeds.
        """
    default:
        return """
        Output contract:
        - Return confirmed facts, recommended next action, and verification evidence.
        - Keep assumptions explicit.
        """
    }
}

private func assistantLaunchHandoffContract(for templateId: String) -> String {
    switch templateId {
    case "bug-analysis":
        return """
        Efficiency handoff:
        - End with a ready-to-use bug handoff: reproduction/status, evidence refs, validation command, and the smallest next fix or missing input.
        - Preserve ticket, log, file, and source refs already present in Context.
        - If this should become a durable note or work item output, propose the exact artifact title and body.
        """
    case "mr-review":
        return """
        Efficiency handoff:
        - End with a paste-ready MR review comment when there are findings, or a concise approval note when there are none.
        - Preserve source refs, changed files, validation commands, and residual risk from Context.
        - Keep merge readiness separate from nice-to-have cleanup.
        """
    case "validation":
        return """
        Efficiency handoff:
        - End with a ready-to-paste validation note: checks run, result, evidence, blocker if any, and next action.
        - Preserve pending commands and prior validation evidence from Context without claiming pending checks already ran.
        - If validation fails, stop at the smallest confirmed failure and name the next fix candidate separately.
        """
    case "jira-execution":
        return """
        Efficiency handoff:
        - End with a paste-ready Jira update containing Status, Evidence, Validation, Blockers, and Next action.
        - Preserve acceptance criteria, source refs, external refs, and ticket key from Context.
        - Do not claim Jira was updated unless an external write actually succeeded.
        """
    case "log-analysis":
        return """
        Efficiency handoff:
        - End with the exact next `/logtrace` or `/clickhouse` command when more lookup is needed.
        - Preserve ID fields, source refs, time window, and environment separately.
        - Include a compact phase summary that can be pasted into Jira or a bug handoff.
        """
    case "skill-hardening":
        return """
        Efficiency handoff:
        - End with the improved invocation shape, example commands, validation command, and any SKILL.md/script guardrail change.
        - Preserve environment, credential, and source refs from Context.
        - If the skill should capture durable knowledge, propose the exact note or knowledge-card body.
        """
    default:
        return """
        Efficiency handoff:
        - End with a concise ready-to-use handoff: evidence, validation, blockers, and next action.
        - Preserve source refs and external links already present in Context.
        """
    }
}

let assistantLaunchTemplates: [AssistantLaunchTemplate] = [
    AssistantLaunchTemplate(
        id: "mac-native-builder",
        title: "Mac Native Builder",
        subtitle: "Pick the next small native-client improvement, implement it, and validate the Swift package.",
        badge: "Mac",
        symbol: "macwindow",
        agentKind: .codex,
        prompt: """
        Improve the Pikiclaw mac native client in {project}.

        Pick one practical efficiency or UX improvement from the current context. Keep the change small, preserve existing work, implement it in the macOS app, and validate with the narrowest useful Swift test. If a full app rebuild is needed after several chats have changed code, use the shared macOS build script once instead of starting parallel Swift builds.
        """
    ),
    AssistantLaunchTemplate(
        id: "bug-analysis",
        title: "Bug Analysis Assistant",
        subtitle: "Turn a rough failure report into reproduction, likely seam, smallest fix, and focused validation.",
        badge: "QA",
        symbol: "ladybug",
        agentKind: .codex,
        permissionMode: .readOnly,
        prompt: """
        Analyze the current bug or failure in {project}.

        Work from repo evidence first. Reproduce or locate the likely seam, separate facts from guesses, propose the smallest safe fix, and run focused validation. If the report is underspecified, identify the single most useful missing input instead of expanding scope.
        """
    ),
    AssistantLaunchTemplate(
        id: "mr-review",
        title: "MR Review Assistant",
        subtitle: "Review code changes with findings first, then verification gaps and residual risk.",
        badge: "Review",
        symbol: "checkmark.seal",
        agentKind: .codex,
        permissionMode: .readOnly,
        prompt: """
        Review the current changes in {project}.

        Use a code-review stance: prioritize bugs, regressions, risky behavior, security or data-loss concerns, and missing tests. Present findings first with file and line references when available, then open questions, then a short verification note.
        """
    ),
    AssistantLaunchTemplate(
        id: "validation",
        title: "Validation Assistant",
        subtitle: "Run the smallest useful check, separate pending commands from evidence, and report readiness.",
        badge: "Verify",
        symbol: "checkmark.seal",
        agentKind: .codex,
        permissionMode: .askBeforeEdit,
        prompt: """
        Validate the current work in {project}.

        Start from the selected workspace, work item, and saved context. Prefer the narrowest relevant pending command when one is present; otherwise choose the smallest useful test, build, or manual check. Report exact checks, pass/fail evidence, blockers, and the next action. Do not modify implementation during this validation pass; if a fix is needed, describe it separately.
        """
    ),
    AssistantLaunchTemplate(
        id: "terminal-follow-up",
        title: "Terminal Follow-Up",
        subtitle: "Turn terminal output, failed checks, or a running task into the next concrete agent action.",
        badge: "Run",
        symbol: "terminal",
        agentKind: .codex,
        prompt: """
        Continue from the current terminal or run evidence in {project}.

        Identify the first actionable signal, separate confirmed output from assumptions, propose the next command or code change, and keep the response tied to the selected workspace and work item.
        """
    ),
    AssistantLaunchTemplate(
        id: "log-analysis",
        title: "Log Analysis Assistant",
        subtitle: "Start from explicit IDs, keep session/conversation/trace fields separate, and summarize phases.",
        badge: "Ops",
        symbol: "waveform.path.ecg",
        agentKind: .codex,
        permissionMode: .readOnly,
        prompt: """
        Help me trace a runtime issue from logs in {project}.

        If I provide conversationId, sessionId, traceId, requestId, or taskId, keep those fields distinct. Prefer `/logtrace` for runtime log lookup and `/clickhouse` for trace span, slow span, or error span analysis when a TraceId or ConversationId is available. Build a phase-by-phase summary, compare related calls when useful, and call out field/source ambiguity before guessing.
        """
    ),
    AssistantLaunchTemplate(
        id: "jira-execution",
        title: "Jira Execution Assistant",
        subtitle: "Convert a ticket into repo work with scope, evidence, implementation, and validation.",
        badge: "Jira",
        symbol: "checklist",
        agentKind: .codex,
        permissionMode: .askBeforeEdit,
        prompt: """
        Start from the selected Jira work in {project}.

        Read the ticket context, identify acceptance boundaries, inspect the implementation seam, make the smallest useful change, run focused validation, and preserve the final result plus blockers in the chat transcript.
        """
    ),
    AssistantLaunchTemplate(
        id: "skill-hardening",
        title: "Skill Hardening Assistant",
        subtitle: "Improve a high-frequency skill with crisp invocation, examples, failure behavior, and validation.",
        badge: "Skill",
        symbol: "puzzlepiece.extension",
        agentKind: .codex,
        permissionMode: .askBeforeEdit,
        prompt: """
        Harden a high-frequency Pikiclaw skill in {project}.

        Start from the selected work and current skill inventory. Inspect the skill instructions and scripts before changing behavior, improve invocation speed and parameter clarity, make failure modes easier to recover from, and add focused validation where practical. Preserve source-grounded behavior and avoid installing tools or changing credentials without approval.
        """
    ),
    AssistantLaunchTemplate(
        id: "release-check",
        title: "Release Check Assistant",
        subtitle: "Collect build, test, local smoke, risk, and handoff evidence before shipping.",
        badge: "Ship",
        symbol: "shippingbox",
        agentKind: .codex,
        permissionMode: .readOnly,
        prompt: """
        Run a release-readiness pass for {project}.

        Check the relevant build and tests, inspect the high-risk product surfaces touched by current changes, summarize go/no-go status, and list only the risks that would change the decision.
        """
    )
]

let newChatAssistantQuickLaunchTemplateIDs = [
    "bug-analysis",
    "mr-review",
    "validation",
    "jira-execution",
    "log-analysis",
    "skill-hardening"
]

func newChatAssistantQuickLaunchTemplates() -> [AssistantLaunchTemplate] {
    newChatAssistantQuickLaunchTemplateIDs.compactMap { id in
        assistantLaunchTemplates.first(where: { $0.id == id })
    }
}

func assistantLaunchTemplatesForContext(
    _ templates: [AssistantLaunchTemplate],
    recommendation: AssistantLaunchRecommendation?
) -> [AssistantLaunchTemplate] {
    guard let recommendation,
          let index = templates.firstIndex(where: { $0.id == recommendation.templateId }) else {
        return templates
    }
    var ordered = templates
    let recommended = ordered.remove(at: index)
    ordered.insert(recommended, at: 0)
    return ordered
}

func assistantLaunchRecommendation(
    summary: AssistantLaunchContextSummary,
    workItem: WorkItem?
) -> AssistantLaunchRecommendation? {
    let signalText = assistantRecommendationSignalText(summary)
    if assistantSignalContainsSkillFailure(signalText) {
        return AssistantLaunchRecommendation(templateId: "skill-hardening", reason: "Skill signal")
    }
    if assistantSignalContainsLogSignal(signalText) {
        return AssistantLaunchRecommendation(templateId: "log-analysis", reason: "Log lookup")
    }
    if summary.pendingCommandCount > 0 {
        return AssistantLaunchRecommendation(templateId: "validation", reason: "Pending check")
    }
    if assistantSignalContainsBlockingSignal(signalText) {
        return AssistantLaunchRecommendation(templateId: "bug-analysis", reason: "Blocked output")
    }
    if summary.validationEvidenceCount > 0 || summary.decisionSignalCount > 0 || summary.actionableNoteCount > 0 {
        return AssistantLaunchRecommendation(templateId: "mr-review", reason: "Review-ready context")
    }
    if workItem?.sourceType == .jira || workItem?.jira != nil {
        return AssistantLaunchRecommendation(templateId: "jira-execution", reason: "Selected Jira")
    }
    return nil
}

private func assistantRecommendationSignalText(_ summary: AssistantLaunchContextSummary) -> String {
    (summary.pendingCommands + summary.validationEvidence + summary.decisionSignals + summary.actionableNotes)
        .joined(separator: "\n")
        .lowercased()
}

private func assistantSignalContainsSkillFailure(_ text: String) -> Bool {
    guard text.contains("skill")
        || text.contains("skill.md")
        || text.contains("iva_logtracer")
        || text.contains("/logtrace")
        || text.contains("/clickhouse") else {
        return false
    }
    return text.contains("failed")
        || text.contains("failure")
        || text.contains("missing")
        || text.contains("not found")
        || text.contains("cannot")
        || text.contains("unable")
}

private func assistantSignalContainsLogSignal(_ text: String) -> Bool {
    text.contains("/logtrace")
        || text.contains("/clickhouse")
        || text.contains("conversationid")
        || text.contains("sessionid")
        || text.contains("traceid")
        || text.contains("requestid")
        || text.contains("taskid")
}

private func assistantSignalContainsBlockingSignal(_ text: String) -> Bool {
    text.contains("blocker")
        || text.contains("blocked")
        || text.contains("not ready")
        || text.contains("request changes")
        || text.contains("failed")
        || text.contains("failure")
        || text.contains("risk:")
        || text.contains("missing")
}

func assistantTemplatePermissionMode(
    _ template: AssistantLaunchTemplate,
    current: PermissionMode
) -> PermissionMode {
    template.permissionMode ?? current
}

func workItemOutputs(for item: WorkItem?, snapshot: NativeStoreSnapshot) -> [Artifact] {
    guard let item else { return [] }
    return snapshot.artifacts
        .filter { $0.workItemId == item.id }
        .sorted { $0.createdAt > $1.createdAt }
}

func artifactSourceRun(_ artifact: Artifact, snapshot: NativeStoreSnapshot) -> AgentRun? {
    if let runId = artifact.runId,
       let run = snapshot.runs.first(where: { $0.id == runId }) {
        return run
    }
    let prefix = "pikiclaw://runs/"
    guard let uri = artifact.sourceRefs.first(where: { $0.kind == "chat-run" })?.uri,
          uri.hasPrefix(prefix) else {
        return nil
    }
    let rawRunId = String(uri.dropFirst(prefix.count))
    return snapshot.runs.first(where: { $0.id.rawValue == rawRunId })
}

func artifactWorkItem(_ artifact: Artifact, snapshot: NativeStoreSnapshot) -> WorkItem? {
    guard let workItemId = artifact.workItemId else { return nil }
    return snapshot.workItems.first(where: { $0.id == workItemId })
}

func artifactDisplaySubtitle(_ artifact: Artifact, sourceRun: AgentRun?) -> String {
    var parts = [
        artifact.kind.rawValue,
        artifact.status.rawValue
    ]
    if let sourceRun {
        parts.append("chat \(sourceRun.state.rawValue)")
    }
    return parts.joined(separator: " - ")
}

func artifactKindLabel(_ kind: ArtifactKind) -> String {
    switch kind {
    case .commandOutputSummary:
        return "output"
    case .markdownReport:
        return "report"
    case .obsidianNote:
        return "note"
    case .generatedCode:
        return "code"
    case .verificationResult:
        return "verify"
    default:
        return kind.rawValue
    }
}

func artifactCreatedLabel(_ artifact: Artifact) -> String {
    artifact.createdAt.formatted(date: .abbreviated, time: .shortened)
}

func artifactURIKind(_ artifact: Artifact) -> String {
    let value = artifact.uri.trimmingCharacters(in: .whitespacesAndNewlines)
    if value.hasPrefix("pikiclaw://") { return "Pikiclaw" }
    if value.hasPrefix("obsidian://") { return "Obsidian" }
    if value.hasPrefix("http://") || value.hasPrefix("https://") { return "Link" }
    if value.hasPrefix("/") || value.hasPrefix("~") { return "File" }
    return value.isEmpty ? "No URI" : "URI"
}

func artifactSourceLabel(_ run: AgentRun, workItem: WorkItem?) -> String {
    if let workItem {
        return workItem.title.firstLineFallback("Task")
    }
    return run.promptSnapshot.firstLineFallback("Chat")
}

func artifactClipboardSummary(artifact: Artifact, run: AgentRun?, workItem: WorkItem?) -> String {
    var lines = [
        "Output: \(artifact.title)",
        "Kind: \(artifact.kind.rawValue)",
        "Status: \(artifact.status.rawValue)"
    ]
    if let workItem {
        lines.append("Work item: \(workItem.title)")
    }
    if let run {
        lines.append("Source chat: \(run.promptSnapshot.firstLineFallback("Chat"))")
        lines.append("Source run: \(run.id.rawValue)")
    }
    if !artifact.uri.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
        lines.append("URI: \(artifact.uri)")
    }
    let signalLines = artifactSignalSummaryLines(artifact: artifact, run: run)
    if !signalLines.isEmpty {
        lines.append("")
        lines.append("Output signals:")
        lines.append(contentsOf: signalLines)
    }
    let provenance = artifact.provenance.trimmingCharacters(in: .whitespacesAndNewlines)
    if !provenance.isEmpty {
        lines.append("")
        lines.append("Evidence:")
        lines.append(provenance)
    }
    let refs = dedupedSourceRefs(artifact.sourceRefs + (workItem?.sourceRefs ?? []))
    if !refs.isEmpty {
        lines.append("")
        lines.append("Source refs:")
        for ref in refs.prefix(8) {
            let suffix = ref.uri.map { " \($0)" } ?? ""
            lines.append("- [\(ref.kind)] \(ref.label)\(suffix)")
        }
    }
    return lines.joined(separator: "\n")
}

private func artifactSignalSummaryLines(artifact: Artifact, run: AgentRun?) -> [String] {
    let output = artifact.provenance.gitTrimmed
    guard !output.isEmpty else { return [] }

    var lines: [String] = []
    let decisionSignals = runFollowUpDecisionSignals(from: output)
    if !decisionSignals.isEmpty {
        lines.append("Decision signals: \(decisionSignals.joined(separator: "; "))")
    }

    let actionableNotes = runFollowUpActionableNotes(from: output)
    if !actionableNotes.isEmpty {
        lines.append("Actionable notes: \(actionableNotes.joined(separator: "; "))")
    }

    let validationEvidence = runFollowUpValidationEvidence(from: output)
    if !validationEvidence.isEmpty {
        lines.append("Validation evidence: \(validationEvidence.joined(separator: "; "))")
    }

    if let run {
        let nextCommands = runFollowUpNextCommands(run: run, output: output)
        if !nextCommands.isEmpty {
            lines.append("Next commands: \(nextCommands.joined(separator: "; "))")
        }
    }

    return lines
}

func artifactFollowUpPrompt(artifact: Artifact, run: AgentRun?, workItem: WorkItem?) -> String {
    let target = workItem?.title.firstLineFallback("this work item")
        ?? run?.promptSnapshot.firstLineFallback("this chat")
        ?? artifact.title.firstLineFallback("this output")
    let summary = artifactClipboardSummary(artifact: artifact, run: run, workItem: workItem)
    let jiraKey = workItem?.jira?.key ?? workItem?.sourceRefs.first(where: { $0.kind == "jira" })?.label
    let isJira = workItem?.sourceType == .jira || jiraKey != nil
    let isReviewOutput = artifact.kind == .pullRequest || artifact.kind == .reviewComment || workItem?.state == .review
    let instruction: String
    if isJira {
        instruction = """
        Prepare a Jira-ready update for \(target).

        Use the saved evidence below. Separate confirmed facts from guesses, include validation status, blockers, and next concrete action, and keep the result concise enough to paste as a Jira comment. If the evidence points to a failure, identify the smallest next debug or fix step.
        """
    } else if isReviewOutput {
        instruction = """
        Prepare an MR-ready review note for \(target).

        Use the saved evidence below. Lead with actionable findings and risk, include file or source references when present, call out verification status, and end with a concise merge recommendation. Keep it short enough to paste into a merge request review.
        """
    } else {
        instruction = """
        Continue from this saved output for \(target).

        Use the saved evidence below. Decide the next highest-leverage action: validate, debug, review, or turn it into a durable note. Separate confirmed facts from guesses, preserve source refs, and propose only the smallest concrete next step.
        """
    }

    return """
    \(instruction)

    Saved output:
    \(summary)
    """
}

private func dedupedSourceRefs(_ refs: [SourceRef]) -> [SourceRef] {
    var seen = Set<String>()
    var out: [SourceRef] = []
    for ref in refs {
        let key = "\(ref.kind)|\(ref.label)|\(ref.uri ?? "")"
        guard !seen.contains(key) else { continue }
        seen.insert(key)
        out.append(ref)
    }
    return out
}

private func artifactOutputSymbol(_ kind: ArtifactKind) -> String {
    switch kind {
    case .patch, .generatedCode:
        return "curlybraces"
    case .pullRequest, .reviewComment:
        return "checkmark.seal"
    case .markdownReport, .obsidianNote, .document:
        return "doc.text"
    case .screenshot:
        return "photo"
    case .traceBundle:
        return "waveform.path.ecg"
    case .verificationResult:
        return "testtube.2"
    case .commandOutputSummary:
        return "archivebox"
    }
}

private func artifactStatusColor(_ status: ArtifactStatus) -> Color {
    switch status {
    case .ready, .verified:
        return PKTheme.ok
    case .failed:
        return PKTheme.err
    case .superseded:
        return PKTheme.text4
    case .draft:
        return PKTheme.primary
    }
}

private func sourceLabel(_ source: WorkItemSourceType) -> String {
    switch source {
    case .manualPrompt: "Manual"
    case .todo: "Todo"
    case .jira: "Jira"
    case .note: "Note"
    case .chatSelection: "Chat"
    case .git: "Git"
    case .fileEvidence: "File"
    case .scheduledAutomation: "Schedule"
    case .connectorImport: "Connector"
    case .voiceDelegation: "Voice"
    case .goal: "Goal"
    }
}

private func statusColor(_ state: WorkItemState) -> Color {
    switch state {
    case .active, .done: PKTheme.ok
    case .blocked, .review: PKTheme.warn
    case .cancelled: PKTheme.err
    default: PKTheme.text3
    }
}

private func permissionLabel(_ mode: PermissionMode) -> String {
    switch mode {
    case .readOnly: "Read"
    case .askBeforeEdit: "Ask"
    case .autopilot: "Autopilot"
    }
}

private func initials(_ name: String) -> String {
    let parts = name.split(separator: " ").prefix(2)
    let text = parts.compactMap { $0.first }.map(String.init).joined()
    return text.isEmpty ? "PK" : text.uppercased()
}

private let agentDockKinds: [NativeAgentKind] = [
    .codex,
    .cursor,
    .githubCopilot,
    .gemini,
    .hermes,
    .claude,
]

private func enabledAgentProfiles(in snapshot: NativeStoreSnapshot) -> [AgentProfile] {
    let byKind = Dictionary(uniqueKeysWithValues: snapshot.agentProfiles.map { ($0.kind, $0) })
    let orderedKinds = Set(agentDockKinds)
    let ordered = agentDockKinds.compactMap { kind -> AgentProfile? in
        guard let profile = byKind[kind], profile.isEnabled else { return nil }
        return profile
    }
    let extras = snapshot.agentProfiles.filter { profile in
        profile.isEnabled && !orderedKinds.contains(profile.kind)
    }
    return ordered + extras
}

private func isLiveRunState(_ state: RunState) -> Bool {
    switch state {
    case .queued, .starting, .running, .waitingForUser, .cancelling:
        return true
    case .completed, .failed, .cancelled, .stale, .draft:
        return false
    }
}

private func agentCapability(for profile: AgentProfile, snapshot: NativeStoreSnapshot) -> Capability? {
    snapshot.capabilities.first { capability in
        capability.name.localizedCaseInsensitiveContains(profile.displayName)
            || profile.displayName.localizedCaseInsensitiveContains(capability.name.replacingOccurrences(of: " CLI", with: ""))
            || capability.name.localizedCaseInsensitiveContains(profile.executableName)
    }
}

private func agentHealthColor(_ health: CapabilityHealthState?) -> Color {
    switch health {
    case .healthy:
        return PKTheme.ok
    case .needsConfiguration, .unknown, nil:
        return PKTheme.warn
    case .unavailable, .failed:
        return PKTheme.err
    }
}

private func agentHealthText(_ health: CapabilityHealthState?) -> String {
    switch health {
    case .healthy:
        return "Ready"
    case .needsConfiguration, .unknown, nil:
        return "Check setup"
    case .unavailable, .failed:
        return "Missing"
    }
}

private func agentDockHelp(profile: AgentProfile, active: Bool, attentionCount: Int, snapshot: NativeStoreSnapshot) -> String {
    if attentionCount > 0 {
        return "\(profile.displayName) · \(attentionCount) run(s) need attention"
    }
    if active {
        return "\(profile.displayName) · running"
    }
    return "\(profile.displayName) · \(agentHealthText(agentCapability(for: profile, snapshot: snapshot)?.healthState))"
}

private func enterpriseModeColor(_ mode: AgentEnterpriseCapabilityMode) -> Color {
    switch mode {
    case .native:
        return PKTheme.ok
    case .portable:
        return PKTheme.primary
    case .unsupported, .missing:
        return PKTheme.warn
    case .disabled:
        return PKTheme.text3
    }
}

private func enterpriseReadinessColor(_ row: EnterpriseReadinessRow) -> Color {
    if row.attention > 0 {
        return row.ready > 0 ? PKTheme.warn : PKTheme.err
    }
    return row.ready > 0 ? PKTheme.ok : PKTheme.text3
}

private func agentDisplayName(_ kind: NativeAgentKind) -> String {
    switch kind {
    case .claude: return "Claude Code"
    case .codex: return "Codex"
    case .cursor: return "Cursor Agent"
    case .gemini: return "Gemini CLI"
    case .githubCopilot: return "GitHub Copilot"
    case .hermes: return "Hermes"
    case .customCLI: return "Custom CLI"
    }
}

private func agentShortLabel(_ kind: NativeAgentKind) -> String {
    switch kind {
    case .claude: return "Claude"
    case .codex: return "Codex"
    case .cursor: return "Cursor"
    case .gemini: return "Gemini"
    case .githubCopilot: return "Copilot"
    case .hermes: return "Hermes"
    case .customCLI: return "CLI"
    }
}

private func agentSymbol(_ kind: NativeAgentKind) -> String {
    switch kind {
    case .claude: return "sparkles"
    case .codex: return "curlybraces"
    case .cursor: return "cursorarrow.click"
    case .gemini: return "diamond"
    case .githubCopilot: return "person.crop.square"
    case .hermes: return "bolt"
    case .customCLI: return "chevron.left.forwardslash.chevron.right"
    }
}

private func agentTint(_ kind: NativeAgentKind) -> Color {
    switch kind {
    case .codex: return PKTheme.primary
    case .cursor: return Color(red: 0.58, green: 0.70, blue: 1.00)
    case .githubCopilot: return Color(red: 0.74, green: 0.86, blue: 0.70)
    case .gemini: return Color(red: 0.72, green: 0.64, blue: 1.00)
    case .hermes: return Color(red: 0.98, green: 0.80, blue: 0.36)
    case .claude: return Color(red: 0.94, green: 0.62, blue: 0.42)
    case .customCLI: return PKTheme.text3
    }
}

private func agentConfigFiles(for kind: NativeAgentKind) -> [String] {
    switch kind {
    case .codex:
        return ["auth.json", "config.toml", "AGENTS.md"]
    case .claude:
        return ["settings.json", ".claude.json", "CLAUDE.md"]
    case .cursor:
        return ["settings.json", ".cursor/rules"]
    case .githubCopilot:
        return ["gh auth", "copilot"]
    case .gemini:
        return ["settings.json", ".gemini"]
    case .hermes:
        return ["hermes.yaml", "providers"]
    case .customCLI:
        return ["command", "env"]
    }
}

private func agentConfigPreview(profile: AgentProfile?, provider: ProviderProfile?, workspace: Workspace?) -> String {
    guard let profile else {
        return "Select an agent profile to inspect its install, auth, config, and launch boundary."
    }

    let providerText = provider?.displayName ?? "agent-default"
    let modelText = provider?.defaultModel ?? "agent-default"
    let workspaceText = workspace?.pathDisplay ?? "~/workspace"
    let permissionText = permissionLabel(profile.defaultPermissionMode)

    switch profile.kind {
    case .codex:
        return """
        [agent]
        executable = "\(profile.executableName)"
        provider = "\(providerText)"
        model = "\(modelText)"
        permission = "\(permissionText)"

        [workspace]
        path = "\(workspaceText)"
        """
    case .claude:
        return """
        {
          "executable": "\(profile.executableName)",
          "permissionMode": "\(permissionText)",
          "workspace": "\(workspaceText)"
        }
        """
    case .githubCopilot:
        return """
        gh auth status
        gh copilot suggest "<prompt>"

        workspace: \(workspaceText)
        permission: \(permissionText)
        """
    default:
        return """
        executable: \(profile.executableName)
        provider: \(providerText)
        model: \(modelText)
        permission: \(permissionText)
        workspace: \(workspaceText)
        """
    }
}

private func shortDisplayPath(_ path: String) -> String {
    let trimmed = path.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty else { return "Workspace root" }
    let home = FileManager.default.homeDirectoryForCurrentUser.path
    let normalized = trimmed.hasPrefix(home) ? "~" + trimmed.dropFirst(home.count) : Substring(trimmed)
    let parts = normalized.split(separator: "/", omittingEmptySubsequences: true)
    guard parts.count > 3 else { return String(normalized) }
    return "…/" + parts.suffix(3).joined(separator: "/")
}

private func jiraRefLabel(_ ref: SourceRef) -> String {
    let kind = ref.kind.trimmingCharacters(in: .whitespacesAndNewlines)
    let label = ref.label.trimmingCharacters(in: .whitespacesAndNewlines)
    let uri = ref.uri?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    let primary = label.isEmpty ? (uri.isEmpty ? kind : uri) : label
    guard !kind.isEmpty, kind.localizedCaseInsensitiveCompare(primary) != .orderedSame else {
        return primary
    }
    return "\(kind) · \(primary)"
}

private func agentKind(for run: AgentRun, snapshot: NativeStoreSnapshot) -> NativeAgentKind {
    snapshot.agentProfiles.first(where: { $0.id == run.agentProfileId })?.kind ?? .codex
}

private func workspaceName(for id: EntityID, snapshot: NativeStoreSnapshot) -> String {
    snapshot.workspaces.first(where: { $0.id == id })?.name ?? "Workspace"
}

private func projectTitle(for workspaceId: EntityID?, snapshot: NativeStoreSnapshot) -> String {
    guard let workspaceId else {
        return snapshot.projects.first?.name ?? snapshot.workspaces.first?.name ?? "Project"
    }
    if let project = snapshot.projects.first(where: { $0.workspaceIds.contains(workspaceId) }) {
        return project.name
    }
    return snapshot.workspaces.first(where: { $0.id == workspaceId })?.name ?? "Project"
}

private func branchTitle(for workspaceId: EntityID?, snapshot: NativeStoreSnapshot) -> String? {
    let workspace = workspaceId.flatMap { id in
        snapshot.workspaces.first(where: { $0.id == id })
    } ?? snapshot.workspaces.first
    guard let branch = workspace?.currentBranch?.trimmingCharacters(in: .whitespacesAndNewlines),
          !branch.isEmpty else {
        return nil
    }
    return branch
}

private func permissionTitle(_ mode: PermissionMode) -> String {
    switch mode {
    case .readOnly: return "Read"
    case .askBeforeEdit: return "Ask"
    case .autopilot: return "Autopilot"
    }
}

private func copyTextToPasteboard(_ text: String) {
    NSPasteboard.general.clearContents()
    NSPasteboard.general.setString(text, forType: .string)
}

private extension String {
    var gitTrimmed: String {
        trimmingCharacters(in: .whitespacesAndNewlines)
    }

    func firstLineFallback(_ fallback: String) -> String {
        let first = split(whereSeparator: \.isNewline).first.map(String.init) ?? ""
        let trimmed = first.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? fallback : String(trimmed.prefix(80))
    }
}
