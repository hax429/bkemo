import Foundation
import SwiftData
import BkemoShared

@MainActor
final class SyncEngine: ObservableObject {
    static let shared = SyncEngine()
    @Published var lastListFetched: Date?
    @Published var syncError: String?

    private var container: ModelContainer
    private var context: ModelContext { container.mainContext }
    private var eventTask: Task<Void, Never>?
    private var pollingTask: Task<Void, Never>?

    init(container: ModelContainer? = nil) {
        self.container = container ?? ModelContainerSetup.make()
    }

    func configure(container: ModelContainer) {
        self.container = container
    }

    // Replay pending rows oldest-first.
    func replayPending() async {
        let descriptor = FetchDescriptor<LocalMemo>(
            predicate: #Predicate { $0.syncState == "pending" },
            sortBy: [SortDescriptor(\.createdAt, order: .forward)]
        )
        guard let pending = try? context.fetch(descriptor), !pending.isEmpty else { return }
        for memo in pending {
            let localId = memo.localId
            let source = memo.source
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
                try context.save()
                if source == MemoSource.manual {
                    CaptureFeedback.shared.noteSynced(localId: localId)
                } else {
                    // Share / widget captures were not tracked by the composer.
                    CaptureFeedback.shared.noteSyncedBurst()
                }
            } catch APIError.unauthorized {
                AuthManager.shared.handleUnauthorized()
                return
            } catch APIError.transport(let error) {
                // Keep transient network failures eligible for the foreground
                // 10-second retry instead of stranding the capture in "error".
                memo.syncState = "pending"
                memo.syncError = error.localizedDescription
                try? context.save()
            } catch {
                memo.syncState = "error"
                memo.syncError = error.localizedDescription
                try? context.save()
                CaptureFeedback.shared.showFailed("Sync failed")
            }
        }
        AppGroup.defaults.set(Date().timeIntervalSince1970, forKey: AppGroup.lastSyncKey)
    }

    func retry(item: MemoItem) async {
        guard let lid = item.localId else { return }
        let descriptor = FetchDescriptor<LocalMemo>(predicate: #Predicate { $0.localId == lid })
        guard let row = try? context.fetch(descriptor).first else { return }
        row.syncState = "pending"
        row.syncError = nil
        try? context.save()
        await replayPending()
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
            syncError = nil
        } catch APIError.unauthorized {
            AuthManager.shared.handleUnauthorized()
        } catch {
            syncError = error.localizedDescription
        }
    }

    func updateRemote(item: MemoItem, content: String, type: Int, isImportant: Bool, isUrgent: Bool) async throws {
        guard let id = item.serverId else { throw APIError.decode("memo has no server id") }
        do {
            let body = BkemoClient.UpsertBody(content: content, type: type,
                                              isImportant: isImportant, isUrgent: isUrgent, id: id)
            _ = try await AuthManager.shared.client.noteUpsert(body)
            await refreshRecentList(force: true)
            syncError = nil
        } catch APIError.unauthorized {
            AuthManager.shared.handleUnauthorized()
            throw APIError.unauthorized
        } catch {
            syncError = error.localizedDescription
            throw error
        }
    }

    func delete(item: MemoItem) async throws {
        if let id = item.serverId {
            do {
                try await AuthManager.shared.client.noteBatchTrash(ids: [id])
                try MemoReconciler.remove(serverId: id, context: context)
                ListStore.shared.remove(serverId: id)
                syncError = nil
            } catch APIError.unauthorized {
                AuthManager.shared.handleUnauthorized()
                throw APIError.unauthorized
            } catch {
                syncError = error.localizedDescription
                throw error
            }
        } else if let lid = item.localId {
            let descriptor = FetchDescriptor<LocalMemo>(predicate: #Predicate { $0.localId == lid })
            if let row = try context.fetch(descriptor).first {
                context.delete(row)
                try context.save()
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
            try await ListStore.shared.load()
            lastListFetched = Date()
            AppGroup.defaults.set(now, forKey: AppGroup.lastSyncKey)
            syncError = nil
        } catch APIError.unauthorized {
            AuthManager.shared.handleUnauthorized()
        } catch {
            syncError = error.localizedDescription
        }
    }

    func syncChanges() async {
        guard AuthManager.shared.isLoggedIn else { return }
        let savedCursor = AppGroup.defaults.object(forKey: AppGroup.noteChangesCursorKey) as? Int
        do {
            let changes = try await AuthManager.shared.client.noteChanges(
                cursor: savedCursor,
                bootstrap: savedCursor == nil
            )
            try MemoReconciler.reconcileLocal(
                changed: changes.changed,
                removedIds: changes.removedIds,
                context: context
            )
            ListStore.shared.apply(changed: changes.changed, removedIds: changes.removedIds)
            AppGroup.defaults.set(changes.cursor, forKey: AppGroup.noteChangesCursorKey)
            AppGroup.defaults.set(Date().timeIntervalSince1970, forKey: AppGroup.lastSyncKey)
            syncError = nil
        } catch APIError.unauthorized {
            AuthManager.shared.handleUnauthorized()
        } catch {
            syncError = error.localizedDescription
        }
    }

    func startForegroundSync() {
        cancelForegroundSync()
        Task {
            await replayPending()
            await syncChanges()
        }
        eventTask = Task { [weak self] in
            guard let self else { return }
            await self.runEventLoop()
        }
        pollingTask = Task { [weak self] in
            while !Task.isCancelled {
                do {
                    try await Task.sleep(for: .seconds(10))
                } catch {
                    return
                }
                guard let self else { return }
                await self.replayPending()
                await self.syncChanges()
            }
        }
    }

    func cancelForegroundSync() {
        eventTask?.cancel()
        pollingTask?.cancel()
        eventTask = nil
        pollingTask = nil
    }

    private func runEventLoop() async {
        while !Task.isCancelled, AuthManager.shared.isLoggedIn {
            do {
                for try await event in AuthManager.shared.client.noteEvents() {
                    guard !Task.isCancelled else { return }
                    if event.kind == "security" {
                        AuthManager.shared.securityAlertMessage =
                            "Security alert — open bkemo on Mac or Web to review"
                        continue
                    }
                    await syncChanges()
                }
            } catch APIError.unauthorized {
                AuthManager.shared.handleUnauthorized()
                return
            } catch is CancellationError {
                return
            } catch {
                syncError = error.localizedDescription
            }
            do {
                try await Task.sleep(for: .seconds(2))
            } catch {
                return
            }
            await syncChanges()
        }
    }
}