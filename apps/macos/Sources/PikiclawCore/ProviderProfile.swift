import Foundation

public enum ProviderKind: String, Codable, Sendable, CaseIterable {
    case anthropic
    case openAI
    case gemini
    case deepSeek
    case doubao
    case miniMax
    case openRouter
    case local
    case openAICompatible
}

public struct ProviderProfile: Identifiable, Hashable, Codable, Sendable {
    public var id: EntityID
    public var kind: ProviderKind
    public var displayName: String
    public var baseURL: String?
    public var keychainSecretRef: String?
    public var defaultModel: String?
    public var healthState: CapabilityHealthState
    public var lastValidatedAt: Date?

    public init(
        id: EntityID = EntityID(),
        kind: ProviderKind,
        displayName: String,
        baseURL: String? = nil,
        keychainSecretRef: String? = nil,
        defaultModel: String? = nil,
        healthState: CapabilityHealthState = .unknown,
        lastValidatedAt: Date? = nil
    ) {
        self.id = id
        self.kind = kind
        self.displayName = displayName
        self.baseURL = baseURL
        self.keychainSecretRef = keychainSecretRef
        self.defaultModel = defaultModel
        self.healthState = healthState
        self.lastValidatedAt = lastValidatedAt
    }
}

