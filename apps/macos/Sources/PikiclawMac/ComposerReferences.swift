import AppKit
import Foundation
import PikiclawCore
import SwiftUI

struct ComposerReferenceAttachment: Identifiable, Hashable {
    let id: UUID
    let kind: ComposerReferenceKind
    let value: String

    init(id: UUID = UUID(), kind: ComposerReferenceKind, value: String) {
        self.id = id
        self.kind = kind
        self.value = value
    }

    var title: String {
        switch kind {
        case .file:
            let filename = URL(fileURLWithPath: value).lastPathComponent
            return filename.isEmpty ? value : filename
        case .web:
            guard let url = URL(string: value), let host = url.host else {
                return value
            }
            let path = url.path == "/" ? "" : url.path
            return path.isEmpty ? host : "\(host)\(path)"
        }
    }

    var subtitle: String {
        switch kind {
        case .file: "File"
        case .web: "Web page"
        }
    }

    var symbol: String {
        switch kind {
        case .file: "doc.text"
        case .web: "globe"
        }
    }

    var promptRef: ComposerReferenceAttachmentRef {
        ComposerReferenceAttachmentRef(kind: kind, title: title, value: value)
    }
}

struct ComposerReferenceExtraction: Hashable {
    var text: String
    var references: [ComposerReferenceAttachment]
}

func composerMergedReferenceAttachments(
    existing: [ComposerReferenceAttachment],
    newReferences: [ComposerReferenceAttachment]
) -> [ComposerReferenceAttachment] {
    var merged = existing
    var seen = Set(existing.map(composerReferenceDeduplicationKey))
    for reference in newReferences where seen.insert(composerReferenceDeduplicationKey(reference)).inserted {
        merged.append(reference)
    }
    return merged
}

func composerExtractReferenceAttachments(
    from text: String,
    includesTrailingReference: Bool = true
) -> ComposerReferenceExtraction {
    let nsText = text as NSString
    guard nsText.length > 0 else {
        return ComposerReferenceExtraction(text: text, references: [])
    }

    var candidates: [ComposerReferenceCandidate] = []
    candidates.append(contentsOf: composerURLCandidates(in: text, includesTrailingReference: includesTrailingReference))
    candidates.append(contentsOf: composerWholeLineFileCandidates(in: text, includesTrailingReference: includesTrailingReference))
    candidates.append(contentsOf: composerFileTokenCandidates(in: text, includesTrailingReference: includesTrailingReference))

    let accepted = composerAcceptedReferenceCandidates(candidates)
    guard !accepted.isEmpty else {
        return ComposerReferenceExtraction(text: text, references: [])
    }

    let remaining = NSMutableString(string: text)
    for candidate in accepted.sorted(by: { $0.range.location > $1.range.location }) {
        remaining.deleteCharacters(in: candidate.range)
    }

    return ComposerReferenceExtraction(
        text: composerCleanRemainingReferenceText(remaining as String),
        references: accepted.map(\.reference)
    )
}

@MainActor
enum ComposerReferenceAttachmentStore {
    static func importReferencesFromPasteboard(_ pasteboard: NSPasteboard = .general) -> ComposerReferenceExtraction {
        var references: [ComposerReferenceAttachment] = []
        var remainingText: [String] = []

        if let urls = pasteboard.readObjects(forClasses: [NSURL.self], options: nil) as? [NSURL] {
            references.append(contentsOf: urls.compactMap { composerReferenceAttachment(rawValue: ($0 as URL).absoluteString) })
        }

        if let string = pasteboard.string(forType: .string) {
            let extraction = composerExtractReferenceAttachments(from: string)
            references.append(contentsOf: extraction.references)
            if !extraction.text.isEmpty {
                remainingText.append(extraction.text)
            }
        }

        return ComposerReferenceExtraction(
            text: remainingText.joined(separator: " "),
            references: composerDeduplicatedReferences(references)
        )
    }
}

struct ComposerReferenceAttachmentStrip: View {
    let references: [ComposerReferenceAttachment]
    let remove: (ComposerReferenceAttachment) -> Void
    var compact = false

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(references) { reference in
                    ComposerReferenceAttachmentChip(
                        reference: reference,
                        compact: compact,
                        remove: { remove(reference) }
                    )
                }
            }
            .padding(.vertical, 1)
        }
    }
}

private struct ComposerReferenceAttachmentChip: View {
    let reference: ComposerReferenceAttachment
    let compact: Bool
    let remove: () -> Void

