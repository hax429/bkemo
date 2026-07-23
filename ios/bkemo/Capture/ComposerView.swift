import SwiftUI
import BkemoShared

struct ComposerView: View {
    @Environment(\.modelContext) private var context
    @FocusState private var focused: Bool
    @State private var content: String = ""
    @State private var type: Int
    @State private var isImportant = false
    @State private var isUrgent = false
    @State private var dismissKeyboardTask: Task<Void, Never>?

    init() {
        let saved = AppGroup.defaults.object(forKey: AppGroup.lastTypeKey) as? Int
        _type = State(initialValue: saved ?? 0)
    }

    private var canSend: Bool {
        !content.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            header
            if type == 2 {
                PriorityToggle(isImportant: $isImportant, isUrgent: $isUrgent)
                    .padding(.horizontal, 20)
                    .padding(.top, 10)
            }
            canvas
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .background(Color(.systemBackground))
        .safeAreaInset(edge: .bottom, spacing: 0) {
            accessoryBar
        }
        .onAppear {
            if let pending = AppGroup.defaults.object(forKey: AppGroup.pendingTypeKey) as? Int {
                type = pending
                AppGroup.defaults.removeObject(forKey: AppGroup.pendingTypeKey)
            }
            focused = true
        }
        .onChange(of: content) { _, new in
            if !new.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                dismissKeyboardTask?.cancel()
                dismissKeyboardTask = nil
            }
        }
        .onDisappear {
            dismissKeyboardTask?.cancel()
        }
    }

    private var header: some View {
        HStack(alignment: .center, spacing: 12) {
            Text("QUICK CAPTURE")
                .font(.system(size: 10.5, weight: .medium, design: .monospaced))
                .tracking(0.9)
                .foregroundStyle(.secondary)
            Spacer(minLength: 8)
            TypeToggle(selection: $type)
                .frame(width: 168)
        }
        .padding(.horizontal, 20)
        .padding(.top, 8)
        .padding(.bottom, 4)
        .contentShape(Rectangle())
        .onTapGesture { focused = false }
    }

    private var canvas: some View {
        ZStack(alignment: .topLeading) {
            TextEditor(text: $content)
                .focused($focused)
                .font(.system(size: 22, weight: .regular))
                .scrollContentBackground(.hidden)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled(false)
                .padding(.horizontal, 16)
                .padding(.top, 8)
                .padding(.bottom, 12)

            if content.isEmpty {
                Text(type == 2 ? "What needs to be done?" : "Capture your ideas, thoughts or notes…")
                    .font(.system(size: 22, weight: .regular))
                    .foregroundStyle(Color(.placeholderText))
                    .padding(.horizontal, 21)
                    .padding(.top, 16)
                    .allowsHitTesting(false)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    private var accessoryBar: some View {
        HStack(spacing: 12) {
            Button {
                focused = false
            } label: {
                Image(systemName: "keyboard.chevron.compact.down")
                    .font(.system(size: 16, weight: .medium))
                    .foregroundStyle(.secondary)
                    .frame(width: 40, height: 40)
                    .background(Color(.secondarySystemBackground), in: Circle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Hide keyboard")

            Spacer(minLength: 0)

            Button(action: save) {
                HStack(spacing: 7) {
                    Text("Send")
                        .font(.system(size: 15, weight: .semibold))
                    Image(systemName: "arrow.up")
                        .font(.system(size: 13, weight: .bold))
                }
                .foregroundStyle(canSend ? Color.white : Color.secondary)
                .padding(.horizontal, 22)
                .frame(height: 40)
                .background {
                    Capsule(style: .continuous)
                        .fill(canSend ? Color.accentColor : Color(.secondarySystemBackground))
                }
            }
            .buttonStyle(.plain)
            .disabled(!canSend)
            .opacity(canSend ? 1 : 0.72)
            .accessibilityLabel("Send")
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .background {
            Rectangle()
                .fill(.ultraThinMaterial)
                .ignoresSafeArea(edges: .bottom)
        }
        .overlay(alignment: .top) {
            Rectangle()
                .fill(Color.primary.opacity(0.08))
                .frame(height: 0.5)
        }
    }

    private func save() {
        let trimmed = content.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        let memo = LocalMemo(
            content: trimmed,
            type: type,
            source: MemoSource.manual,
            isImportant: isImportant,
            isUrgent: isUrgent
        )
        context.insert(memo)
        try? context.save()
        CaptureFeedback.shared.showSaved(localId: memo.localId)

        content = ""
        isImportant = false
        isUrgent = false
        focused = true
        scheduleKeyboardDismissIfIdle()
        Task { await SyncEngine.shared.replayPending() }
    }

    private func scheduleKeyboardDismissIfIdle() {
        dismissKeyboardTask?.cancel()
        dismissKeyboardTask = Task {
            try? await Task.sleep(for: .seconds(1))
            guard !Task.isCancelled else { return }
            if content.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                focused = false
            }
        }
    }
}
