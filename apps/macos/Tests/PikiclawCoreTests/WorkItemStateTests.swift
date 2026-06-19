import Testing
@testable import PikiclawCore

@Test func workItemStateAllowsExpectedForwardFlow() {
    #expect(WorkItemState.inbox.canTransition(to: .planned))
    #expect(WorkItemState.planned.canTransition(to: .active))
    #expect(WorkItemState.active.canTransition(to: .review))
    #expect(WorkItemState.review.canTransition(to: .done))
}

@Test func workItemStateRejectsInvalidReverseFlow() {
    #expect(!WorkItemState.done.canTransition(to: .active))
    #expect(!WorkItemState.archived.canTransition(to: .inbox))
}

