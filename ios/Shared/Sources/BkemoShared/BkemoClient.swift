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