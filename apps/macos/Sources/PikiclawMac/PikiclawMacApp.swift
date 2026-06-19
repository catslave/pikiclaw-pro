import AppKit
import SwiftUI

@MainActor
final class PikiclawAppDelegate: NSObject, NSApplicationDelegate {
    private var window: NSWindow?

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSWindow.allowsAutomaticWindowTabbing = false
        NSApp.setActivationPolicy(.regular)
        showMainWindow()
    }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        showMainWindow()
        return true
    }

    private func showMainWindow() {
        if let window {
            window.makeKeyAndOrderFront(nil)
            NSApp.activate(ignoringOtherApps: true)
            return
        }

        let rootView = RootView()
            .frame(minWidth: 1120, minHeight: 700)
            .tint(PKTheme.primary)

        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1280, height: 820),
            styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
            backing: .buffered,
            defer: false
        )
        window.title = "Pikiclaw"
        window.tabbingMode = .disallowed
        window.minSize = NSSize(width: 1120, height: 700)
        window.contentView = NSHostingView(rootView: rootView)
        window.center()
        window.makeKeyAndOrderFront(nil)
        self.window = window
        NSApp.activate(ignoringOtherApps: true)
    }
}

@main
struct PikiclawMacApp: App {
    @NSApplicationDelegateAdaptor(PikiclawAppDelegate.self) private var appDelegate

    var body: some Scene {
        WindowGroup {
            RootView()
                .frame(minWidth: 1120, minHeight: 700)
                .tint(PKTheme.primary)
        }
        .commands {
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
                    NotificationCenter.default.post(name: .pikiclawNavigate, object: "chat")
                }
                .keyboardShortcut("1", modifiers: [.command])

                Button("Projects") {
                    NotificationCenter.default.post(name: .pikiclawNavigate, object: "projects")
                }
                .keyboardShortcut("2", modifiers: [.command])

                Button("Work Items") {
                    NotificationCenter.default.post(name: .pikiclawNavigate, object: "workItems")
                }
                .keyboardShortcut("3", modifiers: [.command])

                Button("Work Plan") {
                    NotificationCenter.default.post(name: .pikiclawNavigate, object: "workPlan")
                }
                .keyboardShortcut("4", modifiers: [.command])

                Button("Workflows") {
                    NotificationCenter.default.post(name: .pikiclawNavigate, object: "workflows")
                }
                .keyboardShortcut("5", modifiers: [.command])

                Button("Mission Control") {
                    NotificationCenter.default.post(name: .pikiclawNavigate, object: "missionControl")
                }
                .keyboardShortcut("6", modifiers: [.command])

                Button("Agent Studio") {
                    NotificationCenter.default.post(name: .pikiclawNavigate, object: "agents")
                }
                .keyboardShortcut("7", modifiers: [.command])

                Divider()

                Button("Focus Command Center") {
                    NotificationCenter.default.post(name: .pikiclawFocusCommandCenter, object: nil)
                }
                .keyboardShortcut("k", modifiers: [.command])

                Button("Voice Assistant") {
                    NotificationCenter.default.post(name: .pikiclawToggleVoiceAssistant, object: nil)
                }
                .keyboardShortcut("v", modifiers: [.command, .shift])
            }

            CommandMenu("Appearance") {
                Button("Light Mode") {
                    UserDefaults.standard.set(PKThemePreference.light.rawValue, forKey: PKThemePreference.storageKey)
                }

                Button("Dark Mode") {
                    UserDefaults.standard.set(PKThemePreference.dark.rawValue, forKey: PKThemePreference.storageKey)
                }
            }

            CommandMenu("Run") {
                Button("Run Selected Work") {
                    NotificationCenter.default.post(name: .pikiclawRunSelectedWork, object: nil)
                }
                .keyboardShortcut(.return, modifiers: [.command])

                Button("Restart Pikiclaw") {
                    NotificationCenter.default.post(name: .pikiclawRestartApplication, object: nil)
                }
                .keyboardShortcut("r", modifiers: [.command, .control])

                Button("Open Mission Control") {
                    NotificationCenter.default.post(name: .pikiclawNavigate, object: "missionControl")
                }
            }
        }
    }
}
