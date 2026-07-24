import Foundation

public enum TagParser {
    public struct ActiveHashtag: Equatable {
        /// Tag body without the leading `#`.
        public let query: String
        /// UTF-16 range covering `#` + query in the source string.
        public let range: NSRange

        public init(query: String, range: NSRange) {
            self.query = query
            self.range = range
        }
    }

    public struct SuggestItem: Equatable, Identifiable {
        public var id: String { path }
        public let path: String
        public let isNew: Bool

        public init(path: String, isNew: Bool) {
            self.path = path
            self.isNew = isNew
        }

        public var label: String { "#\(path)" }
    }

    public static func extract(_ text: String) -> [String] {
        let withoutCode = text.replacingOccurrences(of: "\\{\\{[\\s\\S]*?\\}\\}", with: "", options: .regularExpression)
            .replacingOccurrences(of: "```[\\s\\S]*?```", with: "", options: .regularExpression)
        var tags: [String] = []
        let pattern = "(?<=\\s|^)#[^\\s#]+(?=\\s|$)"
        guard let regex = try? NSRegularExpression(pattern: pattern) else { return [] }
        let range = NSRange(withoutCode.startIndex..., in: withoutCode)
        for match in regex.matches(in: withoutCode, range: range) {
            if let r = Range(match.range, in: withoutCode) {
                tags.append(String(withoutCode[r]).dropFirst().description)
            }
        }
        return tags
    }

    /// Active `#tag` fragment at the UTF-16 cursor, matching web TipTap suggestion.
    public static func activeHashtag(in text: String, cursorUTF16: Int) -> ActiveHashtag? {
        let ns = text as NSString
        let cursor = min(max(0, cursorUTF16), ns.length)
        guard cursor > 0 else { return nil }

        var index = cursor - 1
        while index >= 0 {
            let ch = ns.character(at: index)
            if ch == 35 { // #
                let precededOk = index == 0 || CharacterSet.whitespacesAndNewlines
                    .contains(UnicodeScalar(ns.character(at: index - 1))!)
                guard precededOk else { return nil }
                let length = cursor - index
                let token = ns.substring(with: NSRange(location: index, length: length))
                let body = String(token.dropFirst())
                if body.contains(where: { $0.isWhitespace || $0 == "#" }) { return nil }
                return ActiveHashtag(query: body, range: NSRange(location: index, length: length))
            }
            if let scalar = UnicodeScalar(ch), CharacterSet.whitespacesAndNewlines.contains(scalar) {
                return nil
            }
            index -= 1
        }
        return nil
    }

    public static func suggestions(query: String, pathTags: [String], limit: Int = 8) -> [SuggestItem] {
        let q = query.lowercased()
        var matched = pathTags.filter { $0.lowercased().contains(q) }
        if matched.count > limit { matched = Array(matched.prefix(limit)) }
        var items = matched.map { SuggestItem(path: $0, isNew: false) }
        if !query.isEmpty, !pathTags.contains(where: { $0.lowercased() == q }) {
            items.insert(SuggestItem(path: query, isNew: true), at: 0)
            if items.count > limit { items = Array(items.prefix(limit)) }
        }
        return items
    }

    /// Build path tags (`ios`, `ios/bug`) from flat DB rows, matching web `pathTags`.
    public static func pathTags(from rows: [(id: Int, name: String, parent: Int, sortOrder: Int)]) -> [String] {
        struct Node {
            let name: String
            let parent: Int
            let sortOrder: Int
            var children: [Int] = []
        }

        var map: [Int: Node] = [:]
        for row in rows {
            map[row.id] = Node(name: row.name, parent: row.parent, sortOrder: row.sortOrder)
        }

        var roots: [Int] = []
        for row in rows {
            if row.parent == 0 || map[row.parent] == nil {
                roots.append(row.id)
            } else if var parent = map[row.parent] {
                parent.children.append(row.id)
                map[row.parent] = parent
            }
        }

        roots.sort { (map[$0]?.sortOrder ?? 0) < (map[$1]?.sortOrder ?? 0) }
        for id in Array(map.keys) {
            guard var node = map[id] else { continue }
            node.children.sort { (map[$0]?.sortOrder ?? 0) < (map[$1]?.sortOrder ?? 0) }
            map[id] = node
        }

        func paths(for id: Int, parentPath: String) -> [String] {
            guard let node = map[id] else { return [] }
            let current = parentPath.isEmpty ? node.name : "\(parentPath)/\(node.name)"
            var out = [current]
            for child in node.children {
                out.append(contentsOf: paths(for: child, parentPath: current))
            }
            return out
        }

        return roots.flatMap { paths(for: $0, parentPath: "") }
    }
}
