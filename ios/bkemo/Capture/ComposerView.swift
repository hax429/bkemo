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
        VStack(alignment: .leading, spacing: 11) {
            HStack {
                Text("QUICK CAPTURE")
                    .font(.system(size: 10.5, weight: .medium, design: .monospaced))
                    .tracking(0.9)
                    .foregroundStyle(.secondary)
                Spacer()
                TypeToggle(selection: $type)
                    .frame(width: 180)
            }
            TextEditor(text: $content)
                .focused($focused)
                .font(.system(size: 17))
                .scrollContentBackground(.hidden)
                .frame(minHeight: 116, maxHeight: 180)
                .padding(10)
                .background(Color(.secondarySystemBackground))
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                .overlay {
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .stroke(Color.primary.opacity(0.1), lineWidth: 0.75)
                }
                .overlay(alignment: .topLeading) {
                    if content.isEmpty {
						Text(type == 2 ? "What needs to be done?" : "Capture a thought…")
                            .foregroundStyle(Color(.placeholderText))
                            .padding(.horizontal, 15).padding(.vertical, 18)
                            .allowsHitTesting(false)
                    }
                }
            if type == 2 {
                PriorityToggle(isImportant: $isImportant, isUrgent: $isUrgent)
            }
        }
        .padding(.horizontal)
        .padding(.top, 12)
        .padding(.bottom, 10)
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
                    Image(systemName: "arrow.up")
                        .font(.system(size: 15, weight: .bold))
                        .foregroundStyle(.white)
                        .frame(width: 36, height: 36)
                        .background { Circle().fill(.tint) }
                }
                .buttonStyle(.plain)
                .disabled(content.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                .opacity(content.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? 0.38 : 1)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 7)
            .background(.ultraThinMaterial)
            .overlay(alignment: .top) {
                Rectangle().fill(Color.primary.opacity(0.08)).frame(height: 0.5)
            }
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