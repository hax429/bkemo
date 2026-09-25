import Foundation

indirect enum SettingsValue: Codable, Hashable {
    case null, bool(Bool), number(Double), string(String), array([SettingsValue]), object([String: SettingsValue])
    init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if c.decodeNil() { self = .null }
        else if let v = try? c.decode(Bool.self) { self = .bool(v) }
        else if let v = try? c.decode(Double.self) { self = .number(v) }
        else if let v = try? c.decode(String.self) { self = .string(v) }
        else if let v = try? c.decode([SettingsValue].self) { self = .array(v) }
        else { self = .object(try c.decode([String: SettingsValue].self)) }
    }
    func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        switch self {
        case .null: try c.encodeNil()
        case .bool(let v): try c.encode(v)
        case .number(let v): try c.encode(v)
        case .string(let v): try c.encode(v)
        case .array(let v): try c.encode(v)
        case .object(let v): try c.encode(v)
        }
    }
    subscript(key: String) -> SettingsValue {
        get { if case .object(let v) = self { return v[key] ?? .null }; return .null }
        set { var v = object; v[key] = newValue; self = .object(v) }
    }
    var object: [String: SettingsValue] { if case .object(let v) = self { return v }; return [:] }
    var array: [SettingsValue] { if case .array(let v) = self { return v }; return [] }
    var string: String {
        switch self {
        case .string(let v): return v
        case .number(let v): return v.formatted(.number.grouping(.never))
        case .bool(let v): return v ? "Yes" : "No"
        default: return ""
        }
    }
    var bool: Bool { if case .bool(let v) = self { return v }; return false }
    var isNull: Bool { self == .null }
    var schemaType: String { self["type"].string }
    var effectiveSchema: SettingsValue {
        let choices = self["anyOf"].array + self["oneOf"].array
        return choices.first(where: { $0.schemaType != "null" }) ?? self
    }
    var initialValue: SettingsValue {
        if !self["default"].isNull { return self["default"] }
        if !self["const"].isNull { return self["const"] }
        if let first = self["enum"].array.first { return first }
        let schema = effectiveSchema
        switch schema.schemaType {
        case "object":
            let required = Set(schema["required"].array.map(\.string))
            return .object(schema["properties"].object.filter { required.contains($0.key) || !$0.value["default"].isNull }.mapValues(\.initialValue))
        case "array": return .array([])
        case "boolean": return .bool(false)
        case "integer", "number": return schema["minimum"].isNull ? .number(0) : schema["minimum"]
        case "null": return .null
        default: return .string("")
        }
    }
}

struct NativeSetting: Decodable, Identifiable {
    var id: String { key }
    let key: String
    let section: String
    let title: String
    let secret: Bool
    let writable: Bool
    let schema: SettingsValue
    let value: SettingsValue
    let configured: Bool
}
struct SettingsOperation: Decodable, Identifiable {
    let id: String
    let section: String
    let title: String
    let mutation: Bool
    let destructive: Bool?
    let input: SettingsValue
}
struct SettingsSnapshot: Decodable {
    struct Account: Decodable { let id: Int; let name: String }
    /// Absent on older servers; treat as unrestricted.
    struct Access: Decodable { let scoped: Bool; let canManageSettings: Bool }
    let version: Int
    let account: Account
    var access: Access? = nil
    /// The token (not the account) is what hides most settings.
    var limitedByToken: Bool { access.map { $0.scoped && !$0.canManageSettings } ?? false }
    let config: [NativeSetting]
    let operations: [SettingsOperation]
}
func settingTitle(_ key: String) -> String {
    let labels = ["id": "Select item", "providerId": "Provider", "clientId": "Application", "filePath": "Import file", "apiKey": "API key", "baseURL": "Base URL", "isEnabled": "Enabled", "originalPassword": "Current password", "password": "New password", "quickNote": "Quick Note shortcut", "quickAI": "Quick AI shortcut", "systemTrayEnabled": "Show menu bar icon", "enabled": "Enable Quick Note shortcut", "aiEnabled": "Enable Quick AI shortcut", "autostart": "Open at login", "time": "Schedule (cron)"]
    if let label = labels[key] { return label }
    let words = key.replacingOccurrences(of: "([a-z])([A-Z])", with: "$1 $2", options: .regularExpression)
    return words.prefix(1).uppercased() + words.dropFirst()
}
func isSecretField(_ key: String) -> Bool {
    key.range(of: "password|secret|apiKey|accessKey|passphrase|token", options: [.regularExpression, .caseInsensitive]) != nil
}
