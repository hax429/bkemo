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
                        // The sidebar layout has its own editor (SidebarLayoutEditor).
                        ForEach(shape["properties"].object.keys.sorted().filter { key != "bkemoPrefs" || !$0.hasPrefix("sidebar") }, id: \.self) { name in
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

func recordName(_ value: SettingsValue) -> String {
    for key in ["title", "name", "nickname", "filename", "task"] { if !value[key].string.isEmpty { return value[key].string } }
    return value["id"].string
}
