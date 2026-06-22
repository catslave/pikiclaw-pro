import AppKit
import SwiftUI

struct ChatOutputReviewComment: Identifiable, Equatable {
    var id: UUID
    var quote: String
    var note: String

    init(id: UUID = UUID(), quote: String, note: String = "") {
        self.id = id
        self.quote = quote
        self.note = note
    }
}

func chatOutputReviewPrompt(outputTitle: String, comments: [ChatOutputReviewComment]) -> String {
    let title = outputTitle.trimmingCharacters(in: .whitespacesAndNewlines)
    let heading = title.isEmpty ? "the previous output" : "\"\(title)\""
    let commentLines = comments.enumerated().map { index, comment in
        let quote = markdownQuoteBlock(comment.quote)
        let note = comment.note.trimmingCharacters(in: .whitespacesAndNewlines)
        return """
        \(index + 1). Selected output:
        \(quote)

        Comment:
        \(note.isEmpty ? "- No extra note." : note)
        """
    }
    .joined(separator: "\n\n")

    return """
    Please address these review comments on \(heading). Treat them as inline comments on the markdown solution output, then respond with the revised answer or a clear resolution for each comment.

    \(commentLines)
    """
}

private func markdownQuoteBlock(_ text: String) -> String {
    let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty else { return "> [empty selection]" }
    return trimmed
        .components(separatedBy: .newlines)
        .map { "> \($0)" }
        .joined(separator: "\n")
}

struct MarkdownOutputReviewTextView: NSViewRepresentable {
    let markdown: String
    @Binding var selectedText: String
    var selectedAnchor: Binding<CGRect?>? = nil
    var fontSize: CGFloat = 13
    var onAddComment: ((String) -> Void)?

    func makeCoordinator() -> Coordinator {
        Coordinator(parent: self)
    }

    func makeNSView(context: Context) -> MarkdownReviewNSTextView {
        let textView = MarkdownReviewNSTextView()
        textView.delegate = context.coordinator
        textView.isEditable = false
        textView.isSelectable = true
        textView.drawsBackground = false
        textView.textContainerInset = NSSize(width: 0, height: 0)
        textView.textContainer?.lineFragmentPadding = 0
        textView.textContainer?.widthTracksTextView = true
        textView.isHorizontallyResizable = false
        textView.isVerticallyResizable = true
        textView.autoresizingMask = [.width]
        textView.onAddComment = { quote in
            onAddComment?(quote)
        }
        return textView
    }

    func updateNSView(_ textView: MarkdownReviewNSTextView, context: Context) {
        context.coordinator.parent = self
        textView.onAddComment = { quote in
            onAddComment?(quote)
        }
        if textView.renderedMarkdown != markdown {
            textView.renderedMarkdown = markdown
            textView.textStorage?.setAttributedString(nativeMarkdownReviewAttributedString(markdown, fontSize: fontSize))
            textView.invalidateIntrinsicContentSize()
        }
    }

    final class Coordinator: NSObject, NSTextViewDelegate {
        var parent: MarkdownOutputReviewTextView

        init(parent: MarkdownOutputReviewTextView) {
            self.parent = parent
        }

        func textViewDidChangeSelection(_ notification: Notification) {
            guard let textView = notification.object as? MarkdownReviewNSTextView else { return }
            parent.selectedText = textView.reviewSelectedText()
            parent.selectedAnchor?.wrappedValue = textView.reviewSelectionRect()
        }
    }
}

final class MarkdownReviewNSTextView: NSTextView {
    var renderedMarkdown = ""
    var onAddComment: ((String) -> Void)?

    override var intrinsicContentSize: NSSize {
        guard let layoutManager, let textContainer else {
            return NSSize(width: NSView.noIntrinsicMetric, height: 40)
        }
        layoutManager.ensureLayout(for: textContainer)
        let usedRect = layoutManager.usedRect(for: textContainer)
        return NSSize(
            width: NSView.noIntrinsicMetric,
            height: max(36, ceil(usedRect.height + textContainerInset.height * 2))
        )
    }

    override func layout() {
        super.layout()
        textContainer?.containerSize = NSSize(
            width: max(0, bounds.width),
            height: CGFloat.greatestFiniteMagnitude
        )
        invalidateIntrinsicContentSize()
    }

