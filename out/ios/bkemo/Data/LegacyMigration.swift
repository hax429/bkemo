import Foundation
import SwiftData
import BkemoShared

/// Carries unsynced captures from the v1 SwiftData store into the v2 outbox,
/// then deletes the old store. Runs once, after the first frame.
enum LegacyMigration {
    @MainActor
    static func runIfNeeded(into store: MemoStore) async {
        let defaults = AppGroup.defaults
        guard !defaults.bool(forKey: AppGroup.legacyMigratedKey), !Session.shared.isDemo else { return }
        defaults.removeObject(forKey: AppGroup.legacyCursorKey)

        let url = AppGroup.legacyStoreURL
        if FileManager.default.fileExists(atPath: url.path) {
            let captured = await Task.detached(priority: .utility) { readUnsynced(at: url) }.value
            if let captured {
                await store.loadFull()
                store.importCaptures(captured)
            } else {
                // Store unreadable: keep it for a later attempt rather than lose captures.
                return
            }
            for suffix in ["", "-shm", "-wal"] {
                try? FileManager.default.removeItem(atPath: url.path + suffix)
            }
        }
        defaults.set(true, forKey: AppGroup.legacyMigratedKey)
    }

    nonisolated private static func readUnsynced(at url: URL) -> [Memo]? {
        let schema = Schema([LocalMemo.self])
        let config = ModelConfiguration("Memo", schema: schema, url: url, cloudKitDatabase: .none)
        guard let container = try? ModelContainer(for: schema, configurations: [config]) else { return nil }
        let context = ModelContext(container)
        guard let rows = try? context.fetch(FetchDescriptor<LocalMemo>()) else { return nil }
        return rows
            .filter { $0.serverId == nil && $0.syncState != "synced" }
            .map { row in
                Memo(
                    localId: row.localId,
                    content: row.content,
                    type: row.type,
                    isImportant: row.isImportant,
                    isUrgent: row.isUrgent,
                    dueDate: row.dueDate,
                    completedAt: row.completedAt,
                    createdAt: row.createdAt,
                    updatedAt: row.updatedAt,
                    source: row.source
                )
            }
    }
}
