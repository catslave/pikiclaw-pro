import Foundation

public struct ComposerImageAttachmentRef: Hashable, Codable, Sendable {
    public var name: String
    public var path: String

    public init(name: String, path: String) {
        self.name = name
        self.path = path
    }
}

public enum ComposerAttachmentPrompt {
    public static func appendImageRefs(to prompt: String, images: [ComposerImageAttachmentRef]) -> String {
        let trimmed = prompt.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !images.isEmpty else { return trimmed }

        let imageLines = images.map { image in
            "- \(image.name): \(image.path)"
        }.joined(separator: "\n")

        if trimmed.isEmpty {
            return """
            Attached images for the agent:
            \(imageLines)
            """
        }

        return """
        \(trimmed)

        Attached images for the agent:
        \(imageLines)
        """
    }
}
