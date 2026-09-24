import SwiftUI
import BkemoShared

/// Full-screen editor for an existing memo. Saving is local + queued, so it
/// works offline exactly like capture.
struct EditorSheet: View {
    let original: Memo

    @Environment(MemoStore.self) private var store
    @Environment(Appearance.self) private var appearance
    @Environment(\.dismiss) private var dismiss
    @State private var text: String
    @State private var cursor = 0
    @State private var focused = true
    @State private var type: Int
    @State private var isImportant: Bool
    @State private var isUrgent: Bool
    @State private var handle = TextViewHandle()
    @State private var confirmDelete = false

    init(memo: Memo) {
        original = memo
        _text = State(initialValue: memo.content)
        _type = State(initialValue: memo.type)
        _isImportant = State(initialValue: memo.isImportant)
        _isUrgent = State(initialValue: memo.isUrgent)
    }

    private var trimmed: String { text.trimmingCharacters(in: .whitespacesAndNewlines) }
    private var hasChanges: Bool {
        trimmed != original.content || type != original.type
            || isImportant != original.isImportant || isUrgent != original.isUrgent
    }

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 0) {
                HStack(spacing: 8) {
                    TypeSwitch(type: $type)
                    if type == NoteType.todo {
                        Chip(label: "Important", systemImage: "star", selected: isImportant, tint: Theme.important) {
                            isImportant.toggle()
                        }
                        Chip(label: "Urgent", systemImage: "flame", selected: isUrgent, tint: Theme.urgent) {
                            isUrgent.toggle()
                        }
                    }
                    Spacer(minLength: 0)
                }
                .padding(.horizontal, 20)
                .padding(.vertical, 10)

                if let active = focused ? TagParser.activeHashtag(in: text, cursorUTF16: cursor) : nil {
                    TagSuggestionStrip(query: active.query) { pick in
                        handle.replace(active.range, with: "#\(pick) ")
                    }
                    .padding(.bottom, 6)
                }

                ComposerTextView(
                    text: $text,
                    isFocused: $focused,
                    cursor: $cursor,
                    handle: handle,
                    placeholder: "Write something…",
                    font: Typo.memoUIFont(serif: appearance.serifMemos, size: 18),
                    fills: true,
                    insets: UIEdgeInsets(top: 8, left: 20, bottom: 24, right: 20)
                )

                footer
            }
            .background(Theme.bg.ignoresSafeArea())
            .navigationTitle(type == NoteType.todo ? "Edit todo" : "Edit memo")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save", action: save)
                        .fontWeight(.semibold)
                        .disabled(trimmed.isEmpty || !hasChanges)
                }
            }
            .confirmationDialog("Delete this memo?", isPresented: $confirmDelete, titleVisibility: .visible) {
                Button("Delete", role: .destructive) {
                    store.delete(original)
                    SyncEngine.shared.kick()
                    dismiss()
                }
            }
        }
        .interactiveDismissDisabled(hasChanges)
    }

    private var footer: some View {
        HStack(spacing: 14) {
            VStack(alignment: .leading, spacing: 2) {
                Kicker("Created \(DateText.full(original.createdAt))")
                if original.updatedAt.timeIntervalSince(original.createdAt) > 60 {
                    Kicker("Edited \(DateText.full(original.updatedAt))")
                }
            }
            Spacer()
            Button {
                handle.prefixCurrentLine("- [ ] ")
            } label: {
                Image(systemName: "checklist")
            }
            .accessibilityLabel("Checklist item")
            Button(role: .destructive) {
                confirmDelete = true
            } label: {
                Image(systemName: "trash")
            }
            .tint(Theme.urgent)
            .accessibilityLabel("Delete")
        }
        .font(.system(size: 16))
        .padding(.horizontal, 20)
        .padding(.vertical, 12)
        .background(Theme.bg)
        .overlay(alignment: .top) { Rectangle().fill(Theme.border).frame(height: 0.5) }
    }

    private func save() {
        guard !trimmed.isEmpty else { return }
        var next = store.memo(localId: original.localId) ?? original
        next.content = trimmed
        next.type = type
        next.isImportant = type == NoteType.todo && isImportant
        next.isUrgent = type == NoteType.todo && isUrgent
        store.update(next)
        SyncEngine.shared.kick()
        Haptics.success()
        dismiss()
    }
}
