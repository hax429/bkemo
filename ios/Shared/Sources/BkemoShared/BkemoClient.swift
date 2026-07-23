import Foundation

public enum APIError: Error, LocalizedError {
    case http(Int, String?)
    case decode(String)
    case transport(Error)
    case unauthorized
    case empty

    public var errorDescription: String? {
        switch self {
        case .http(let code, let msg): return "HTTP \(code): \(msg ?? "")"
        case .decode(let m): return "Decode error: \(m)"
        case .transport(let e): return e.localizedDescription
        case .empty: return "Empty response"
        case .unauthorized: return "Unauthorized"
        }
    }
}

public struct BkemoClient {
    public let endpoint: String
    public var token: String?

    public init(endpoint: String = "https://bk.hax429.me", token: String? = nil) {
        self.endpoint = endpoint
        self.token = token
    }

    private func call(_ path: String, method: String = "POST", body: [String: Any]? = nil) async throws -> Data {
        guard let url = URL(string: endpoint + path) else { throw APIError.decode("bad url") }
        var req = URLRequest(url: url)
        req.httpMethod = method
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if let token { req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        if let body {
            req.httpBody = try JSONSerialization.data(withJSONObject: body, options: [])
        }
        let (data, response): (Data, URLResponse)
        do {
            (data, response) = try await URLSession.shared.data(for: req)
        } catch { throw APIError.transport(error) }
        guard let http = response as? HTTPURLResponse else { throw APIError.decode("no http") }
        if http.statusCode == 401 { throw APIError.unauthorized }
        guard (200..<300).contains(http.statusCode) else {
            let msg = String(data: data, encoding: .utf8)
            throw APIError.http(http.statusCode, msg)
        }
        return data
    }

    // MARK: Auth

    public struct LoginResponse: Decodable {
        public let token: String?
        public let requiresTwoFactor: Bool?
        public let userId: Int?
        public let error: String?
    }

    public func login(username: String, password: String) async throws -> LoginResponse {
        let data = try await call("/api/auth/login", body: ["username": username, "password": password])
        return try JSONDecoder().decode(LoginResponse.self, from: data)
    }

    public func verify2fa(userId: Int, code: String) async throws -> LoginResponse {
        let data = try await call("/api/auth/verify-2fa", body: ["userId": userId, "twoFactorCode": code])
        return try JSONDecoder().decode(LoginResponse.self, from: data)
    }

    public func profile() async throws -> Bool {
        do {
            _ = try await call("/api/auth/profile")
            return true
        } catch APIError.unauthorized { return false } catch { throw error }
    }

    // MARK: Account preferences

    public struct AppearancePreferences: Codable, Equatable {
        public var theme: String
        public var accent: String
        public var density: String
        public var bgGradient: String?

        public init(
            theme: String = "dark",
            accent: String = "#e2a96b",
            density: String = "regular",
            bgGradient: String? = "dusk"
        ) {
            self.theme = theme
            self.accent = accent
            self.density = density
            self.bgGradient = bgGradient
        }
    }

    public func appearancePreferences() async throws -> AppearancePreferences? {
        let data = try await call("/api/v1/config/list", method: "GET")
        guard let root = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let value = root["bkemoPrefs"] else {
            return nil
        }
        let preferencesData = try JSONSerialization.data(withJSONObject: value)
        return try JSONDecoder().decode(AppearancePreferences.self, from: preferencesData)
    }

    public func updateAppearancePreferences(_ preferences: AppearancePreferences) async throws {
        let valueData = try JSONEncoder().encode(preferences)
        guard let value = try JSONSerialization.jsonObject(with: valueData) as? [String: Any] else {
            throw APIError.decode("invalid appearance preferences")
        }
        _ = try await call("/api/v1/config/update", body: [
            "key": "bkemoPrefs",
            "value": value,
        ])
    }

    // MARK: Notes

    public struct UpsertBody {
        public var content: String
        public var type: Int
        public var isImportant: Bool
        public var isUrgent: Bool
        public var dueDate: Date?
        public var id: Int?
        public var createdAt: Date?
        public init(content: String, type: Int, isImportant: Bool = false, isUrgent: Bool = false,
                    dueDate: Date? = nil, id: Int? = nil, createdAt: Date? = nil) {
            self.content = content; self.type = type; self.isImportant = isImportant
            self.isUrgent = isUrgent; self.dueDate = dueDate; self.id = id; self.createdAt = createdAt
        }
    }

    public func noteUpsert(_ body: UpsertBody) async throws -> Int {
        var payload: [String: Any] = [
            "content": body.content,
            "type": body.type,
            "isImportant": body.isImportant,
            "isUrgent": body.isUrgent,
        ]
        if let id = body.id { payload["id"] = id }
        let iso = ISO8601DateFormatter()
        if let d = body.dueDate { payload["dueDate"] = iso.string(from: d) }
        if let c = body.createdAt { payload["createdAt"] = iso.string(from: c) }
        let data = try await call("/api/v1/note/upsert", body: payload)
        guard let obj = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let id = obj["id"] as? Int else { throw APIError.decode("no id in upsert response") }
        return id
    }

    public func noteList(page: Int = 1, size: Int = 50) async throws -> [[String: Any]] {
        let data = try await call("/api/v1/note/list", body: ["page": page, "size": size, "orderBy": "desc"])
        let obj = try JSONSerialization.jsonObject(with: data)
        if let arr = obj as? [[String: Any]] { return arr }
        if let single = obj as? [String: Any], let arr = single["data"] as? [[String: Any]] { return arr }
        return []
    }

    public struct NoteChanges {
        public let cursor: Int
        public let changed: [[String: Any]]
        public let removedIds: [Int]

        public init(cursor: Int, changed: [[String: Any]], removedIds: [Int]) {
            self.cursor = cursor
            self.changed = changed
            self.removedIds = removedIds
        }
    }

    public struct NoteEvent: Equatable, Sendable {
        public let data: String

        public init(data: String) {
            self.data = data
        }
    }

    public func noteChanges(cursor: Int? = nil, bootstrap: Bool = false) async throws -> NoteChanges {
        var body: [String: Any] = [:]
        if let cursor { body["cursor"] = cursor }
        if bootstrap { body["bootstrap"] = true }
        let data = try await call("/api/v1/note/changes", body: body)
        guard let object = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let cursor = object["cursor"] as? Int else {
            throw APIError.decode("invalid note changes response")
        }
        return NoteChanges(
            cursor: cursor,
            changed: object["changed"] as? [[String: Any]] ?? [],
            removedIds: object["removedIds"] as? [Int] ?? []
        )
    }

    public func noteEvents() -> AsyncThrowingStream<NoteEvent, Error> {
        AsyncThrowingStream { continuation in
            let task = Task {
                do {
                    guard let url = URL(string: endpoint + "/api/v1/note/events") else {
                        throw APIError.decode("bad url")
                    }
                    var request = URLRequest(url: url)
                    request.setValue("text/event-stream", forHTTPHeaderField: "Accept")
                    request.setValue("no-cache", forHTTPHeaderField: "Cache-Control")
                    if let token {
                        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
                    }
                    let (bytes, response) = try await URLSession.shared.bytes(for: request)
                    guard let http = response as? HTTPURLResponse else {
                        throw APIError.decode("no http")
                    }
                    if http.statusCode == 401 { throw APIError.unauthorized }
                    guard (200..<300).contains(http.statusCode) else {
                        throw APIError.http(http.statusCode, nil)
                    }

                    var dataLines: [String] = []
                    for try await line in bytes.lines {
                        try Task.checkCancellation()
                        if line.isEmpty {
                            if !dataLines.isEmpty {
                                continuation.yield(NoteEvent(data: dataLines.joined(separator: "\n")))
                                dataLines.removeAll(keepingCapacity: true)
                            }
                        } else if line.hasPrefix("data:") {
                            dataLines.append(String(line.dropFirst(5)).trimmingCharacters(in: .whitespaces))
                        }
                    }
                } catch is CancellationError {
                    continuation.finish()
                } catch {
                    continuation.finish(throwing: error)
                }
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }

    public func noteToggleDone(id: Int, done: Bool) async throws {
        _ = try await call("/api/v1/note/toggle-done", body: ["id": id, "done": done])
    }

    public func noteBatchTrash(ids: [Int]) async throws {
        _ = try await call("/api/v1/note/batch-trash", body: ["ids": ids])
    }

    public func noteBatchDelete(ids: [Int]) async throws {
        _ = try await call("/api/v1/note/batch-delete", body: ["ids": ids])
    }
}