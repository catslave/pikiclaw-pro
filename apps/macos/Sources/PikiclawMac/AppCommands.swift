import Foundation

let missionOpenFocusedLaneCommandTitle = "Open Focused Mission Lane"
let missionOpenFocusedLaneShortcutLabel = "Cmd-Opt-Return"
let missionOpenFocusedLaneUnavailableStatus = "No Mission lane is pinned"
let missionFocusNextLaneCommandTitle = "Focus Next Mission Lane"
let missionFocusPreviousLaneCommandTitle = "Focus Previous Mission Lane"
let missionFocusNextLaneShortcutLabel = "Cmd-Opt-]"
let missionFocusPreviousLaneShortcutLabel = "Cmd-Opt-["
let missionFocusLaneShortcutHint = "Cmd-Opt-[ / ]"
let missionFocusLaneUnavailableStatus = "No Mission lane target is available"
let generatedUIStageFocusedActionCommandTitle = "Stage Focused Generated UI Action"
let generatedUIStageFocusedActionShortcutLabel = "Cmd-Opt-S"
let generatedUIStageFocusedActionUnavailableStatus = "No focused generated UI action is open"

extension Notification.Name {
    static let pikiclawNewChat = Notification.Name("PikiclawNewChat")
    static let pikiclawNewWorkItem = Notification.Name("PikiclawNewWorkItem")
    static let pikiclawAddWorkspace = Notification.Name("PikiclawAddWorkspace")
    static let pikiclawRunSelectedWork = Notification.Name("PikiclawRunSelectedWork")
    static let pikiclawRestartApplication = Notification.Name("PikiclawRestartApplication")
    static let pikiclawFocusCommandCenter = Notification.Name("PikiclawFocusCommandCenter")
    static let pikiclawToggleVoiceAssistant = Notification.Name("PikiclawToggleVoiceAssistant")
    static let pikiclawOpenContextTerminal = Notification.Name("PikiclawOpenContextTerminal")
    static let pikiclawNavigate = Notification.Name("PikiclawNavigate")
    static let pikiclawOpenDeepLink = Notification.Name("PikiclawOpenDeepLink")
    static let pikiclawShowMainWindow = Notification.Name("PikiclawShowMainWindow")
    static let pikiclawOpenFocusedMissionLane = Notification.Name("PikiclawOpenFocusedMissionLane")
    static let pikiclawFocusNextMissionLane = Notification.Name("PikiclawFocusNextMissionLane")
    static let pikiclawFocusPreviousMissionLane = Notification.Name("PikiclawFocusPreviousMissionLane")
    static let pikiclawStageFocusedGeneratedUIAction = Notification.Name("PikiclawStageFocusedGeneratedUIAction")
    static let pikiclawSyncJiraCurrentSprint = Notification.Name("PikiclawSyncJiraCurrentSprint")
    static let pikiclawOpenJiraQueue = Notification.Name("PikiclawOpenJiraQueue")
    static let pikiclawOpenJiraTicket = Notification.Name("PikiclawOpenJiraTicket")
    static let pikiclawStartSelectedJiraTicket = Notification.Name("PikiclawStartSelectedJiraTicket")
}
