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

@Test func composerAttachmentPromptAppendsReferenceLinks() {
    let prompt = ComposerAttachmentPrompt.appendReferenceRefs(
        to: "Summarize these references",
        references: [
            ComposerReferenceAttachmentRef(kind: .file, title: "plan.md", value: "/tmp/plan.md"),
            ComposerReferenceAttachmentRef(kind: .web, title: "example.com/docs", value: "https://example.com/docs")
        ]
    )

    #expect(prompt.contains("Summarize these references"))
    #expect(prompt.contains("References for the agent:"))
    #expect(prompt.contains("- File: plan.md: /tmp/plan.md"))
    #expect(prompt.contains("- Web: example.com/docs: https://example.com/docs"))
}

@Test func composerAttachmentPromptAllowsReferenceOnlyMessages() {
    let prompt = ComposerAttachmentPrompt.appendReferenceRefs(
        to: "   ",
        references: [ComposerReferenceAttachmentRef(kind: .file, title: "note.md", value: "/tmp/note.md")]
    )

    #expect(prompt.hasPrefix("References for the agent:"))
    #expect(prompt.contains("note.md"))
}

@Test func composerAttachmentPromptAppendsReferenceLocations() {
    let prompt = ComposerAttachmentPrompt.appendReferenceRefs(
        to: "Use this context",
        references: [ComposerReferenceAttachmentRef(kind: .file, title: "README.md", value: "/tmp/README.md")]
    )

    #expect(prompt.contains("Use this context"))
    #expect(prompt.contains("References for the agent:"))
    #expect(prompt.contains("- File: README.md: /tmp/README.md"))
}