    override func menu(for event: NSEvent) -> NSMenu? {
        let menu = super.menu(for: event)?.copy() as? NSMenu ?? NSMenu()
        let quote = reviewSelectedText()
        if !quote.isEmpty, onAddComment != nil {
            if menu.items.isEmpty == false {
                menu.insertItem(.separator(), at: 0)
            }
            let item = NSMenuItem(title: "Add Comment", action: #selector(addSelectedTextComment), keyEquivalent: "")
            item.target = self
            menu.insertItem(item, at: 0)
        }
        return menu
    }

    func reviewSelectedText() -> String {
        guard selectedRange().length > 0,
              let range = Range(selectedRange(), in: string) else {
            return ""
        }
        return String(string[range]).trimmingCharacters(in: .whitespacesAndNewlines)
    }

    func reviewSelectionRect() -> CGRect? {
        let range = selectedRange()
        guard range.length > 0,
              let layoutManager,
              let textContainer else {
            return nil
        }
        layoutManager.ensureLayout(for: textContainer)
        let glyphRange = layoutManager.glyphRange(forCharacterRange: range, actualCharacterRange: nil)
        guard glyphRange.length > 0 else { return nil }
        var rect = layoutManager.boundingRect(forGlyphRange: glyphRange, in: textContainer)
        rect.origin.x += textContainerOrigin.x
        rect.origin.y += textContainerOrigin.y
        return rect
    }

    @objc private func addSelectedTextComment() {
        let quote = reviewSelectedText()
        guard !quote.isEmpty else { return }
        onAddComment?(quote)
    }
}

func nativeMarkdownReviewAttributedString(_ markdown: String, fontSize: CGFloat = 13) -> NSAttributedString {
    let renderer = NativeMarkdownReviewRenderer(fontSize: fontSize)
    return renderer.render(markdown)
}

private struct NativeMarkdownReviewRenderer {
    let fontSize: CGFloat

    private var bodyFont: NSFont {
        .systemFont(ofSize: fontSize)
    }

    private var boldFont: NSFont {
        .boldSystemFont(ofSize: fontSize)
    }

    private var codeFont: NSFont {
        .monospacedSystemFont(ofSize: fontSize - 0.5, weight: .regular)
    }

    private var textColor: NSColor {
        NSColor(calibratedWhite: 0.84, alpha: 1)
    }

    private var subtleColor: NSColor {
        NSColor(calibratedWhite: 0.68, alpha: 1)
    }

    private var codeBackground: NSColor {
        NSColor(calibratedWhite: 1, alpha: 0.07)
    }

    func render(_ markdown: String) -> NSAttributedString {
        let output = NSMutableAttributedString()
        var isInCodeBlock = false
        let lines = markdown.components(separatedBy: .newlines)

        for rawLine in lines {
            let line = rawLine.trimmingCharacters(in: .whitespacesAndNewlines)
            if line.hasPrefix("```") {
                isInCodeBlock.toggle()
                continue
            }

            if isInCodeBlock {
                appendLine(rawLine.isEmpty ? " " : rawLine, to: output, attributes: codeBlockAttributes)
                continue
            }

            if line.isEmpty {
                output.append(NSAttributedString(string: "\n"))
                continue
            }

            if let heading = markdownHeading(line) {
                appendLine(heading.text, to: output, attributes: headingAttributes(level: heading.level))
                continue
            }

            if let listText = markdownUnorderedListText(line) {
                output.append(NSAttributedString(string: "• ", attributes: bodyAttributes))
                appendInline(listText, to: output, baseAttributes: bodyAttributes)
                output.append(NSAttributedString(string: "\n"))
                continue
            }

            if let ordered = markdownOrderedListText(line) {
                output.append(NSAttributedString(string: "\(ordered.number). ", attributes: bodyAttributes))
                appendInline(ordered.text, to: output, baseAttributes: bodyAttributes)
                output.append(NSAttributedString(string: "\n"))
                continue
            }

            appendInline(line, to: output, baseAttributes: bodyAttributes)
            output.append(NSAttributedString(string: "\n"))
        }

        return output.trimmedTrailingWhitespaceAndNewlines()
    }

    private var bodyAttributes: [NSAttributedString.Key: Any] {
        [
            .font: bodyFont,
            .foregroundColor: textColor,
            .paragraphStyle: paragraphStyle(spacing: 4, paragraphSpacing: 6)
        ]
    }

    private var codeAttributes: [NSAttributedString.Key: Any] {
        [
            .font: codeFont,
            .foregroundColor: textColor,
            .backgroundColor: codeBackground
        ]
    }

    private var codeBlockAttributes: [NSAttributedString.Key: Any] {
        [
            .font: codeFont,
            .foregroundColor: textColor,
            .backgroundColor: codeBackground,
            .paragraphStyle: paragraphStyle(spacing: 3, paragraphSpacing: 3)
        ]
    }

