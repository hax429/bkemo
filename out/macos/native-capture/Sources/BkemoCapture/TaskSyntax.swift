import Foundation

/// Inline task syntax for the capture composer. Ported from
/// `app/src/lib/taskSyntax.ts` — keep behavior in sync with that file.
/// Unlike the web version this only ever runs against a brand-new memo
/// (capture always creates), so the "leave unchanged" (undefined) case in
/// the original due-date parsing collapses into "no due date."
public struct ParsedTaskSyntax {
    public var content: String
    public var isTodo: Bool
    public var dueDate: Date?
    public var isImportant: Bool
    public var isUrgent: Bool
}

private func regexReplace(
    _ input: String,
    pattern: NSRegularExpression,
    transform: (NSTextCheckingResult, NSString) -> String
) -> String {
    let ns = input as NSString
    let range = NSRange(location: 0, length: ns.length)
    let matches = pattern.matches(in: input, range: range)
    guard !matches.isEmpty else { return input }
    var result = ""
    var lastEnd = 0
    for match in matches {
        let full = match.range
        result += ns.substring(with: NSRange(location: lastEnd, length: full.location - lastEnd))
        result += transform(match, ns)
        lastEnd = full.location + full.length
    }
    result += ns.substring(from: lastEnd)
    return result
}

private func group(_ match: NSTextCheckingResult, _ index: Int, _ ns: NSString) -> String {
    let r = match.range(at: index)
    return r.location == NSNotFound ? "" : ns.substring(with: r)
}

public enum TaskSyntax {
    private static let taskItemRegex = try! NSRegularExpression(
        pattern: #"^[ \t]*[-*+][ \t]*\[[ xX]?\]"#, options: [.anchorsMatchLines])
    private static let escapedCheckboxRegex = try! NSRegularExpression(
        pattern: #"^([ \t]*)\\?[-*+][ \t]*\\?\[[ \t]*([xX]?)[ \t]*\\?\]"#, options: [.anchorsMatchLines])
    private static let checkboxLineRegex = try! NSRegularExpression(
        pattern: #"^[ \t]*[-*+][ \t]*\[[ xX]?\]"#, options: [.anchorsMatchLines])
    private static let loneCheckboxRegex = try! NSRegularExpression(
        pattern: #"^([ \t]*)[-*+][ \t]*\[[ xX]?\][ \t]*"#, options: [.anchorsMatchLines])
    private static let dueRegex = try! NSRegularExpression(
        pattern: #"(^|\s)due:(\S+)"#, options: [.caseInsensitive])
    private static let importantRegex = try! NSRegularExpression(
        pattern: #"(^|\s)#important(?=$|\s)"#, options: [.caseInsensitive])
    private static let urgentRegex = try! NSRegularExpression(
        pattern: #"(^|\s)#urgent(?=$|\s)"#, options: [.caseInsensitive])
    private static let trailingWhitespaceRegex = try! NSRegularExpression(
        pattern: #"[ \t]+$"#, options: [.anchorsMatchLines])

    private static func hasMatch(_ regex: NSRegularExpression, _ s: String) -> Bool {
        regex.firstMatch(in: s, range: NSRange(location: 0, length: (s as NSString).length)) != nil
    }

    static func normalizeCheckboxes(_ markdown: String) -> String {
        regexReplace(markdown, pattern: escapedCheckboxRegex) { match, ns in
            let indent = group(match, 1, ns)
            let mark = group(match, 2, ns)
            return "\(indent)- [\(mark.isEmpty ? " " : "x")]"
        }
    }

    static func stripLoneCheckbox(_ markdown: String) -> String {
        let normalized = normalizeCheckboxes(markdown)
        let ns = normalized as NSString
        let matches = checkboxLineRegex.matches(in: normalized, range: NSRange(location: 0, length: ns.length))
        guard matches.count == 1 else { return markdown }
        var didReplace = false
        return regexReplace(normalized, pattern: loneCheckboxRegex) { match, ns in
            if didReplace { return ns.substring(with: match.range) }
            didReplace = true
            return group(match, 1, ns)
        }
    }

    private static func endOfDay(_ date: Date) -> Date {
        let cal = Calendar.current
        let start = cal.startOfDay(for: date)
        return cal.date(byAdding: DateComponents(day: 1, second: -1), to: start) ?? date
    }

    private enum DueParseResult {
        case unrecognized
        case cleared
        case date(Date)
    }

    private static func parseDueValue(_ raw: String) -> DueParseResult {
        let v = raw.trimmingCharacters(in: .whitespaces).lowercased()
        if v.isEmpty { return .unrecognized }
        if v == "today" || v == "tod" { return .date(endOfDay(Date())) }
        if v == "tomorrow" || v == "tmr" || v == "tom" {
            let tomorrow = Calendar.current.date(byAdding: .day, value: 1, to: Date()) ?? Date()
            return .date(endOfDay(tomorrow))
        }
        if v == "none" || v == "clear" || v == "inbox" { return .cleared }
        let trimmed = raw.trimmingCharacters(in: .whitespaces)
        let formats = ["MM/dd/yyyy", "M/d/yyyy", "MM/dd/yy", "M/d/yy", "yyyy-MM-dd", "yyyy/MM/dd"]
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        for fmt in formats {
            formatter.dateFormat = fmt
            if let d = formatter.date(from: trimmed) { return .date(endOfDay(d)) }
        }
        return .unrecognized
    }

    public static func parse(_ markdown: String) -> ParsedTaskSyntax {
        let normalized = normalizeCheckboxes(markdown)
        let hasCheckbox = hasMatch(taskItemRegex, normalized)
        let ns = normalized as NSString
        let dueMatch = dueRegex.firstMatch(in: normalized, range: NSRange(location: 0, length: ns.length))

        var dueDate: Date?
        var shouldStripDue = false
        if let dueMatch {
            switch parseDueValue(group(dueMatch, 2, ns)) {
            case .unrecognized: break
            case .cleared: shouldStripDue = true
            case .date(let d): shouldStripDue = true; dueDate = d
            }
        }

        let isImportant = hasMatch(importantRegex, normalized)
        let isUrgent = hasMatch(urgentRegex, normalized)

        var content = regexReplace(normalized, pattern: importantRegex) { match, ns in group(match, 1, ns) }
        content = regexReplace(content, pattern: urgentRegex) { match, ns in group(match, 1, ns) }
        if shouldStripDue {
            content = regexReplace(content, pattern: dueRegex) { match, ns in group(match, 1, ns) }
        }
        content = stripLoneCheckbox(content)
        content = regexReplace(content, pattern: trailingWhitespaceRegex) { _, _ in "" }
        content = content.trimmingCharacters(in: .whitespacesAndNewlines)

        return ParsedTaskSyntax(
            content: content,
            isTodo: hasCheckbox || dueDate != nil,
            dueDate: dueDate,
            isImportant: isImportant,
            isUrgent: isUrgent
        )
    }
}
