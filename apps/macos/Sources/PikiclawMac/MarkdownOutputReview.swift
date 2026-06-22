import AppKit
import SwiftUI
import WebKit

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

struct MarkdownWebReviewView: NSViewRepresentable {
    let markdown: String
    @Binding var selectedText: String
    var selectedAnchor: Binding<CGRect?>? = nil
    var onAddComment: ((String) -> Void)?

    func makeCoordinator() -> Coordinator {
        Coordinator(parent: self)
    }

    func makeNSView(context: Context) -> WKWebView {
        let contentController = WKUserContentController()
        contentController.add(context.coordinator, name: "pikiclawSelection")

        let config = WKWebViewConfiguration()
        config.userContentController = contentController
        config.defaultWebpagePreferences.allowsContentJavaScript = true

        let webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = context.coordinator
        webView.setValue(false, forKey: "drawsBackground")
        webView.allowsMagnification = false
        webView.customUserAgent = "PikiclawMac MarkdownReview"
        webView.loadHTMLString(markdownWebReviewHTML(markdown: markdown), baseURL: nil)
        return webView
    }

    func updateNSView(_ webView: WKWebView, context: Context) {
        context.coordinator.parent = self
        if context.coordinator.renderedMarkdown != markdown {
            context.coordinator.renderedMarkdown = markdown
            webView.loadHTMLString(markdownWebReviewHTML(markdown: markdown), baseURL: nil)
        }
    }

    final class Coordinator: NSObject, WKNavigationDelegate, WKScriptMessageHandler {
        var parent: MarkdownWebReviewView
        var renderedMarkdown = ""

        init(parent: MarkdownWebReviewView) {
            self.parent = parent
            self.renderedMarkdown = parent.markdown
        }

