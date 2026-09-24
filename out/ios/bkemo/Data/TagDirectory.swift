import Foundation
import Observation
import BkemoShared

/// Tag paths for `#` suggestions: server tags (cached for offline use) plus
/// whatever tags already appear in local memos.
@MainActor
@Observable
final class TagDirectory {
    static let shared = TagDirectory()

    private(set) var serverTags: [String]
    @ObservationIgnored private var lastFetch: Date?

    private init() {
        serverTags = AppGroup.defaults.stringArray(forKey: AppGroup.recentTagsKey) ?? []
    }

    func paths(local: [TagCount]) -> [String] {
        var seen = Set<String>()
        var result: [String] = []
        for path in local.map(\.name) + serverTags where seen.insert(path.lowercased()).inserted {
            result.append(path)
        }
        return result
    }

    func refresh() async {
        if let lastFetch, Date().timeIntervalSince(lastFetch) < 120 { return }
        guard Session.shared.canSync else { return }
        guard let rows = try? await Session.shared.client.tagList() else { return }
        lastFetch = .now
        serverTags = TagParser.pathTags(from: rows.map {
            (id: $0.id, name: $0.name, parent: $0.parent, sortOrder: $0.sortOrder)
        })
        AppGroup.defaults.set(serverTags, forKey: AppGroup.recentTagsKey)
    }
}
