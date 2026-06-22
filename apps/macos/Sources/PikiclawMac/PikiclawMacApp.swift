import AppKit
import SwiftUI
@preconcurrency import UserNotifications

let pikiclawMainWindowIdentifierRaw = "PikiclawMainWindow"
let pikiclawSettingsWindowTitle = "Pikiclaw Settings"

func pikiclawShouldCloseRestoredSettingsWindow(title: String, identifier: String?) -> Bool {
    title == pikiclawSettingsWindowTitle && identifier != pikiclawMainWindowIdentifierRaw
}

@MainActor
final class PikiclawAppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate, UNUserNotificationCenterDelegate {
    private var window: NSWindow?
    private let mainWindowIdentifier = NSUserInterfaceItemIdentifier(pikiclawMainWindowIdentifierRaw)

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSWindow.allowsAutomaticWindowTabbing = false
        NSApp.setActivationPolicy(.regular)
        UNUserNotificationCenter.current().delegate = self
        NotificationCenter.default.addObserver(
            forName: .pikiclawShowMainWindow,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            Task { @MainActor in
                self?.showMainWindow()
            }
        }
        showMainWindow()
        DispatchQueue.main.async { [weak self] in
            self?.closeRestoredSettingsWindows()
        }
    }

    func applicationDidBecomeActive(_ notification: Notification) {
        closeRestoredSettingsWindows()
    }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        showMainWindow()
        return false
    }

    func application(_ application: NSApplication, open urls: [URL]) {
        showMainWindow()
        for url in urls {
            postDeepLink(url)
        }
    }

    nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse
    ) async {
        guard let url = pikiclawNotificationDeepLinkURL(
            from: response.notification.request.content.userInfo
        ) else {
            return
        }
        await MainActor.run {
            self.openNotificationDeepLink(url)
        }
    }

    private func openNotificationDeepLink(_ url: URL) {
        showMainWindow()
        postDeepLink(url)
    }

    private func postDeepLink(_ url: URL) {
        NotificationCenter.default.post(name: .pikiclawOpenDeepLink, object: url)
    }

    private func showMainWindow() {
        if let window {
            if window.isMiniaturized {
                window.deminiaturize(nil)
            }
            window.makeKeyAndOrderFront(nil)
            NSApp.activate(ignoringOtherApps: true)
            return
        }

        if let existing = NSApp.windows.first(where: { $0.identifier == mainWindowIdentifier }) {
            existing.delegate = self
            if existing.isMiniaturized {
                existing.deminiaturize(nil)
            }
            existing.makeKeyAndOrderFront(nil)
            window = existing
            NSApp.activate(ignoringOtherApps: true)
            return
        }

        let rootView = RootView()
            .frame(minWidth: 1120, maxWidth: .infinity, minHeight: 700, maxHeight: .infinity, alignment: .topLeading)
            .tint(PKTheme.primary)

        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1280, height: 820),
            styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
            backing: .buffered,
            defer: false
        )
        window.title = "Pikiclaw"
        window.identifier = mainWindowIdentifier
        window.tabbingMode = .disallowed
        window.isReleasedWhenClosed = false
        window.delegate = self
        window.minSize = NSSize(width: 1120, height: 700)
        window.contentView = NSHostingView(rootView: rootView)
        window.center()
        window.makeKeyAndOrderFront(nil)
        self.window = window
        NSApp.activate(ignoringOtherApps: true)
    }

    private func closeRestoredSettingsWindows() {
        for candidate in NSApp.windows where pikiclawShouldCloseRestoredSettingsWindow(
            title: candidate.title,
            identifier: candidate.identifier?.rawValue
        ) {
            candidate.close()
        }
    }

    func windowWillClose(_ notification: Notification) {
        guard let closedWindow = notification.object as? NSWindow, closedWindow === window else { return }
        window = nil
    }
}

@main
struct PikiclawMacApp: App {
    @NSApplicationDelegateAdaptor(PikiclawAppDelegate.self) private var appDelegate

