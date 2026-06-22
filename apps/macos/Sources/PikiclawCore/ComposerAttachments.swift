import Foundation

public struct ComposerImageAttachmentRef: Hashable, Codable, Sendable {
    public var name: String
    public var path: String

    public init(name: String, path: String) {
        self.name = name
        self.path = path
    }
}

public enum ComposerReferenceKind: String, Hashable, Codable, Sendable {
    case file
    case web

    public var promptLabel: String {
        switch self {
        case .file: "File"
        case .web: "Web"
        }
    }
}

public struct ComposerReferenceAttachmentRef: Hashable, Codable, Sendable {
    public var kind: ComposerReferenceKind
    public var title: String
    public var value: String

    public init(kind: ComposerReferenceKind, title: String, value: String) {
        self.kind = kind
        self.title = title
        self.value = value
    }
}

public enum ComposerAttachmentPrompt {
    public static func appendReferenceRefs(to prompt: String, references: [ComposerReferenceAttachmentRef]) -> String {
        let trimmed = prompt.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !references.isEmpty else { return trimmed }

        let referenceLines = references.map { reference in
            "- \(reference.kind.promptLabel): \(reference.title): \(reference.value)"
        }.joined(separator: "\n")

        if trimmed.isEmpty {
            return """
            References for the agent:
            \(referenceLines)
            """
        }

        return """
        \(trimmed)

        References for the agent:
        \(referenceLines)
        """
    }

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
