import Foundation

public struct MemoAttachment: Codable, Hashable, Sendable {
    public var name: String
    public var path: String
    public var type: String

    public init(name: String, path: String, type: String) {
        self.name = name
        self.path = path
        self.type = type
    }

    public var isImage: Bool {
        if type.hasPrefix("image") { return true }
        let ext = (name as NSString).pathExtension.lowercased()
        return ["png", "jpg", "jpeg", "gif", "webp", "heic", "heif"].contains(ext)
    }
}

/// One note as the app sees it. The same shape is used for the timeline mirror,
/// the outbox payloads, and the inbox files written by extensions.
public struct Memo: Codable, Identifiable, Hashable, Sendable {
    /// Stable UI identity. Captured memos keep the UUID they were born with even
    /// after the server assigns an id, so rows never jump.
    public var localId: UUID
    public var serverId: Int?
    public var content: String
    public var type: Int
    public var isTop: Bool
    public var isArchived: Bool
    public var isImportant: Bool
    public var isUrgent: Bool
    public var dueDate: Date?
    public var completedAt: Date?
    public var createdAt: Date
    public var updatedAt: Date
    public var attachments: [MemoAttachment]
    public var source: String

    public var id: UUID { localId }
    public var isTodo: Bool { type == NoteType.todo }
    public var isDone: Bool { completedAt != nil }

    public init(
        localId: UUID = UUID(),
        serverId: Int? = nil,
        content: String,
        type: Int = NoteType.blinko,
        isTop: Bool = false,
        isArchived: Bool = false,
        isImportant: Bool = false,
        isUrgent: Bool = false,
        dueDate: Date? = nil,
        completedAt: Date? = nil,
        createdAt: Date = .now,
        updatedAt: Date = .now,
        attachments: [MemoAttachment] = [],
        source: String = MemoSource.manual
    ) {
        self.localId = localId
        self.serverId = serverId
        self.content = content
        self.type = type
        self.isTop = isTop
        self.isArchived = isArchived
        self.isImportant = isImportant
        self.isUrgent = isUrgent
        self.dueDate = dueDate
        self.completedAt = completedAt
        self.createdAt = createdAt
        self.updatedAt = updatedAt
        self.attachments = attachments
        self.source = source
    }

    /// Deterministic identity for memos first seen from the server.
    public static func stableLocalId(serverId: Int) -> UUID {
        let hex = String(format: "%012llx", UInt64(bitPattern: Int64(serverId)) & 0xffff_ffff_ffff)
        return UUID(uuidString: "b4e40000-0000-4000-8000-\(hex)") ?? UUID()
    }

    /// Builds a memo from a `/v1/note/*` JSON row. Returns nil without an id.
    public init?(remote row: [String: Any], localId: UUID? = nil) {
        guard let id = row["id"] as? Int else { return nil }
        self.serverId = id
        self.localId = localId ?? Self.stableLocalId(serverId: id)
        self.content = row["content"] as? String ?? ""
        self.type = row["type"] as? Int ?? NoteType.blinko
        self.isTop = row["isTop"] as? Bool ?? false
        self.isArchived = row["isArchived"] as? Bool ?? false
        self.isImportant = row["isImportant"] as? Bool ?? false
        self.isUrgent = row["isUrgent"] as? Bool ?? false
        self.dueDate = ServerDate.parse(row["dueDate"])
        self.completedAt = ServerDate.parse(row["completedAt"])
        self.createdAt = ServerDate.parse(row["createdAt"]) ?? .now
        self.updatedAt = ServerDate.parse(row["updatedAt"]) ?? self.createdAt
        self.source = row["source"] as? String ?? MemoSource.manual
        let rawAttachments = row["attachments"] as? [[String: Any]] ?? []
        self.attachments = rawAttachments.compactMap { item in
            guard let path = item["path"] as? String else { return nil }
            return MemoAttachment(
                name: item["name"] as? String ?? (path as NSString).lastPathComponent,
                path: path,
                type: item["type"] as? String ?? ""
            )
        }
    }
}

public enum ServerDate {
    private static let fractional: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()
    private static let plain = ISO8601DateFormatter()

    public static func parse(_ value: Any?) -> Date? {
        if let date = value as? Date { return date }
        guard let string = value as? String, !string.isEmpty else { return nil }
        return fractional.date(from: string) ?? plain.date(from: string)
    }

    public static func string(_ date: Date) -> String {
        fractional.string(from: date)
    }
}

/// Fast, stable on-disk coding for memos and the outbox.
public enum MemoCoding {
    public static func encoder() -> JSONEncoder {
        let e = JSONEncoder()
        e.dateEncodingStrategy = .secondsSince1970
        return e
    }

    public static func decoder() -> JSONDecoder {
        let d = JSONDecoder()
        d.dateDecodingStrategy = .secondsSince1970
        return d
    }

    public static func read<T: Decodable>(_ type: T.Type, from url: URL) -> T? {
        guard let data = try? Data(contentsOf: url, options: .mappedIfSafe) else { return nil }
        return try? decoder().decode(type, from: data)
    }

    public static func write<T: Encodable>(_ value: T, to url: URL) throws {
        let data = try encoder().encode(value)
        try data.write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    }
}
