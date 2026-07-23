import Foundation
import BkemoShared

struct MemoItem: Identifiable, Equatable {
    let id: String
    let localId: UUID?
    let serverId: Int?
    var content: String
    var type: Int
    var isImportant: Bool
    var isUrgent: Bool
    var dueDate: Date?
    var completedAt: Date?
    var createdAt: Date
    var syncState: String
    var syncError: String?
    var source: String

    var isPending: Bool { syncState == "pending" }
    var isError: Bool { syncState == "error" }
    var isRemote: Bool { syncState == "remote" }
    var isTodo: Bool { type == NoteType.todo }
    var isCompleted: Bool { completedAt != nil }

    init(local: LocalMemo) {
        self.id = "local:\(local.localId.uuidString)"
        self.localId = local.localId
        self.serverId = local.serverId
        self.content = local.content
        self.type = local.type
        self.isImportant = local.isImportant
        self.isUrgent = local.isUrgent
        self.dueDate = local.dueDate
        self.completedAt = local.completedAt
        self.createdAt = local.createdAt
        self.syncState = local.syncState
        self.syncError = local.syncError
        self.source = local.source
    }

    init(remote: [String: Any]) {
        let id = (remote["id"] as? Int) ?? -1
        self.id = "remote:\(id)"
        self.localId = nil
        self.serverId = id
        self.content = (remote["content"] as? String) ?? ""
        self.type = (remote["type"] as? Int) ?? 0
        self.isImportant = (remote["isImportant"] as? Bool) ?? false
        self.isUrgent = (remote["isUrgent"] as? Bool) ?? false
        self.dueDate = Self.parseDate(remote["dueDate"] as Any)
        self.completedAt = Self.parseDate(remote["completedAt"] as Any)
        if let s = remote["createdAt"] as Any? { self.createdAt = Self.parseDate(s) ?? Date() } else { self.createdAt = Date() }
        self.syncState = "remote"
        self.syncError = nil
        self.source = (remote["source"] as? String) ?? ""
    }

    static func parseDate(_ v: Any) -> Date? {
        if let d = v as? Date { return d }
        if let s = v as? String { return ISO8601DateFormatter().date(from: s) }
        return nil
    }
}