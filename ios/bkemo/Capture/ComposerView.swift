import SwiftUI
import BkemoShared

struct ComposerView: View {
    @Environment(\.modelContext) private var context
    @FocusState private var focused: Bool
    @State private var content: String = ""
    @State private var type: Int
    @State private var isImportant = false
    @State private var isUrgent = false
    @State private var showVoiceHint = false

    init() {
        let saved = AppGroup.defaults.object(forKey: AppGroup.lastTypeKey) as? Int
        _type = State(initialValue: saved ?? 0)
    }

    var body: some View {
        VStack(spacing: 12) {
            HStack {
                TypeToggle(selection: $type)
                Spacer()
            }
            TextEditor(text: $content)
                .focused($focused)
                .frame(minHeight: 96)
                .padding(8)
                .background(Color(.secondarySystemBackground))
                .cornerRadius(10)
                .overlay(alignment: .topLeading) {
                    if content.isEmpty {
						Text(type == 2 ? "What needs to be done?" : "Capture a thought…")
                            .foregroundStyle(Color(.placeholderText))
                            .padding(.horizontal, 14).padding(.vertical, 16)
                            .allowsHitTesting(false)
                    }
                }
            if type == 2 {
                PriorityToggle(isImportant: $isImportant, isUrgent: $isUrgent)
            }
        }
        .padding(.horizontal)
        .padding(.top)
        .onAppear {
            if let pending = AppGroup.defaults.object(forKey: AppGroup.pendingTypeKey) as? Int {
                type = pending
                AppGroup.defaults.removeObject(forKey: AppGroup.pendingTypeKey)
            }
            focused = true
            if !(AppGroup.defaults.object(forKey: AppGroup.voiceHintKey) as? Bool ?? false) {
                showVoiceHint = true
            }
        }
		.safeAreaInset(edge: .bottom) {
            HStack {
                if showVoiceHint {
                    Label("Hold the 🎤 key to dictate", systemImage: "mic.fill")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .padding(.horizontal, 10).padding(.vertical, 6)
                        .background(Color(.secondarySystemBackground))
                        .cornerRadius(8)
                    Spacer()
                    Button { dismissVoiceHint() } label: { Image(systemName: "xmark.circle.fill").foregroundStyle(.secondary) }
                        .buttonStyle(.plain)
                }
                Spacer()
                Button {
                    save()
                } label: {
                    Image(systemName: "arrow.up.circle.fill")
                        .font(.system(size: 30))
                        .foregroundColor(.accentColor)
                }
                .buttonStyle(.plain)
                .disabled(content.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 6)
            .background(.bar)
        }
    }

    private func dismissVoiceHint() {
        AppGroup.defaults.set(true, forKey: AppGroup.voiceHintKey)
        showVoiceHint = false
    }

    private func save() {
        let trimmed = content.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        let memo = LocalMemo(content: trimmed, type: type, source: MemoSource.manual,
                             isImportant: isImportant, isUrgent: isUrgent)
        context.insert(memo)
        try? context.save()
        content = ""
        isImportant = false
        isUrgent = false
        focused = true
        Task { await SyncEngine.shared.replayPending() }
    }
}