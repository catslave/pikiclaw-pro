import Foundation
import Testing
@testable import PikiclawCore
@testable import PikiclawMac

@Test func composerExtractsWholeFilePathWithSpacesAsReference() {
    let path = "/Users/michael.yang/Documents/Obsidian Vault/repo/AIR/kafka-producer-fallback-implementation-plan-2026-06-11.md"

    let extraction = composerExtractReferenceAttachments(from: path)

    #expect(extraction.text.isEmpty)
    #expect(extraction.references.count == 1)
    #expect(extraction.references[0].kind == .file)
    #expect(extraction.references[0].value == (path as NSString).standardizingPath)
    #expect(extraction.references[0].title == "kafka-producer-fallback-implementation-plan-2026-06-11.md")
}

@Test func composerExtractsWebURLAndKeepsSurroundingText() {
    let extraction = composerExtractReferenceAttachments(
        from: "Please review https://example.com/docs/agent?tab=mac and summarize"
    )

    #expect(extraction.text == "Please review and summarize")
    #expect(extraction.references.count == 1)
    #expect(extraction.references[0].kind == .web)
    #expect(extraction.references[0].value == "https://example.com/docs/agent?tab=mac")
    #expect(extraction.references[0].title == "example.com/docs/agent")
}

@Test func composerWaitsForTypedReferenceSeparatorBeforeExtraction() {
    let inProgress = composerExtractReferenceAttachments(
        from: "Review https://example.com/docs",
        includesTrailingReference: false
    )
    let complete = composerExtractReferenceAttachments(
        from: "Review https://example.com/docs ",
        includesTrailingReference: false
    )

    #expect(inProgress.references.isEmpty)
    #expect(inProgress.text == "Review https://example.com/docs")
    #expect(complete.references.count == 1)
    #expect(complete.text == "Review")
}

@Test func composerMergesReferenceAttachmentsWithoutDuplicates() {
    let file = ComposerReferenceAttachment(kind: .file, value: "/tmp/plan.md")
    let web = ComposerReferenceAttachment(kind: .web, value: "https://example.com/docs")

    let merged = composerMergedReferenceAttachments(
        existing: [file],
        newReferences: [
            ComposerReferenceAttachment(kind: .file, value: "/tmp/plan.md"),
            web
        ]
    )

    #expect(merged.map(\.kind) == [.file, .web])
    #expect(merged.map(\.value) == ["/tmp/plan.md", "https://example.com/docs"])
}