    var body: some Scene {
        Settings {
            EmptyView()
        }
        .commands {
            CommandGroup(replacing: .appSettings) {
                Button("Settings") {
                    NotificationCenter.default.post(name: .pikiclawShowMainWindow, object: nil)
                    NotificationCenter.default.post(name: .pikiclawNavigate, object: "settings")
                }
                .keyboardShortcut(",", modifiers: [.command])
            }

            CommandGroup(replacing: .newItem) {
                Button("New Chat") {
                    NotificationCenter.default.post(name: .pikiclawNewChat, object: nil)
                }
                .keyboardShortcut("n", modifiers: [.command])

                Button("New Work Item") {
                    NotificationCenter.default.post(name: .pikiclawNewWorkItem, object: nil)
                }
                .keyboardShortcut("n", modifiers: [.command, .shift])

                Button("Add Project...") {
                    NotificationCenter.default.post(name: .pikiclawAddWorkspace, object: nil)
                }
                .keyboardShortcut("o", modifiers: [.command])
            }

            CommandMenu("Navigate") {
                Button("Chat") {
                    NotificationCenter.default.post(name: .pikiclawShowMainWindow, object: nil)
                    NotificationCenter.default.post(name: .pikiclawNavigate, object: "chat")
                }
                .keyboardShortcut("1", modifiers: [.command])

                Button("Projects") {
                    NotificationCenter.default.post(name: .pikiclawShowMainWindow, object: nil)
                    NotificationCenter.default.post(name: .pikiclawNavigate, object: "projects")
                }
                .keyboardShortcut("2", modifiers: [.command])

                Button("Work Items") {
                    NotificationCenter.default.post(name: .pikiclawShowMainWindow, object: nil)
                    NotificationCenter.default.post(name: .pikiclawNavigate, object: "workItems")
                }
                .keyboardShortcut("3", modifiers: [.command])

                Button("Work Plan") {
                    NotificationCenter.default.post(name: .pikiclawShowMainWindow, object: nil)
                    NotificationCenter.default.post(name: .pikiclawNavigate, object: "workPlan")
                }
                .keyboardShortcut("4", modifiers: [.command])

                Button("Workflows") {
                    NotificationCenter.default.post(name: .pikiclawShowMainWindow, object: nil)
                    NotificationCenter.default.post(name: .pikiclawNavigate, object: "workflows")
                }
                .keyboardShortcut("5", modifiers: [.command])

                Button("Mission Control") {
                    NotificationCenter.default.post(name: .pikiclawShowMainWindow, object: nil)
                    NotificationCenter.default.post(name: .pikiclawNavigate, object: "missionControl")
                }
                .keyboardShortcut("6", modifiers: [.command])

                Button("Agent Studio") {
                    NotificationCenter.default.post(name: .pikiclawShowMainWindow, object: nil)
                    NotificationCenter.default.post(name: .pikiclawNavigate, object: "agents")
                }
                .keyboardShortcut("7", modifiers: [.command])

                Button("Assistant") {
                    NotificationCenter.default.post(name: .pikiclawShowMainWindow, object: nil)
                    NotificationCenter.default.post(name: .pikiclawNavigate, object: "assistants")
                }
                .keyboardShortcut("8", modifiers: [.command])

                Button("Notes") {
                    NotificationCenter.default.post(name: .pikiclawShowMainWindow, object: nil)
                    NotificationCenter.default.post(name: .pikiclawNavigate, object: "notes")
                }

                Button("Memory") {
                    NotificationCenter.default.post(name: .pikiclawShowMainWindow, object: nil)
                    NotificationCenter.default.post(name: .pikiclawNavigate, object: "memory")
                }

                Button("Extensions") {
                    NotificationCenter.default.post(name: .pikiclawShowMainWindow, object: nil)
                    NotificationCenter.default.post(name: .pikiclawNavigate, object: "extensions")
                }
                .keyboardShortcut("9", modifiers: [.command])

                Button("Settings") {
                    NotificationCenter.default.post(name: .pikiclawShowMainWindow, object: nil)
                    NotificationCenter.default.post(name: .pikiclawNavigate, object: "settings")
                }
                .keyboardShortcut("0", modifiers: [.command])

                Button("Context Terminal") {
                    NotificationCenter.default.post(name: .pikiclawShowMainWindow, object: nil)
                    NotificationCenter.default.post(name: .pikiclawOpenContextTerminal, object: nil)
                }
                .keyboardShortcut("t", modifiers: [.command, .shift])

                Button("Voice Lens") {
                    NotificationCenter.default.post(name: .pikiclawShowMainWindow, object: nil)
                    NotificationCenter.default.post(name: .pikiclawToggleVoiceAssistant, object: nil)
                }
                .keyboardShortcut(" ", modifiers: [.command, .shift])

                Divider()

                Button("Show Main Window") {
                    NotificationCenter.default.post(name: .pikiclawShowMainWindow, object: nil)
                }
                .keyboardShortcut("m", modifiers: [.command, .shift])

                Button("Focus Command Center") {
                    NotificationCenter.default.post(name: .pikiclawShowMainWindow, object: nil)
                    NotificationCenter.default.post(name: .pikiclawFocusCommandCenter, object: nil)
                }
                .keyboardShortcut("k", modifiers: [.command])
            }

            CommandMenu("Appearance") {
                Button("Light Mode") {
                    UserDefaults.standard.set(PKThemePreference.light.rawValue, forKey: PKThemePreference.storageKey)
                }

                Button("Dark Mode") {
                    UserDefaults.standard.set(PKThemePreference.dark.rawValue, forKey: PKThemePreference.storageKey)
                }
            }

            CommandMenu("Jira") {
                Button("Sync Current Sprint") {
                    NotificationCenter.default.post(name: .pikiclawShowMainWindow, object: nil)
                    NotificationCenter.default.post(name: .pikiclawSyncJiraCurrentSprint, object: nil)
                }
                .keyboardShortcut("j", modifiers: [.command, .option])

                Button("Open Jira Queue") {
                    NotificationCenter.default.post(name: .pikiclawShowMainWindow, object: nil)
                    NotificationCenter.default.post(name: .pikiclawOpenJiraQueue, object: nil)
                }
                .keyboardShortcut("j", modifiers: [.command, .shift])

                Button("Start Selected Ticket") {
                    NotificationCenter.default.post(name: .pikiclawShowMainWindow, object: nil)
                    NotificationCenter.default.post(name: .pikiclawStartSelectedJiraTicket, object: nil)
                }
                .keyboardShortcut(.return, modifiers: [.command, .shift])
            }

            CommandMenu("Run") {
                Button("Run Selected Work") {
                    NotificationCenter.default.post(name: .pikiclawShowMainWindow, object: nil)
                    NotificationCenter.default.post(name: .pikiclawRunSelectedWork, object: nil)
                }
                .keyboardShortcut(.return, modifiers: [.command])

                Button(missionOpenFocusedLaneCommandTitle) {
                    NotificationCenter.default.post(name: .pikiclawShowMainWindow, object: nil)
                    NotificationCenter.default.post(name: .pikiclawOpenFocusedMissionLane, object: nil)
                }
                .keyboardShortcut(.return, modifiers: [.command, .option])

                Button(generatedUIStageFocusedActionCommandTitle) {
                    NotificationCenter.default.post(name: .pikiclawShowMainWindow, object: nil)
                    NotificationCenter.default.post(name: .pikiclawStageFocusedGeneratedUIAction, object: nil)
                }
                .keyboardShortcut("s", modifiers: [.command, .option])

                Button(missionFocusNextLaneCommandTitle) {
                    NotificationCenter.default.post(name: .pikiclawShowMainWindow, object: nil)
                    NotificationCenter.default.post(name: .pikiclawFocusNextMissionLane, object: nil)
                }
                .keyboardShortcut("]", modifiers: [.command, .option])

                Button(missionFocusPreviousLaneCommandTitle) {
                    NotificationCenter.default.post(name: .pikiclawShowMainWindow, object: nil)
                    NotificationCenter.default.post(name: .pikiclawFocusPreviousMissionLane, object: nil)
                }
                .keyboardShortcut("[", modifiers: [.command, .option])

                Button("Restart Pikiclaw") {
                    NotificationCenter.default.post(name: .pikiclawShowMainWindow, object: nil)
                    NotificationCenter.default.post(name: .pikiclawRestartApplication, object: nil)
                }
                .keyboardShortcut("r", modifiers: [.command, .control])

                Button("Open Mission Control") {
                    NotificationCenter.default.post(name: .pikiclawShowMainWindow, object: nil)
                    NotificationCenter.default.post(name: .pikiclawNavigate, object: "missionControl")
                }
            }
        }

        MenuBarExtra("Jira", systemImage: "checklist") {
            JiraMenuBarView()
        }
        .menuBarExtraStyle(.window)
    }
}
