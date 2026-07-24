import Foundation
import SwiftUI
import BkemoShared

@MainActor
final class TagStore: ObservableObject {
    static let shared = TagStore()

    @Published private(set) var pathTags: [String] = []
    @Published private(set) var loading = false

    private var lastFetch: Date?
    private let cacheTTL: TimeInterval = 60

    func refresh(force: Bool = false) async {
        if !force, let lastFetch, Date().timeIntervalSince(lastFetch) < cacheTTL, !pathTags.isEmpty {
            return
        }
        guard AuthManager.shared.isLoggedIn else { return }
        loading = true
        defer { loading = false }
        do {
            let rows = try await AuthManager.shared.client.tagList()
            pathTags = TagParser.pathTags(from: rows.map {
                (id: $0.id, name: $0.name, parent: $0.parent, sortOrder: $0.sortOrder)
            })
            lastFetch = Date()
        } catch APIError.unauthorized {
            AuthManager.shared.handleUnauthorized()
        } catch {
            // Keep stale cache; suggestions still work offline from last fetch.
        }
    }
}
