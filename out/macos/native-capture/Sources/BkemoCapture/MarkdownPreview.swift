import SwiftUI

/// Deliberately minimal: bold, italic, plain lists, todo checkboxes, and H1
/// only. No live WYSIWYG — this renders when the user toggles Preview.
struct MarkdownPreview: View {
    let markdown: String

    private enum LineKind {
        case h1(AttributedString)
        case todo(checked: Bool, text: AttributedString)
        case bullet(AttributedString)
        case paragraph(AttributedString)
        case blank
    }

    private struct Line: Identifiable {
        let id: Int
        let kind: LineKind
    }

    private static let h1Regex = try! NSRegularExpression(pattern: #"^#\s+(.*)$"#)
    private static let todoRegex = try! NSRegularExpression(pattern: #"^[ \t]*[-*+][ \t]*\[([ xX]?)\][ \t]*(.*)$"#)
    private static let bulletRegex = try! NSRegularExpression(pattern: #"^[ \t]*[-*+][ \t]+(.*)$"#)

    private static func inline(_ s: String) -> AttributedString {
        var options = AttributedString.MarkdownParsingOptions()
        options.interpretedSyntax = .inlineOnlyPreservingWhitespace
        return (try? AttributedString(markdown: s, options: options)) ?? AttributedString(s)
    }

    private var lines: [Line] {
        markdown.components(separatedBy: "\n").enumerated().map { index, raw in
            if raw.trimmingCharacters(in: .whitespaces).isEmpty {
                return Line(id: index, kind: .blank)
            }
            let full = NSRange(raw.startIndex..., in: raw)

            if let match = Self.h1Regex.firstMatch(in: raw, range: full),
               let range = Range(match.range(at: 1), in: raw) {
                return Line(id: index, kind: .h1(Self.inline(String(raw[range]))))
            }
            if let match = Self.todoRegex.firstMatch(in: raw, range: full),
               let markRange = Range(match.range(at: 1), in: raw),
               let textRange = Range(match.range(at: 2), in: raw) {
                let checked = raw[markRange].lowercased() == "x"
                return Line(id: index, kind: .todo(checked: checked, text: Self.inline(String(raw[textRange]))))
            }
            if let match = Self.bulletRegex.firstMatch(in: raw, range: full),
               let textRange = Range(match.range(at: 1), in: raw) {
                return Line(id: index, kind: .bullet(Self.inline(String(raw[textRange]))))
            }
            return Line(id: index, kind: .paragraph(Self.inline(raw)))
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            ForEach(lines) { line in
                lineView(for: line.kind)
            }
        }
        .textSelection(.enabled)
    }

    @ViewBuilder
    private func lineView(for kind: LineKind) -> some View {
        switch kind {
        case .h1(let text):
            Text(text).font(.title3.bold())
        case .todo(let checked, let text):
            HStack(alignment: .top, spacing: 6) {
                Image(systemName: checked ? "checkmark.square.fill" : "square")
                    .foregroundStyle(checked ? .secondary : .primary)
                Text(text).strikethrough(checked)
            }
        case .bullet(let text):
            HStack(alignment: .top, spacing: 6) {
                Text("\u{2022}")
                Text(text)
            }
        case .paragraph(let text):
            Text(text)
        case .blank:
            Spacer().frame(height: 4)
        }
    }
}