    private func headingAttributes(level: Int) -> [NSAttributedString.Key: Any] {
        let size = max(fontSize + 1, fontSize + CGFloat(7 - min(level, 6)))
        return [
            .font: NSFont.boldSystemFont(ofSize: size),
            .foregroundColor: textColor,
            .paragraphStyle: paragraphStyle(spacing: 3, paragraphSpacing: 9)
        ]
    }

    private func paragraphStyle(spacing: CGFloat, paragraphSpacing: CGFloat) -> NSParagraphStyle {
        let style = NSMutableParagraphStyle()
        style.lineSpacing = spacing
        style.paragraphSpacing = paragraphSpacing
        return style
    }

    private func appendLine(_ text: String, to output: NSMutableAttributedString, attributes: [NSAttributedString.Key: Any]) {
        output.append(NSAttributedString(string: text, attributes: attributes))
        output.append(NSAttributedString(string: "\n"))
    }

    private func appendInline(_ source: String, to output: NSMutableAttributedString, baseAttributes: [NSAttributedString.Key: Any]) {
        var index = source.startIndex
        while index < source.endIndex {
            if source[index] == "`",
               let closing = source[source.index(after: index)...].firstIndex(of: "`") {
                let contentStart = source.index(after: index)
                output.append(NSAttributedString(
                    string: String(source[contentStart..<closing]),
                    attributes: codeAttributes.merging(baseAttributes) { current, _ in current }
                ))
                index = source.index(after: closing)
                continue
            }

            if source[index...].hasPrefix("**"),
               let closing = source[source.index(index, offsetBy: 2)...].range(of: "**")?.lowerBound {
                let contentStart = source.index(index, offsetBy: 2)
                var attrs = baseAttributes
                attrs[.font] = boldFont
                output.append(NSAttributedString(string: String(source[contentStart..<closing]), attributes: attrs))
                index = source.index(closing, offsetBy: 2)
                continue
            }

            if source[index] == "[",
               let labelEnd = source[index...].firstIndex(of: "]"),
               source.index(after: labelEnd) < source.endIndex,
               source[source.index(after: labelEnd)] == "(",
               let urlEnd = source[source.index(after: labelEnd)..<source.endIndex].firstIndex(of: ")") {
                let labelStart = source.index(after: index)
                let urlStart = source.index(labelEnd, offsetBy: 2)
                let label = String(source[labelStart..<labelEnd])
                let url = String(source[urlStart..<urlEnd])
                var attrs = baseAttributes
                attrs[.foregroundColor] = NSColor.systemTeal
                attrs[.underlineStyle] = NSUnderlineStyle.single.rawValue
                attrs[.link] = url
                output.append(NSAttributedString(string: label, attributes: attrs))
                index = source.index(after: urlEnd)
                continue
            }

            let nextSpecial = ["`", "**", "["]
                .compactMap { marker in source[index...].range(of: marker)?.lowerBound }
                .min()
            let end = nextSpecial.map { $0 == index ? source.index(after: index) : $0 } ?? source.endIndex
            output.append(NSAttributedString(string: String(source[index..<end]), attributes: baseAttributes))
            index = end
        }
    }

    private func markdownHeading(_ line: String) -> (level: Int, text: String)? {
        let hashes = line.prefix { $0 == "#" }
        guard !hashes.isEmpty, hashes.count <= 6 else { return nil }
        let rest = line.dropFirst(hashes.count)
        guard rest.first == " " else { return nil }
        return (hashes.count, String(rest.dropFirst()).trimmingCharacters(in: .whitespacesAndNewlines))
    }

    private func markdownUnorderedListText(_ line: String) -> String? {
        guard line.hasPrefix("- ") || line.hasPrefix("* ") else { return nil }
        return String(line.dropFirst(2)).trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private func markdownOrderedListText(_ line: String) -> (number: String, text: String)? {
        guard let dot = line.firstIndex(of: ".") else { return nil }
        let number = String(line[..<dot])
        guard !number.isEmpty, number.allSatisfy(\.isNumber) else { return nil }
        let textStart = line.index(after: dot)
        guard textStart < line.endIndex, line[textStart] == " " else { return nil }
        return (number, String(line[line.index(after: textStart)...]))
    }
}

private extension NSMutableAttributedString {
    func trimmedTrailingWhitespaceAndNewlines() -> NSAttributedString {
        while length > 0 {
            let trailing = string[string.index(before: string.endIndex)]
            guard trailing.isWhitespace || trailing.isNewline else { break }
            deleteCharacters(in: NSRange(location: length - 1, length: 1))
        }
        return self
    }
}
