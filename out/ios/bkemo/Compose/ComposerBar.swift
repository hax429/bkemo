import SwiftUI
import BkemoShared

/// Floating capture bar pinned above the keyboard. It is the fastest path in
/// the app: tap, type, send — the memo lands in the local store and outbox
/// synchronously, so it works identically offline.
struct ComposerBar: View {
    @Binding var isFocused: Bool
    /// Long drafts grow the bar into a full-screen editor. The same text view
    /// stays mounted throughout, so the keyboard, caret and undo never reset.
    @Binding var isFullScreen: Bool
    var onSent: (Memo) -> Void

    @Environment(MemoStore.self) private var store
    @Environment(Appearance.self) private var appearance
    @State private var text = AppGroup.defaults.string(forKey: Self.draftKey) ?? ""
    @State private var cursor = 0
    @State private var type = AppGroup.defaults.object(forKey: AppGroup.lastTypeKey) as? Int ?? NoteType.blinko
    @State private var isImportant = false
    @State private var isUrgent = false
    @State private var handle = TextViewHandle()
    /// Set when the user collapses a long draft, so it doesn't spring back
    /// open on the next keystroke. Cleared once the draft is short again.
    @State private var userCollapsed = false

    static let draftKey = "bkemo.v2.draft"
    private static let inlineMaxHeight: CGFloat = 210
    /// Hysteresis: expand past the inline cap, collapse well below it.
    private static let collapseBelow: CGFloat = 150
    private static let resize = Animation.smooth(duration: 0.42, extraBounce: 0.02)

    private var trimmed: String { text.trimmingCharacters(in: .whitespacesAndNewlines) }
    private var expanded: Bool { isFocused || !trimmed.isEmpty }
    private var isTodo: Bool { type == NoteType.todo }

    var body: some View {
        VStack(spacing: 8) {
            if isFocused, let active = TagParser.activeHashtag(in: text, cursorUTF16: cursor) {
                TagSuggestionStrip(query: active.query) { pick in
                    handle.replace(active.range, with: "#\(pick) ")
                }
                .transition(.move(edge: .bottom).combined(with: .opacity))
            }
            VStack(alignment: .leading, spacing: 10) {
                if isFullScreen {
                    fullScreenHeader
                        .transition(.opacity.combined(with: .move(edge: .top)))
                }
                HStack(alignment: .bottom, spacing: 10) {
                    if !expanded {
                        Image(systemName: isTodo ? "circle" : "sparkle")
                            .font(.system(size: 15, weight: .medium))
                            .foregroundStyle(appearance.accent)
                            .frame(height: 30)
                    }
                    ComposerTextView(
                        text: $text,
                        isFocused: $isFocused,
                        cursor: $cursor,
                        handle: handle,
                        placeholder: isTodo ? "Add a todo…" : "Capture a thought…",
                        font: Typo.memoUIFont(serif: appearance.serifMemos, size: 17),
                        minHeight: 30,
                        maxHeight: isFullScreen ? .infinity : Self.inlineMaxHeight,
                        fills: isFullScreen,
                        onContentHeight: contentHeightChanged
                    )
                    .frame(maxHeight: isFullScreen ? .infinity : nil)
                    if !expanded {
                        sendButton.hidden()
                    }
                }
                if expanded {
                    toolbar
                        .transition(.opacity.combined(with: .move(edge: .bottom)))
                }
            }
            .padding(.horizontal, isFullScreen ? 20 : 16)
            .padding(.vertical, expanded ? 12 : 9)
            .frame(maxHeight: isFullScreen ? .infinity : nil, alignment: .bottom)
            .floatingSurface(cornerRadius: isFullScreen ? 30 : expanded ? 22 : 26)
            .contentShape(Rectangle())
            .onTapGesture { if !isFocused { isFocused = true } }
        }
        .padding(.horizontal, isFullScreen ? 6 : 10)
        .padding(.top, isFullScreen ? 6 : 0)
        .padding(.bottom, 6)
        .frame(maxHeight: isFullScreen ? .infinity : nil, alignment: .bottom)
        .background {
            // Opaque backdrop so the full-screen editor reads as its own page.
            if isFullScreen {
                Theme.bg.ignoresSafeArea().transition(.opacity)
            }
        }
        .animation(.snappy(duration: 0.28), value: expanded)
        .animation(Self.resize, value: isFullScreen)
        .animation(.snappy(duration: 0.2), value: isTodo)
        .onChange(of: text) { _, value in
            AppGroup.defaults.set(value, forKey: Self.draftKey)
        }
        .onChange(of: type) { _, value in
            AppGroup.defaults.set(value, forKey: AppGroup.lastTypeKey)
        }
        .onChange(of: Router.shared.composeRequest) { _, request in
            guard let request else { return }
            if let requested = request.type { type = requested }
            isFocused = true
        }
        .onAppear {
            if let requested = Router.shared.composeRequest?.type { type = requested }
        }
    }

    private var fullScreenHeader: some View {
        HStack {
            Kicker(isTodo ? "New todo" : "New memo")
            Spacer()
            Button { setFullScreen(false, byUser: true) } label: {
                Image(systemName: "arrow.down.right.and.arrow.up.left")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(Theme.fg2)
                    .frame(width: 34, height: 30)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Collapse editor")
        }
    }

    private func contentHeightChanged(_ height: CGFloat) {
        if height < Self.collapseBelow {
            userCollapsed = false
            if isFullScreen { setFullScreen(false) }
        } else if height > Self.inlineMaxHeight, !isFullScreen, !userCollapsed, isFocused {
            setFullScreen(true)
        }
    }

    private func setFullScreen(_ on: Bool, byUser: Bool = false) {
        guard on != isFullScreen else { return }
        if byUser { userCollapsed = !on }
        withAnimation(Self.resize) { isFullScreen = on }
        // Once the new size has settled, bring the caret back into view.
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.45) { handle.scrollToCaret() }
    }