        func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
            guard message.name == "pikiclawSelection",
                  let payload = message.body as? [String: Any] else {
                return
            }
            let text = (payload["text"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            parent.selectedText = text
            if let rectPayload = payload["rect"] as? [String: Any],
               let x = rectPayload["x"] as? Double,
               let y = rectPayload["y"] as? Double,
               let width = rectPayload["width"] as? Double,
               let height = rectPayload["height"] as? Double {
                parent.selectedAnchor?.wrappedValue = CGRect(x: x, y: y, width: width, height: height)
            } else {
                parent.selectedAnchor?.wrappedValue = nil
            }
        }
    }
}

private func markdownWebReviewHTML(markdown: String) -> String {
    let payload = markdownWebJSONLiteral(markdown)
    return """
    <!doctype html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <script src="https://cdn.jsdelivr.net/npm/markdown-it@14.1.0/dist/markdown-it.min.js"></script>
      <script src="https://cdn.jsdelivr.net/npm/mermaid@11.6.0/dist/mermaid.min.js"></script>
      <style>
        :root {
          color-scheme: dark;
          --text: rgba(234, 238, 238, 0.92);
          --muted: rgba(192, 199, 199, 0.68);
          --edge: rgba(133, 214, 199, 0.18);
          --panel: rgba(255, 255, 255, 0.045);
          --code: rgba(255, 255, 255, 0.08);
          --accent: rgb(127, 211, 196);
        }
        html, body {
          margin: 0;
          padding: 0;
          background: transparent;
          color: var(--text);
          font: 13px -apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif;
          line-height: 1.55;
          overflow: auto;
          -webkit-font-smoothing: antialiased;
        }
        body { padding: 14px; box-sizing: border-box; }
        #content { max-width: 100%; }
        h1, h2, h3, h4 {
          color: rgba(246, 249, 249, 0.96);
          line-height: 1.22;
          margin: 1.1em 0 0.45em;
          font-weight: 700;
        }
        h1:first-child, h2:first-child, h3:first-child { margin-top: 0; }
        h1 { font-size: 22px; }
        h2 { font-size: 18px; }
        h3 { font-size: 15px; }
        p { margin: 0.55em 0; }
        ul, ol { padding-left: 1.45em; margin: 0.55em 0; }
        li { margin: 0.25em 0; }
        blockquote {
          margin: 0.75em 0;
          padding: 0.15em 0 0.15em 0.85em;
          border-left: 3px solid var(--accent);
          color: var(--muted);
          background: rgba(127, 211, 196, 0.055);
        }
        code {
          font: 12.5px "SF Mono", ui-monospace, Menlo, monospace;
          background: var(--code);
          border: 1px solid rgba(255, 255, 255, 0.055);
          border-radius: 5px;
          padding: 0.1em 0.34em;
        }
        pre {
          margin: 0.75em 0;
          padding: 12px;
          background: rgba(5, 8, 9, 0.62);
          border: 1px solid var(--edge);
          border-radius: 8px;
          overflow: auto;
        }
        pre code {
          padding: 0;
          border: 0;
          background: transparent;
          white-space: pre;
        }
        table {
          border-collapse: collapse;
          width: 100%;
          margin: 0.85em 0;
          overflow: hidden;
          border-radius: 8px;
        }
        th, td {
          border: 1px solid var(--edge);
          padding: 7px 9px;
          text-align: left;
          vertical-align: top;
        }
        th {
          background: rgba(127, 211, 196, 0.10);
          color: rgba(246, 249, 249, 0.94);
          font-weight: 700;
        }
        a { color: var(--accent); text-decoration: none; }
        hr { border: 0; border-top: 1px solid var(--edge); margin: 1em 0; }
        .mermaid {
          margin: 0.9em 0;
          padding: 12px;
          border-radius: 8px;
          background: rgba(255,255,255,0.04);
          border: 1px solid var(--edge);
          overflow: auto;
        }
        .missing-plugin {
          color: var(--muted);
          border: 1px dashed var(--edge);
          border-radius: 8px;
          padding: 10px;
          background: rgba(255,255,255,0.035);
        }
        ::selection {
          background: rgba(127, 211, 196, 0.34);
          color: white;
        }
      </style>
    </head>
    <body>
      <main id="content"></main>
      <script>
        const source = \(payload);
        function escapeHtml(value) {
          return value.replace(/[&<>"']/g, ch => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
          }[ch]));
        }
        function fallbackMarkdown(value) {
          return '<pre><code>' + escapeHtml(value) + '</code></pre>';
        }
        function render() {
          const container = document.getElementById('content');
          if (window.markdownit) {
            const md = window.markdownit({
              html: false,
              linkify: true,
              typographer: true,
              breaks: false
            });
            const defaultFence = md.renderer.rules.fence;
            md.renderer.rules.fence = (tokens, idx, options, env, self) => {
              const token = tokens[idx];
              const info = (token.info || '').trim().split(/\\s+/)[0].toLowerCase();
              if (info === 'mermaid') {
                return '<div class="mermaid">' + escapeHtml(token.content) + '</div>';
              }
              return defaultFence(tokens, idx, options, env, self);
            };
            container.innerHTML = md.render(source);
          } else {
            container.innerHTML = '<div class="missing-plugin">Markdown renderer did not load. Showing raw markdown.</div>' + fallbackMarkdown(source);
          }
          if (window.mermaid) {
            window.mermaid.initialize({
              startOnLoad: false,
              theme: 'dark',
              securityLevel: 'strict',
              fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif'
            });
            window.mermaid.run({ querySelector: '.mermaid' }).catch(() => {});
          }
        }
        function publishSelection() {
          const selection = window.getSelection();
          const text = selection ? selection.toString().trim() : '';
          if (!text || !selection.rangeCount) {
            window.webkit.messageHandlers.pikiclawSelection.postMessage({ text: '', rect: null });
            return;
          }
          const range = selection.getRangeAt(0);
          const rects = Array.from(range.getClientRects()).filter(rect => rect.width > 0 && rect.height > 0);
          const isMultiLine = rects.length > 1;
          const rect = isMultiLine ? rects[0] : range.getBoundingClientRect();
          window.webkit.messageHandlers.pikiclawSelection.postMessage({
            text,
            rect: {
              x: rect.left,
              y: rect.top,
              width: isMultiLine ? 0 : rect.width,
              height: rect.height
            }
          });
        }
        document.addEventListener('selectionchange', () => window.setTimeout(publishSelection, 0));
        document.addEventListener('mouseup', publishSelection);
        document.addEventListener('keyup', publishSelection);
        render();
      </script>
    </body>
    </html>
    """
}

private func markdownWebJSONLiteral(_ value: String) -> String {
    guard let data = try? JSONSerialization.data(withJSONObject: [value], options: []),
          var encoded = String(data: data, encoding: .utf8) else {
        return "\"\""
    }
    encoded.removeFirst()
    encoded.removeLast()
    return encoded
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
        var index = lines.startIndex

        while index < lines.endIndex {
            let rawLine = lines[index]
            let line = rawLine.trimmingCharacters(in: .whitespacesAndNewlines)
            if line.hasPrefix("```") {
                isInCodeBlock.toggle()
                index = lines.index(after: index)
                continue
            }

            if isInCodeBlock {
                appendLine(rawLine.isEmpty ? " " : rawLine, to: output, attributes: codeBlockAttributes)
                index = lines.index(after: index)
                continue
            }

            if line.isEmpty {
                output.append(NSAttributedString(string: "\n"))
                index = lines.index(after: index)
                continue
            }

            if let heading = markdownHeading(line) {
                appendLine(heading.text, to: output, attributes: headingAttributes(level: heading.level))
                index = lines.index(after: index)
                continue
            }

            if let listText = markdownUnorderedListText(line) {
                output.append(NSAttributedString(string: "• ", attributes: bodyAttributes))
                appendInline(listText, to: output, baseAttributes: bodyAttributes)
                output.append(NSAttributedString(string: "\n"))
                index = lines.index(after: index)
                continue
            }

            if let ordered = markdownOrderedListText(line) {
                output.append(NSAttributedString(string: "\(ordered.number). ", attributes: bodyAttributes))
                appendInline(ordered.text, to: output, baseAttributes: bodyAttributes)
                output.append(NSAttributedString(string: "\n"))
                index = lines.index(after: index)
                continue
            }

            if markdownShellCommandLine(line) {
                var blockEnd = lines.index(after: index)
                var previousContinues = line.hasSuffix("\\")
                while blockEnd < lines.endIndex {
                    let nextLine = lines[blockEnd].trimmingCharacters(in: .whitespacesAndNewlines)
                    guard !nextLine.isEmpty,
                          previousContinues || markdownShellCommandLine(nextLine) || markdownShellContinuationLine(nextLine) else {
                        break
                    }
                    previousContinues = nextLine.hasSuffix("\\")
                    blockEnd = lines.index(after: blockEnd)
                }
                for codeIndex in index..<blockEnd {
                    appendLine(lines[codeIndex].isEmpty ? " " : lines[codeIndex], to: output, attributes: codeBlockAttributes)
                }
                index = blockEnd
                continue
            }

            appendInline(line, to: output, baseAttributes: bodyAttributes)
            output.append(NSAttributedString(string: "\n"))
            index = lines.index(after: index)
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

    private func markdownShellCommandLine(_ line: String) -> Bool {
        let commandPrefixes = [
            "./", "git ", "npm ", "pnpm ", "yarn ", "npx ", "swift ", "xcodebuild ",
            "python ", "python3 ", "node ", "bun ", "cargo ", "go ", "make ",
            "docker ", "kubectl ", "mvn ", "gradle ", "./gradlew ", "rg ", "sed ",
            "awk ", "cat ", "ls ", "cd ", "mkdir ", "cp ", "rm ", "chmod ", "curl ",
            "jq ", "brew "
        ]
        return commandPrefixes.contains { line.hasPrefix($0) }
            || line.range(of: #"^[A-Z_][A-Z0-9_]*=.+"#, options: .regularExpression) != nil
    }

    private func markdownShellContinuationLine(_ line: String) -> Bool {
        guard line.hasSuffix("\\") else { return false }
        let withoutSlash = line.dropLast().trimmingCharacters(in: .whitespacesAndNewlines)
        guard !withoutSlash.isEmpty, !withoutSlash.contains(" ") else { return false }
        return withoutSlash.contains("/") || withoutSlash.hasPrefix(".")
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
