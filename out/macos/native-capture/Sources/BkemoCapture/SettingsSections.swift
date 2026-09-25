import AppKit
import SwiftUI

/// System Settings–style page for one settings section: a header, then
/// read-only values rendered inline (auto-loaded, never collapsed), editable
/// preferences, and actions as single rows with a trailing button.
struct SettingsSectionPage: View {
    let section: SettingsSectionInfo
    let snapshot: SettingsSnapshot
    @ObservedObject var model: SettingsModel

    private var config: [NativeSetting] { snapshot.config.filter(visible) }
    private var operations: [SettingsOperation] { snapshot.operations.filter(visible) }
    private var readouts: [SettingsOperation] { operations.filter(\.isReadout) }
    private var actions: [SettingsOperation] { operations.filter { !$0.isReadout } }

    var body: some View {
        Form {
            Section {
                SectionHeader(section: section)
            }
            if model.search.isEmpty == false && config.isEmpty && operations.isEmpty {
                Section { Text("No settings match “\(model.search)”.").foregroundStyle(.secondary) }
            }
            ForEach(readouts) { operation in
                Section(operation.title) { ReadoutRows(operation: operation, model: model) }
            }
            if !config.isEmpty {
                Section("Settings") {
                    ForEach(config) { setting in
                        SettingEditor(setting: setting, model: model).id("\(snapshot.account.id):\(setting.key)")
                    }
                }
            }
            if !actions.isEmpty {
                Section("Actions") {
                    ForEach(actions) { operation in
                        ActionRow(operation: operation, model: model).id("\(snapshot.account.id):\(operation.id)")
                    }
                }
            }
        }
        .formStyle(.grouped)
    }

    private func visible(_ item: some SettingsItem) -> Bool {
        model.search.isEmpty ? item.section == section.id : item.title.localizedCaseInsensitiveContains(model.search)
    }
}

protocol SettingsItem { var section: String { get }; var title: String { get } }
extension NativeSetting: SettingsItem {}
extension SettingsOperation: SettingsItem {
    private var requiredFields: [String] { input.effectiveSchema["required"].array.map(\.string) }
    /// Queries that need nothing from the user just show their result.
    var isReadout: Bool { !mutation && requiredFields.isEmpty }
    /// Object inputs with only optional fields still expect `{}`, not nothing.
    var readoutInput: SettingsValue { input.effectiveSchema.schemaType == "object" ? .object([:]) : .null }
    /// Whether running it asks for values first (opens a sheet).
    var needsInput: Bool {
        let schema = input.effectiveSchema
        return !schema["properties"].object.isEmpty || !schema["oneOf"].array.isEmpty || !schema["anyOf"].array.isEmpty
    }
}

struct SettingsSectionInfo: Identifiable {
    let id: String
    let title: String
    let icon: String
    let tint: Color
    let summary: String
}

private struct SectionHeader: View {
    let section: SettingsSectionInfo
    var body: some View {
        HStack(spacing: 14) {
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .fill(section.tint.gradient)
                .frame(width: 44, height: 44)
                .overlay(Image(systemName: section.icon).font(.system(size: 21, weight: .medium)).foregroundStyle(.white))
            VStack(alignment: .leading, spacing: 3) {
                Text(section.title).font(.title2.weight(.semibold))
                Text(section.summary).font(.callout).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 0)
        }
        .padding(.vertical, 6)
    }
}

// MARK: Read-only values

private struct ReadoutRows: View {
    let operation: SettingsOperation
    @ObservedObject var model: SettingsModel

    var body: some View {
        if let value = model.results[operation.id] {
            ValueRows(value: value)
        } else if let error = model.loadErrors[operation.id] {
            HStack {
                Label(error, systemImage: "exclamationmark.triangle").foregroundStyle(.secondary)
                Spacer()
                Button("Retry") { Task { await model.query(operation.id, input: operation.readoutInput) } }
            }
        } else {
            HStack(spacing: 8) { ProgressView().controlSize(.small); Text("Loading…").foregroundStyle(.secondary) }
                // Each readout loads itself when shown, so switching sections
                // always starts fresh loads and a page's values load in parallel.
                .task(id: operation.id) { await model.query(operation.id, input: operation.readoutInput) }
        }
    }
}

