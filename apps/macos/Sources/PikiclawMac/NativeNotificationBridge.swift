import Foundation
@preconcurrency import UserNotifications

enum NativeNotificationReadiness: Equatable, Sendable {
    case unknown
    case notDetermined
    case authorized
    case provisional
    case ephemeral
    case denied

    var canSchedule: Bool {
        switch self {
        case .authorized, .provisional, .ephemeral:
            return true
        case .unknown, .notDetermined, .denied:
            return false
        }
    }

    var badgeText: String {
        switch self {
        case .unknown: return "Notifications: Unknown"
        case .notDetermined: return "Notifications: Ask"
        case .authorized: return "Notifications: Ready"
        case .provisional: return "Notifications: Quiet"
        case .ephemeral: return "Notifications: Session"
        case .denied: return "Notifications: Off"
        }
    }

    var detail: String {
        switch self {
        case .unknown:
            return "Notification permission has not been checked yet."
        case .notDetermined:
            return "Notification permission is needed before native reminders can interrupt you."
        case .authorized:
            return "Native reminders can interrupt you and reopen exact Pikiclaw evidence."
        case .provisional:
            return "Native reminders can be delivered quietly and reopen exact Pikiclaw evidence."
        case .ephemeral:
            return "Native reminders are available for this app session."
        case .denied:
            return "System notifications are disabled; use the in-app evidence link instead."
        }
    }

    static func from(_ status: UNAuthorizationStatus) -> NativeNotificationReadiness {
        switch status {
        case .notDetermined: return .notDetermined
        case .denied: return .denied
        case .authorized: return .authorized
        case .provisional: return .provisional
        case .ephemeral: return .ephemeral
        @unknown default: return .unknown
        }
    }
}

struct NativeNotificationScheduleResult: Equatable, Sendable {
    var readiness: NativeNotificationReadiness
    var requestIdentifier: String?
    var didEnqueue: Bool
    var statusLine: String
}

@MainActor
protocol NativeNotificationCenterClient {
    func authorizationStatus() async -> UNAuthorizationStatus
    func requestAuthorization(options: UNAuthorizationOptions) async throws -> Bool
    func add(_ request: UNNotificationRequest) async throws
}

@MainActor
struct SystemNativeNotificationCenterClient: NativeNotificationCenterClient {
    func authorizationStatus() async -> UNAuthorizationStatus {
        await UNUserNotificationCenter.current().notificationSettings().authorizationStatus
    }

    func requestAuthorization(options: UNAuthorizationOptions) async throws -> Bool {
        try await UNUserNotificationCenter.current().requestAuthorization(options: options)
    }

    func add(_ request: UNNotificationRequest) async throws {
        try await UNUserNotificationCenter.current().add(request)
    }
}

enum NativeNotificationBridge {
    static func userInfo(for payload: NativeNotificationActionPayload) -> [String: String]? {
        guard let url = payload.primaryURL else { return nil }
        return pikiclawNotificationDeepLinkUserInfo(url: url)
    }

    static func content(for payload: NativeNotificationActionPayload) -> UNMutableNotificationContent? {
        guard let userInfo = userInfo(for: payload) else { return nil }
        let content = UNMutableNotificationContent()
        content.title = payload.title
        content.body = payload.body
        content.userInfo = userInfo
        return content
    }

    static func request(
        for payload: NativeNotificationActionPayload,
        identifier: String? = nil
    ) -> UNNotificationRequest? {
        guard let content = content(for: payload) else { return nil }
        return UNNotificationRequest(
            identifier: identifier ?? "pikiclaw.notification.\(payload.automationId)",
            content: content,
            trigger: nil
        )
    }

    @MainActor
    static func readiness(center: any NativeNotificationCenterClient = SystemNativeNotificationCenterClient()) async -> NativeNotificationReadiness {
        let status = await center.authorizationStatus()
        return NativeNotificationReadiness.from(status)
    }

    @MainActor
    static func enqueue(
        _ payload: NativeNotificationActionPayload,
        center: any NativeNotificationCenterClient = SystemNativeNotificationCenterClient(),
        requestAuthorizationIfNeeded: Bool = true
    ) async -> NativeNotificationScheduleResult {
        var readiness = await readiness(center: center)
        guard let request = request(for: payload) else {
            return NativeNotificationScheduleResult(
                readiness: readiness,
                requestIdentifier: nil,
                didEnqueue: false,
                statusLine: "No native notification link for \(payload.automationName)"
            )
        }

        if readiness == .notDetermined {
            guard requestAuthorizationIfNeeded else {
                return NativeNotificationScheduleResult(
                    readiness: readiness,
                    requestIdentifier: nil,
                    didEnqueue: false,
                    statusLine: "Notification permission needed for \(payload.automationName)"
                )
            }
            do {
                let granted = try await center.requestAuthorization(options: [.alert, .sound, .badge])
                readiness = granted ? .authorized : .denied
            } catch {
                return NativeNotificationScheduleResult(
                    readiness: readiness,
                    requestIdentifier: nil,
                    didEnqueue: false,
                    statusLine: "Notification permission failed: \(error.localizedDescription)"
                )
            }
        }

        guard readiness.canSchedule else {
            return NativeNotificationScheduleResult(
                readiness: readiness,
                requestIdentifier: nil,
                didEnqueue: false,
                statusLine: "\(readiness.badgeText); \(readiness.detail)"
            )
        }

        do {
            try await center.add(request)
            return NativeNotificationScheduleResult(
                readiness: readiness,
                requestIdentifier: request.identifier,
                didEnqueue: true,
                statusLine: "Notification scheduled: \(payload.primaryLink?.label ?? payload.automationName)"
            )
        } catch {
            return NativeNotificationScheduleResult(
                readiness: readiness,
                requestIdentifier: nil,
                didEnqueue: false,
                statusLine: "Notification scheduling failed: \(error.localizedDescription)"
            )
        }
    }
}
