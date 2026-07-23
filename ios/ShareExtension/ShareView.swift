import SwiftUI
import BkemoShared

struct ShareDraft {
    var content: String
    var type: Int
    var isImportant: Bool
    var isUrgent: Bool
}

struct ShareView: View {
    let prefilled: String
    let onSave: (ShareDraft) -> Void
    let onCancel: () -> Void

    @State private var content: String = ""
    @State private var type = 0
    @State private var isImportant = false
    @State private var isUrgent = false
    @FocusState private var focused: Bool

    private var appearance: BkemoClient.AppearancePreferences {
        guard let data = AppGroup.defaults.data(forKey: AppGroup.appearanceKey),
              let value = try? JSONDecoder().decode(BkemoClient.AppearancePreferences.self, from: data) else {
            return .init()
        }
        return value
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 12) {
                Picker("Type", selection: $type) {
                    Text("Memo").tag(0)
                    Text("Todo").tag(2)
                }
                .pickerStyle(.segmented)
                TextEditor(text: $content)
                    .focused($focused)
                    .frame(minHeight: 120)
                    .padding(8)
                    .background(Color(.secondarySystemBackground))
                    .cornerRadius(10)
                if type == 2 {
                    HStack(spacing: 8) {
                        chip("#important", .yellow, $isImportant)
                        chip("#urgent", .red, $isUrgent)
                        Spacer()
                    }
                }
                Spacer()
            }
            .padding()
            .navigationTitle("bkemo")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Cancel") { onCancel() }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Save") {
                        let trimmed = content.trimmingCharacters(in: .whitespacesAndNewlines)
                        guard !trimmed.isEmpty else { return }
                        onSave(ShareDraft(content: trimmed, type: type, isImportant: isImportant, isUrgent: isUrgent))
                    }
                    .disabled(content.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
            }
            .onAppear {
                content = prefilled
                focused = true
            }
        }
        .tint(Color(shareHex: appearance.accent))
        .preferredColorScheme(appearance.theme == "light" ? .light : .dark)
    }

    private func chip(_ label: String, _ color: Color, _ selected: Binding<Bool>) -> some View {
        Button { selected.wrappedValue.toggle() } label: {
            Text(label).font(.system(.caption, design: .monospaced))
                .padding(.horizontal, 10).padding(.vertical, 5)
                .background(selected.wrappedValue ? color.opacity(0.25) : Color(.secondarySystemBackground))
                .foregroundStyle(selected.wrappedValue ? color : .secondary)
                .overlay(RoundedRectangle(cornerRadius: 8).stroke(selected.wrappedValue ? color : Color.secondary.opacity(0.2), lineWidth: 1))
                .cornerRadius(8)
        }
        .buttonStyle(.plain)
    }
}

private extension Color {
    init(shareHex hex: String) {
        let value = hex.trimmingCharacters(in: CharacterSet.alphanumerics.inverted)
        let rgb = UInt64(value, radix: 16) ?? 0xE2A96B
        self.init(
            red: Double((rgb >> 16) & 0xff) / 255,
            green: Double((rgb >> 8) & 0xff) / 255,
            blue: Double(rgb & 0xff) / 255
        )
    }
}