    var body: some View {
        HStack(spacing: 8) {
            ZStack {
                RoundedRectangle(cornerRadius: 7)
                    .fill(PKTheme.primary.opacity(0.12))
                Image(systemName: reference.symbol)
                    .font(.system(size: compact ? 13 : 15, weight: .semibold))
                    .foregroundStyle(PKTheme.primary)
            }
            .frame(width: compact ? 30 : 36, height: compact ? 30 : 36)

            VStack(alignment: .leading, spacing: 2) {
                Text(reference.title)
                    .font(.system(size: compact ? 10 : 11, weight: .semibold))
                    .foregroundStyle(PKTheme.text2)
                    .lineLimit(1)
                    .truncationMode(.middle)
                Text(reference.subtitle)
                    .font(.system(size: 9, weight: .medium))
                    .foregroundStyle(PKTheme.text4)
            }
            .frame(maxWidth: compact ? 116 : 168, alignment: .leading)

            Button(action: remove) {
                Image(systemName: "xmark.circle.fill")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(PKTheme.text3)
            }
            .buttonStyle(.plain)
        }
        .padding(.horizontal, 8)
        .frame(height: compact ? 42 : 48)
        .background(PKTheme.panelAlt.opacity(0.52))
        .overlay(RoundedRectangle(cornerRadius: 8).stroke(PKTheme.primary.opacity(0.22), lineWidth: 1))
        .clipShape(RoundedRectangle(cornerRadius: 8))
        .help(reference.value)
    }
}

private struct ComposerReferenceCandidate {
    let range: NSRange
    let reference: ComposerReferenceAttachment
}

private func composerURLCandidates(
    in text: String,
    includesTrailingReference: Bool
) -> [ComposerReferenceCandidate] {
    guard let detector = try? NSDataDetector(types: NSTextCheckingResult.CheckingType.link.rawValue) else {
        return []
    }

    let nsText = text as NSString
    let fullRange = NSRange(location: 0, length: nsText.length)
    return detector.matches(in: text, options: [], range: fullRange).compactMap { match in
        guard let url = match.url,
              ["http", "https"].contains(url.scheme?.lowercased() ?? ""),
              composerReferenceRangeIsComplete(match.range, in: nsText, includesTrailingReference: includesTrailingReference),
              let reference = composerReferenceAttachment(rawValue: url.absoluteString) else {
            return nil
        }
        return ComposerReferenceCandidate(
            range: composerReferenceRemovalRange(for: match.range, in: nsText),
            reference: reference
        )
    }
}

private func composerWholeLineFileCandidates(
    in text: String,
    includesTrailingReference: Bool
) -> [ComposerReferenceCandidate] {
    composerRegexCandidates(
        in: text,
        pattern: #"(?m)^\s*(file://[^\n\r]+|~/[^\n\r]+|/[^\n\r]+)\s*$"#,
        includesTrailingReference: includesTrailingReference
    )
}

private func composerFileTokenCandidates(
    in text: String,
    includesTrailingReference: Bool
) -> [ComposerReferenceCandidate] {
    composerRegexCandidates(
        in: text,
        pattern: #"(?:^|\s)(file://\S+|~/\S+|/\S+)"#,
        includesTrailingReference: includesTrailingReference
    )
}

private func composerRegexCandidates(
    in text: String,
    pattern: String,
    includesTrailingReference: Bool
) -> [ComposerReferenceCandidate] {
    guard let regex = try? NSRegularExpression(pattern: pattern) else {
        return []
    }

    let nsText = text as NSString
    let fullRange = NSRange(location: 0, length: nsText.length)
    return regex.matches(in: text, range: fullRange).compactMap { match in
        guard match.numberOfRanges > 1,
              let trimmed = composerTrimmedReferenceRange(match.range(at: 1), in: nsText),
              composerReferenceRangeIsComplete(trimmed.range, in: nsText, includesTrailingReference: includesTrailingReference),
              let reference = composerReferenceAttachment(rawValue: trimmed.value) else {
            return nil
        }
        return ComposerReferenceCandidate(
            range: composerReferenceRemovalRange(for: trimmed.range, in: nsText),
            reference: reference
        )
    }
}

private func composerReferenceAttachment(rawValue: String) -> ComposerReferenceAttachment? {
    let value = rawValue.trimmingCharacters(in: .whitespacesAndNewlines)
    if let webReference = composerWebReferenceAttachment(rawValue: value) {
        return webReference
    }
    if let fileReference = composerFileReferenceAttachment(rawValue: value) {
        return fileReference
    }
    return nil
}

private func composerWebReferenceAttachment(rawValue: String) -> ComposerReferenceAttachment? {
    guard let url = URL(string: rawValue),
          ["http", "https"].contains(url.scheme?.lowercased() ?? ""),
          url.host?.isEmpty == false else {
        return nil
    }
    return ComposerReferenceAttachment(kind: .web, value: url.absoluteString)
}

