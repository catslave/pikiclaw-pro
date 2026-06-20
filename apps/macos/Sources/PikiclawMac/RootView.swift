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
                    isVoiceSelected: voiceOverlayOpen || route == .voice,
                    openProjects: { navigate(.projects) },
                    addProject: chooseWorkspace,
                    selectAgent: { kind in
                        closeVoiceOverlay()
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
            Task {
                await model.createWorkItem(workspaceId: selectedWorkspaceId)
                selectedWorkItemId = model.snapshot.workItems.first?.id
                route = .workItems
            }
        }
        .onReceive(NotificationCenter.default.publisher(for: .pikiclawAddWorkspace)) { _ in
            chooseWorkspace()
        }
        .onReceive(NotificationCenter.default.publisher(for: .pikiclawRunSelectedWork)) { _ in
            Task { await model.run(workItemId: selectedWorkItemId) }
        }
        .onReceive(NotificationCenter.default.publisher(for: .pikiclawRestartApplication)) { _ in
            model.restartApplication()
        }
        .onReceive(NotificationCenter.default.publisher(for: .pikiclawFocusCommandCenter)) { _ in
            route = .chat
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
            WorkflowPage(snapshot: model.snapshot, runWorkflow: {
                route = .chat
                model.draftPrompt = "Run the selected Pikiclaw workflow and keep source evidence attached."
                commandFocused = true
            })
        case .missionControl:
            MissionControlPage(snapshot: model.snapshot)
        case .agents:
            AgentStudioPage(snapshot: model.snapshot, selectedAgentKind: $model.selectedAgentKind)
        case .channels, .assistants, .team, .extensions, .settings:
            SystemSurfacePage(
                route: route,
                snapshot: model.snapshot,
                statusLine: model.statusLine,
                restartBlocked: model.restartBlockedByActiveRun,
                restart: { model.restartApplication() }
            )
        }
    }

    private func navigate(_ next: NativeRoute) {
        if next == .voice {
            openVoiceAssistant(autoStart: true)
            return
        }
        closeVoiceOverlay()
        route = next
    }

    private func openNewChat() {
        closeVoiceOverlay()
        route = .chat
        model.prepareNewChat()
        Task { await model.refreshBranches(for: selectedWorkspace) }
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
        assistantDockOpen = false
        commandFocused = false
        Task { await model.refreshBranches(for: selectedWorkspace) }
    }

    private func chooseWorkspace() {
        closeVoiceOverlay()
        let panel = NSOpenPanel()
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.allowsMultipleSelection = false
        panel.prompt = "Add Workspace"
        if panel.runModal() == .OK, let url = panel.url {
            Task {
                await model.addWorkspace(path: url.path)
                selectedWorkspaceId = model.snapshot.workspaces.first(where: { $0.pathDisplay == url.path })?.id
                route = .projects
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
    let isVoiceSelected: Bool
    let openProjects: () -> Void
    let addProject: () -> Void
    let selectAgent: (NativeAgentKind) -> Void
    let newChat: () -> Void
    let openVoice: () -> Void
    let openTerminal: () -> Void
    let openAgentStudio: () -> Void
    let openMissionControl: () -> Void

    var body: some View {
        VStack(spacing: 12) {
            BrandMark(size: 46)
                .padding(.top, 12)

            Button(action: newChat) {
                Image(systemName: "plus")
                    .font(.system(size: 16, weight: .semibold))
                    .frame(width: 42, height: 42)
                    .background(PKTheme.primary)
                    .foregroundStyle(PKTheme.primaryText)
                    .clipShape(RoundedRectangle(cornerRadius: 10))
            }
            .buttonStyle(.plain)
            .help("New Chat")

            Button(action: openVoice) {
                VoiceDockButton(isLive: isRunning, isSelected: isVoiceSelected)
            }
            .buttonStyle(.plain)
            .help("Voice Lens")

            ProjectDockTile(
                snapshot: snapshot,
                selectedWorkspaceId: $selectedWorkspaceId,
                openProjects: openProjects,
                addProject: addProject
            )

            Divider()
                .overlay(PKTheme.edge)
                .padding(.horizontal, 16)

            VStack(spacing: 8) {
                ForEach(enabledAgentProfiles(in: snapshot)) { profile in
                    let kind = profile.kind
                    Button {
                        selectAgent(kind)
                    } label: {
                        VStack(spacing: 4) {
                            Image(systemName: agentSymbol(kind))
                                .font(.system(size: 15, weight: .semibold))
                            Text(agentShortLabel(kind))
                                .font(.system(size: 9, weight: .semibold))
                                .lineLimit(1)
                                .minimumScaleFactor(0.7)
                        }
                        .frame(width: 54, height: 52)
                        .foregroundStyle(selectedAgentKind == kind ? PKTheme.primaryText : PKTheme.text3)
                        .background(selectedAgentKind == kind ? agentTint(kind) : PKTheme.panel.opacity(0.54))
                        .overlay(
                            RoundedRectangle(cornerRadius: 11)
                                .stroke(selectedAgentKind == kind ? agentTint(kind).opacity(0.95) : PKTheme.edge, lineWidth: 1)
                        )
                        .clipShape(RoundedRectangle(cornerRadius: 11))
                    }
                    .buttonStyle(.plain)
                    .help(profile.displayName)
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
                Image(systemName: "gauge.with.dots.needle.67percent")
                    .font(.system(size: 15, weight: .semibold))
                    .frame(width: 42, height: 42)
                    .background(PKTheme.panel.opacity(0.62))
                    .foregroundStyle(isRunning ? PKTheme.ok : PKTheme.text3)
                    .overlay(RoundedRectangle(cornerRadius: 10).stroke(PKTheme.edge, lineWidth: 1))
                    .clipShape(RoundedRectangle(cornerRadius: 10))
            }
            .buttonStyle(.plain)
            .help(statusLine)

            Dot(color: isRunning ? PKTheme.ok : PKTheme.primary)
                .padding(.bottom, 12)
        }
        .frame(width: 82)
        .background(PKTheme.sidebar)
    }
}

private struct ProjectDockTile: View {
    let snapshot: NativeStoreSnapshot
    @Binding var selectedWorkspaceId: EntityID?
    let openProjects: () -> Void
    let addProject: () -> Void

    private var selectedTitle: String {
        projectTitle(for: selectedWorkspaceId, snapshot: snapshot)
    }

    private var hasSelection: Bool {
        selectedWorkspaceId != nil || !snapshot.projects.isEmpty || !snapshot.workspaces.isEmpty
    }

    var body: some View {
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
            .foregroundStyle(hasSelection ? PKTheme.primary : PKTheme.text3)
            .background(PKTheme.panel.opacity(0.54))
            .overlay(
                RoundedRectangle(cornerRadius: 11)
                    .stroke(hasSelection ? PKTheme.primary.opacity(0.56) : PKTheme.edge, lineWidth: 1)
            )
            .clipShape(RoundedRectangle(cornerRadius: 11))
        }
        .buttonStyle(.plain)
        .contextMenu {
            Button("Open Projects", systemImage: "folder", action: openProjects)
            Button("Add Project...", systemImage: "plus", action: addProject)
        }
        .help("Project: \(selectedTitle)")
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
                    Text(isRunning ? "运行中" : "运行中")
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
            if chatHistoryVisible {
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
                    },
                    selectSideRun: { parent, child in
                        model.activeRunId = parent.id
                        focusedSideRunId = child.id
                        hiddenSideRunIds.remove(child.id)
                        trimVisibleSideRuns(parentId: parent.id, keeping: child.id)
                        selectedWorkspaceId = child.workspaceId
                        selectedWorkItemId = child.workItemId
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
                if !chatHistoryVisible {
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
            paneLabel: isParent ? "Parent" : "Side",
            newChat: newChat,
            newSideChat: nil,
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

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 10) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(agentDisplayName(selectedAgentKind))
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundStyle(PKTheme.text)
                    Text("Chat history")
                        .font(.caption)
                        .foregroundStyle(PKTheme.text3)
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
                        ConversationMessageBubble(
                            title: "You",
                            subtitle: workspace?.name ?? "Project",
                            text: run.promptSnapshot,
                            symbol: "person.crop.circle",
                            accent: accent,
                            trailing: true
                        )

                        AssistantResponseCard(
                            title: agentName,
                            text: run.transcript.isEmpty ? "No assistant output yet." : run.transcript,
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
    var commandFocused: FocusState<Bool>.Binding
    @ObservedObject var model: NativeAppModel
    let openTerminal: () -> Void
    let send: () -> Void
    @State private var selectedMode: NewChatMode = .engineering

    private var selectedWorkspace: Workspace? {
        snapshot.workspaces.first(where: { $0.id == selectedWorkspaceId }) ?? snapshot.workspaces.first
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                NewChatAgentRail(
                    selectedAgentKind: $model.selectedAgentKind,
                    availableProfiles: enabledAgentProfiles(in: snapshot)
                )

                NewChatHero(
                    snapshot: snapshot,
                    selectedWorkspaceId: selectedWorkspaceId,
                    selectedAgentKind: model.selectedAgentKind,
                    selectedMode: $selectedMode,
                    isRunning: model.isRunning
                )

                NewChatCategoryStrip(mode: selectedMode) { action in
                    applyPrompt(action.prompt)
                }

                MinimalChatComposer(
                    snapshot: snapshot,
                    selectedWorkspaceId: $selectedWorkspaceId,
                    selectedPermissionMode: $model.selectedPermissionMode,
                    text: $model.draftPrompt,
                    placeholder: "\(selectedMode.placeholder) \(agentShortLabel(model.selectedAgentKind)) what you need...",
                    focused: commandFocused,
                    selectedAgentKind: model.selectedAgentKind,
                    isRunning: model.isRunning,
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

                NewChatTemplateGallery(mode: selectedMode) { template in
                    applyPrompt(template.prompt)
                }
            }
            .frame(maxWidth: 980, alignment: .leading)
            .padding(.vertical, 36)
            .frame(maxWidth: .infinity)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .task(id: selectedWorkspace?.id) {
            await model.refreshBranches(for: selectedWorkspace)
        }
    }

    private func applyPrompt(_ prompt: String) {
        let project = projectTitle(for: selectedWorkspaceId, snapshot: snapshot)
        model.draftPrompt = prompt
            .replacingOccurrences(of: "{project}", with: project)
            .replacingOccurrences(of: "{agent}", with: agentShortLabel(model.selectedAgentKind))
        commandFocused.wrappedValue = true
    }
}

private struct NewChatHero: View {
    let snapshot: NativeStoreSnapshot
    let selectedWorkspaceId: EntityID?
    let selectedAgentKind: NativeAgentKind
    @Binding var selectedMode: NewChatMode
    let isRunning: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            HStack(alignment: .top, spacing: 18) {
                VStack(alignment: .leading, spacing: 7) {
                    Text(greeting)
                        .font(.system(size: 34, weight: .semibold))
                        .foregroundStyle(PKTheme.text)
                        .lineLimit(1)
                        .minimumScaleFactor(0.78)
                    Text(observation)
                        .font(.system(size: 15, weight: .medium))
                        .foregroundStyle(PKTheme.text3)
                        .lineLimit(2)
                }

                Spacer(minLength: 0)

                if let branch = branchTitle(for: selectedWorkspaceId, snapshot: snapshot) {
                    NewChatFocusPill(
                        title: branch,
                        subtitle: "Current branch",
                        tint: PKTheme.primary
                    )
                }
            }

            NewChatModePicker(selectedMode: $selectedMode)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var greeting: String {
        let hour = Calendar.current.component(.hour, from: Date())
        let name = NSFullUserName().split(separator: " ").first.map(String.init) ?? "Michael"
        switch hour {
        case 5..<12:
            return "Good morning, \(name)"
        case 12..<18:
            return "Good afternoon, \(name)"
        default:
            return "Good evening, \(name)"
        }
    }

    private var observation: String {
        if isRunning || runningRuns > 0 {
            return "\(agentShortLabel(selectedAgentKind)) is already moving. I can keep the next step in \(projectTitle(for: selectedWorkspaceId, snapshot: snapshot))."
        }
        if failedRuns >= 3 {
            return "\(agentShortLabel(selectedAgentKind)) has a few recent failed runs. Tiny hint: setup may want a quick look before the next send."
        }
        if snapshot.workItems.contains(where: { $0.state == .active }) {
            return "I found active work nearby. Pick a mode, choose a project, then say the outcome."
        }
        return "\(projectTitle(for: selectedWorkspaceId, snapshot: snapshot)) is ready. Say the outcome and I will route the work."
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

    private var runPulse: String {
        if isRunning || runningRuns > 0 { return "Live run" }
        if failedRuns > 0 { return "\(failedRuns) failed" }
        return "Ready"
    }

    private var runTint: Color {
        if isRunning || runningRuns > 0 { return PKTheme.ok }
        if failedRuns > 0 { return PKTheme.err }
        return PKTheme.text3
    }

    private var focusTitle: String {
        if isRunning || runningRuns > 0 { return "Live run" }
        if failedRuns > 0 { return "\(failedRuns) needs review" }
        return "\(snapshot.workItems.filter { $0.state == .active }.count) active items"
    }

    private var focusSubtitle: String {
        if isRunning || runningRuns > 0 { return "Agent is working" }
        if failedRuns > 0 { return "Recent failures" }
        return selectedMode.title
    }
}

private struct NewChatFocusPill: View {
    let title: String
    let subtitle: String
    let tint: Color

    var body: some View {
        HStack(spacing: 9) {
            Image(systemName: "scope")
                .font(.system(size: 14, weight: .semibold))
                .frame(width: 28, height: 28)
                .foregroundStyle(PKTheme.primaryText)
                .background(tint)
                .clipShape(Circle())

            VStack(alignment: .leading, spacing: 1) {
                Text(title)
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(PKTheme.text)
                    .lineLimit(1)
                Text(subtitle)
                    .font(.system(size: 10, weight: .medium))
                    .foregroundStyle(PKTheme.text3)
                    .lineLimit(1)
            }

            Image(systemName: "chevron.right")
                .font(.system(size: 10, weight: .bold))
                .foregroundStyle(PKTheme.text4)
        }
        .padding(.leading, 8)
        .padding(.trailing, 11)
        .frame(height: 44)
        .background(PKTheme.surfaceRaised.opacity(0.86))
        .overlay(RoundedRectangle(cornerRadius: 8).stroke(PKTheme.edge, lineWidth: 1))
        .clipShape(RoundedRectangle(cornerRadius: 8))
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

private struct NewChatModePicker: View {
    @Binding var selectedMode: NewChatMode

    var body: some View {
        HStack(spacing: 0) {
            ForEach(NewChatMode.allCases) { mode in
                Button {
                    selectedMode = mode
                } label: {
                    HStack(spacing: 7) {
                        Image(systemName: mode.symbol)
                            .font(.system(size: 12, weight: .semibold))
                        Text(mode.title)
                            .font(.system(size: 12, weight: .semibold))
                    }
                    .foregroundStyle(selectedMode == mode ? PKTheme.primaryText : PKTheme.text2)
                    .padding(.horizontal, 14)
                    .frame(height: 34)
                    .background(selectedMode == mode ? PKTheme.primary : Color.clear)
                    .clipShape(RoundedRectangle(cornerRadius: 8))
                }
                .buttonStyle(.plain)
            }
        }
        .padding(3)
        .background(PKTheme.control.opacity(0.92))
        .overlay(RoundedRectangle(cornerRadius: 8).stroke(PKTheme.edge, lineWidth: 1))
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }
}

private struct NewChatAgentRail: View {
    @Binding var selectedAgentKind: NativeAgentKind
    let availableProfiles: [AgentProfile]

    private var enabledKinds: Set<NativeAgentKind> {
        Set(availableProfiles.map(\.kind))
    }

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(agentDockKinds, id: \.self) { kind in
                    let isEnabled = enabledKinds.isEmpty || enabledKinds.contains(kind)
                    Button {
                        selectedAgentKind = kind
                    } label: {
                        HStack(spacing: 7) {
                            Image(systemName: agentSymbol(kind))
                                .font(.system(size: 11, weight: .bold))
                                .frame(width: 22, height: 22)
                                .foregroundStyle(agentTint(kind))
                                .background(agentTint(kind).opacity(selectedAgentKind == kind ? 0.20 : 0.10))
                                .clipShape(Circle())
                            Text(agentDisplayName(kind))
                                .font(.system(size: 12, weight: .semibold))
                                .lineLimit(1)
                        }
                        .foregroundStyle(isEnabled ? PKTheme.text2 : PKTheme.text4)
                        .padding(.leading, 8)
                        .padding(.trailing, 12)
                        .frame(height: 36)
                        .background(selectedAgentKind == kind ? agentTint(kind).opacity(0.13) : PKTheme.surfaceRaised.opacity(0.74))
                        .overlay(
                            RoundedRectangle(cornerRadius: 8)
                                .stroke(selectedAgentKind == kind ? agentTint(kind).opacity(0.58) : PKTheme.edge, lineWidth: 1)
                        )
                        .clipShape(RoundedRectangle(cornerRadius: 8))
                    }
                    .buttonStyle(.plain)
                    .disabled(!isEnabled)
                    .help(agentDisplayName(kind))
                }
            }
            .padding(6)
        }
        .background(PKTheme.panel.opacity(0.72))
        .overlay(RoundedRectangle(cornerRadius: 8).stroke(PKTheme.edge, lineWidth: 1))
        .clipShape(RoundedRectangle(cornerRadius: 8))
        .shadow(color: Color.black.opacity(0.10), radius: 14, x: 0, y: 8)
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

    init(capability: Capability, index: Int) {
        id = capability.id
        title = capability.name
        subtitle = composerSkillSubtitle(for: capability)
        symbol = composerSkillSymbol(for: capability)
        tint = composerSkillTint(for: capability, index: index)
        command = composerSkillCommand(for: capability)
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
            }
            .padding(10)
            .frame(width: 168, height: 64, alignment: .leading)
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
        .help(skill.command)
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
    let palette = [
        Color(red: 0.78, green: 0.88, blue: 1.00),
        Color(red: 1.00, green: 0.78, blue: 0.76),
        Color(red: 0.82, green: 0.94, blue: 0.70)
    ]
    return palette[index % palette.count]
}

private func composerSkillCommand(for capability: Capability) -> String {
    let lower = capability.name.lowercased()
    if isLogTraceSkillName(lower) {
        return "/logtrace conversationId= last=24h "
    }
    if lower.contains("clickhouse") || lower.contains("ch sql") {
        return "/clickhouse "
    }
    return "/sk_\(composerSkillSlug(capability.name)) "
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
    if lower.contains("draw") || lower.contains("diagram") {
        return 3
    }
    if capability.configState == "ready" {
        return 10
    }
    return 20
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

    private var skillCards: [ComposerSkillCardModel] {
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
            cards.append(ComposerSkillCardModel(capability: capability, index: cards.count))
            if cards.count == 3 { break }
        }
        return cards
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            if !skillCards.isEmpty {
                ComposerSkillCardRow(skills: skillCards) { skill in
                    insertSkillCommand(skill.command)
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
                        .padding(.top, 18)
                        .padding(.leading, 15)
                        .allowsHitTesting(false)
                    }

                    NativeSendingTextEditor(
                        text: $text,
                        focused: focused,
                        fontSize: 16,
                        lineSpacing: 3,
                        onSend: sendWithAttachments,
                        onFocusChange: { editorFocused = $0 }
                    )
                    .frame(minHeight: 104, maxHeight: 136)
                    .padding(.top, 18)
                    .padding(.horizontal, 15)
                    .padding(.bottom, 2)
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

                    Menu {
                        Button("Read only") { selectedPermissionMode = .readOnly }
                        Button("Ask before edit") { selectedPermissionMode = .askBeforeEdit }
                        Button("Autopilot") { selectedPermissionMode = .autopilot }
                    } label: {
                        ComposerToolbarLabel(
                            symbol: "shield.checkered",
                            title: permissionTitle(selectedPermissionMode),
                            tint: PKTheme.text3,
                            showsChevron: true
                        )
                    }
                    .menuStyle(.borderlessButton)
                    .help("Permission mode")

                    StatusPill(
                        text: isRunning ? "RUNNING" : "READY",
                        color: isRunning ? PKTheme.warn : accent
                    )

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
                    .help(isRunning ? "Running" : "Send")
                }
                .padding(.horizontal, 12)
                .padding(.bottom, 12)
                .padding(.top, 10)
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
            .overlay(alignment: .leading) {
                RoundedRectangle(cornerRadius: 2)
                    .fill(accent.opacity(focused.wrappedValue ? 0.92 : 0.40))
                    .frame(width: 2)
                    .padding(.vertical, 10)
            }
            .clipShape(RoundedRectangle(cornerRadius: 10))
            .shadow(color: Color.black.opacity(focused.wrappedValue ? 0.20 : 0.11), radius: focused.wrappedValue ? 18 : 12, x: 0, y: 10)
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
    let onSend: () -> Void
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
        textView.textContainerInset = NSSize(width: 0, height: 0)
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
        textView.onFocusChange = { [weak coordinator = context.coordinator] isFocused in
            coordinator?.setFocused(isFocused)
        }
        if textView.string != text {
            textView.string = text
        }
        let editorWidth = max(scrollView.contentSize.width, 1)
        textView.textContainer?.containerSize = NSSize(width: editorWidth, height: .greatestFiniteMagnitude)
        if abs(textView.frame.width - editorWidth) > 0.5 {
            var frame = textView.frame
            frame.size.width = editorWidth
            textView.frame = frame
        }
        applyStyle(to: textView)
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
    var closeChat: (() -> Void)?
    var detachChat: (() -> Void)?
    let openWorkItem: () -> Void
    @State private var replyDraft = ""
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
                        SecondaryButton(title: "Work Item", systemImage: "checklist", action: openWorkItem)
                        PrimaryButton(title: "New Chat", systemImage: "plus", action: newChat)
                    }
                }
                .fixedSize(horizontal: true, vertical: false)
                .layoutPriority(2)
            }
            .padding(.horizontal, immersive ? 22 : 18)
            .padding(.vertical, immersive ? 18 : 14)

            Rectangle()
                .fill(PKTheme.edge.opacity(0.72))
                .frame(height: 1)

            if terminalOpen {
                ContextTerminalPane(
                    selectedWorkspace: selectedWorkspace,
                    selectedWorkItem: conversationWorkItem,
                    selectedAgentKind: conversationAgentKind,
                    selectedPermissionMode: run?.permissionMode ?? model.selectedPermissionMode,
                    activeRun: run,
                    model: model,
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
                        ConversationMessageBubble(
                            title: "You",
                            subtitle: selectedWorkspace?.name ?? "Project",
                            text: run?.promptSnapshot ?? model.draftPrompt,
                            symbol: "person.crop.circle",
                            accent: accent,
                            trailing: true
                        )

                        AssistantResponseCard(
                            title: agentLabel,
                            text: assistantText,
                            state: run?.state,
                            isRunning: currentRunBlocksReply,
                            accent: accent
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
                replyDraft = ""
                Task {
                    let sentRunId: EntityID?
                    if let run {
                        sentRunId = await model.sendMessage(in: run.id, message: next)
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
}

private struct ConversationMessageBubble: View {
    let title: String
    let subtitle: String
    let text: String
    let symbol: String
    let accent: Color
    var trailing = false

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

private struct AssistantResponseCard: View {
    let title: String
    let text: String
    let state: RunState?
    let isRunning: Bool
    let accent: Color

    private var cleanedText: String {
        friendlyAgentOutput(text)
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

                if cleanedText.isEmpty {
                    AgentThinkingState(isRunning: isRunning, state: state, accent: accent)
                } else {
                    Text(cleanedText)
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

private struct AgentThinkingState: View {
    let isRunning: Bool
    let state: RunState?
    let accent: Color

    var body: some View {
        HStack(spacing: 11) {
            ProgressView()
                .controlSize(.small)
                .tint(accent)
                .opacity(isRunning ? 1 : 0.4)
            VStack(alignment: .leading, spacing: 3) {
                Text(isRunning ? "Starting agent runtime" : emptyOutputTitle)
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(PKTheme.text2)
                Text(isRunning ? "Output will appear here as the agent responds." : "No response text has been emitted yet.")
                    .font(.caption)
                    .foregroundStyle(PKTheme.text3)
            }
            Spacer()
        }
        .padding(14)
        .background(PKTheme.inset.opacity(0.78))
        .overlay(RoundedRectangle(cornerRadius: 8).stroke(accent.opacity(0.20), lineWidth: 1))
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }

    private var emptyOutputTitle: String {
        switch state {
        case .failed: "Run failed before output"
        case .completed: "Completed without text output"
        default: "Waiting for output"
        }
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

    var body: some View {
        VStack(spacing: 0) {
            ZStack(alignment: .topLeading) {
                if text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !composerFocused {
                    Text("Continue the conversation")
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
                    onSend: sendWithAttachments,
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
                .help(isRunning ? "Running" : "Send")
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
                    model: model
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
        if selectedWorkspace?.pathDisplay.contains("pikiclaw") == true {
            return ["pwd", "git status --short", "npm test"]
        }
        return ["pwd", "ls", "git status --short"]
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

    static func importImagesFromPasteboard(_ pasteboard: NSPasteboard = .general) -> ComposerImageAttachmentImportResult {
        var attachments: [ComposerImageAttachment] = []
        let options: [NSPasteboard.ReadingOptionKey: Any] = [
            .urlReadingContentsConformToTypes: [UTType.image.identifier]
        ]

        if let urls = pasteboard.readObjects(forClasses: [NSURL.self], options: options) as? [NSURL] {
            attachments.append(contentsOf: urls.map { $0 as URL }.compactMap(makeAttachment))
        }

        if attachments.isEmpty, let image = NSImage(pasteboard: pasteboard) {
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

private func friendlyAgentOutput(_ text: String) -> String {
    let withoutAnsi = text.replacingOccurrences(
        of: #"\u001B\[[0-9;?]*[ -/]*[@-~]"#,
        with: "",
        options: .regularExpression
    )
    let lines = withoutAnsi
        .components(separatedBy: .newlines)
        .map { line -> String? in
            let trimmed = line.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !trimmed.isEmpty else { return nil }
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
        case .planning: return "Ready to delegate"
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
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .fill(isSelected ? PKTheme.primary.opacity(0.22) : hovering ? PKTheme.control.opacity(0.72) : PKTheme.panel.opacity(0.62))
                .overlay(
                    RoundedRectangle(cornerRadius: 10, style: .continuous)
                        .stroke(accent.opacity(isSelected || hovering ? 0.74 : 0.36), lineWidth: 1)
                )
                .shadow(color: accent.opacity(isSelected || hovering ? 0.16 : 0.0), radius: 12, y: 6)

            Image(systemName: isLive ? "waveform.path.ecg" : "waveform")
                .font(.system(size: 17, weight: .semibold))
                .foregroundStyle(isSelected ? PKTheme.primaryText : accent)
                .scaleEffect(isLive && pulse ? 1.06 : 1)

            if isLive || isSelected {
                Circle()
                    .fill(accent)
                    .frame(width: 6, height: 6)
                    .padding(7)
                    .opacity(isLive && pulse ? 0.62 : 1)
            }
        }
        .frame(width: 42, height: 42)
        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
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
                Text(language.shortTitle).tag(language)
            }
        }
        .pickerStyle(.segmented)
        .controlSize(.small)
        .labelsHidden()
        .disabled(disabled)
        .help("Speech language")
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
        case .understanding: return "Turning speech into an agent brief"
        case .planning: return "Ready to delegate"
        case .running: return "\(agentShortLabel(plan.suggestedAgentKind)) is working"
        case .needsUser: return "Decision needed"
        case .reporting: return report.headline
        case .idle: return "Ready for a voice task"
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
    @AppStorage("PikiclawMac.voiceAutoDelegate") private var voiceAutoDelegate = true
    @State private var delegatedUtterance = ""
    @State private var conversationTurns: [VoiceConversationTurn] = []
    @State private var assistantThinking = false
    @State private var engineSettingsExpanded = false
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

    private var selectedVoiceLabel: String {
        if voiceboxEnabled {
            let profile = voiceboxProfile.trimmingCharacters(in: .whitespacesAndNewlines)
            return profile.isEmpty ? "Voicebox Default" : profile
        }
        return selectedSystemVoiceName
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
            let trimmed = next.trimmingCharacters(in: .whitespacesAndNewlines)
            if !trimmed.isEmpty {
                interruptAssistantSpeechIfNeeded()
                delegatedUtterance = trimmed
                scheduleTranscriptAutoCommit(trimmed)
            }
        }
        .onChange(of: voice.finalizedTurn?.id) { _, _ in
            guard let turn = voice.finalizedTurn else { return }
            handleFinalizedTurn(turn)
        }
        .onChange(of: voice.isCapturingTurn) { _, isCapturing in
            if isCapturing {
                interruptAssistantSpeechIfNeeded()
            } else if !currentTranscript.isEmpty {
                scheduleTranscriptAutoCommit(currentTranscript)
            }
        }
        .onChange(of: voice.isTranscribing) { _, isTranscribing in
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
                        title: "Pikiclaw Voice",
                        badge: voiceboxEnabled ? "Voicebox" : "Apple",
                        color: voiceVisualColor
                    )

                    Spacer()

                    VoiceGlassIconButton(symbol: "arrow.clockwise", help: "Refresh Voice Engine") {
                        Task { await voice.refreshVoicebox(configuration: voiceboxConfiguration) }
                    }
                }
                .padding(.horizontal, 32)
                .padding(.top, 28)

                Spacer(minLength: 14)

                VoiceFluidOrb(
                    level: voice.audioLevel,
                    isListening: voice.isListening || voice.isCapturingTurn,
                    isThinking: assistantThinking || voice.isTranscribing || model.isRunning,
                    isSpeaking: speaker.isSpeaking || voice.isVoiceboxSpeaking,
                    color: voiceVisualColor
                )
                .frame(width: 218, height: 218)
                .padding(.bottom, 22)

                VoicePromptStack(
                    title: immersivePromptTitle,
                    text: immersivePromptText,
                    color: voiceVisualColor,
                    isLive: voice.isListening || voice.isCapturingTurn || !currentTranscript.isEmpty
                )
                .frame(maxWidth: 390)
                .padding(.horizontal, 36)

                Spacer(minLength: 14)

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
                        symbol: (speaker.isSpeaking || voice.isVoiceboxSpeaking) ? "speaker.slash.fill" : "speaker.wave.2.fill",
                        color: voiceVisualColor,
                        isActive: speaker.isSpeaking || voice.isVoiceboxSpeaking,
                        help: (speaker.isSpeaking || voice.isVoiceboxSpeaking) ? "Stop Speaking" : "Speak Last Reply",
                        action: toggleAssistantSpeech
                    )

                    Spacer()

                    VoiceMicControlButton(
                        isActive: voice.isConversationActive,
                        isCapturing: voice.isCapturingTurn,
                        isThinking: assistantThinking || voice.isTranscribing || model.isRunning,
                        color: voiceVisualColor
                    ) {
                        voice.toggleConversation(configuration: voiceboxConfiguration)
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

    private var immersivePromptTitle: String {
        if !currentTranscript.isEmpty { return voice.isCapturingTurn ? "我在听" : "我听到了" }
        if voice.isCapturingTurn { return "我在听" }
        if voice.isTranscribing { return "正在识别" }
        if voice.isListening && activeVoiceTaskCount > 0 { return "我在听" }
        if model.isRunning { return "\(agentShortLabel(plan.suggestedAgentKind)) 正在执行" }
        if assistantThinking { return "正在思考" }
        if speaker.isSpeaking || voice.isVoiceboxSpeaking { return "正在回应" }
        if isOpeningGreeting { return "你好，我在" }
        return statusTitle
    }

    private var immersivePromptText: String {
        if !currentTranscript.isEmpty {
            return currentTranscript
        }
        if let voiceProblemText {
            return voiceProblemText
        }
        if voice.isCapturingTurn {
            return "你继续说，短暂停顿后我会整理成文字。"
        }
        if voice.isTranscribing {
            return "我正在把刚才那一轮语音转成文字。"
        }
        if voice.isListening && activeVoiceTaskCount > 0 {
            return "后台有 \(activeVoiceTaskCount) 个任务正在执行。你可以继续说新的任务，也可以问我当前任务进度。"
        }
        if model.isRunning {
            return "我已经把这轮语音提交到后台 Conversation，正在监听智能体的进度。"
        }
        if assistantThinking {
            return "我正在根据你的上一句话决定继续对话，还是交给合适的智能体。"
        }
        if isOpeningGreeting {
            return openingGreetingText
        }
        if stage == .reporting || stage == .needsUser {
            return report.spokenText
        }
        return "直接说你想完成什么。我会先听完，再判断是继续对话、查看状态，还是交给合适的智能体。"
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
            StatusPill(text: voiceboxEnabled ? "Voicebox" : "Apple", color: voice.voiceboxOnline ? PKTheme.ok : PKTheme.text3)

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
                    Label("Voice Conversation", systemImage: "bubble.left.and.bubble.right")
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
                    StatusPill(text: voiceboxEnabled ? "Voicebox" : "Apple", color: voice.voiceboxOnline ? PKTheme.ok : PKTheme.text3)
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
                        value: voiceboxEnabled ? voice.voiceboxStatus : "Apple Speech fallback",
                        color: voiceboxEnabled ? (voice.voiceboxOnline ? PKTheme.ok : PKTheme.warn) : PKTheme.text3
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
        "你好，我在。你可以直接跟我说要做什么；我会先听完，再判断是继续对话、查看状态，还是交给合适的智能体。"
    }

    private var liveTranscriptText: String {
        if !currentTranscript.isEmpty {
            return currentTranscript
        }
        if voice.isCapturingTurn {
            return "我听到声音了，正在捕捉这一轮；你可以继续说，短暂停顿后我会整理成文字。"
        }
        if assistantThinking {
            return "I am thinking about what you just said..."
        }
        if voice.isTranscribing {
            return "I am turning the last voice turn into text..."
        }
        if speaker.isSpeaking || voice.isVoiceboxSpeaking {
            return conversationTurns.last(where: { $0.role == .assistant })?.text ?? "Speaking..."
        }
        return voiceboxEnabled
            ? "我正在等你说话。停顿后会用 Voicebox 本地转写，并在可执行任务上自动路由。"
            : "我正在等你说话。停顿后会用 Apple Speech 转写，并在可执行任务上自动路由。"
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
        case .listening: return "I am listening"
        case .understanding: return "Thinking about what you said"
        case .planning: return "Ready for the next turn"
        case .running: return "\(agentShortLabel(plan.suggestedAgentKind)) is working"
        case .needsUser: return "The agent needs you"
        case .reporting: return report.headline
        case .idle: return "Voice Lens is ready"
        }
    }

    private var statusSubtitle: String {
        if isOpeningGreeting {
            return "我会先问候你，然后开始听你说话。"
        }
        switch stage {
        case .listening:
            return voice.isCapturingTurn ? "Keep talking. I will close this turn after a short pause." : "Hands-free mode is open. Start speaking when you are ready."
        case .understanding:
            return "I am preparing a reply and keeping the conversation context."
        case .planning:
            return "Say the next thing, or delegate the latest request to an agent."
        case .running:
            return "I am keeping this overlay open while the agent works, then I will summarize the final state."
        case .needsUser:
            return "A human decision is needed. Open the chat or Work Item when you are ready."
        case .reporting:
            return report.spokenText
        case .idle:
            return "Start speaking and I will show the transcript, choose a route, and answer out loud."
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
        openingGreetingTask?.cancel()
        openingGreetingTask = Task {
            _ = await ensureVoiceConversationOpened()
            guard !Task.isCancelled else { return }
            if autoListen {
                await voice.startConversation(configuration: voiceboxConfiguration)
                guard !Task.isCancelled else { return }
            }
            await MainActor.run {
                appendAssistantTurn(greeting, caption: voiceboxEnabled ? "Voicebox Greeting" : "Voice Greeting")
                speakWithAppleVoice(greeting, allowBargeIn: false)
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
            launchDelegation()
        } else {
            sendConversationTurn()
        }
    }

    private func toggleAssistantSpeech() {
        if speaker.isSpeaking || voice.isVoiceboxSpeaking {
            speaker.stop()
            voice.cancelVoiceboxSpeechForInterruption()
            voice.resumeListening()
            return
        }
        let text = conversationTurns.last(where: { $0.role == .assistant })?.text
            ?? (activeRun == nil ? openingGreetingText : report.spokenText)
        speakAssistantText(text)
    }

    private func launchDelegation(autoTriggered: Bool = false, userCaption: String = "You", speakStart: Bool = true) {
        commitCurrentTranscript(reply: false, caption: userCaption)
        voice.pauseForAgentRun()
        briefFocused = false
        let preparedPlan = plan
        let message = autoTriggered
            ? "我会把这件事自动交给 \(agentShortLabel(preparedPlan.suggestedAgentKind))，并在这里继续观察进度。"
            : "好的，我会把这件事交给 \(agentShortLabel(preparedPlan.suggestedAgentKind))，并继续在这里观察进度。"
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
                preserveActiveRunId: preservedRunId
            ),
               let run = model.snapshot.runs.first(where: { $0.id == runId }) {
                voiceConversationRunId = run.id
                if let workItemId = run.workItemId {
                    selectedWorkItemId = workItemId
                }
                assistantThinking = false
                let runningCount = max(1, activeVoiceTaskCount)
                let submittedMessage = runningCount > 1
                    ? "已提交，这是第 \(runningCount) 个后台任务。我会继续监听进度；你可以继续说新的任务，也可以问我当前任务状态。"
                    : "已提交到后台 Conversation。我会继续监听进度；你可以继续说新的任务，也可以问我当前任务状态。"
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
        commitCurrentTranscript()
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
                appendAssistantTurn(reply, caption: voiceboxEnabled ? "Voicebox Lens" : "Voice Lens")
                speakAssistantText(reply)
            }
        }
    }

    private func speakAssistantText(_ text: String) {
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
            language: voice.recognitionLanguage
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
        speechResumeTask?.cancel()
        speechResumeTask = nil
        speaker.stop()
        voice.cancelVoiceboxSpeechForInterruption()
        isOpeningGreeting = false
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
            return "我可以直接听你说需求，然后做三件事：继续和你澄清、查看当前智能体状态，或者把明确任务交给 \(agent) 并在这里监听结果。比如你可以说：帮我优化 chat 消息管理、继续改 voice 打断体验、整理 output 面板、检查失败报告。"
        }
        if lower.contains("开始") || lower.contains("执行") || lower.contains("帮我做") || lower.contains("实现") || lower.contains("fix") || lower.contains("build") {
            return "我听到了。这个更像一个可以交给 \(agent) 的任务：\(shortUtterance(utterance))。我已经整理好项目、权限和验收点；你可以继续补充细节，也可以让我开始监督执行。"
        }
        if lower.contains("进度") || lower.contains("状态") || lower.contains("status") {
            if let activeRun {
                return "当前运行状态是 \(activeRun.state.rawValue)。我会继续盯着它；如果它需要你决策，我会在这里提醒你。"
            }
            return "现在没有正在监督的智能体任务。你可以告诉我要做什么，我会先和你确认，再决定是否交给智能体。"
        }
        if lower.contains("不用") || lower.contains("取消") || lower.contains("stop") || lower.contains("cancel") {
            return "好的，我先不交给智能体。我们可以继续聊，把需求说清楚之后再行动。"
        }
        return "我听到了：\(shortUtterance(utterance))。我会先把它当成对话上下文记住；你可以继续说更多背景，或者让我把最新这件事整理成智能体任务。"
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

private struct VoicePromptStack: View {
    let title: String
    let text: String
    let color: Color
    let isLive: Bool

    var body: some View {
        VStack(spacing: 13) {
            Text(title)
                .font(.system(size: 24, weight: .semibold))
                .foregroundStyle(Color.white.opacity(0.92))
                .multilineTextAlignment(.center)
                .lineLimit(2)
                .minimumScaleFactor(0.82)

            Text(text)
                .font(.system(size: 19, weight: .semibold))
                .foregroundStyle(
                    LinearGradient(
                        colors: [
                            Color.white.opacity(isLive ? 0.92 : 0.58),
                            color.opacity(isLive ? 0.78 : 0.28)
                        ],
                        startPoint: .top,
                        endPoint: .bottom
                    )
                )
                .multilineTextAlignment(.center)
                .lineSpacing(4)
                .lineLimit(4)
                .minimumScaleFactor(0.78)
                .fixedSize(horizontal: false, vertical: true)
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
                selectWorkspace: selectWorkspace
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
                    selectChat: selectRecentChat
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

    private func selectRecentChat(_ run: AgentRun) {
        selectedWorkspaceId = run.workspaceId
        selectedWorkItemId = run.workItemId
        model.activeRunId = run.id
        model.draftPrompt = ""
        if let workspace = snapshot.workspaces.first(where: { $0.id == run.workspaceId }) {
            Task { await model.refreshBranches(for: workspace) }
        }
    }
}

private struct ProjectTreePane: View {
    let snapshot: NativeStoreSnapshot
    @Binding var selectedWorkspaceId: EntityID?
    let newProject: () -> Void
    let selectWorkspace: (EntityID) -> Void
    @State private var addHovering = false

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
                            selectWorkspace: selectWorkspace
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
                            selectWorkspace: selectWorkspace
                        )
                    }
                }
                .padding(12)
            }
        }
        .background(PKTheme.panel.opacity(0.48))
    }

    private func workspaces(for project: Project) -> [Workspace] {
        snapshot.workspaces.filter { project.workspaceIds.contains($0.id) }
    }
}

private struct ProjectTreeProjectGroup: View {
    let project: Project
    let workspaces: [Workspace]
    let selectedWorkspaceId: EntityID?
    let selectWorkspace: (EntityID) -> Void
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

            VStack(spacing: 5) {
                ForEach(workspaces) { workspace in
                    ProjectTreeWorkspaceRow(
                        workspace: workspace,
                        selected: selectedWorkspaceId == workspace.id,
                        action: { selectWorkspace(workspace.id) }
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
                    action: { selectWorkspace(workspace.id) }
                )
            }
        }
    }
}

private struct ProjectTreeWorkspaceRow: View {
    let workspace: Workspace
    let selected: Bool
    let action: () -> Void
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
                    ForEach(artifacts.prefix(4)) { artifact in
                        InspectorRow(symbol: "doc.text", title: artifact.title, subtitle: artifact.status.rawValue)
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

    private var selectedItem: WorkItem? {
        snapshot.workItems.first(where: { $0.id == selectedWorkItemId }) ?? snapshot.workItems.first
    }

    var body: some View {
        PageFrame(route: .workItems) {
            HStack(alignment: .top, spacing: 12) {
                VStack(spacing: 12) {
                    WorkItemsRail(
                        title: "Inbox",
                        subtitle: "Todo, daily, notes, chat selections",
                        items: snapshot.workItems.filter { $0.state == .inbox || $0.sourceType != .jira },
                        selectedWorkItemId: $selectedWorkItemId
                    )
                    WorkItemsRail(
                        title: "Queue",
                        subtitle: "Active and attention-needed",
                        items: snapshot.workItems.filter { $0.state == .active || $0.state == .blocked || $0.state == .review },
                        selectedWorkItemId: $selectedWorkItemId
                    )
                }
                .frame(width: 270)

                WorkbenchDetail(
                    item: selectedItem,
                    snapshot: snapshot,
                    detailTab: $detailTab,
                    run: {
                        Task { await model.run(workItemId: selectedItem?.id) }
                    },
                    openChat: {
                        if let selectedItem {
                            model.draftPrompt = selectedItem.description.isEmpty ? selectedItem.title : selectedItem.description
                        }
                        navigate(.chat)
                    }
                )
                .frame(maxWidth: .infinity)

                WorkItemInspector(item: selectedItem, snapshot: snapshot)
                    .frame(width: 270)
            }
        } actions: {
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

    private var outputs: [Artifact] {
        guard let item else { return [] }
        return snapshot.artifacts.filter { $0.workItemId == item.id }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            ForEach(outputs) { artifact in
                InspectorRow(symbol: "doc.text", title: artifact.title, subtitle: artifact.kind.rawValue)
            }
            if outputs.isEmpty {
                EmptyMiniState(title: "No outputs yet", subtitle: "Verification notes, patches, and Obsidian artifacts appear here.")
            }
        }
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
    let runWorkflow: () -> Void

    var body: some View {
        PageFrame(route: .workflows) {
            HStack(alignment: .top, spacing: 16) {
                VStack(alignment: .leading, spacing: 12) {
                    LibrarySummary(count: 8)
                    SearchPlaceholder(title: "Search workflow recipes...")
                    CategoryRow(title: "Featured", count: 3, selected: true)
                    CategoryRow(title: "Engineering", count: 2, selected: false)
                    CategoryRow(title: "Knowledge", count: 1, selected: false)
                    CategoryRow(title: "Operations", count: snapshot.automations.count, selected: false)
                }
                .frame(width: 220)

                LazyVGrid(columns: [GridItem(.adaptive(minimum: 270), spacing: 12)], spacing: 12) {
                    WorkflowCard(title: "Repository Audit", steps: 4, outputs: 4, effort: "Deep", action: runWorkflow)
                    WorkflowCard(title: "Regression Triage", steps: 5, outputs: 4, effort: "Deep", action: runWorkflow)
                    WorkflowCard(title: "Release Readiness", steps: 4, outputs: 4, effort: "Medium", action: runWorkflow)
                    ForEach(snapshot.automations) { automation in
                        WorkflowCard(title: automation.name, steps: 3, outputs: 2, effort: automation.state.rawValue, action: runWorkflow)
                    }
                }
            }
        } actions: {
            SecondaryButton(title: "Import workflow", systemImage: "square.and.arrow.down") {}
            PrimaryButton(title: "Build workflow", systemImage: "plus", action: runWorkflow)
            CountBadge(value: snapshot.automations.count)
        }
    }
}

private struct MissionControlPage: View {
    let snapshot: NativeStoreSnapshot

    var body: some View {
        PageFrame(route: .missionControl) {
            VStack(alignment: .leading, spacing: 14) {
                HStack(spacing: 12) {
                    RuntimeCard(title: "RUNNING", value: "\(snapshot.runs.filter { $0.state == .running }.count)", subtitle: "Active agent sessions", color: PKTheme.ok)
                    RuntimeCard(title: "BLOCKED", value: "\(snapshot.runs.filter { $0.state == .waitingForUser || $0.state == .failed }.count)", subtitle: "Need attention", color: PKTheme.warn)
                    RuntimeCard(title: "BUDGET", value: "Local", subtitle: "Usage ledger pending", color: PKTheme.primary)
                }

                HStack(alignment: .top, spacing: 12) {
                    InspectorSection(title: "Runtime Queue") {
                        ForEach(snapshot.runs.prefix(6)) { run in
                            InspectorRow(symbol: agentSymbol(agentKind(for: run, snapshot: snapshot)), title: run.state.rawValue, subtitle: run.promptSnapshot)
                        }
                    }
                    InspectorSection(title: "Capability Health") {
                        ForEach(snapshot.capabilities) { capability in
                            InspectorRow(symbol: "puzzlepiece.extension", title: capability.name, subtitle: capability.healthState.rawValue)
                        }
                    }
                }
            }
        } actions: {
            SecondaryButton(title: "Refresh", systemImage: "arrow.clockwise") {}
        }
    }
}

private struct AgentStudioPage: View {
    let snapshot: NativeStoreSnapshot
    @Binding var selectedAgentKind: NativeAgentKind

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
                        capability: selectedCapability
                    )
                    AgentConfigWindow(
                        profile: selectedProfile,
                        provider: selectedProvider,
                        workspace: snapshot.workspaces.first
                    )
                }
            }
        } actions: {
            SecondaryButton(title: "Detect", systemImage: "dot.viewfinder") {}
            SecondaryButton(title: "Login", systemImage: "person.badge.key") {}
            PrimaryButton(title: "Test Run", systemImage: "play.fill") {}
        }
    }

    private func capability(for profile: AgentProfile) -> Capability? {
        snapshot.capabilities.first { capability in
            capability.name.localizedCaseInsensitiveContains(profile.displayName)
                || profile.displayName.localizedCaseInsensitiveContains(capability.name.replacingOccurrences(of: " CLI", with: ""))
                || capability.name.localizedCaseInsensitiveContains(profile.executableName)
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
}

private struct AgentSetupWindow: View {
    let profile: AgentProfile?
    let provider: ProviderProfile?
    let capability: Capability?

    var body: some View {
        AgentStudioWindow(title: "Install & Auth", subtitle: "Detect the local CLI and make it runnable.") {
            VStack(alignment: .leading, spacing: 12) {
                AgentStudioField(label: "Executable", value: profile?.executableName ?? "No agent")
                AgentStudioField(label: "Install", value: capability?.installState.capitalized ?? "Profile ready")
                AgentStudioField(label: "Auth", value: capability?.configState.capitalized ?? "Needs check")
                AgentStudioField(label: "Provider", value: provider?.displayName ?? "Agent default")
                AgentStudioField(label: "Permission", value: permissionLabel(profile?.defaultPermissionMode ?? .askBeforeEdit))

                HStack(spacing: 8) {
                    SecondaryButton(title: "Detect", systemImage: "magnifyingglass") {}
                    SecondaryButton(title: "Login", systemImage: "key") {}
                    PrimaryButton(title: "Open", systemImage: agentSymbol(profile?.kind ?? .customCLI)) {}
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

    var body: some View {
        AgentStudioWindow(title: "Config & Launch", subtitle: "Edit the files and preview the native launch boundary.") {
            VStack(alignment: .leading, spacing: 12) {
                HStack(spacing: 8) {
                    ForEach(agentConfigFiles(for: profile?.kind ?? .customCLI), id: \.self) { file in
                        HeaderChip(title: file)
                    }
                }
                .lineLimit(1)

                Text(agentConfigPreview(profile: profile, provider: provider, workspace: workspace))
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
                SecondaryButton(title: "Refresh", systemImage: "arrow.clockwise") {}
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
    @ViewBuilder var content: Content
    @ViewBuilder var actions: Actions

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                HeaderBand(title: route.title, subtitle: route.subtitle, route: route) {
                    actions
                }
                content
            }
            .padding(32)
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
    let count: Int

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                VStack(alignment: .leading, spacing: 3) {
                    Text("LIBRARY")
                        .font(.system(size: 10, weight: .semibold))
                        .foregroundStyle(PKTheme.text3)
                    Text("\(count) recipes")
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
                MetricBox(label: "FEATURED", value: "3")
                MetricBox(label: "CUSTOM", value: "0")
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
    let title: String
    let steps: Int
    let outputs: Int
    let effort: String
    let action: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 13) {
            HStack {
                StatusPill(text: "ENGINEERING", color: PKTheme.text3)
                StatusPill(text: "FEATURED", color: PKTheme.primary)
                Spacer()
                CountBadge(text: "Built in")
            }
            Text(title)
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(PKTheme.text)
            Text(workflowDescription(title))
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
                    Text("Launch workflow")
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

private func workflowDescription(_ title: String) -> String {
    switch title {
    case "Repository Audit":
        return "Read a repo or module, map the current implementation, identify gaps, and save a durable note."
    case "Regression Triage":
        return "Turn a bug report into a narrow reproduction, likely cause, smallest fix path, and verification plan."
    case "Release Readiness":
        return "Collect build, test, smoke, risk, and rollback evidence before a local install or rollout."
    default:
        return "Reusable workflow tuned for repeatable agent work."
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
