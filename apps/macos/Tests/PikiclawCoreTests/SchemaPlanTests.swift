import Testing
@testable import PikiclawCore

@Test func schemaPlanCoversCoreProductObjects() {
    #expect(NativeSchemaPlan.tables.contains("workspaces"))
    #expect(NativeSchemaPlan.tables.contains("work_items"))
    #expect(NativeSchemaPlan.tables.contains("runs"))
    #expect(NativeSchemaPlan.tables.contains("artifacts"))
    #expect(NativeSchemaPlan.tables.contains("capabilities"))
    #expect(NativeSchemaPlan.tables.contains("knowledge_cards"))
    #expect(NativeSchemaPlan.tables.contains("audit_events"))
}

