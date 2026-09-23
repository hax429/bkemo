import SwiftUI

/// Native recursive controls for the versioned settings contract. No HTML,
/// JavaScript, webview, or downloaded executable UI is involved.
struct SettingsField: View {
    let title: String
    let key: String
    let schema: SettingsValue
    @Binding var value: SettingsValue
    var secret = false
    var optional = false
    var configured = false
    var onUpload: (() -> Void)? = nil
    @State private var recordKey = ""

    private var shape: SettingsValue { schema.effectiveSchema }
    private var text: Binding<String> { Binding(get: { value.string }, set: { value = .string($0) }) }
    private var choices: [SettingsValue] { schema["oneOf"].array.isEmpty ? schema["anyOf"].array.filter { $0.schemaType != "null" } : schema["oneOf"].array }
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if optional {
                Toggle("Set \(title.lowercased())", isOn: Binding(get: { !value.isNull }, set: { value = $0 ? shape.initialValue : .null }))
            }
            if !optional || !value.isNull {
                control
            }
        }
    }
    @ViewBuilder private var control: some View {
        if choices.count > 1 {
            let selected = choices.firstIndex(where: { candidate in
                let props = candidate["properties"].object
                return props.contains { !$0.value["const"].isNull && value[$0.key] == $0.value["const"] }
            }) ?? 0
            Picker(title, selection: Binding(get: { selected }, set: { value = choices[$0].initialValue })) {
                ForEach(choices.indices, id: \.self) { index in
                    Text(choices[index]["properties"].object.values.first(where: { !$0["const"].isNull })?["const"].string ?? "Option \(index + 1)").tag(index)
                }
            }
            SettingsField(title: title, key: key, schema: choices[selected], value: $value)
        } else if !shape["enum"].array.isEmpty {
            Picker(title, selection: Binding(get: { value.isNull ? shape["enum"].array[0].string : value.string }, set: { new in value = shape["enum"].array.first(where: { $0.string == new }) ?? .string(new) })) {
                ForEach(shape["enum"].array.map(\.string), id: \.self) { item in Text(item).tag(item) }
            }
        } else if !shape["const"].isNull {
            LabeledContent(title, value: shape["const"].string)
        } else if secret || isSecretField(key) {
            SecureField(title, text: text, prompt: Text(configured ? "Configured — enter to replace" : "Not configured"))
        } else if key == "filePath", let onUpload {
            HStack { Text(title); Spacer(); Text(value.string.isEmpty ? "No file chosen" : "File uploaded").foregroundStyle(.secondary); Button("Choose file…", action: onUpload) }
        } else {
            switch shape.schemaType {
            case "boolean":
                Toggle(title, isOn: Binding(get: { value.bool }, set: { value = .bool($0) }))
            case "integer", "number":
                TextField(title, text: Binding(get: { value.string }, set: { new in
                    if let number = Double(new), number.isFinite { value = .number(number) }
                }))
            case "object":
                GroupBox(title) {
                    VStack(alignment: .leading, spacing: 12) {
                        let required = Set(shape["required"].array.map(\.string))
                        ForEach(shape["properties"].object.keys.sorted(), id: \.self) { name in
                            SettingsField(title: settingTitle(name), key: name, schema: shape["properties"][name],
                                          value: Binding(get: { value[name] }, set: { new in
                                              var object = value.object
                                              if new.isNull { object.removeValue(forKey: name) } else { object[name] = new }
                                              value = .object(object)
                                          }), optional: !required.contains(name), onUpload: name == "filePath" ? onUpload : nil)
                        }
                        if shape["properties"].object.isEmpty && shape["additionalProperties"] != .bool(false) { recordEditor }
                    }.padding(6)
                }
            case "array":
                GroupBox(title) {
                    VStack(alignment: .leading) {
                        ForEach(value.array.indices, id: \.self) { index in
                            HStack(alignment: .top) {
                                SettingsField(title: "Item \(index + 1)", key: key, schema: shape["items"], value: Binding(get: { value.array.indices.contains(index) ? value.array[index] : .null }, set: { new in var items = value.array; guard items.indices.contains(index) else { return }; items[index] = new; value = .array(items) }))
                                Button(role: .destructive) { var items = value.array; items.remove(at: index); value = .array(items) } label: { Image(systemName: "minus.circle") }.help("Remove item")
                            }
                        }
                        Button("Add item", systemImage: "plus") { value = .array(value.array + [shape["items"].initialValue]) }
                    }.padding(6)
                }
            case "null": EmptyView()
            default:
                if shape.object.isEmpty || (shape.schemaType.isEmpty && shape["properties"].isNull) {
                    GroupBox(title) { recordEditor }
                } else if key.localizedCaseInsensitiveContains("prompt") || key == "description" {
                    VStack(alignment: .leading) { Text(title); TextEditor(text: text).font(.body).frame(minHeight: 90).border(.quaternary) }
                } else {
                    TextField(title, text: text)
                }
            }
        }
    }
    private var recordEditor: some View {
        VStack(alignment: .leading) {
            ForEach(value.object.keys.sorted(), id: \.self) { name in
                HStack {
                    TextField(name, text: Binding(get: { value[name].string }, set: { value[name] = .string($0) }))
                    Button(role: .destructive) { var obj = value.object; obj.removeValue(forKey: name); value = .object(obj) } label: { Image(systemName: "minus.circle") }
                }
            }
            HStack {
                TextField("Name", text: $recordKey)
                Button("Add") { guard !recordKey.isEmpty else { return }; value[recordKey] = .string(""); recordKey = "" }.disabled(recordKey.isEmpty)
            }
        }.padding(6)
    }
}

