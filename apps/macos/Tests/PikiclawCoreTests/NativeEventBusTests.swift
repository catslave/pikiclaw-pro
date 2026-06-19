import Testing
@testable import PikiclawCore

@Test func nativeEventBusStoresRecentEventsInOrder() async {
    let bus = NativeEventBus()
    await bus.publish(.workItemChanged("work-a"))
    await bus.publish(.runStateChanged(runId: "run-a", state: .running))

    let events = await bus.recent()
    #expect(events == [
        .workItemChanged("work-a"),
        .runStateChanged(runId: "run-a", state: .running)
    ])
}

