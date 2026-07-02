import AppKit
import Markdown
import Splash
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

enum MarkdownReviewLinkDestination: Equatable {
    case localFile(URL)
    case external(URL)
}

func markdownReviewLinkDestination(_ link: Any) -> MarkdownReviewLinkDestination? {
    if let url = link as? URL {
        if url.isFileURL {
            return .localFile(markdownReviewExistingLocalFileURL(url))
        }
        return .external(url)
    }

    let raw = String(describing: link).trimmingCharacters(in: .whitespacesAndNewlines)
    guard !raw.isEmpty else { return nil }

    if let fileURL = markdownReviewLocalFileURL(from: raw) {
        return .localFile(fileURL)
    }
    if let url = URL(string: raw), url.scheme != nil {
        return .external(url)
    }
    return nil
}

func markdownReviewLocalFileURL(from raw: String) -> URL? {
    var trimCharacters = CharacterSet.whitespacesAndNewlines
    trimCharacters.insert(charactersIn: "<>")
    let cleaned = raw.trimmingCharacters(in: trimCharacters)
    guard !cleaned.isEmpty else { return nil }

    if let url = URL(string: cleaned), url.isFileURL {
        let strippedPath = markdownReviewPathByStrippingLineSuffix(url.path) ?? url.path
        return URL(fileURLWithPath: strippedPath)
    }
    guard cleaned.hasPrefix("/") || cleaned.hasPrefix("~") else { return nil }

    let withoutLineSuffix = markdownReviewPathByStrippingLineSuffix(cleaned) ?? cleaned
    let decodedPath = withoutLineSuffix.removingPercentEncoding ?? withoutLineSuffix
    return URL(fileURLWithPath: (decodedPath as NSString).expandingTildeInPath)
}

private func markdownReviewExistingLocalFileURL(_ url: URL) -> URL {
    let path = url.path
    guard !FileManager.default.fileExists(atPath: path),
          let strippedPath = markdownReviewPathByStrippingLineSuffix(path),
          FileManager.default.fileExists(atPath: strippedPath) else {
        return url
    }
    return URL(fileURLWithPath: strippedPath)
}

