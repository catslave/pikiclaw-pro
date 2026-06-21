import AppKit
import SwiftUI
import PikiclawCore

struct JiraMenuBarView: View {
    @StateObject private var model = NativeAppModel()
    @State private var filter: JiraTicketSyncScope = .currentSprint

    private var jiraItems: [WorkItem] {
        model.snapshot.workItems
            .filter { $0.sourceType == .jira }
            .filter { item in
                switch filter {
                case .mine, .currentSprint:
                    return item.state != .done && item.state != .cancelled
                case .review:
                    return item.state == .review
                case .blocked:
                    return item.state == .blocked
                }
            }
            .prefix(8)
            .map { $0 }
    }

    private var syncState: JiraSyncState {
        model.snapshot.jiraSync ?? JiraSyncState()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .center) {
                VStack(alignment: .leading, spacing: 3) {
                    Text("Jira")
                        .font(.system(size: 18, weight: .semibold))
                    Text(syncSubtitle)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
                Spacer()
                Button {
                    Task<Void, Never> { await syncAndOpenQueue() }
                } label: {
                    Image(systemName: model.jiraSyncIsRunning ? "arrow.triangle.2.circlepath" : "arrow.clockwise")
                }
                .help("Sync current sprint")
                .disabled(model.jiraSyncIsRunning)
            }

            Picker("Filter", selection: $filter) {
                ForEach(JiraTicketSyncScope.allCases, id: \.self) { scope in
                    Text(scope.title).tag(scope)
                }
            }
            .pickerStyle(.segmented)

            if model.jiraSyncIsRunning {
                ProgressView("Syncing Jira tickets...")
                    .font(.caption)
            }

            if syncState.status == .failed, let error = syncState.lastError {
                Text(error)
                    .font(.caption)
                    .foregroundStyle(.red)
                    .lineLimit(3)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(8)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Color.red.opacity(0.08))
                    .clipShape(RoundedRectangle(cornerRadius: 7))
            }

            VStack(spacing: 7) {
                ForEach(jiraItems) { item in
                    Button {
                        open(item)
                    } label: {
                        JiraMenuTicketRow(item: item)
                    }
                    .buttonStyle(.plain)
                    .contextMenu {
                        Button("Start Work") {
                            open(item, start: true)
                        }
                        Button("Open Queue") {
                            openQueue()
                        }
                        if let url = item.jira?.url.flatMap(URL.init(string:)) {
                            Button("Open in Jira") {
                                NSWorkspace.shared.open(url)
                            }
                        }
                        Button("Copy Agent Brief") {
                            copyAgentBrief(item)
                        }
                        Button("Copy Jira Update") {
                            copyJiraUpdate(item)
                        }
                        Button("Copy Ticket Key") {
                            NSPasteboard.general.clearContents()
                            NSPasteboard.general.setString(item.jira?.key ?? item.title, forType: .string)
                        }
                    }
                }

                if jiraItems.isEmpty {
                    VStack(alignment: .leading, spacing: 5) {
                        Text("No Jira tickets")
                            .font(.system(size: 13, weight: .semibold))
                        Text("Sync your current sprint or adjust the filter.")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    .padding(10)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Color.secondary.opacity(0.08))
                    .clipShape(RoundedRectangle(cornerRadius: 7))
                }
            }

            Divider()

            HStack {
                Button("Open Queue") {
                    openQueue()
                }
                Spacer()
                Button("Start First") {
                    if let item = jiraItems.first {
                        open(item, start: true)
                    } else {
                        openQueue()
                    }
                }
                .disabled(jiraItems.isEmpty)
            }
        }
        .padding(14)
        .frame(width: 420)
        .task {
            await model.reload()
        }
    }

    private var syncSubtitle: String {
        if model.jiraSyncIsRunning { return "Syncing..." }
        if let date = syncState.lastSyncAt {
            return "\(syncState.ticketCount) ticket(s) - \(date.formatted(date: .abbreviated, time: .shortened))"
        }
        return "Sync current sprint to begin"
    }

    private func syncAndOpenQueue() async {
        _ = await model.syncJiraTickets(scope: .currentSprint)
        openQueue()
    }

    private func openQueue() {
        NotificationCenter.default.post(name: .pikiclawShowMainWindow, object: nil)
        NotificationCenter.default.post(name: .pikiclawOpenJiraQueue, object: nil)
    }

    private func open(_ item: WorkItem, start: Bool = false) {
        NotificationCenter.default.post(name: .pikiclawShowMainWindow, object: nil)
        NotificationCenter.default.post(name: .pikiclawOpenJiraTicket, object: item.id.rawValue)
        if start {
            NotificationCenter.default.post(name: .pikiclawStartSelectedJiraTicket, object: item.id.rawValue)
        }
    }

    private func copyAgentBrief(_ item: WorkItem) {
        let workspace = model.snapshot.workspaces.first { $0.id == item.workspaceId }
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(jiraTicketAgentBrief(for: item, workspace: workspace), forType: .string)
        model.statusLine = "\(item.jira?.key ?? "Jira ticket") brief copied"
    }

    private func copyJiraUpdate(_ item: WorkItem) {
        let workspace = model.snapshot.workspaces.first { $0.id == item.workspaceId }
        let draft = jiraTicketUpdateDraft(for: item, snapshot: model.snapshot, workspace: workspace)
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(draft.comment, forType: .string)
        model.statusLine = "\(item.jira?.key ?? "Jira ticket") update copied"
    }
}

private struct JiraMenuTicketRow: View {
    let item: WorkItem

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 7) {
                Text(item.jira?.key ?? "Jira")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(.white)
                    .padding(.horizontal, 6)
                    .frame(height: 20)
                    .background(tone)
                    .clipShape(RoundedRectangle(cornerRadius: 5))
                Text(item.jira?.status ?? item.state.rawValue)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                Spacer()
                if item.currentRunId != nil {
                    Image(systemName: "text.bubble")
                        .foregroundStyle(.secondary)
                }
            }
            Text(item.title)
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(.primary)
                .lineLimit(2)
            HStack(spacing: 8) {
                if let sprint = item.jira?.sprint {
                    Label(sprint, systemImage: "calendar")
                }
                Label("\(item.acceptanceCriteria.count) checks", systemImage: "checkmark.circle")
                Spacer()
            }
            .font(.caption2)
            .foregroundStyle(.secondary)
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.secondary.opacity(0.08))
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }

    private var tone: Color {
        switch item.state {
        case .blocked: .orange
        case .review: .purple
        case .active: .blue
        case .done: .green
        case .cancelled, .archived: .gray
        case .inbox, .planned: .teal
        }
    }
}
