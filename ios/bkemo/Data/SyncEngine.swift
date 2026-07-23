import Foundation
import SwiftData
import BkemoShared

@MainActor
final class SyncEngine: ObservableObject {
    static let shared = SyncEngine()
    @Published var lastListFetched: Date?

    let container: ModelContainer
    private var context: ModelContext { container.mainContext }

    init(container: ModelContainer? = nil) {
        self.container = container ?? ModelContainerSetup.make()
    }

    // Replay pending rows oldest-first.
    func replayPending() async {
        let descriptor = FetchDescriptor<LocalMemo>(
            predicate: #Predicate { $0.syncState == "pending" },
            sortBy: [SortDescriptor(\.createdAt, order: .forward)]
        )
        guard let pending = try? context.fetch(descriptor), !pending.isEmpty else { return }
        for memo in pending {
            do {
                let body = BkemoClient.UpsertBody(
                    content: memo.content,
                    type: memo.type,
                    isImportant: memo.isImportant,
                    isUrgent: memo.isUrgent,
                    dueDate: memo.dueDate,
                    createdAt: memo.createdAt
                )
                let id = try await AuthManager.shared.client.noteUpsert(body)
                memo.serverId = id
                memo.syncState = "synced"
                memo.syncError = nil
                try? context.save()
            } catch APIError.unauthorized {
                AuthManager.shared.handleUnauthorized()
                return
            } catch {
                memo.syncState = "error"
                memo.syncError = error.localizedDescription
                try? context.save()
            }
        }
        AppGroup.defaults.set(Date().timeIntervalSince1970, forKey: AppGroup.lastSyncKey)
    }

    @discardableResult
    func insert(content: String, type: Int, isImportant: Bool, isUrgent: Bool,
                source: String, dueDate: Date? = nil) -> LocalMemo {
        let memo = LocalMemo(content: content, type: type, source: source,
                             isImportant: isImportant, isUrgent: isUrgent, dueDate: dueDate)
        context.insert(memo)
        try? context.save()
        Task { await replayPending() }
        return memo
    }

    func toggleDone(item: MemoItem) async {
        guard let id = item.serverId else { return }
        do {
            try await AuthManager.shared.client.noteToggleDone(id: id, done: !(item.completedAt != nil))
            await refreshRecentList(force: true)
        } catch APIError.unauthorized {
            AuthManager.shared.handleUnauthorized()
        } catch { }
    }

    func updateRemote(item: MemoItem, content: String, type: Int, isImportant: Bool, isUrgent: Bool) async {
        guard let id = item.serverId else { return }
        do {
            let body = BkemoClient.UpsertBody(content: content, type: type,
                                              isImportant: isImportant, isUrgent: isUrgent, id: id)
            _ = try await AuthManager.shared.client.noteUpsert(body)
            await refreshRecentList(force: true)
        } catch APIError.unauthorized {
            AuthManager.shared.handleUnauthorized()
        } catch { }
    }

    func delete(item: MemoItem) async {
        if let id = item.serverId {
            do {
                try await AuthManager.shared.client.noteBatchTrash(ids: [id])
                await refreshRecentList(force: true)
            } catch APIError.unauthorized {
                AuthManager.shared.handleUnauthorized()
            } catch { }
        } else if item.syncState == "pending", let lid = item.localId {
            let descriptor = FetchDescriptor<LocalMemo>(predicate: #Predicate { $0.localId == lid })
            if let row = try? context.fetch(descriptor).first {
                context.delete(row)
                try? context.save()
            }
        }
    }

    func refreshRecentList(force: Bool) async {
        let now = Date().timeIntervalSince1970
        if !force, let last = AppGroup.defaults.object(forKey: AppGroup.lastSyncKey) as? Double,
           now - last < 30 {
            return
        }
        do {
            _ = try await AuthManager.shared.client.noteList(page: 1, size: 50)
            lastListFetched = Date()
            AppGroup.defaults.set(now, forKey: AppGroup.lastSyncKey)
        } catch APIError.unauthorized {
            AuthManager.shared.handleUnauthorized()
        } catch { }
    }
}