private func markdownReviewPathByStrippingLineSuffix(_ path: String) -> String? {
    guard let range = path.range(of: #":[0-9]+$"#, options: .regularExpression) else {
        return nil
    }
    return String(path[..<range.lowerBound])
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
    var fontSize: CGFloat = 13.5
    var onAddComment: ((String) -> Void)?
    var onOpenLink: ((MarkdownReviewLinkDestination) -> Void)?

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
        let displayMarkdown = nativeReviewDisplayMarkdown(markdown)
        if textView.renderedMarkdown != displayMarkdown {
            textView.renderedMarkdown = displayMarkdown
            textView.textStorage?.setAttributedString(nativeMarkdownReviewAttributedString(displayMarkdown, fontSize: fontSize))
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

        func textView(_ textView: NSTextView, clickedOnLink link: Any, at charIndex: Int) -> Bool {
            guard let destination = markdownReviewLinkDestination(link),
                  let onOpenLink = parent.onOpenLink else {
                return false
            }
            onOpenLink(destination)
            return true
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

func nativeReviewDisplayMarkdown(_ markdown: String) -> String {
    let lines = markdown.components(separatedBy: .newlines)
    var output: [String] = []

    func appendBlankBeforeHeadingIfNeeded() {
        guard let last = output.last, !last.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
        output.append("")
    }

    func appendHeading(_ heading: String, body: String? = nil) {
        appendBlankBeforeHeadingIfNeeded()
        output.append("### \(heading)")
        if let body = body?.trimmingCharacters(in: .whitespacesAndNewlines), !body.isEmpty {
            output.append(body)
        }
    }

    for rawLine in lines {
        let line = rawLine.trimmingCharacters(in: .whitespacesAndNewlines)
        let lower = line.lowercased()
        if let rest = reviewDisplayRest(after: "Risk:", in: line) {
            appendHeading("Risk", body: rest)
            continue
        }
        if let rest = reviewDisplayRest(after: "Why it matters:", in: line) {
            appendHeading("Why It Matters", body: rest)
            continue
        }
        if let rest = reviewDisplayRest(after: "Suggested fix", in: line) {
            appendHeading("Suggested Fix", body: rest)
            continue
        }
        if lower == "suggested comments mr" || lower == "suggested comments" {
            appendHeading("Suggested Comments")
            continue
        }
        if lower == "open questions" {
            appendHeading("Open Questions")
            continue
        }
        if lower == "residual risk" || lower == "residual risks" {
            appendHeading("Residual Risk")
            continue
        }
        output.append(rawLine)
    }

    return output.joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines)
}

private func reviewDisplayRest(after prefix: String, in line: String) -> String? {
    guard line.range(of: prefix, options: [.anchored, .caseInsensitive], locale: .current) != nil else {
        return nil
    }
    return String(line.dropFirst(prefix.count))
        .trimmingCharacters(in: CharacterSet(charactersIn: " :\t"))
}

private struct NativeMarkdownReviewRenderer {
    let fontSize: CGFloat

    private var bodyFont: NSFont {
        .systemFont(ofSize: fontSize, weight: .regular)
    }

    private var boldFont: NSFont {
        .systemFont(ofSize: fontSize, weight: .semibold)
    }

    private var codeFont: NSFont {
        .monospacedSystemFont(ofSize: fontSize - 0.75, weight: .regular)
    }

    private var textColor: NSColor {
        NSColor(calibratedWhite: 0.88, alpha: 1)
    }

    private var subtleColor: NSColor {
        NSColor(calibratedWhite: 0.72, alpha: 1)
    }

    private var headingColor: NSColor {
        NSColor(calibratedRed: 0.88, green: 0.95, blue: 0.94, alpha: 1)
    }

    private var accentColor: NSColor {
        NSColor(calibratedRed: 0.50, green: 0.83, blue: 0.76, alpha: 1)
    }

    private var codeBackground: NSColor {
        NSColor(calibratedWhite: 1, alpha: 0.055)
    }

    private var quoteBackground: NSColor {
        NSColor(calibratedRed: 0.50, green: 0.83, blue: 0.76, alpha: 0.075)
    }

    func render(_ markdown: String) -> NSAttributedString {
        let document = Document(parsing: markdownPromotingBareShellBlocks(markdown))
        let output = NSMutableAttributedString()
        for child in document.children {
            appendBlock(child, to: output)
        }
        return output.trimmedTrailingWhitespaceAndNewlines()
    }

    private func appendBlock(_ markup: Markup, to output: NSMutableAttributedString) {
        switch markup {
        case let heading as Heading:
            appendChildren(of: heading, to: output, attributes: headingAttributes(level: heading.level))
            output.append(NSAttributedString(string: "\n", attributes: headingAttributes(level: heading.level)))
        case let paragraph as Paragraph:
            appendChildren(of: paragraph, to: output, attributes: bodyAttributes)
            output.append(NSAttributedString(string: "\n", attributes: bodyAttributes))
        case let unorderedList as UnorderedList:
            appendUnorderedList(unorderedList, to: output)
        case let orderedList as OrderedList:
            appendOrderedList(orderedList, to: output)
        case let codeBlock as CodeBlock:
            appendCodeBlock(codeBlock, to: output)
        case let blockQuote as BlockQuote:
            output.append(NSAttributedString(string: "▌ ", attributes: quoteMarkerAttributes))
            let content = NSMutableAttributedString()
            appendChildren(of: blockQuote, to: content, attributes: quoteAttributes)
            output.append(content.trimmedTrailingWhitespaceAndNewlines())
            output.append(NSAttributedString(string: "\n", attributes: quoteAttributes))
        case _ as ThematicBreak:
            output.append(NSAttributedString(string: "────────\n", attributes: quoteMarkerAttributes))
        default:
            appendChildren(of: markup, to: output, attributes: bodyAttributes)
            if output.length > 0, !output.string.hasSuffix("\n") {
                output.append(NSAttributedString(string: "\n", attributes: bodyAttributes))
            }
        }
    }

    private func appendChildren(
        of markup: Markup,
        to output: NSMutableAttributedString,
        attributes: [NSAttributedString.Key: Any]
    ) {
        for child in markup.children {
            appendInlineOrBlock(child, to: output, attributes: attributes)
        }
    }

    private func appendInlineOrBlock(
        _ markup: Markup,
        to output: NSMutableAttributedString,
        attributes: [NSAttributedString.Key: Any]
    ) {
        switch markup {
        case let text as Markdown.Text:
            output.append(NSAttributedString(string: text.string, attributes: attributes))
        case let inlineCode as InlineCode:
            output.append(NSAttributedString(
                string: inlineCode.code,
                attributes: codeAttributes.merging(attributes) { current, _ in current }
            ))
        case let strong as Strong:
            var attrs = attributes
            attrs[.font] = boldFont
            appendChildren(of: strong, to: output, attributes: attrs)
        case let emphasis as Emphasis:
            var attrs = attributes
            attrs[.font] = NSFontManager.shared.convert(bodyFont, toHaveTrait: .italicFontMask)
            appendChildren(of: emphasis, to: output, attributes: attrs)
        case let link as Markdown.Link:
            var attrs = attributes
            attrs[.foregroundColor] = NSColor.systemTeal
            attrs[.underlineStyle] = NSUnderlineStyle.single.rawValue
            if let destination = link.destination {
                attrs[.link] = destination
            }
            appendChildren(of: link, to: output, attributes: attrs)
        case _ as SoftBreak:
            output.append(NSAttributedString(string: "\n", attributes: attributes))
        case _ as LineBreak:
            output.append(NSAttributedString(string: "\n", attributes: attributes))
        case let paragraph as Paragraph:
            appendChildren(of: paragraph, to: output, attributes: attributes)
        case let codeBlock as CodeBlock:
            appendCodeBlock(codeBlock, to: output)
        default:
            appendChildren(of: markup, to: output, attributes: attributes)
        }
    }

    private func appendUnorderedList(_ list: UnorderedList, to output: NSMutableAttributedString) {
        for item in list.children {
            output.append(NSAttributedString(string: "• ", attributes: listMarkerAttributes))
            appendListItem(item, to: output, markerWidth: 18)
        }
    }

    private func appendOrderedList(_ list: OrderedList, to output: NSMutableAttributedString) {
        var number = Int(list.startIndex)
        for item in list.children {
            output.append(NSAttributedString(string: "\(number). ", attributes: listMarkerAttributes))
            appendListItem(item, to: output, markerWidth: 24)
            number += 1
        }
    }

    private func appendListItem(_ item: Markup, to output: NSMutableAttributedString, markerWidth: CGFloat) {
        var attrs = listAttributes
        attrs[.paragraphStyle] = paragraphStyle(
            spacing: 4,
            paragraphSpacing: 5,
            firstLineHeadIndent: 0,
            headIndent: markerWidth
        )

        let content = NSMutableAttributedString()
        appendChildren(of: item, to: content, attributes: attrs)
        output.append(content.trimmedTrailingWhitespaceAndNewlines())
        output.append(NSAttributedString(string: "\n", attributes: attrs))
    }

    private func appendCodeBlock(_ codeBlock: CodeBlock, to output: NSMutableAttributedString) {
        let highlighted = highlightedCode(codeBlock.code.isEmpty ? " " : codeBlock.code, language: codeBlock.language)
        output.append(highlighted)
        if !output.string.hasSuffix("\n") {
            output.append(NSAttributedString(string: "\n", attributes: codeBlockAttributes))
        }
    }

    private func highlightedCode(_ code: String, language: String?) -> NSAttributedString {
        let highlighted: NSMutableAttributedString
        if shouldUseSplash(for: language) {
            let format = AttributedStringOutputFormat(theme: .wwdc17(withFont: Splash.Font(size: Double(fontSize - 0.75))))
            highlighted = NSMutableAttributedString(attributedString: SyntaxHighlighter(format: format).highlight(code))
        } else {
            highlighted = NSMutableAttributedString(string: code, attributes: codeBlockAttributes)
        }

        highlighted.addAttributes(
            codeBlockAttributesForExistingText,
            range: NSRange(location: 0, length: highlighted.length)
        )
        return highlighted
    }

    private func shouldUseSplash(for language: String?) -> Bool {
        guard let language = language?.lowercased() else { return true }
        return ["swift", "kt", "kotlin", "java", "scala", "js", "javascript", "ts", "typescript"].contains(language)
    }

    private var bodyAttributes: [NSAttributedString.Key: Any] {
        [
            .font: bodyFont,
            .foregroundColor: textColor,
            .paragraphStyle: paragraphStyle(spacing: 5, paragraphSpacing: 8)
        ]
    }

    private var listAttributes: [NSAttributedString.Key: Any] {
        [
            .font: bodyFont,
            .foregroundColor: textColor,
            .paragraphStyle: paragraphStyle(spacing: 4, paragraphSpacing: 5, firstLineHeadIndent: 0, headIndent: 18)
        ]
    }

    private var listMarkerAttributes: [NSAttributedString.Key: Any] {
        [
            .font: boldFont,
            .foregroundColor: accentColor,
            .paragraphStyle: paragraphStyle(spacing: 4, paragraphSpacing: 5)
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
            .paragraphStyle: paragraphStyle(spacing: 4, paragraphSpacing: 8, firstLineHeadIndent: 10, headIndent: 10)
        ]
    }

    private var codeBlockAttributesForExistingText: [NSAttributedString.Key: Any] {
        [
            .backgroundColor: codeBackground,
            .paragraphStyle: paragraphStyle(spacing: 4, paragraphSpacing: 8, firstLineHeadIndent: 10, headIndent: 10)
        ]
    }

    private var quoteAttributes: [NSAttributedString.Key: Any] {
        [
            .font: bodyFont,
            .foregroundColor: subtleColor,
            .backgroundColor: quoteBackground,
            .paragraphStyle: paragraphStyle(spacing: 4, paragraphSpacing: 6, firstLineHeadIndent: 0, headIndent: 16)
        ]
    }

    private var quoteMarkerAttributes: [NSAttributedString.Key: Any] {
        [
            .font: boldFont,
            .foregroundColor: accentColor,
            .backgroundColor: quoteBackground,
            .paragraphStyle: paragraphStyle(spacing: 4, paragraphSpacing: 6)
        ]
    }

    private func headingAttributes(level: Int) -> [NSAttributedString.Key: Any] {
        let size = max(fontSize + 1, fontSize + CGFloat(6 - min(level, 6)))
        return [
            .font: NSFont.systemFont(ofSize: size, weight: .semibold),
            .foregroundColor: headingColor,
            .paragraphStyle: paragraphStyle(spacing: 3, paragraphSpacing: 11, paragraphSpacingBefore: level <= 2 ? 4 : 2)
        ]
    }

    private func paragraphStyle(
        spacing: CGFloat,
        paragraphSpacing: CGFloat,
        paragraphSpacingBefore: CGFloat = 0,
        firstLineHeadIndent: CGFloat = 0,
        headIndent: CGFloat = 0
    ) -> NSParagraphStyle {
        let style = NSMutableParagraphStyle()
        style.lineSpacing = spacing
        style.paragraphSpacing = paragraphSpacing
        style.paragraphSpacingBefore = paragraphSpacingBefore
        style.firstLineHeadIndent = firstLineHeadIndent
        style.headIndent = headIndent
        return style
    }

    private func markdownPromotingBareShellBlocks(_ markdown: String) -> String {
        let lines = markdown.components(separatedBy: .newlines)
        var output: [String] = []
        var index = lines.startIndex
        var isInCodeFence = false

        while index < lines.endIndex {
            let rawLine = lines[index]
            let line = rawLine.trimmingCharacters(in: .whitespacesAndNewlines)
            if line.hasPrefix("```") {
                isInCodeFence.toggle()
                output.append(rawLine)
                index = lines.index(after: index)
                continue
            }

            guard !isInCodeFence, markdownShellCommandLine(line) else {
                output.append(rawLine)
                index = lines.index(after: index)
                continue
            }

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

            output.append("```bash")
            for codeIndex in index..<blockEnd {
                output.append(lines[codeIndex])
            }
            output.append("```")
            index = blockEnd
        }

        return output.joined(separator: "\n")
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