struct SettingEditor: View {
    let setting: NativeSetting
    @ObservedObject var model: SettingsModel
    /// Reads/writes the shared pending-edit dictionary directly — there is
    /// no per-row local copy or per-row Save; the one page-level Save
    /// button (see NativeSettingsView) commits every edited row at once.
    private var value: Binding<SettingsValue> {
        Binding(
            get: { model.configEdits[setting.key] ?? (setting.value.isNull ? setting.schema.initialValue : setting.value) },
            set: { model.configEdits[setting.key] = $0 }
        )
    }
    var body: some View {
        SettingsField(title: setting.title, key: setting.key, schema: setting.schema, value: value, secret: setting.secret, configured: setting.configured)
            .disabled(!setting.writable || !model.online || model.busy || model.savingConfig)
    }
}

struct SettingsActionView: View {
    let operation: SettingsOperation
    @ObservedObject var model: SettingsModel
    @State private var input: SettingsValue
    @State private var result: SettingsValue = .null
    @State private var message: String?
    @State private var confirm = false
    @State private var selectedItem = ""
    init(operation: SettingsOperation, model: SettingsModel) {
        self.operation = operation; self.model = model
        _input = State(initialValue: operation.input.initialValue)
    }
    private var records: [SettingsValue] {
        let namespace = operation.id.components(separatedBy: ".")[0]
        let source = operation.id.contains("Provider") ? "ai.getAllProviders" : operation.id.contains("Model") ? "ai.getAllModels" : namespace == "users" ? "users.list" : namespace == "accessTokens" ? "accessTokens.list" : namespace == "mcpServers" ? "mcpServers.list" : namespace == "oauth" ? "oauth.connections" : "task.list"
        return model.results[source]?.array ?? []
    }
    var body: some View {
        DisclosureGroup(operation.title) {
            VStack(alignment: .leading, spacing: 14) {
                if !records.isEmpty && !operation.input["properties"]["id"].isNull {
                    Picker("Fill from existing item", selection: $selectedItem) {
                        Text("Choose…").tag("")
                        ForEach(records.indices, id: \.self) { index in Text(recordName(records[index])).tag(String(index)) }
                    }.onChange(of: selectedItem) { _, new in
                        guard let index = Int(new), records.indices.contains(index) else { return }
                        let record = records[index]
                        let allowed = Set(operation.input["properties"].object.keys)
                        input = .object(record.object.filter { allowed.contains($0.key) && !isSecretField($0.key) })
                    }
                }
                SettingsField(title: operation.title, key: "input", schema: operation.input, value: $input, onUpload: {
                    Task { do { input["filePath"] = .string(try await model.chooseUpload()) } catch { message = error.localizedDescription } }
                })
                if let message { Text(message).font(.callout).foregroundStyle(.secondary).textSelection(.enabled) }
                Button(operation.mutation ? operation.title : "Refresh") {
                    if operation.destructive == true { confirm = true } else { run() }
                }.disabled(!model.online || model.busy)
                if !result.isNull {
                    SettingsResultView(value: result)
                    if !result["downloadUrl"].string.isEmpty {
                        Button("Save file…") { Task { do { try await model.download(result) } catch { message = error.localizedDescription } } }
                    }
                }
            }.padding(.vertical, 12)
        }
        .confirmationDialog(operation.title + "?", isPresented: $confirm, titleVisibility: .visible) {
            Button("Confirm", role: .destructive) { run(confirmed: true) }
            Button("Cancel", role: .cancel) {}
        } message: { Text("This changes or removes stored data or access. Review the selected account and values before continuing.") }
    }
    private func run(confirmed: Bool = false) {
        Task {
            do {
                result = try await model.perform(operation.id, input: operation.input.object.isEmpty ? .null : input, confirmed: confirmed)
                message = "Completed"
                if operation.mutation { input = operation.input.initialValue; selectedItem = "" }
            } catch { message = error.localizedDescription }
        }
    }
}
func recordName(_ value: SettingsValue) -> String {
    for key in ["title", "name", "nickname", "filename", "task"] { if !value[key].string.isEmpty { return value[key].string } }
    return value["id"].string
}
struct SettingsResultView: View {
    let value: SettingsValue
    var body: some View {
        switch value {
        case .object(let fields):
            VStack(alignment: .leading, spacing: 8) {
                ForEach(fields.keys.sorted(), id: \.self) { key in
                    if case .object = fields[key]! {
                        DisclosureGroup(settingTitle(key)) { SettingsResultView(value: fields[key]!) }
                    } else if case .array = fields[key]! {
                        DisclosureGroup(settingTitle(key)) { SettingsResultView(value: fields[key]!) }
                    } else if !fields[key]!.isNull {
                        LabeledContent(settingTitle(key)) { Text(fields[key]!.string).textSelection(.enabled).lineLimit(6) }
                    }
                }
            }
        case .array(let items):
            VStack(alignment: .leading) {
                if items.isEmpty { Text("No items").foregroundStyle(.secondary) }
                ForEach(items.indices, id: \.self) { index in
                    if case .object = items[index] {
                        DisclosureGroup(recordName(items[index]).isEmpty ? "Item \(index + 1)" : recordName(items[index])) { SettingsResultView(value: items[index]) }
                    } else { Text(items[index].string).textSelection(.enabled) }
                }
            }
        default: Text(value.string).textSelection(.enabled)
        }
    }
}