private func composerFileReferenceAttachment(rawValue: String) -> ComposerReferenceAttachment? {
    let path: String
    if rawValue.hasPrefix("file://") {
        guard let url = URL(string: rawValue), url.isFileURL else { return nil }
        path = url.path
    } else if rawValue.hasPrefix("~/") {
        path = (NSHomeDirectory() as NSString).appendingPathComponent(String(rawValue.dropFirst(2)))
    } else if rawValue.hasPrefix("/") {
        path = rawValue
    } else {
        return nil
    }

    let standardized = (path as NSString).standardizingPath
    guard composerLooksLikeFilePath(standardized) else { return nil }
    return ComposerReferenceAttachment(kind: .file, value: standardized)
}

private func composerLooksLikeFilePath(_ path: String) -> Bool {
    guard path.hasPrefix("/"), path != "/", !path.contains("://") else {
        return false
    }
    let components = path.split(separator: "/", omittingEmptySubsequences: true)
    return components.count >= 2 || FileManager.default.fileExists(atPath: path)
}

private func composerAcceptedReferenceCandidates(_ candidates: [ComposerReferenceCandidate]) -> [ComposerReferenceCandidate] {
    var accepted: [ComposerReferenceCandidate] = []
    var seenReferences = Set<String>()

    for candidate in candidates.sorted(by: composerReferenceCandidateSort) {
        guard !accepted.contains(where: { NSIntersectionRange($0.range, candidate.range).length > 0 }) else {
            continue
        }
        guard seenReferences.insert(composerReferenceDeduplicationKey(candidate.reference)).inserted else {
            continue
        }
        accepted.append(candidate)
    }

    return accepted.sorted { $0.range.location < $1.range.location }
}

private func composerReferenceCandidateSort(_ lhs: ComposerReferenceCandidate, _ rhs: ComposerReferenceCandidate) -> Bool {
    if lhs.range.location != rhs.range.location {
        return lhs.range.location < rhs.range.location
    }
    return lhs.range.length > rhs.range.length
}

private func composerDeduplicatedReferences(_ references: [ComposerReferenceAttachment]) -> [ComposerReferenceAttachment] {
    var result: [ComposerReferenceAttachment] = []
    var seen = Set<String>()
    for reference in references where seen.insert(composerReferenceDeduplicationKey(reference)).inserted {
        result.append(reference)
    }
    return result
}

private func composerReferenceDeduplicationKey(_ reference: ComposerReferenceAttachment) -> String {
    "\(reference.kind.rawValue)\u{0}\(reference.value)"
}

private func composerReferenceRangeIsComplete(
    _ range: NSRange,
    in nsText: NSString,
    includesTrailingReference: Bool
) -> Bool {
    guard includesTrailingReference else {
        let end = NSMaxRange(range)
        guard end < nsText.length else { return false }
        let next = nsText.substring(with: NSRange(location: end, length: 1))
        return next.rangeOfCharacter(from: .whitespacesAndNewlines) != nil
            || next.rangeOfCharacter(from: composerReferenceSeparatorCharacters) != nil
    }
    return true
}

private func composerTrimmedReferenceRange(
    _ range: NSRange,
    in nsText: NSString
) -> (value: String, range: NSRange)? {
    var location = range.location
    var length = range.length

    while length > 0 {
        let character = nsText.substring(with: NSRange(location: location, length: 1))
        guard character.rangeOfCharacter(from: .whitespacesAndNewlines) != nil else { break }
        location += 1
        length -= 1
    }

    while length > 0 {
        let character = nsText.substring(with: NSRange(location: location + length - 1, length: 1))
        guard character.rangeOfCharacter(from: composerReferenceTrimCharacters) != nil else { break }
        length -= 1
    }

    guard length > 0 else { return nil }
    let trimmedRange = NSRange(location: location, length: length)
    return (nsText.substring(with: trimmedRange), trimmedRange)
}

private func composerReferenceRemovalRange(for range: NSRange, in nsText: NSString) -> NSRange {
    var removal = range
    let end = NSMaxRange(range)
    if end < nsText.length {
        let next = nsText.substring(with: NSRange(location: end, length: 1))
        if next.rangeOfCharacter(from: composerReferenceSeparatorCharacters) != nil {
            removal.length += 1
        }
    }
    return removal
}

private func composerCleanRemainingReferenceText(_ text: String) -> String {
    text
        .replacingOccurrences(of: #"[ \t]{2,}"#, with: " ", options: .regularExpression)
        .replacingOccurrences(of: #"\n{3,}"#, with: "\n\n", options: .regularExpression)
        .trimmingCharacters(in: composerRemainingTrimCharacters)
}

private let composerReferenceSeparatorCharacters = CharacterSet(charactersIn: ".,;:!?)]}")
private let composerReferenceTrimCharacters = CharacterSet.whitespacesAndNewlines
    .union(composerReferenceSeparatorCharacters)
private let composerRemainingTrimCharacters = CharacterSet.whitespacesAndNewlines
    .union(CharacterSet(charactersIn: ".,;:!?"))