/// Flat label/value rows. Nested objects collapse to a one-line summary and
/// lists become one row per item — never a disclosure triangle.
struct ValueRows: View {
    let value: SettingsValue
    var body: some View {
        switch value {
        case .object(let fields):
            let keys = fields.keys.sorted().filter { $0 != "id" && fields[$0].map(hasContent) == true && !isSecretField($0) }
            if keys.isEmpty { Text("Nothing to show").foregroundStyle(.secondary) }
            ForEach(keys, id: \.self) { key in
                let field = fields[key]!
                if case .array(let items) = field, items.contains(where: { !$0.object.isEmpty }) {
                    LabeledContent(readoutTitle(key)) { Text("\(items.count) item\(items.count == 1 ? "" : "s")").foregroundStyle(.secondary) }
                    ForEach(items.indices, id: \.self) { index in ItemRow(item: items[index], index: index) }
                } else {
                    LabeledContent(readoutTitle(key)) { Text(summary(field)).textSelection(.enabled).lineLimit(3).multilineTextAlignment(.trailing) }
                }
            }
        case .array(let items):
            if items.isEmpty { Text("None yet").foregroundStyle(.secondary) }
            ForEach(items.indices, id: \.self) { index in ItemRow(item: items[index], index: index) }
        default:
            Text(summary(value)).textSelection(.enabled)
        }
    }
}

private struct ItemRow: View {
    let item: SettingsValue
    let index: Int
    var body: some View {
        if item.object.isEmpty {
            Text(summary(item)).textSelection(.enabled)
        } else {
            let name = recordName(item)
            let details = item.object.keys.sorted()
                .filter { !["id", "title", "name", "nickname", "filename", "task"].contains($0) && !isSecretField($0) }
                .compactMap { key -> String? in
                    let field = item[key]
                    guard !field.isNull, field.object.isEmpty, field.array.isEmpty, !field.string.isEmpty else { return nil }
                    return "\(readoutTitle(key)): \(displayString(field))"
                }
                .prefix(3)
            VStack(alignment: .leading, spacing: 2) {
                Text(name.isEmpty ? "Item \(index + 1)" : name)
                if !details.isEmpty {
                    Text(details.joined(separator: " · ")).font(.caption).foregroundStyle(.secondary).lineLimit(2)
                }
            }
        }
    }
}

/// Labels for values being *shown*: the form's input labels ("Select item",
/// "Enable Quick Note shortcut") describe controls, not data.
func readoutTitle(_ key: String) -> String {
    let words = key.replacingOccurrences(of: "([a-z])([A-Z])", with: "$1 $2", options: .regularExpression)
    return words.prefix(1).uppercased() + words.dropFirst().lowercased()
}

/// Worth a row: not null, not an empty string/list/object.
func hasContent(_ value: SettingsValue) -> Bool {
    switch value {
    case .null: return false
    case .string(let text): return !text.isEmpty
    case .array(let items): return !items.isEmpty
    case .object(let fields): return !fields.isEmpty
    default: return true
    }
}

/// One line for any value: scalars as text, objects as "Key: value · …".
func summary(_ value: SettingsValue) -> String {
    switch value {
    case .object(let fields):
        return fields.keys.sorted()
            .filter { fields[$0].map(hasContent) == true && !isSecretField($0) }
            .map { "\(readoutTitle($0)): \(summary(fields[$0]!))" }
            .joined(separator: " · ")
    case .array(let items):
        return items.isEmpty ? "None" : items.map(summary).joined(separator: ", ")
    case .null:
        return "—"
    default:
        return displayString(value)
    }
}

private let isoParser: ISO8601DateFormatter = {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return formatter
}()

/// Scalars for display: ISO timestamps become local dates.
func displayString(_ value: SettingsValue) -> String {
    let raw = value.string
    if raw.count >= 20, raw.contains("T"), let date = isoParser.date(from: raw) ?? ISO8601DateFormatter().date(from: raw) {
        return date.formatted(date: .abbreviated, time: .shortened)
    }
    return raw
}

// MARK: Actions

private struct ActionRow: View {
    let operation: SettingsOperation
    @ObservedObject var model: SettingsModel
    @State private var confirm = false
    @State private var showSheet = false
    @State private var status: String?
    @State private var result: SettingsValue = .null

    var body: some View {
        HStack(alignment: .center, spacing: 12) {
            VStack(alignment: .leading, spacing: 2) {
                Text(operation.title)
                if let status {
                    Text(status).font(.caption).foregroundStyle(.secondary).lineLimit(2).textSelection(.enabled)
                }
            }
            Spacer(minLength: 12)
            if !result["downloadUrl"].string.isEmpty {
                Button("Save File…") { Task { do { try await model.download(result) } catch { status = error.localizedDescription } } }
            }
            Button(buttonTitle, role: operation.destructive == true ? .destructive : nil) {
                if operation.needsInput { showSheet = true }
                else if operation.destructive == true { confirm = true }
                else { run(input: .null) }
            }
            .disabled(!model.online || model.busy)
        }
        .confirmationDialog(operation.title + "?", isPresented: $confirm, titleVisibility: .visible) {
            Button(operation.title, role: .destructive) { run(input: .null, confirmed: true) }
            Button("Cancel", role: .cancel) {}
        } message: { Text("This changes or removes stored data or access.") }
        .sheet(isPresented: $showSheet) {
            ActionSheet(operation: operation, model: model) { outcome, value in
                status = outcome
                result = value
            }
        }
    }

