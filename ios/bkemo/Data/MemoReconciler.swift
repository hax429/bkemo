import Foundation
import SwiftData
import BkemoShared

enum MemoReconciler {
    static func mergeRemote(
        existing: [MemoItem],
        changed: [[String: Any]],
        removedIds: [Int]
    ) -> [MemoItem] {
        let removed = Set(removedIds)
        var byId: [Int: MemoItem] = [:]
        for item in existing {
            if let id = item.serverId {
                byId[id] = item
            }
        }

        for id in removed {
            byId.removeValue(forKey: id)
        }
        for row in changed {
            let item = MemoItem(remote: row)
            guard let id = item.serverId, id >= 0, !removed.contains(id) else { continue }
            byId[id] = item
        }

        return Array(byId.values.sorted { lhs, rhs in
            if lhs.createdAt == rhs.createdAt {
                return (lhs.serverId ?? 0) > (rhs.serverId ?? 0)
            }
            return lhs.createdAt > rhs.createdAt
        }.prefix(50))
    }

    static func reconcileLocal(
        changed: [[String: Any]],
        removedIds: [Int],
        context: ModelContext
    ) throws {
        let localMemos = try context.fetch(FetchDescriptor<LocalMemo>())
        let removed = Set(removedIds)

        for memo in localMemos {
            guard let serverId = memo.serverId else { continue }
            if removed.contains(serverId) {
                context.delete(memo)
                continue
            }
            guard let row = changed.first(where: { $0["id"] as? Int == serverId }) else { continue }
            apply(row, to: memo)
        }
        try context.save()
    }

    static func remove(serverId: Int, context: ModelContext) throws {
        let descriptor = FetchDescriptor<LocalMemo>(
            predicate: #Predicate { $0.serverId == serverId }
        )
        for memo in try context.fetch(descriptor) {
            context.delete(memo)
        }
        try context.save()
    }

    private static func apply(_ row: [String: Any], to memo: LocalMemo) {
        memo.content = row["content"] as? String ?? memo.content
        memo.type = row["type"] as? Int ?? memo.type
        memo.isImportant = row["isImportant"] as? Bool ?? memo.isImportant
        memo.isUrgent = row["isUrgent"] as? Bool ?? memo.isUrgent
        memo.dueDate = MemoItem.parseDate(row["dueDate"] as Any)
        memo.completedAt = MemoItem.parseDate(row["completedAt"] as Any)
        memo.updatedAt = MemoItem.parseDate(row["updatedAt"] as Any) ?? memo.updatedAt
        memo.syncState = "synced"
        memo.syncError = nil
    }
}
