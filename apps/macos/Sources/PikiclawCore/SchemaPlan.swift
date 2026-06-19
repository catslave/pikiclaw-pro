import Foundation

public struct NativeSchemaPlan: Hashable, Sendable {
    public static let currentVersion = 1

    public static let tables: [String] = [
        "workspaces",
        "projects",
        "work_items",
        "runs",
        "turns",
        "tool_calls",
        "artifacts",
        "capabilities",
        "agent_profiles",
        "provider_profiles",
        "knowledge_cards",
        "automations",
        "audit_events"
    ]
}

