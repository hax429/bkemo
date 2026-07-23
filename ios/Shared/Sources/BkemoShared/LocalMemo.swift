import Foundation
import SwiftData

@Model
public final class LocalMemo {
    @Attribute(.unique) public var localId: UUID
    public var serverId: Int?
    public var content: String
    public var type: Int
    public var isImportant: Bool
    public var isUrgent: Bool
    public var dueDate: Date?
    public var source: String
    public var createdAt: Date
    public var updatedAt: Date
    public var completedAt: Date?
    public var syncState: String
    public var syncError: String?

    public init(content: String, type: Int, source: String,
                isImportant: Bool = false, isUrgent: Bool = false,
                dueDate: Date? = nil) {
        self.localId = UUID()
        self.serverId = nil
        self.content = content
        self.type = type
        self.source = source
        self.isImportant = isImportant
        self.isUrgent = isUrgent
        self.dueDate = dueDate
        self.createdAt = .now
        self.updatedAt = .now
        self.syncState = "pending"
        self.syncError = nil
    }
}