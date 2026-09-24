import SwiftUI
import BkemoShared

/// Small, fast Markdown subset for memo cards: headings, task lists, bullets,
/// quotes, fenced code, inline emphasis/code/links, bare URLs and `#tags`.
enum MemoBlock: Hashable {
    case paragraph(AttributedString)
    case heading(level: Int, AttributedString)
    case task(line: Int, checked: Bool, AttributedString)
    case bullet(marker: String, indent: Int, AttributedString)
    case quote(AttributedString)
    case code(String)
}

enum MemoMarkdown {
    static let tagScheme = "bkemo-tag"

    private static let cache: NSCache<NSString, Box> = {
        let cache = NSCache<NSString, Box>()
        cache.countLimit = 400
        return cache
    }()

    private final class Box {
        let blocks: [MemoBlock]
        init(_ blocks: [MemoBlock]) { self.blocks = blocks }
    }

    static func blocks(for content: String) -> [MemoBlock] {
        let key = content as NSString
        if let hit = cache.object(forKey: key) { return hit.blocks }
        let blocks = parse(content)
        cache.setObject(Box(blocks), forKey: key)
        return blocks
    }

    private static let headingRegex = try! NSRegularExpression(pattern: #"^(#{1,3})\s+(.+)$"#)
    private static let bulletRegex = try! NSRegularExpression(pattern: #"^(\s*)([-*+]|\d+[.)])\s+(.*)$"#)
    private static let tagRegex = try! NSRegularExpression(pattern: #"(?<=\s|^)#[^\s#]+"#)
    private static let linkDetector = try? NSDataDetector(types: NSTextCheckingResult.CheckingType.link.rawValue)

    static func parse(_ content: String) -> [MemoBlock] {
        var blocks: [MemoBlock] = []
        var paragraph: [String] = []
        var code: [String]?

        func flushParagraph() {
            guard !paragraph.isEmpty else { return }
            blocks.append(.paragraph(inline(paragraph.joined(separator: "\n"))))
            paragraph.removeAll()
        }

        let lines = content.components(separatedBy: "\n")
        for (index, line) in lines.enumerated() {
            if line.trimmingCharacters(in: .whitespaces).hasPrefix("```") {
                if let open = code {
                    blocks.append(.code(open.joined(separator: "\n")))
                    code = nil
                } else {
                    flushParagraph()
                    code = []
                }
                continue
            }
            if code != nil {
                code?.append(line)
                continue
            }
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            if trimmed.isEmpty {
                flushParagraph()
                continue
            }
            let ns = line as NSString
            let full = NSRange(location: 0, length: ns.length)

            if let task = Checklist.parse(line) {
                flushParagraph()
                blocks.append(.task(line: index, checked: task.checked, inline(task.text)))
            } else if let match = headingRegex.firstMatch(in: line, range: full) {
                flushParagraph()
                let level = match.range(at: 1).length
                blocks.append(.heading(level: level, inline(ns.substring(with: match.range(at: 2)))))
            } else if let match = bulletRegex.firstMatch(in: line, range: full) {
                flushParagraph()
                let indent = match.range(at: 1).length / 2
                var marker = ns.substring(with: match.range(at: 2))
                if ["-", "*", "+"].contains(marker) { marker = "•" }
                blocks.append(.bullet(marker: marker, indent: indent, inline(ns.substring(with: match.range(at: 3)))))
            } else if trimmed.hasPrefix(">") {
                flushParagraph()
                let body = trimmed.dropFirst().trimmingCharacters(in: .whitespaces)
                blocks.append(.quote(inline(body)))
            } else {
                paragraph.append(line)
            }
        }
        if let open = code { blocks.append(.code(open.joined(separator: "\n"))) }
        flushParagraph()
        return blocks
    }

    static func inline(_ text: String) -> AttributedString {
        var result = (try? AttributedString(
            markdown: text,
            options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace, failurePolicy: .returnPartiallyParsedIfPossible)
        )) ?? AttributedString(text)

        let plain = String(result.characters)
        let ns = plain as NSString
        let full = NSRange(location: 0, length: ns.length)

        if plain.contains("#") {
            for match in tagRegex.matches(in: plain, range: full) {
                guard let range = Range(match.range, in: result) else { continue }
                let tag = String(ns.substring(with: match.range).dropFirst())
                var components = URLComponents()
                components.scheme = tagScheme
                components.host = "tag"
                components.queryItems = [URLQueryItem(name: "name", value: tag)]
                result[range].link = components.url
                result[range].font = Typo.sans(14.5, .medium)
            }
        }
        if plain.contains("://") || plain.contains("www."), let linkDetector {
            for match in linkDetector.matches(in: plain, range: full) {
                guard let url = match.url, let range = Range(match.range, in: result),
                      result[range].link == nil else { continue }
                result[range].link = url
            }
        }
        return result
    }

    static func tagName(from url: URL) -> String? {
        guard url.scheme == tagScheme else { return nil }
        return URLComponents(url: url, resolvingAgainstBaseURL: false)?
            .queryItems?.first { $0.name == "name" }?.value
    }
}

struct MemoContentView: View {
    let content: String
    var dimmed = false
    var collapsible = true
    var onToggleTask: ((Int) -> Void)?

    @Environment(Appearance.self) private var appearance
    @State private var expanded = false

    private static let collapsedBlockLimit = 9
    private static let collapsedCharLimit = 520

    var body: some View {
        let blocks = MemoMarkdown.blocks(for: content)
        let isLong = collapsible && (blocks.count > Self.collapsedBlockLimit || content.count > Self.collapsedCharLimit)
        let shown = isLong && !expanded ? Array(blocks.prefix(Self.collapsedBlockLimit)) : blocks

        VStack(alignment: .leading, spacing: 7) {
            ForEach(Array(shown.enumerated()), id: \.offset) { _, block in
                view(for: block, clampParagraphs: isLong && !expanded)
            }
            if isLong {
                Button {
                    withAnimation(.snappy(duration: 0.25)) { expanded.toggle() }
                } label: {
                    Text(expanded ? "Show less" : "Show more")
                        .font(Typo.sans(13, .semibold))
                        .foregroundStyle(Color.accentColor)
                }
                .buttonStyle(.plain)
                .padding(.top, 2)
            }
        }
        .foregroundStyle(dimmed ? Theme.fg3 : Theme.fg)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var bodyFont: Font { Typo.memo(serif: appearance.serifMemos, size: 16) }

    @ViewBuilder
    private func view(for block: MemoBlock, clampParagraphs: Bool) -> some View {
        switch block {
        case .paragraph(let text):
            Text(text)
                .font(bodyFont)
                .lineSpacing(3.5)
                .lineLimit(clampParagraphs ? 8 : nil)
                .fixedSize(horizontal: false, vertical: true)
        case .heading(let level, let text):
            Text(text)
                .font(Typo.memo(serif: appearance.serifMemos, size: level == 1 ? 20 : level == 2 ? 18 : 16.5, weight: .semibold))
                .padding(.top, 2)
        case .task(let line, let checked, let text):
            HStack(alignment: .firstTextBaseline, spacing: 9) {
                Button {
                    Haptics.select()
                    onToggleTask?(line)
                } label: {
                    Image(systemName: checked ? "checkmark.square.fill" : "square")
                        .font(.system(size: 16, weight: .regular))
                        .foregroundStyle(checked ? Color.accentColor : Theme.fg3)
                        .contentTransition(.symbolEffect(.replace))
                }
                .buttonStyle(.plain)
                .disabled(onToggleTask == nil)
                Text(text)
                    .font(bodyFont)
                    .strikethrough(checked, color: Theme.fg3)
                    .foregroundStyle(checked ? Theme.fg3 : Theme.fg)
                    .fixedSize(horizontal: false, vertical: true)
            }
        case .bullet(let marker, let indent, let text):
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(marker)
                    .font(marker == "•" ? .system(size: 15, weight: .bold) : bodyFont.monospacedDigit())
                    .foregroundStyle(Theme.fg3)
                    .frame(minWidth: 12, alignment: .trailing)
                Text(text)
                    .font(bodyFont)
                    .lineSpacing(3)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .padding(.leading, CGFloat(indent) * 16)
        case .quote(let text):
            HStack(spacing: 10) {
                RoundedRectangle(cornerRadius: 1.5).fill(Color.accentColor.opacity(0.55)).frame(width: 3)
                Text(text)
                    .font(bodyFont.italic())
                    .foregroundStyle(Theme.fg2)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .fixedSize(horizontal: false, vertical: true)
        case .code(let text):
            ScrollView(.horizontal, showsIndicators: false) {
                Text(text)
                    .font(.system(size: 13, design: .monospaced))
                    .foregroundStyle(Theme.fg2)
                    .padding(10)
            }
            .background(Theme.surface2, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
        }
    }
}
