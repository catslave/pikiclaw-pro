import AppKit
import PikiclawCore
import SwiftUI

private enum NativeRoute: String, CaseIterable, Identifiable {
    case chat
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
        .chat, .projects, .workItems, .workPlan, .notes, .memory, .workflows,
    ]

    static let system: [NativeRoute] = [
        .missionControl, .channels, .agents, .assistants, .team, .extensions, .settings,
    ]

    var title: String {
        switch self {
        case .chat: "Conversations"
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
        case .projects: "folder"
        case .workItems: "square.grid.2x2"
        case .workPlan: "calendar"
        case .notes: "note.text"
        case .memory: "brain"
        case .workflows: "point.3.connected.trianglepath.dotted"
        case .missionControl: "gauge.with.dots.needle.67percent"
        case .channels: "bubble.left.and.bubble.right"
        case .agents: "terminal"
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
    @FocusState private var commandFocused: Bool

    private var themePreference: PKThemePreference {
        PKThemePreference(rawValue: themePreferenceRaw) ?? .dark
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
                    openProjects: { route = .projects },
                    addProject: chooseWorkspace,
                    selectAgent: { kind in
                        model.selectedAgentKind = kind
                        route = .chat
                        model.prepareNewChat()
                        commandFocused = true
                    },
                    newChat: openNewChat,
                    openVoice: openVoiceAssistant,
                    openAgentStudio: { route = .agents },
                    openMissionControl: { route = .missionControl }
                )

                Divider().overlay(PKTheme.edge)

                ZStack {
                    pageContent
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
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
        .onReceive(NotificationCenter.default.publisher(for: .pikiclawNavigate)) { note in
            if let raw = note.object as? String, let destination = NativeRoute(rawValue: raw) {
                route = destination
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
        route = next
    }

    private func openNewChat() {
        route = .chat
        model.prepareNewChat()
        commandFocused = true
    }

    private func openVoiceAssistant() {
        route = .chat
        assistantDockOpen = true
        commandFocused = false
    }

    private func chooseWorkspace() {
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
    let openProjects: () -> Void
    let addProject: () -> Void
    let selectAgent: (NativeAgentKind) -> Void
    let newChat: () -> Void
    let openVoice: () -> Void
    let openAgentStudio: () -> Void
    let openMissionControl: () -> Void

    var body: some View {
        VStack(spacing: 12) {
            BrandMark()
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
                Image(systemName: "waveform.circle")
                    .font(.system(size: 17, weight: .semibold))
                    .frame(width: 42, height: 42)
                    .background(PKTheme.panel.opacity(0.62))
                    .foregroundStyle(PKTheme.primary)
                    .overlay(RoundedRectangle(cornerRadius: 10).stroke(PKTheme.primary.opacity(0.42), lineWidth: 1))
                    .clipShape(RoundedRectangle(cornerRadius: 10))
            }
            .buttonStyle(.plain)
            .help("Voice Assistant")

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

            Button(action: openAgentStudio) {
                Image(systemName: "terminal")
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
            ChatHistoryPane(
                snapshot: snapshot,
                selectedAgentKind: model.selectedAgentKind,
                activeRunId: model.activeRunId,
                selectRun: { run in
                    model.activeRunId = run.id
                    selectedWorkspaceId = run.workspaceId
                    selectedWorkItemId = run.workItemId
                },
                newChat: {
                    model.prepareNewChat()
                    commandFocused.wrappedValue = true
                },
                openRunInNewWindow: { run in
                    DetachedChatWindowRegistry.shared.open(run: run, snapshot: snapshot)
                },
                deleteRun: { run in
                    Task { await model.deleteChat(runId: run.id) }
                }
            )
            .frame(width: 312)

            Divider().overlay(PKTheme.edge)

            ZStack {
                if model.activeRunId != nil {
                    ConversationWorkspace(
                        run: activeRun,
                        snapshot: snapshot,
                        selectedWorkspace: selectedWorkspace,
                        selectedWorkspaceId: $selectedWorkspaceId,
                        selectedWorkItemId: $selectedWorkItemId,
                        model: model,
                        newChat: {
                            model.prepareNewChat()
                            commandFocused.wrappedValue = true
                        },
                        openWorkItem: {
                            if let itemId = activeRun?.workItemId {
                                selectedWorkItemId = itemId
                            }
                            navigate(.workItems)
                        }
                    )
                    .padding(24)
                } else {
                    NewChatLauncher(
                        snapshot: snapshot,
                        selectedWorkspaceId: $selectedWorkspaceId,
                        commandFocused: commandFocused,
                        model: model,
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
                .frame(width: 340)
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
}

private struct ChatHistoryPane: View {
    let snapshot: NativeStoreSnapshot
    let selectedAgentKind: NativeAgentKind
    let activeRunId: EntityID?
    let selectRun: (AgentRun) -> Void
    let newChat: () -> Void
    let openRunInNewWindow: (AgentRun) -> Void
    let deleteRun: (AgentRun) -> Void

    private var runs: [AgentRun] {
        let matching = snapshot.runs.filter { run in
            agentKind(for: run, snapshot: snapshot) == selectedAgentKind
        }
        return matching.sorted { ($0.startedAt ?? .distantPast) > ($1.startedAt ?? .distantPast) }
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
                    ForEach(runs) { run in
                        ChatHistoryRow(
                            run: run,
                            selected: activeRunId == run.id,
                            workspaceName: workspaceName(for: run.workspaceId, snapshot: snapshot)
                            ,
                            openInNewWindow: { openRunInNewWindow(run) },
                            delete: { deleteRun(run) },
                            action: { selectRun(run) }
                        )
                    }

                    if runs.isEmpty {
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
        .overlay(RoundedRectangle(cornerRadius: 8).stroke(selected ? PKTheme.edgeStrong : PKTheme.edge, lineWidth: 1))
        .clipShape(RoundedRectangle(cornerRadius: 8))
        .contentShape(RoundedRectangle(cornerRadius: 8))
        .onTapGesture(perform: action)
        .onHover { isHovering = $0 }
        .contextMenu {
            Button("Open in New Window", systemImage: "rectangle.on.rectangle", action: openInNewWindow)
            Button("Delete Chat", systemImage: "trash", role: .destructive, action: delete)
        }
    }
}

private struct RowIconButton: View {
    let symbol: String
    let help: String
    var tint: Color = PKTheme.text3
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(tint)
                .frame(width: 24, height: 22)
                .background(PKTheme.control.opacity(0.64))
                .overlay(RoundedRectangle(cornerRadius: 6).stroke(PKTheme.edge, lineWidth: 1))
                .clipShape(RoundedRectangle(cornerRadius: 6))
        }
        .buttonStyle(.plain)
        .help(help)
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
                            accent: PKTheme.primary,
                            trailing: true
                        )

                        AssistantResponseCard(
                            title: agentName,
                            text: run.transcript.isEmpty ? "No assistant output yet." : run.transcript,
                            state: run.state,
                            isRunning: run.state == .running
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
    let send: () -> Void
    @State private var selectedMode: NewChatMode = .engineering

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
                    captureWorkItem: {
                        Task { _ = await model.createWorkItem(workspaceId: selectedWorkspaceId) }
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

                NewChatFocusPill(
                    title: focusTitle,
                    subtitle: focusSubtitle,
                    tint: isRunning ? PKTheme.ok : PKTheme.primary
                )
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

private struct MinimalChatComposer: View {
    let snapshot: NativeStoreSnapshot
    @Binding var selectedWorkspaceId: EntityID?
    @Binding var selectedPermissionMode: PermissionMode
    @Binding var text: String
    let placeholder: String
    var focused: FocusState<Bool>.Binding
    let selectedAgentKind: NativeAgentKind
    let isRunning: Bool
    let captureWorkItem: () -> Void
    let send: () -> Void
    @State private var isHovering = false

    private var canSend: Bool {
        !isRunning && !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    var body: some View {
        VStack(spacing: 0) {
            ZStack(alignment: .topLeading) {
                if text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    VStack(alignment: .leading, spacing: 6) {
                        Text(placeholder)
                            .font(.system(size: 17, weight: .medium))
                            .foregroundStyle(PKTheme.text2)
                        Text(projectTitle(for: selectedWorkspaceId, snapshot: snapshot))
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundStyle(PKTheme.text4)
                    }
                    .padding(.top, 15)
                    .padding(.leading, 16)
                    .allowsHitTesting(false)
                }

                TextEditor(text: $text)
                    .focused(focused)
                    .font(.system(size: 17))
                    .foregroundStyle(PKTheme.text)
                    .scrollContentBackground(.hidden)
                    .lineSpacing(3)
                    .frame(minHeight: 132, maxHeight: 172)
                    .padding(.top, 15)
                    .padding(.horizontal, 16)
                    .padding(.bottom, 4)
            }

            Rectangle()
                .fill(PKTheme.edge.opacity(0.72))
                .frame(height: 1)

            HStack(spacing: 9) {
                ComposerToolbarLabel(
                    symbol: "folder",
                    title: projectTitle(for: selectedWorkspaceId, snapshot: snapshot),
                    tint: PKTheme.primary
                )
                .help("Project is selected from the Project tree")

                Menu {
                    Button("Read only") { selectedPermissionMode = .readOnly }
                    Button("Ask before edit") { selectedPermissionMode = .askBeforeEdit }
                    Button("Autopilot") { selectedPermissionMode = .autopilot }
                } label: {
                    ComposerToolbarLabel(
                        symbol: "shield.checkered",
                        title: permissionTitle(selectedPermissionMode),
                        tint: PKTheme.text3
                    )
                }
                .menuStyle(.borderlessButton)
                .help("Permission mode")

                StatusPill(
                    text: isRunning ? "RUNNING" : "READY",
                    color: isRunning ? PKTheme.warn : PKTheme.text3
                )

                Spacer(minLength: 0)

                ComposerIconButton(symbol: "paperclip", title: "Attach") {}
                ComposerIconButton(symbol: "tray.and.arrow.down", title: "Capture") {
                    captureWorkItem()
                }
                ComposerIconButton(symbol: "mic", title: "Voice") {}
                    .disabled(true)

                Text("# Commands")
                    .font(.system(size: 11, weight: .medium))
                    .foregroundStyle(PKTheme.text4)

                Spacer()

                Button(action: send) {
                    HStack(spacing: 7) {
                        Image(systemName: isRunning ? "hourglass" : "arrow.up")
                            .font(.system(size: 13, weight: .bold))
                        Text(isRunning ? "Running" : "Send")
                            .font(.system(size: 13, weight: .semibold))
                    }
                    .foregroundStyle(canSend ? PKTheme.primaryText : PKTheme.text4)
                    .padding(.horizontal, 12)
                    .frame(height: 34)
                    .background(canSend ? PKTheme.primary : PKTheme.control.opacity(0.86))
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
                    PKTheme.surfaceRaised.opacity(0.96),
                    PKTheme.panel.opacity(0.92)
                ],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
        )
        .overlay(
            RoundedRectangle(cornerRadius: 8)
                .stroke(focused.wrappedValue ? PKTheme.primary.opacity(0.72) : PKTheme.edgeStrong.opacity(isHovering ? 0.78 : 0.54), lineWidth: 1)
        )
        .clipShape(RoundedRectangle(cornerRadius: 8))
        .shadow(color: Color.black.opacity(focused.wrappedValue ? 0.26 : 0.16), radius: focused.wrappedValue ? 24 : 16, x: 0, y: 12)
        .onHover { isHovering = $0 }
    }
}

private struct ComposerToolbarLabel: View {
    let symbol: String
    let title: String
    let tint: Color

    var body: some View {
        HStack(spacing: 7) {
            Image(systemName: symbol)
                .font(.system(size: 12, weight: .semibold))
            Text(title)
                .font(.system(size: 12, weight: .semibold))
                .lineLimit(1)
                .truncationMode(.tail)
            Image(systemName: "chevron.down")
                .font(.system(size: 9, weight: .bold))
                .foregroundStyle(tint.opacity(0.72))
        }
        .foregroundStyle(tint)
        .padding(.horizontal, 10)
        .frame(height: 30)
        .background(tint.opacity(0.10))
        .overlay(RoundedRectangle(cornerRadius: 8).stroke(tint.opacity(0.22), lineWidth: 1))
        .clipShape(RoundedRectangle(cornerRadius: 8))
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

private struct ConversationWorkspace: View {
    let run: AgentRun?
    let snapshot: NativeStoreSnapshot
    let selectedWorkspace: Workspace?
    @Binding var selectedWorkspaceId: EntityID?
    @Binding var selectedWorkItemId: EntityID?
    @ObservedObject var model: NativeAppModel
    let newChat: () -> Void
    let openWorkItem: () -> Void
    @State private var replyDraft = ""

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 12) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(runTitle)
                        .font(.system(size: 20, weight: .semibold))
                        .foregroundStyle(PKTheme.text)
                        .lineLimit(1)
                    Text("\(selectedWorkspace?.name ?? "Project") · \(run?.state.rawValue ?? "starting")")
                        .font(.caption)
                        .foregroundStyle(PKTheme.text3)
                }
                Spacer()
                StatusPill(text: run?.state.rawValue ?? "starting", color: runStateColor(run?.state))
                SecondaryButton(title: "Work Item", systemImage: "checklist", action: openWorkItem)
                PrimaryButton(title: "New Chat", systemImage: "plus", action: newChat)
            }
            .padding(.horizontal, 18)
            .padding(.vertical, 14)

            Rectangle()
                .fill(PKTheme.edge.opacity(0.72))
                .frame(height: 1)

            ScrollViewReader { reader in
                ScrollView {
                    VStack(alignment: .leading, spacing: 18) {
                        ConversationMessageBubble(
                            title: "You",
                            subtitle: selectedWorkspace?.name ?? "Project",
                            text: run?.promptSnapshot ?? model.draftPrompt,
                            symbol: "person.crop.circle",
                            accent: PKTheme.primary,
                            trailing: true
                        )

                        AssistantResponseCard(
                            title: agentLabel,
                            text: assistantText,
                            state: run?.state,
                            isRunning: model.isRunning
                        )
                        .id("assistant-output")
                    }
                    .padding(20)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .onChange(of: run?.transcript ?? "") { _, _ in
                    withAnimation(.easeOut(duration: 0.16)) {
                        reader.scrollTo("assistant-output", anchor: .bottom)
                    }
                }
            }

            ConversationReplyComposer(
                text: $replyDraft,
                statusLine: model.statusLine,
                isRunning: model.isRunning
            ) {
                let next = replyDraft.trimmingCharacters(in: .whitespacesAndNewlines)
                guard !next.isEmpty else { return }
                model.draftPrompt = next
                replyDraft = ""
                Task {
                    if let runId = await model.startChat(
                        workspaceId: selectedWorkspaceId,
                        targetWorkItemId: selectedWorkItemId
                    ),
                       let nextRun = model.snapshot.runs.first(where: { $0.id == runId }) {
                        selectedWorkItemId = nextRun.workItemId
                    }
                }
            }
            .padding(16)
        }
        .background(PKTheme.panel.opacity(0.46))
        .overlay(RoundedRectangle(cornerRadius: 8).stroke(PKTheme.edge, lineWidth: 1))
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }

    private var runTitle: String {
        run?.promptSnapshot.firstLineFallback("Conversation") ?? "Starting conversation"
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
                    .background(trailing ? PKTheme.primary.opacity(0.14) : PKTheme.panelAlt.opacity(0.52))
                    .overlay(RoundedRectangle(cornerRadius: 8).stroke(trailing ? PKTheme.primary.opacity(0.28) : PKTheme.edge, lineWidth: 1))
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
                        .background(PKTheme.primary)
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
                    AgentThinkingState(isRunning: isRunning, state: state)
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
            .overlay(RoundedRectangle(cornerRadius: 8).stroke(PKTheme.edge, lineWidth: 1))
            .clipShape(RoundedRectangle(cornerRadius: 8))

            Spacer(minLength: 72)
        }
    }
}

private struct AgentThinkingState: View {
    let isRunning: Bool
    let state: RunState?

    var body: some View {
        HStack(spacing: 11) {
            ProgressView()
                .controlSize(.small)
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
        .overlay(RoundedRectangle(cornerRadius: 8).stroke(PKTheme.edge, lineWidth: 1))
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
    @Binding var text: String
    let statusLine: String
    let isRunning: Bool
    let send: () -> Void
    @FocusState private var focused: Bool

    private var canSend: Bool {
        !isRunning && !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    var body: some View {
        VStack(spacing: 0) {
            ZStack(alignment: .topLeading) {
                if text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    Text("Continue the conversation")
                        .font(.system(size: 14, weight: .medium))
                        .foregroundStyle(PKTheme.text3)
                        .padding(.top, 6)
                        .padding(.leading, 9)
                        .allowsHitTesting(false)
                }
                TextEditor(text: $text)
                    .focused($focused)
                    .font(.system(size: 14))
                    .foregroundStyle(PKTheme.text)
                    .lineSpacing(2)
                    .scrollContentBackground(.hidden)
                    .frame(minHeight: 58, maxHeight: 92)
                    .padding(.horizontal, 9)
                    .padding(.top, 6)
                    .padding(.bottom, 2)
            }

            HStack(spacing: 9) {
                Text(statusLine)
                    .font(.caption)
                    .foregroundStyle(PKTheme.text3)
                    .lineLimit(1)
                Spacer()
                Button(action: send) {
                    Image(systemName: isRunning ? "hourglass" : "arrow.up")
                        .font(.system(size: 13, weight: .bold))
                        .foregroundStyle(canSend ? PKTheme.primaryText : PKTheme.text4)
                        .frame(width: 32, height: 32)
                        .background(canSend ? PKTheme.primary : PKTheme.control.opacity(0.86))
                        .clipShape(RoundedRectangle(cornerRadius: 8))
                }
                .buttonStyle(.plain)
                .disabled(!canSend)
                .keyboardShortcut(.return, modifiers: .command)
                .help(isRunning ? "Running" : "Send")
            }
            .padding(.horizontal, 10)
            .padding(.bottom, 10)
        }
        .background(PKTheme.surfaceRaised.opacity(0.92))
        .overlay(RoundedRectangle(cornerRadius: 8).stroke(focused ? PKTheme.primary.opacity(0.62) : PKTheme.edgeStrong.opacity(0.48), lineWidth: 1))
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

            VoiceWaveform(isLive: voice.isRecording || model.isRunning, color: stageColor)

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
                .disabled(model.isRunning)
                .help(voice.isRecording ? "Stop listening" : "Start listening")

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
        !model.isRunning
            && selectedWorkspace != nil
            && !delegatedUtterance.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
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

private struct VoiceWaveform: View {
    let isLive: Bool
    let color: Color

    var body: some View {
        HStack(alignment: .center, spacing: 4) {
            ForEach(0..<22, id: \.self) { index in
                RoundedRectangle(cornerRadius: 2)
                    .fill(color.opacity(isLive ? 0.82 : 0.32))
                    .frame(width: 4, height: barHeight(index))
                    .animation(.easeInOut(duration: 0.28).repeatForever(autoreverses: true).delay(Double(index % 6) * 0.035), value: isLive)
            }
        }
        .frame(maxWidth: .infinity)
        .frame(height: 44)
        .background(PKTheme.inset.opacity(0.62))
        .overlay(RoundedRectangle(cornerRadius: 8).stroke(color.opacity(isLive ? 0.40 : 0.18), lineWidth: 1))
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }

    private func barHeight(_ index: Int) -> CGFloat {
        let pattern: [CGFloat] = [10, 18, 26, 15, 34, 22, 12, 28, 38, 20, 16]
        return isLive ? pattern[index % pattern.count] : max(8, pattern[index % pattern.count] * 0.42)
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

private struct ProjectsPage: View {
    let snapshot: NativeStoreSnapshot
    @Binding var selectedWorkspaceId: EntityID?
    @Binding var selectedWorkItemId: EntityID?
    @ObservedObject var model: NativeAppModel
    let newProject: () -> Void
    let navigate: (NativeRoute) -> Void

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

            ProjectContextSidebar(
                snapshot: snapshot,
                selectedWorkspace: selectedWorkspace,
                selectedProject: selectedProject,
                selectedAgentKind: model.selectedAgentKind,
                openWorkItems: { navigate(.workItems) }
            )
            .frame(width: 300)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(PKTheme.panel.opacity(0.24))
    }

    private func selectWorkspace(_ workspaceId: EntityID) {
        selectedWorkspaceId = workspaceId
        model.prepareNewChat()
    }
}

private struct ProjectTreePane: View {
    let snapshot: NativeStoreSnapshot
    @Binding var selectedWorkspaceId: EntityID?
    let newProject: () -> Void
    let selectWorkspace: (EntityID) -> Void

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
                        .background(PKTheme.primary)
                        .foregroundStyle(PKTheme.primaryText)
                        .clipShape(RoundedRectangle(cornerRadius: 7))
                }
                .buttonStyle(.plain)
                .help("Add Project")
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
                        .foregroundStyle(selected ? PKTheme.primary : PKTheme.text3)
                        .frame(width: 24, height: 24)
                    VStack(alignment: .leading, spacing: 3) {
                        Text(project.name)
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(PKTheme.text)
                            .lineLimit(1)
                        Text(workspaces.isEmpty ? "No workspace linked" : "\(workspaces.count) workspace\(workspaces.count == 1 ? "" : "s")")
                            .font(.caption2)
                            .foregroundStyle(PKTheme.text3)
                    }
                    Spacer()
                    if selected {
                        Dot(color: PKTheme.primary)
                    }
                }
                .padding(10)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(selected ? PKTheme.primary.opacity(0.10) : PKTheme.panelAlt.opacity(0.36))
                .overlay(RoundedRectangle(cornerRadius: 8).stroke(selected ? PKTheme.primary.opacity(0.38) : PKTheme.edge, lineWidth: 1))
                .clipShape(RoundedRectangle(cornerRadius: 8))
            }
            .buttonStyle(.plain)

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

    var body: some View {
        Button(action: action) {
            HStack(spacing: 8) {
                Image(systemName: "folder.badge.gearshape")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(selected ? PKTheme.primary : PKTheme.text3)
                    .frame(width: 18)
                VStack(alignment: .leading, spacing: 2) {
                    Text(workspace.name)
                        .font(.system(size: 12, weight: selected ? .semibold : .medium))
                        .foregroundStyle(selected ? PKTheme.text : PKTheme.text2)
                        .lineLimit(1)
                    Text(workspace.currentBranch ?? workspace.kind)
                        .font(.caption2)
                        .foregroundStyle(PKTheme.text3)
                        .lineLimit(1)
                }
                Spacer()
            }
            .padding(.horizontal, 9)
            .frame(height: 42)
            .background(selected ? PKTheme.selected : PKTheme.control.opacity(0.36))
            .overlay(RoundedRectangle(cornerRadius: 7).stroke(selected ? PKTheme.edgeStrong : PKTheme.edge.opacity(0.65), lineWidth: 1))
            .clipShape(RoundedRectangle(cornerRadius: 7))
        }
        .buttonStyle(.plain)
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
                        newChat: model.prepareNewChat,
                        openWorkItem: { navigate(.workItems) }
                    )
                    .padding(18)
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
                        captureWorkItem: {
                            Task { _ = await model.createWorkItem(workspaceId: selectedWorkspaceId ?? selectedWorkspace.id) }
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
    let captureWorkItem: () -> Void
    let send: () -> Void
    @FocusState private var focused: Bool

    var body: some View {
        VStack(spacing: 18) {
            HStack(spacing: 12) {
                Image(systemName: "folder")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(PKTheme.primary)
                    .frame(width: 34, height: 34)
                    .background(PKTheme.primary.opacity(0.12))
                    .clipShape(RoundedRectangle(cornerRadius: 8))
                VStack(alignment: .leading, spacing: 4) {
                    Text(project?.name ?? workspace.name)
                        .font(.system(size: 20, weight: .semibold))
                        .foregroundStyle(PKTheme.text)
                        .lineLimit(1)
                    Text(workspace.pathDisplay)
                        .font(.caption)
                        .foregroundStyle(PKTheme.text3)
                        .lineLimit(1)
                }
                Spacer()
                StatusPill(text: agentShortLabel(selectedAgentKind), color: agentTint(selectedAgentKind))
                StatusPill(text: isRunning ? "RUNNING" : "PROJECT CHAT", color: isRunning ? PKTheme.warn : PKTheme.primary)
            }

            Spacer(minLength: 0)

            MinimalChatComposer(
                snapshot: snapshot,
                selectedWorkspaceId: $selectedWorkspaceId,
                selectedPermissionMode: $selectedPermissionMode,
                text: $draftPrompt,
                placeholder: "Message \(agentShortLabel(selectedAgentKind)) in \(project?.name ?? workspace.name)",
                focused: $focused,
                selectedAgentKind: selectedAgentKind,
                isRunning: isRunning,
                captureWorkItem: captureWorkItem,
                send: send
            )
            .frame(maxWidth: 860)

            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .onAppear { focused = true }
        .onChange(of: workspace.id) { _, _ in
            focused = true
        }
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
    let openWorkItems: () -> Void

    private var workspaceIds: [EntityID] {
        if let selectedProject, !selectedProject.workspaceIds.isEmpty {
            return selectedProject.workspaceIds
        }
        if let selectedWorkspace {
            return [selectedWorkspace.id]
        }
        return []
    }

    private var workItems: [WorkItem] {
        snapshot.workItems.filter { workspaceIds.isEmpty || workspaceIds.contains($0.workspaceId) }
    }

    private var runs: [AgentRun] {
        snapshot.runs.filter { workspaceIds.isEmpty || workspaceIds.contains($0.workspaceId) }
    }

    private var artifacts: [Artifact] {
        snapshot.artifacts.filter { workspaceIds.isEmpty || workspaceIds.contains($0.workspaceId) }
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
                }

                InspectorSection(title: "Project") {
                    InspectorMetric(label: "Workspace", value: selectedWorkspace?.name ?? "None")
                    InspectorMetric(label: "Branch", value: selectedWorkspace?.currentBranch ?? "Unknown")
                    InspectorMetric(label: "Trust", value: selectedWorkspace?.trustState.rawValue ?? "unknown")
                    if let path = selectedWorkspace?.pathDisplay {
                        Text(path)
                            .font(.caption)
                            .foregroundStyle(PKTheme.text3)
                            .lineLimit(2)
                            .textSelection(.enabled)
                    }
                }

                InspectorSection(title: "Work Items") {
                    InspectorMetric(label: "Active", value: "\(workItems.filter { $0.state == .active || $0.state == .review || $0.state == .blocked }.count)")
                    InspectorMetric(label: "Total", value: "\(workItems.count)")
                    ForEach(workItems.prefix(3)) { item in
                        InspectorRow(symbol: "checklist", title: item.title, subtitle: item.state.rawValue)
                    }
                    if workItems.isEmpty {
                        EmptyMiniState(title: "No items", subtitle: "Project chat can create the first durable work item.")
                    }
                    SecondaryButton(title: "Open Work Items", systemImage: "square.grid.2x2", action: openWorkItems)
                }

                InspectorSection(title: "Recent Chats") {
                    ForEach(runs.prefix(4)) { run in
                        InspectorRow(symbol: "text.bubble", title: run.promptSnapshot.firstLineFallback("Conversation"), subtitle: run.state.rawValue)
                    }
                    if runs.isEmpty {
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
                            InspectorRow(symbol: "terminal", title: run.state.rawValue, subtitle: run.promptSnapshot)
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
                    PrimaryButton(title: "Open", systemImage: "terminal") {}
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
                        SurfaceCard(symbol: "terminal", title: agent.displayName, subtitle: agent.executableName, badge: agent.isEnabled ? "Ready" : "Off")
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
    case .codex: return "terminal"
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

private func permissionTitle(_ mode: PermissionMode) -> String {
    switch mode {
    case .readOnly: return "Read"
    case .askBeforeEdit: return "Ask"
    case .autopilot: return "Autopilot"
    }
}

private extension String {
    func firstLineFallback(_ fallback: String) -> String {
        let first = split(whereSeparator: \.isNewline).first.map(String.init) ?? ""
        let trimmed = first.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? fallback : String(trimmed.prefix(80))
    }
}
