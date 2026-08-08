import SwiftUI
import BkemoShared

struct ComposerView: View {
    @Environment(\.modelContext) private var context
    @ObservedObject private var tagStore = TagStore.shared
    @State private var content: String = ""
    @State private var selectedUTF16: Int = 0
    @State private var focused = false
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

    private var activeHashtag: TagParser.ActiveHashtag? {
        TagParser.activeHashtag(in: content, cursorUTF16: selectedUTF16)
    }

    private var suggestItems: [TagParser.SuggestItem] {
        guard let active = activeHashtag else { return [] }
        return TagParser.suggestions(query: active.query, pathTags: tagStore.pathTags)
    }

    private var showTagMenu: Bool {
        activeHashtag != nil && focused
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
            VStack(spacing: 0) {
                if showTagMenu {
                    TagSuggestMenu(items: suggestItems, onPick: applySuggestion)
                }
                accessoryBar
            }
        }
        .task {
            await tagStore.refresh()
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
        CaptureTextEditor(
            text: $content,
            selectedUTF16: $selectedUTF16,
            isFocused: $focused,
            placeholder: type == 2 ? "What needs to be done?" : "Capture your ideas, thoughts or notes…"
        )
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    private var accessoryBar: some View {
        HStack(spacing: 10) {
            accessoryIconButton(
                systemName: "keyboard.chevron.compact.down",
                label: "Hide keyboard"
            ) {
                focused = false
            }

            Button(action: insertHash) {
                Text("#")
                    .font(BkemoFont.ui(18, weight: .semibold))
                    .foregroundStyle(.primary)
                    .frame(width: 40, height: 40)
                    .background(Color(.secondarySystemBackground), in: Circle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Insert tag")

            Spacer(minLength: 0)

            Button(action: save) {
                HStack(spacing: 7) {
                    Text("Send")
                        .font(BkemoFont.ui(15, weight: .semibold))
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
                .fill(Color(.systemBackground))
                .ignoresSafeArea(edges: .bottom)
                .overlay(alignment: .top) {
                    Rectangle()
                        .fill(Color.primary.opacity(0.08))
                        .frame(height: 0.5)
                }
        }
    }

    private func accessoryIconButton(
        systemName: String,
        label: String,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            Image(systemName: systemName)
                .font(.system(size: 16, weight: .medium))
                .foregroundStyle(.secondary)
                .frame(width: 40, height: 40)
                .background(Color(.secondarySystemBackground), in: Circle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
    }

    private func insertHash() {
        focused = true
        Task { await tagStore.refresh() }
        // Prefer starting a fresh tag token; if already inside one, leave the `#` alone.
        if activeHashtag == nil {
            let ns = content as NSString
            let at = min(max(0, selectedUTF16), ns.length)
            let needsSpace = at > 0 && !CharacterSet.whitespacesAndNewlines
                .contains(UnicodeScalar(ns.character(at: at - 1))!)
            let insertion = needsSpace ? " #" : "#"
            CaptureTextEditor.insert(insertion, into: &content, at: &selectedUTF16)
        } else if let active = activeHashtag {
            // Already on a `#…` token — keep caret at the end of the active fragment.
            selectedUTF16 = active.range.location + active.range.length
        }
    }

    private func applySuggestion(_ item: TagParser.SuggestItem) {
        guard let active = activeHashtag else { return }
        CaptureTextEditor.replace(
            range: active.range,
            with: "#\(item.path) ",
            into: &content,
            selectedUTF16: &selectedUTF16
        )
        focused = true
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
        selectedUTF16 = 0
        isImportant = false
        isUrgent = false
        focused = true
        scheduleKeyboardDismissIfIdle()
        Task {
            await SyncEngine.shared.replayPending()
            await tagStore.refresh(force: true)
        }
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
