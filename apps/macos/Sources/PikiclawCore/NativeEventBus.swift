import Foundation

public enum NativeEvent: Hashable, Codable, Sendable {
    case workItemChanged(EntityID)
    case runStateChanged(runId: EntityID, state: RunState)
    case artifactCreated(EntityID)
    case capabilityHealthChanged(capabilityId: EntityID, state: CapabilityHealthState)
    case automationChanged(EntityID)
    case audit(AuditEvent)
}

public actor NativeEventBus {
    private var events: [NativeEvent] = []

    public init() {}

    public func publish(_ event: NativeEvent) {
        events.append(event)
    }

    public func recent(limit: Int = 100) -> [NativeEvent] {
        Array(events.suffix(max(0, limit)))
    }

    public func clear() {
        events.removeAll()
    }
}

