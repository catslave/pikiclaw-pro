import Foundation

public struct EntityID: Hashable, Codable, Identifiable, Sendable, ExpressibleByStringLiteral {
    public let rawValue: String

    public var id: String { rawValue }

    public init(_ rawValue: String = UUID().uuidString) {
        self.rawValue = rawValue
    }

    public init(stringLiteral value: String) {
        self.rawValue = value
    }
}

extension EntityID: CustomStringConvertible {
    public var description: String { rawValue }
}

