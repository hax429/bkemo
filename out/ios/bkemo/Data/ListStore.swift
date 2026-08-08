import Foundation
import SwiftUI
import BkemoShared

@MainActor
final class ListStore: ObservableObject {
    static let shared = ListStore()
    @Published var remoteMemos: [MemoItem] = []
    @Published var loading = false
    @Published var error: String?

    func load() async throws {
        loading = true
        defer { loading = false }
        do {
            let rows = try await AuthManager.shared.client.noteList(page: 1, size: 50)
            remoteMemos = rows.map { MemoItem(remote: $0) }
            error = nil
        } catch {
            self.error = error.localizedDescription
            throw error
        }
    }

    func apply(changed: [[String: Any]], removedIds: [Int]) {
        remoteMemos = MemoReconciler.mergeRemote(
            existing: remoteMemos,
            changed: changed,
            removedIds: removedIds
        )
        error = nil
    }

    func remove(serverId: Int) {
        remoteMemos.removeAll { $0.serverId == serverId }
        error = nil
    }

    func reload() async {
        do {
            try await load()
        } catch APIError.unauthorized {
            AuthManager.shared.handleUnauthorized()
        } catch { }
    }
}