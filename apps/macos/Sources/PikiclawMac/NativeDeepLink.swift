import Foundation
import PikiclawCore

let pikiclawNotificationDeepLinkUserInfoKey = "pikiclawDeepLink"

enum NativeDeepLinkRunFocus: Equatable, Sendable {
    case chat
    case evidence
}

enum NativeDeepLinkDestination: Equatable, Sendable {
    case route(NativeRoute)
    case missionOutputReview
    case missionLatestEvidence(workItemId: EntityID?)
    case run(runId: EntityID, focus: NativeDeepLinkRunFocus)
    case workItem(EntityID)
    case artifact(EntityID)
    case jiraWriteBack(issueKey: String)
}

func nativeDeepLinkDestination(for url: URL) -> NativeDeepLinkDestination? {
    guard url.scheme?.lowercased() == "pikiclaw" else { return nil }
    let segments = nativeDeepLinkSegments(url)
    guard let root = segments.first else { return .route(.chat) }
    let rootKey = nativeDeepLinkKey(root)
    let tail = Array(segments.dropFirst())

    switch rootKey {
    case "missioncontrol":
        if tail.first.map(nativeDeepLinkKey) == "outputreview" {
            return .missionOutputReview
        }
        if tail.first.map(nativeDeepLinkKey) == "latestevidence" {
            return .missionLatestEvidence(workItemId: nativeDeepLinkMissionLatestEvidenceWorkItemId(tail))
        }
        return .route(.missionControl)
    case "runs", "run":
        guard let id = tail.first?.nilIfEmpty else { return .route(.chat) }
        let focus: NativeDeepLinkRunFocus = tail.dropFirst().contains { nativeDeepLinkKey($0) == "evidence" } ? .evidence : .chat
        return .run(runId: EntityID(id), focus: focus)
    case "workitems", "workitem":
        guard let id = tail.first?.nilIfEmpty else { return .route(.workItems) }
        return .workItem(EntityID(id))
    case "artifacts", "artifact":
        guard let id = tail.first?.nilIfEmpty else { return .missionOutputReview }
        return .artifact(EntityID(id))
    case "jira":
        guard let issueKey = tail.first?.nilIfEmpty else { return .route(.workItems) }
        if tail.dropFirst().contains(where: { nativeDeepLinkKey($0) == "writeback" }) {
            return .jiraWriteBack(issueKey: issueKey)
        }
        return .workItem(EntityID("jira-\(issueKey.lowercased())"))
    default:
        if let route = NativeRoute.matching(root) {
            return .route(route)
        }
        return nil
    }
}

func pikiclawNotificationDeepLinkUserInfo(url: URL) -> [String: String] {
    [pikiclawNotificationDeepLinkUserInfoKey: url.absoluteString]
}

func pikiclawNotificationDeepLinkURL(from userInfo: [AnyHashable: Any]) -> URL? {
    let rawValue = userInfo[pikiclawNotificationDeepLinkUserInfoKey]
    let url: URL?
    if let value = rawValue as? URL {
        url = value
    } else if let value = rawValue as? String {
        url = URL(string: value)
    } else {
        url = nil
    }
    guard let url,
          nativeDeepLinkDestination(for: url) != nil else {
        return nil
    }
    return url
}

private func nativeDeepLinkMissionLatestEvidenceWorkItemId(_ tail: [String]) -> EntityID? {
    let remaining = Array(tail.dropFirst())
    guard let first = remaining.first?.nilIfEmpty else { return nil }
    let firstKey = nativeDeepLinkKey(first)
    if ["workitem", "workitems"].contains(firstKey) {
        return remaining.dropFirst().first?.nilIfEmpty.map { EntityID($0) }
    }
    return EntityID(first)
}

private func nativeDeepLinkSegments(_ url: URL) -> [String] {
    var segments: [String] = []
    if let host = url.host?.removingPercentEncoding?.nilIfEmpty {
        segments.append(host)
    }
    segments.append(contentsOf: url.path
        .split(separator: "/")
        .compactMap { String($0).removingPercentEncoding?.nilIfEmpty })
    return segments
}

private func nativeDeepLinkKey(_ value: String) -> String {
    value
        .lowercased()
        .filter { $0.isLetter || $0.isNumber }
}

private extension String {
    var nilIfEmpty: String? {
        isEmpty ? nil : self
    }
}
