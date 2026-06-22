import Foundation
import PikiclawCore

struct ComposerBuiltinCommandOption: Equatable, Identifiable {
    let id: EntityID
    let title: String
    let subtitle: String
    let symbol: String
    let command: String
}

enum ComposerSkillAvailabilityMode: Int, Equatable {
    case native = 0
    case portable = 1
    case needsSetup = 2
    case unsupported = 3

    var label: String {
        switch self {
        case .native: return "Native"
        case .portable: return "Portable"
        case .needsSetup: return "Needs setup"
        case .unsupported: return "Unsupported"
        }
    }
}

struct ComposerSkillAvailability: Equatable {
    let mode: ComposerSkillAvailabilityMode
    let detail: String
}

func composerSkillAvailability(for capability: Capability, agentKind: NativeAgentKind) -> ComposerSkillAvailability {
    guard agentKind != .customCLI else {
        return ComposerSkillAvailability(mode: .unsupported, detail: "Unsupported on Custom CLI")
    }

    if capability.healthState == .needsConfiguration
        || capability.healthState == .unavailable
        || capability.healthState == .failed
        || (capability.configState != "ready" && capability.configState != "unknown") {
        let detail = capability.configState == "unknown" ? capability.healthState.rawValue : capability.configState
        return ComposerSkillAvailability(mode: .needsSetup, detail: detail)
    }

    if capability.scope == .agent {
        return ComposerSkillAvailability(mode: .native, detail: "Native on \(composerAgentLabel(agentKind))")
    }

    return ComposerSkillAvailability(mode: .portable, detail: "Portable on \(composerAgentLabel(agentKind))")
}

func composerSkillAvailabilityPriority(for capability: Capability, agentKind: NativeAgentKind) -> Int {
    let availability = composerSkillAvailability(for: capability, agentKind: agentKind)
    return availability.mode.rawValue
}

private func composerAgentLabel(_ agentKind: NativeAgentKind) -> String {
    switch agentKind {
    case .claude: return "Claude"
    case .codex: return "Codex"
    case .cursor: return "Cursor"
    case .gemini: return "Gemini"
    case .githubCopilot: return "Copilot"
    case .hermes: return "Hermes"
    case .customCLI: return "Custom CLI"
    }
}

func composerBuiltinCommandOptions(for agentKind: NativeAgentKind) -> [ComposerBuiltinCommandOption] {
    let supportsPortableGoal = agentKind != .customCLI
    var options: [ComposerBuiltinCommandOption] = []

    if supportsPortableGoal {
        let goalSubtitle: String
        switch agentKind {
        case .codex:
            goalSubtitle = "Native Codex goal"
        case .claude:
            goalSubtitle = "Claude goal, no pause"
        default:
            goalSubtitle = "Portable Pikiclaw goal"
        }
        options.append(ComposerBuiltinCommandOption(
            id: EntityID("composer-builtin-\(agentKind.rawValue)-goal"),
            title: "Goal",
            subtitle: goalSubtitle,
            symbol: "target",
            command: "/goal "
        ))
        if agentKind == .codex || agentKind == .cursor || agentKind == .gemini || agentKind == .githubCopilot || agentKind == .hermes {
            options.append(ComposerBuiltinCommandOption(
                id: EntityID("composer-builtin-\(agentKind.rawValue)-goal-pause"),
                title: "Pause Goal",
                subtitle: "Pause continuation",
                symbol: "pause.circle",
                command: "/goal pause"
            ))
            options.append(ComposerBuiltinCommandOption(
                id: EntityID("composer-builtin-\(agentKind.rawValue)-goal-resume"),
                title: "Resume Goal",
                subtitle: "Resume continuation",
                symbol: "play.circle",
                command: "/goal resume"
            ))
        }
        options.append(ComposerBuiltinCommandOption(
            id: EntityID("composer-builtin-\(agentKind.rawValue)-goal-clear"),
            title: "Clear Goal",
            subtitle: "Remove active goal",
            symbol: "xmark.circle",
            command: "/goal clear"
        ))
    }

    if agentKind != .hermes && agentKind != .customCLI {
        options.append(ComposerBuiltinCommandOption(
            id: EntityID("composer-builtin-\(agentKind.rawValue)-plan"),
            title: "Plan",
            subtitle: agentKind == .codex || agentKind == .claude || agentKind == .gemini ? "Native plan mode" : "Portable plan",
            symbol: "list.bullet.clipboard",
            command: "/plan "
        ))
    }

    return options
}
