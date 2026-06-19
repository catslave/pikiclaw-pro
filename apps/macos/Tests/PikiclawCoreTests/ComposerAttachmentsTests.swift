import Testing
@testable import PikiclawCore

@Test func composerAttachmentPromptAppendsImagePaths() {
    let prompt = ComposerAttachmentPrompt.appendImageRefs(
        to: "Describe this screenshot",
        images: [
            ComposerImageAttachmentRef(name: "screen.png", path: "/tmp/screen.png"),
            ComposerImageAttachmentRef(name: "trace.jpg", path: "/tmp/trace.jpg")
        ]
    )

    #expect(prompt.contains("Describe this screenshot"))
    #expect(prompt.contains("Attached images for the agent:"))
    #expect(prompt.contains("- screen.png: /tmp/screen.png"))
    #expect(prompt.contains("- trace.jpg: /tmp/trace.jpg"))
}

@Test func composerAttachmentPromptAllowsImageOnlyMessages() {
    let prompt = ComposerAttachmentPrompt.appendImageRefs(
        to: "   ",
        images: [ComposerImageAttachmentRef(name: "paste.png", path: "/tmp/paste.png")]
    )

    #expect(prompt.hasPrefix("Attached images for the agent:"))
    #expect(prompt.contains("paste.png"))
}
