import Foundation

public enum JiraTicketSyncScope: String, Codable, Sendable, CaseIterable {
    case mine
    case currentSprint
    case review
    case blocked

    public var title: String {
        switch self {
        case .mine: "Mine"
        case .currentSprint: "Sprint"
        case .review: "Review"
        case .blocked: "Blocked"
        }
    }
}

public enum JiraTicketSyncStatus: String, Codable, Sendable {
    case idle
    case syncing
    case succeeded
    case failed
}

public struct JiraSyncState: Hashable, Codable, Sendable {
    public var status: JiraTicketSyncStatus
    public var scope: JiraTicketSyncScope
    public var source: String?
    public var lastSyncAt: Date?
    public var lastError: String?
    public var ticketCount: Int

    public init(
        status: JiraTicketSyncStatus = .idle,
        scope: JiraTicketSyncScope = .currentSprint,
        source: String? = nil,
        lastSyncAt: Date? = nil,
        lastError: String? = nil,
        ticketCount: Int = 0
    ) {
        self.status = status
        self.scope = scope
        self.source = source
        self.lastSyncAt = lastSyncAt
        self.lastError = lastError
        self.ticketCount = ticketCount
    }
}

public struct JiraWorkItemFields: Hashable, Codable, Sendable {
    public var key: String
    public var url: String?
    public var status: String?
    public var assignee: String?
    public var priority: String?
    public var issueType: String?
    public var sprint: String?
    public var remoteUpdatedAt: String?

    public init(
        key: String,
        url: String? = nil,
        status: String? = nil,
        assignee: String? = nil,
        priority: String? = nil,
        issueType: String? = nil,
        sprint: String? = nil,
        remoteUpdatedAt: String? = nil
    ) {
        self.key = key
        self.url = url
        self.status = status
        self.assignee = assignee
        self.priority = priority
        self.issueType = issueType
        self.sprint = sprint
        self.remoteUpdatedAt = remoteUpdatedAt
    }
}

public struct JiraTicket: Hashable, Codable, Identifiable, Sendable {
    public var key: String
    public var title: String
    public var description: String
    public var url: String?
    public var status: String?
    public var assignee: String?
    public var priority: String?
    public var issueType: String?
    public var sprint: String?
    public var updatedAt: String?

    public var id: String { key }

    public init(
        key: String,
        title: String,
        description: String = "",
        url: String? = nil,
        status: String? = nil,
        assignee: String? = nil,
        priority: String? = nil,
        issueType: String? = nil,
        sprint: String? = nil,
        updatedAt: String? = nil
    ) {
        self.key = key
        self.title = title
        self.description = description
        self.url = url
        self.status = status
        self.assignee = assignee
        self.priority = priority
        self.issueType = issueType
        self.sprint = sprint
        self.updatedAt = updatedAt
    }
}

public struct JiraTicketApplySummary: Hashable, Sendable {
    public var created: Int
    public var updated: Int
    public var unchanged: Int
    public var selectedWorkItemId: EntityID?

    public var ticketCount: Int { created + updated + unchanged }
}

public enum JiraTicketPayloadParser {
    public static func decodeTickets(from data: Data, baseURL: String? = nil) throws -> [JiraTicket] {
        let json = try JSONSerialization.jsonObject(with: data)
        let rawTickets = ticketObjects(from: json)
        return rawTickets.compactMap { ticket(from: $0, baseURL: baseURL) }
    }

    private static func ticketObjects(from json: Any) -> [[String: Any]] {
        if let tickets = json as? [[String: Any]] {
            return tickets
        }
        guard let object = json as? [String: Any] else { return [] }
        for key in ["tickets", "items", "issues"] {
            if let values = object[key] as? [[String: Any]] {
                return values
            }
        }
        return []
    }

    private static func ticket(from object: [String: Any], baseURL: String?) -> JiraTicket? {
        let fields = object["fields"] as? [String: Any] ?? object
        let key = string(object["key"]) ?? string(fields["key"])
        let title = string(object["title"])
            ?? string(object["summary"])
            ?? string(fields["summary"])
            ?? string(fields["title"])
        guard let key, let title, !key.isEmpty, !title.isEmpty else { return nil }

        let url = string(object["url"])
            ?? string(object["self"])
            ?? browseURL(baseURL: baseURL, key: key)
        return JiraTicket(
            key: key,
            title: title,
            description: string(object["description"]) ?? string(fields["description"]) ?? "",
            url: url,
            status: name(from: fields["status"]) ?? string(fields["status"]) ?? string(object["status"]),
            assignee: displayName(from: fields["assignee"]) ?? string(fields["assignee"]) ?? string(object["assignee"]),
            priority: name(from: fields["priority"]) ?? string(fields["priority"]) ?? string(object["priority"]),
            issueType: name(from: fields["issuetype"]) ?? name(from: fields["issueType"]) ?? string(object["issueType"]),
            sprint: sprintName(from: fields) ?? string(object["sprint"]),
            updatedAt: string(fields["updated"]) ?? string(object["updatedAt"])
        )
    }

    private static func browseURL(baseURL: String?, key: String) -> String? {
        guard let baseURL, !baseURL.isEmpty else { return nil }
        return baseURL.trimmingCharacters(in: CharacterSet(charactersIn: "/")) + "/browse/" + key
    }

    private static func displayName(from value: Any?) -> String? {
        guard let object = value as? [String: Any] else { return nil }
        return string(object["displayName"])
            ?? string(object["name"])
            ?? string(object["emailAddress"])
    }

    private static func name(from value: Any?) -> String? {
        guard let object = value as? [String: Any] else { return nil }
        return string(object["name"])
            ?? string(object["value"])
            ?? string(object["key"])
    }

    private static func sprintName(from fields: [String: Any]) -> String? {
        let direct = name(from: fields["sprint"]) ?? string(fields["sprint"])
        if let direct { return direct }

        for (key, value) in fields where key.hasPrefix("customfield_") {
            if let values = value as? [[String: Any]],
               let first = values.first,
               let name = name(from: first) {
                return name
            }
            if let values = value as? [String],
               let found = values.compactMap(parseSprintName).first {
                return found
            }
        }
        return nil
    }

    private static func parseSprintName(_ value: String) -> String? {
        guard let range = value.range(of: "name=") else { return nil }
        let suffix = value[range.upperBound...]
        let name = suffix.split(separator: ",", maxSplits: 1).first.map(String.init)
        return name?.trimmingCharacters(in: .whitespacesAndNewlines).nilIfEmpty
    }

    private static func string(_ value: Any?) -> String? {
        if let value = value as? String {
            return value.trimmingCharacters(in: .whitespacesAndNewlines).nilIfEmpty
        }
        if let value = value as? CustomStringConvertible {
            return value.description.trimmingCharacters(in: .whitespacesAndNewlines).nilIfEmpty
        }
        return nil
    }
}

private extension String {
    var nilIfEmpty: String? {
        isEmpty ? nil : self
    }
}
