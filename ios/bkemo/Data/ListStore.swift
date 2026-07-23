import Foundation
import SwiftUI
import BkemoShared

@MainActor
final class ListStore: ObservableObject {
    static let shared = ListStore()
    @Published var remoteMemos: [MemoItem] = []
    @Published var loading = false

    func load() async {
        loading = true
        defer { loading = false }
        do {
            let rows = try await AuthManager.shared.client.noteList(page: 1, size: 50)
            remoteMemos = rows.map { MemoItem(remote: $0) }
        } catch { }
    }

    func reload() async { await load() }
}