    private var buttonTitle: String {
        if operation.needsInput { return operation.mutation ? "Edit…" : "Open…" }
        if operation.destructive == true { return "Remove…" }
        return operation.mutation ? "Run" : "Show"
    }

    private func run(input: SettingsValue, confirmed: Bool = false) {
        Task {
            do {
                result = try await model.perform(operation.id, input: input, confirmed: confirmed)
                status = summary(result).isEmpty || result == .object(["success": .bool(true)]) ? "Done" : summary(result)
            } catch { status = error.localizedDescription }
        }
    }
}

/// Values for an action, in a sheet rather than an inline disclosure.
private struct ActionSheet: View {
    let operation: SettingsOperation
    @ObservedObject var model: SettingsModel
    let onFinish: (String, SettingsValue) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var input: SettingsValue
    @State private var selectedItem = ""
    @State private var message: String?
    @State private var confirm = false
    @State private var result: SettingsValue = .null

    init(operation: SettingsOperation, model: SettingsModel, onFinish: @escaping (String, SettingsValue) -> Void) {
        self.operation = operation
        self.model = model
        self.onFinish = onFinish
        _input = State(initialValue: operation.input.initialValue)
    }

    /// Existing records the form can be pre-filled from (edit flows).
    private var records: [SettingsValue] {
        let id = operation.id
        let namespace = id.components(separatedBy: ".")[0]
        let source = id.contains("Provider") ? "ai.getAllProviders" : id.contains("Model") ? "ai.getAllModels"
            : namespace == "users" ? "users.list" : namespace == "accessTokens" ? "accessTokens.list"
            : namespace == "mcpServers" ? "mcpServers.list" : namespace == "oauth" ? "oauth.connections" : "task.list"
        return model.results[source]?.array ?? []
    }

    var body: some View {
        VStack(spacing: 0) {
            Form {
                Section {
                    Text(operation.title).font(.title3.weight(.semibold))
                }
                if !records.isEmpty && !operation.input["properties"]["id"].isNull {
                    Section {
                        Picker("Start from", selection: $selectedItem) {
                            Text("New").tag("")
                            ForEach(records.indices, id: \.self) { index in Text(recordName(records[index])).tag(String(index)) }
                        }
                        .onChange(of: selectedItem) { _, new in
                            guard let index = Int(new), records.indices.contains(index) else { return }
                            let allowed = Set(operation.input["properties"].object.keys)
                            input = .object(records[index].object.filter { allowed.contains($0.key) && !isSecretField($0.key) })
                        }
                    }
                }
                Section {
                    SettingsField(title: operation.title, key: "input", schema: operation.input, value: $input, onUpload: {
                        Task { do { input["filePath"] = .string(try await model.chooseUpload()) } catch { message = error.localizedDescription } }
                    })
                }
                if !result.isNull {
                    Section("Result") { ValueRows(value: result) }
                }
                if let message {
                    Section { Text(message).foregroundStyle(.secondary).textSelection(.enabled) }
                }
            }
            .formStyle(.grouped)
            Divider()
            HStack {
                if !result["downloadUrl"].string.isEmpty {
                    Button("Save File…") { Task { do { try await model.download(result) } catch { message = error.localizedDescription } } }
                }
                Spacer()
                Button(result.isNull ? "Cancel" : "Done") { dismiss() }.keyboardShortcut(.cancelAction)
                Button(operation.mutation ? "Apply" : "Look Up", role: operation.destructive == true ? .destructive : nil) {
                    if operation.destructive == true { confirm = true } else { run() }
                }
                .keyboardShortcut(.defaultAction)
                .disabled(!model.online || model.busy)
            }
            .padding(14)
        }
        .frame(minWidth: 480, idealWidth: 540, minHeight: 360, idealHeight: 480)
        .confirmationDialog(operation.title + "?", isPresented: $confirm, titleVisibility: .visible) {
            Button(operation.title, role: .destructive) { run(confirmed: true) }
            Button("Cancel", role: .cancel) {}
        } message: { Text("This changes or removes stored data or access.") }
    }

    private func run(confirmed: Bool = false) {
        Task {
            do {
                let value = try await model.perform(operation.id, input: input, confirmed: confirmed)
                result = value
                message = nil
                onFinish("Done", value)
                // Mutations are finished once applied; lookups stay open to read.
                if operation.mutation && value["downloadUrl"].string.isEmpty { dismiss() }
            } catch { message = error.localizedDescription }
        }
    }
}
