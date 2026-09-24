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

    /// Worth retrying later without user action (offline, timeouts, 5xx, rate limits).
    public var isTransient: Bool {
        switch self {
        case .transport: return true
        case .http(let code, _): return code >= 500 || code == 408 || code == 429
        default: return false
        }
    }
}

public struct BkemoClient: Sendable {
    public let endpoint: String
    public var token: String?

    private static let session: URLSession = {
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 20
        config.waitsForConnectivity = false
        config.httpMaximumConnectionsPerHost = 4
        return URLSession(configuration: config)
    }()

    public init(endpoint: String = BkemoServer.endpoint, token: String? = nil) {
        self.endpoint = endpoint
        self.token = token
    }

    private func request(_ path: String, method: String) throws -> URLRequest {
        guard let url = URL(string: endpoint + path) else { throw APIError.decode("bad url") }
        var req = URLRequest(url: url)
        req.httpMethod = method
        req.setValue("ios", forHTTPHeaderField: "X-Bkemo-Platform")
        if let token { req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        return req
    }

    private func call(_ path: String, method: String = "POST", body: [String: Any]? = nil) async throws -> Data {
        var req = try request(path, method: method)
        if let body {
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            req.httpBody = try JSONSerialization.data(withJSONObject: body, options: [])
        }
        let (data, response): (Data, URLResponse)
        do {
            (data, response) = try await Self.session.data(for: req)
        } catch { throw APIError.transport(error) }
        guard let http = response as? HTTPURLResponse else { throw APIError.decode("no http") }
        if http.statusCode == 401 { throw APIError.unauthorized }
        guard (200..<300).contains(http.statusCode) else {
            throw APIError.http(http.statusCode, String(data: data, encoding: .utf8))
        }
        return data
    }

    private func json(_ data: Data) throws -> Any {
        do { return try JSONSerialization.jsonObject(with: data) }
        catch { throw APIError.decode(error.localizedDescription) }
    }

    // MARK: Auth

    public struct ProfileUser: Decodable, Sendable {
        public let id: Int
        public let name: String?
        public let role: String?
        public let nickname: String?
        public let image: String?
    }

    public struct ProfileResponse: Decodable, Sendable {
        public let user: ProfileUser
    }

    /// Validates `token` and fetches the account profile. iOS pairs with an
    /// access token from Settings → Security & API; there is no password login.
    public func fetchProfile() async throws -> ProfileResponse {
        let data = try await call("/api/auth/profile", method: "GET")
        do { return try JSONDecoder().decode(ProfileResponse.self, from: data) }
        catch { throw APIError.decode(error.localizedDescription) }
    }

    // MARK: Account preferences

    public struct AppearancePreferences: Codable, Equatable, Sendable {
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

        public static func cached() -> AppearancePreferences {
            guard let data = AppGroup.defaults.data(forKey: AppGroup.appearanceKey),
                  let value = try? JSONDecoder().decode(AppearancePreferences.self, from: data) else {
                return .init()
            }
            return value
        }
    }

    public func appearancePreferences() async throws -> AppearancePreferences? {
        let data = try await call("/api/v1/config/list", method: "GET")
        guard let root = try json(data) as? [String: Any], let value = root["bkemoPrefs"] else {
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
        _ = try await call("/api/v1/config/update", body: ["key": "bkemoPrefs", "value": value])
    }

    // MARK: Notes

    /// Creates (no `serverId`) or fully updates a note from local state.
    /// Returns the server id.
    public func upsert(_ memo: Memo) async throws -> Int {
        var payload: [String: Any] = [
            "content": memo.content,
            "type": memo.type,
            "isTop": memo.isTop,
            "isArchived": memo.isArchived,
            "isImportant": memo.isImportant,
            "isUrgent": memo.isUrgent,
        ]
        if let id = memo.serverId {
            payload["id"] = id
            payload["completedAt"] = memo.completedAt.map(ServerDate.string) ?? NSNull()
        } else {
            payload["createdAt"] = ServerDate.string(memo.createdAt)
            if let done = memo.completedAt { payload["completedAt"] = ServerDate.string(done) }
        }
        if let due = memo.dueDate { payload["dueDate"] = ServerDate.string(due) }
        let data = try await call("/api/v1/note/upsert", body: payload)
        guard let obj = try json(data) as? [String: Any], let id = obj["id"] as? Int else {
            throw APIError.decode("no id in upsert response")
        }
        return id
    }

    public func noteList(page: Int, size: Int, archived: Bool) async throws -> [[String: Any]] {
        let data = try await call("/api/v1/note/list", body: [
            "page": page, "size": size, "orderBy": "desc", "isArchived": archived,
        ])
        let obj = try json(data)
        if let arr = obj as? [[String: Any]] { return arr }
        if let single = obj as? [String: Any], let arr = single["data"] as? [[String: Any]] { return arr }
        return []
    }

    public struct NoteChanges: Sendable {
        public let cursor: Int
        public let hasMore: Bool
        public let changed: [Memo]
        public let removedIds: [Int]
    }

    public func noteChanges(cursor: Int?, bootstrap: Bool = false, limit: Int = 500) async throws -> NoteChanges {
        var body: [String: Any] = ["limit": limit]
        if let cursor { body["cursor"] = cursor }
        if bootstrap { body["bootstrap"] = true }
        let data = try await call("/api/v1/note/changes", body: body)
        guard let object = try json(data) as? [String: Any], let cursor = object["cursor"] as? Int else {
            throw APIError.decode("invalid note changes response")
        }
        let rows = object["changed"] as? [[String: Any]] ?? []
        return NoteChanges(
            cursor: cursor,
            hasMore: object["hasMore"] as? Bool ?? false,
            changed: rows.compactMap { Memo(remote: $0) },
            removedIds: object["removedIds"] as? [Int] ?? []
        )
    }

    public func noteBatchTrash(ids: [Int]) async throws {
        _ = try await call("/api/v1/note/batch-trash", body: ["ids": ids])
    }

    // MARK: Events

    public struct NoteEvent: Equatable, Sendable {
        public let data: String
        public var kind: String? {
            guard let payload = data.data(using: .utf8),
                  let object = try? JSONSerialization.jsonObject(with: payload) as? [String: Any] else { return nil }
            return object["kind"] as? String
        }

        public init(data: String) { self.data = data }
    }

    public func noteEvents() -> AsyncThrowingStream<NoteEvent, Error> {
        let token = token
        let endpoint = endpoint
        return AsyncThrowingStream { continuation in
            let task = Task {
                do {
                    guard let url = URL(string: endpoint + "/api/v1/note/events") else {
                        throw APIError.decode("bad url")
                    }
                    var request = URLRequest(url: url)
                    request.timeoutInterval = 600
                    request.setValue("text/event-stream", forHTTPHeaderField: "Accept")
                    request.setValue("no-cache", forHTTPHeaderField: "Cache-Control")
                    request.setValue("ios", forHTTPHeaderField: "X-Bkemo-Platform")
                    if let token { request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
                    let (bytes, response) = try await URLSession.shared.bytes(for: request)
                    guard let http = response as? HTTPURLResponse else { throw APIError.decode("no http") }
                    if http.statusCode == 401 { throw APIError.unauthorized }
                    guard (200..<300).contains(http.statusCode) else { throw APIError.http(http.statusCode, nil) }

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
                    continuation.finish()
                } catch is CancellationError {
                    continuation.finish()
                } catch {
                    continuation.finish(throwing: error)
                }
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }

    // MARK: Files

    /// Downloads an attachment (`/api/file/...`) with the account token.
    public func fileData(path: String) async throws -> Data {
        let absolute = path.hasPrefix("http") ? path : endpoint + (path.hasPrefix("/") ? path : "/" + path)
        guard let url = URL(string: absolute) else { throw APIError.decode("bad url") }
        var req = URLRequest(url: url)
        req.setValue("ios", forHTTPHeaderField: "X-Bkemo-Platform")
        if let token { req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        let (data, response): (Data, URLResponse)
        do { (data, response) = try await Self.session.data(for: req) }
        catch { throw APIError.transport(error) }
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            throw APIError.http((response as? HTTPURLResponse)?.statusCode ?? 0, nil)
        }
        return data
    }

    // MARK: Tags

    public struct TagRow: Equatable, Sendable {
        public let id: Int
        public let name: String
        public let parent: Int
        public let sortOrder: Int

        public init(id: Int, name: String, parent: Int, sortOrder: Int) {
            self.id = id
            self.name = name
            self.parent = parent
            self.sortOrder = sortOrder
        }
    }

    public func tagList() async throws -> [TagRow] {
        let data = try await call("/api/v1/tags/list", method: "GET")
        let obj = try json(data)
        let rows: [[String: Any]]
        if let arr = obj as? [[String: Any]] {
            rows = arr
        } else if let single = obj as? [String: Any], let arr = single["data"] as? [[String: Any]] {
            rows = arr
        } else {
            return []
        }
        return rows.compactMap { row in
            guard let id = row["id"] as? Int, let name = row["name"] as? String else { return nil }
            return TagRow(id: id, name: name, parent: row["parent"] as? Int ?? 0, sortOrder: row["sortOrder"] as? Int ?? 0)
        }
    }
}