    private var toolbar: some View {
        HStack(spacing: 6) {
            TypeSwitch(type: $type)
            toolButton("number", label: "Insert tag") { insertHash() }
            toolButton("checklist", label: "Checklist item") { handle.prefixCurrentLine("- [ ] ") }
            if isTodo {
                flagButton(isOn: $isImportant, color: Theme.important, symbol: "star", label: "Important")
                flagButton(isOn: $isUrgent, color: Theme.urgent, symbol: "flame", label: "Urgent")
            }
            Spacer(minLength: 4)
            if !isFullScreen {
                toolButton("arrow.up.left.and.arrow.down.right", label: "Expand editor") {
                    setFullScreen(true, byUser: true)
                }
            }
            sendButton
        }
    }

    private var sendButton: some View {
        Button(action: send) {
            Image(systemName: "arrow.up")
                .font(.system(size: 15, weight: .bold))
                .foregroundStyle(trimmed.isEmpty ? Theme.fg3 : .white)
                .frame(width: 34, height: 34)
                .background(Circle().fill(trimmed.isEmpty ? Theme.surface2 : appearance.accent))
        }
        .buttonStyle(.plain)
        .disabled(trimmed.isEmpty)
        .keyboardShortcut(.return, modifiers: .command)
        .accessibilityLabel("Save")
    }

    private func toolButton(_ symbol: String, label: String, action: @escaping () -> Void) -> some View {
        Button {
            Haptics.select()
            action()
        } label: {
            Image(systemName: symbol)
                .font(.system(size: 15, weight: .medium))
                .foregroundStyle(Theme.fg2)
                .frame(width: 34, height: 34)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
    }

    private func flagButton(isOn: Binding<Bool>, color: Color, symbol: String, label: String) -> some View {
        Button {
            Haptics.select()
            isOn.wrappedValue.toggle()
        } label: {
            Image(systemName: isOn.wrappedValue ? "\(symbol).fill" : symbol)
                .font(.system(size: 14, weight: .medium))
                .foregroundStyle(isOn.wrappedValue ? color : Theme.fg3)
                .frame(width: 32, height: 34)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
        .accessibilityAddTraits(isOn.wrappedValue ? .isSelected : [])
    }

    private func insertHash() {
        isFocused = true
        let ns = text as NSString
        let at = min(handle.cursor, ns.length)
        let needsSpace = at > 0 && !(ns.substring(with: NSRange(location: at - 1, length: 1)).first?.isWhitespace ?? true)
        handle.insert(needsSpace ? " #" : "#")
    }

    private func send() {
        guard !trimmed.isEmpty else { return }
        let memo = store.create(
            content: trimmed,
            type: type,
            isImportant: isTodo && isImportant,
            isUrgent: isTodo && isUrgent
        )
        Haptics.success()
        text = ""
        cursor = 0
        userCollapsed = false
        if isFullScreen { setFullScreen(false) }
        isImportant = false
        isUrgent = false
        AppGroup.defaults.removeObject(forKey: Self.draftKey)
        SyncEngine.shared.kick()
        onSent(memo)
    }
}

/// Compact Memo / Todo switch.
struct TypeSwitch: View {
    @Binding var type: Int

    var body: some View {
        HStack(spacing: 0) {
            segment("Memo", value: NoteType.blinko)
            segment("Todo", value: NoteType.todo)
        }
        .padding(2)
        .background(Capsule().fill(Theme.surface2))
        // Never truncate to "Me…"; the tool buttons give way first.
        .fixedSize()
    }

    private func segment(_ label: String, value: Int) -> some View {
        let selected = type == value
        return Button {
            Haptics.select()
            type = value
        } label: {
            Text(label)
                .font(Typo.sans(12.5, .semibold))
                .foregroundStyle(selected ? Theme.fg : Theme.fg3)
                .padding(.horizontal, 11)
                .frame(height: 28)
                .background {
                    if selected {
                        Capsule().fill(Theme.surface)
                            .shadow(color: .black.opacity(0.12), radius: 2, y: 1)
                    }
                }
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(selected ? .isSelected : [])
    }
}

struct TagSuggestionStrip: View {
    let query: String
    let onPick: (String) -> Void

    @Environment(MemoStore.self) private var store
    @Environment(TagDirectory.self) private var directory
    @Environment(Appearance.self) private var appearance

    var body: some View {
        let items = TagParser.suggestions(query: query, pathTags: directory.paths(local: store.tagCounts), limit: 12)
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 6) {
                if items.isEmpty {
                    Text("Type a tag")
                        .font(Typo.kicker(11))
                        .foregroundStyle(Theme.fg3)
                        .padding(.horizontal, 6)
                }
                ForEach(items) { item in
                    Chip(label: item.label, systemImage: item.isNew ? "plus" : nil, selected: !item.isNew, tint: appearance.accent) {
                        Haptics.select()
                        onPick(item.path)
                    }
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 2)
        }
        .scrollClipDisabled()
    }
}
