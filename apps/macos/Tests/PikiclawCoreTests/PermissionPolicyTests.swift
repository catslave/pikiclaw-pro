import Testing
@testable import PikiclawCore

@Test func readOnlyPolicyAllowsOnlyRead() {
    let policy = PermissionPolicy(mode: .readOnly)
    #expect(policy.decision(for: .read) == .allow)
    #expect(policy.decision(for: .write) == .deny)
    #expect(policy.decision(for: .execute) == .deny)
}

@Test func askBeforeEditPolicyPromptsForMutatingWork() {
    let policy = PermissionPolicy(mode: .askBeforeEdit)
    #expect(policy.decision(for: .read) == .allow)
    #expect(policy.decision(for: .write) == .ask)
    #expect(policy.decision(for: .externalWriteback) == .ask)
}

@Test func autopilotStillPromptsForHighImpactActions() {
    let policy = PermissionPolicy(mode: .autopilot)
    #expect(policy.decision(for: .write) == .allow)
    #expect(policy.decision(for: .destructive) == .ask)
    #expect(policy.decision(for: .externalWriteback) == .ask)
}

