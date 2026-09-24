import SwiftUI
import BkemoShared

struct TimelineView: View {
    @Environment(MemoStore.self) private var store
    @Environment(SyncEngine.self) private var sync
    @Environment(Session.self) private var session
    @Environment(Router.self) private var router
    @Environment(Appearance.self) private var appearance

    @State private var filter: TimelineFilter = .all
    @State private var selectedDay: Date?
    @State private var search = ""
    @State private var searchPresented = false
    @State private var limit = 120
    @State private var composerFocused: Bool
    @State private var composerFullScreen = false
    /// Height of the inline composer; the list reserves it as a bottom inset.
    @State private var composerHeight: CGFloat = 0
    @State private var revealTarget: Memo?
    @State private var editing: Memo?
    @State private var pendingDelete: Memo?
    @State private var showSettings = false
    @State private var showTags = false
    @State private var showReconnect = false
    @State private var query = TimelineQuery()

    init() {
        let focusOnLaunch = AppGroup.defaults.object(forKey: AppGroup.focusOnLaunchKey) as? Bool ?? true
        _composerFocused = State(initialValue: focusOnLaunch || Router.shared.composeRequest != nil)
    }

    private var actions: MemoActions {
        MemoActions(
            edit: { editing = $0 },
            toggleDone: { store.toggleDone($0); SyncEngine.shared.kick() },
            toggleTask: { store.toggleChecklist($0, line: $1); SyncEngine.shared.kick() },
            togglePin: { memo in
                withAnimation(.snappy) { store.togglePin(memo) }
                SyncEngine.shared.kick()
            },
            toggleArchive: { memo in
                withAnimation(.snappy) { store.toggleArchive(memo) }
                SyncEngine.shared.kick()
            },
            delete: { pendingDelete = $0 }
        )
    }

    var body: some View {
        let sections = query.sections(store: store, filter: filter, day: selectedDay, search: search, limit: limit)
        NavigationStack {
            ScrollViewReader { proxy in
                List {
                    notices
                    if filter == .all && search.isEmpty {
                        TimelineHeader(stats: store.stats, selectedDay: $selectedDay.animation(.snappy))
                            .timelineRow(top: 4, bottom: 6)
                            .id("top")
                    }
                    FilterBar(filter: $filter, selectedDay: $selectedDay)
                        .timelineRow(top: 4, bottom: 4, horizontal: 0)
                        .id(filter == .all && search.isEmpty ? "filters" : "top")

                    if sections.isEmpty {
                        emptyState.timelineRow(top: 40, bottom: 40)
                    }

                    if !sections.pinned.isEmpty {
                        Section {
                            rows(sections.pinned, showsDate: true)
                        } header: {
                            sectionHeader("Pinned")
                        }
                    }
                    ForEach(sections.days) { group in
                        Section {
                            rows(group.memos, showsDate: filter == .todo || filter == .today)
                        } header: {
                            if let title = group.title {
                                sectionHeader(title)
                            } else if group.day != .distantFuture {
                                sectionHeader(DateText.section(group.day))
                            }
                        }
                    }
                    if sections.hasMore {
                        ProgressView()
                            .frame(maxWidth: .infinity)
                            .timelineRow(top: 12, bottom: 12)
                            .onAppear { limit += 200 }
                    }
                }
                .listStyle(.plain)
                .scrollContentBackground(.hidden)
                .scrollDismissesKeyboard(.interactively)
                .environment(\.defaultMinListRowHeight, 1)
                .background(Theme.bg.ignoresSafeArea())
                .refreshable { await sync.sync() }
                .searchable(text: $search, isPresented: $searchPresented, placement: .navigationBarDrawer(displayMode: .automatic), prompt: "Search memos")
                .navigationTitle(filter.title)
                .toolbar { toolbar }
                .safeAreaInset(edge: .bottom, spacing: 0) {
                    if showsComposer { Color.clear.frame(height: composerHeight) }
                }
                .onChange(of: revealTarget) { _, memo in
                    guard let memo else { return }
                    revealTarget = nil
                    reveal(memo, proxy: proxy)
                }
                .environment(\.openURL, OpenURLAction { url in
                    if let tag = MemoMarkdown.tagName(from: url) {
                        withAnimation(.snappy) { filter = .tag(tag) }
                        return .handled
                    }
                    return .systemAction
                })
            }
        }
        // The composer floats above the whole stack rather than living in the
        // list's inset: growing to full screen then simply covers the nav bar,
        // so the list, large title and search drawer never shift underneath.
        .overlay(alignment: .bottom) {
            if showsComposer {
                ComposerBar(isFocused: $composerFocused, isFullScreen: $composerFullScreen) { memo in
                    revealTarget = memo
                }
                .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { height in
                    if !composerFullScreen { composerHeight = height }
                }
                // Outside the NavigationStack the UIKit-bridged accent doesn't reach.
                .tint(appearance.accent)
            }
        }
        .onChange(of: filter) { _, _ in limit = 120 }
        .onChange(of: router.composeRequest) { _, request in
            guard request != nil else { return }
            editing = nil
            showSettings = false
            showTags = false
            if filter == .archived { filter = .all }
            composerFocused = true
        }
        .onChange(of: router.searchRequest) { _, request in
            if request != nil { searchPresented = true }
        }
        .sheet(item: $editing) { memo in
            EditorSheet(memo: memo)
        }
        .sheet(isPresented: $showSettings) { SettingsView() }
        .sheet(isPresented: $showTags) {
            TagsView { tag in
                filter = .tag(tag)
                showTags = false
            }
            .presentationDetents([.medium, .large])
        }
        .sheet(isPresented: $showReconnect) { SignInView(isReconnect: true) }
        .confirmationDialog("Delete this memo?", isPresented: deleteBinding, titleVisibility: .visible, presenting: pendingDelete) { memo in
            Button("Delete", role: .destructive) {
                withAnimation(.snappy) { store.delete(memo) }
                SyncEngine.shared.kick()
            }
        } message: { _ in
            Text("It moves to the recycle bin on bk.hax429.me.")
        }
    }

    private var deleteBinding: Binding<Bool> {
        Binding(get: { pendingDelete != nil }, set: { if !$0 { pendingDelete = nil } })
    }

    @ViewBuilder
    private func rows(_ memos: [Memo], showsDate: Bool) -> some View {
        ForEach(memos) { memo in
            MemoCard(memo: memo, badge: store.syncState(of: memo), showsDate: showsDate, actions: actions)
                .onTapGesture { editing = memo }
                .contextMenu { MemoMenuItems(memo: memo, actions: actions) }
                .timelineRow(top: 5, bottom: 5)
                .swipeActions(edge: .leading, allowsFullSwipe: true) {
                    if memo.isTodo {
                        Button { actions.toggleDone(memo) } label: {
                            Label(memo.isDone ? "Undo" : "Done", systemImage: memo.isDone ? "arrow.uturn.backward" : "checkmark")
                        }
                        .tint(.accentColor)
                    }
                    Button { actions.togglePin(memo) } label: {
                        Label(memo.isTop ? "Unpin" : "Pin", systemImage: memo.isTop ? "pin.slash" : "pin")
                    }
                    .tint(Theme.important)
                }
                .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                    Button(role: .destructive) { actions.delete(memo) } label: {
                        Label("Delete", systemImage: "trash")
                    }
                    Button { actions.toggleArchive(memo) } label: {
                        Label(memo.isArchived ? "Unarchive" : "Archive", systemImage: "archivebox")
                    }
                    .tint(Theme.fg3)
                }
        }
    }

    private func sectionHeader(_ title: String) -> some View {
        Kicker(title)
            .padding(.horizontal, 18)
            .padding(.top, 10)
            .padding(.bottom, 4)
            .frame(maxWidth: .infinity, alignment: .leading)
            .listRowInsets(EdgeInsets())
            .background(Theme.bg.opacity(0.94))
    }

    @ViewBuilder
    private var notices: some View {
        if session.needsReauth {
            NoticeRow(
                icon: "key.slash", tint: Theme.urgent,
                title: "Reconnect to keep syncing",
                detail: "Your access token was revoked or expired. Captures stay safe on this iPhone."
            ) { showReconnect = true }
            .timelineRow(top: 4, bottom: 4)
        }
        if let alert = session.securityAlert {
            NoticeRow(icon: "exclamationmark.shield", tint: Theme.important, title: alert, detail: nil) {
                session.securityAlert = nil
            }
            .timelineRow(top: 4, bottom: 4)
        }
        if store.outbox.failedCount > 0 {
            NoticeRow(
                icon: "exclamationmark.icloud", tint: Theme.urgent,
                title: "\(store.outbox.failedCount) change\(store.outbox.failedCount == 1 ? "" : "s") couldn't sync",
                detail: "Tap to review in Settings."
            ) { showSettings = true }
            .timelineRow(top: 4, bottom: 4)
        }
    }

    @ViewBuilder
    private var emptyState: some View {
        VStack(spacing: 12) {
            if sync.isBootstrapping && store.memos.isEmpty {
                ProgressView()
                Kicker("Syncing your memos")
            } else if !search.isEmpty {
                Image(systemName: "magnifyingglass").font(.system(size: 26, weight: .light))
                Kicker("No matches")
            } else {
                Image(systemName: filter == .archived ? "archivebox" : filter == .today ? "sun.max" : "text.quote")
                    .font(.system(size: 28, weight: .light))
                Text(filter == .all ? "Nothing here yet" : filter == .today ? "Nothing for today yet" : "Nothing in \(filter.title)")
                    .font(Typo.sans(20, .semibold))
                    .foregroundStyle(Theme.fg)
                if filter == .all {
                    Text("Your first thought is one tap away.\nIt saves instantly, even offline.")
                        .font(Typo.sans(14))
                        .multilineTextAlignment(.center)
                }
            }
        }
        .foregroundStyle(Theme.fg3)
        .frame(maxWidth: .infinity)
    }

    private var showsComposer: Bool { filter != .archived }

    @ToolbarContentBuilder
    private var toolbar: some ToolbarContent {
        ToolbarItem(placement: .topBarLeading) {
            SyncStatusButton { showSettings = true }
        }
        ToolbarItem(placement: .topBarTrailing) {
            Menu {
                Button { withAnimation(.snappy) { filter = .today } } label: {
                    Label("Today", systemImage: "sun.max")
                }
                Button { showTags = true } label: { Label("Tags", systemImage: "number") }
                Button { withAnimation(.snappy) { filter = .archived } } label: {
                    Label("Archive", systemImage: "archivebox")
                }
                Divider()
                Button { showSettings = true } label: { Label("Settings", systemImage: "gearshape") }
            } label: {
                Image(systemName: "line.3.horizontal.decrease")
                    .font(.system(size: 15, weight: .semibold))
            }
            .accessibilityLabel("Menu")
        }
    }

    private func reveal(_ memo: Memo, proxy: ScrollViewProxy) {
        let visible = TimelineQuery.build(
            memos: [memo], filter: filter, day: selectedDay, search: search, limit: 1
        ).shown > 0
        withAnimation(.snappy) {
            if !visible {
                filter = .all
                selectedDay = nil
                search = ""
            }
        }
        DispatchQueue.main.async {
            withAnimation(.snappy) { proxy.scrollTo(memo.id, anchor: .top) }
        }
    }
}

struct FilterBar: View {
    @Binding var filter: TimelineFilter
    @Binding var selectedDay: Date?
    @Environment(MemoStore.self) private var store

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 7) {
                if let day = selectedDay {
                    Chip(label: DateText.section(day), systemImage: "xmark", selected: true) {
                        withAnimation(.snappy) { selectedDay = nil }
                    }
                }
                chip("All", .all)
                chip("Pinned", .pinned, icon: "pin")
                chip("Todo", .todo, icon: "checkmark.circle")
                if case .today = filter { chip("Today", .today, icon: "sun.max") }
                if case .archived = filter { chip("Archive", .archived, icon: "archivebox") }
                if case .tag(let name) = filter, !store.tagCounts.prefix(8).contains(where: { $0.name == name }) {
                    chip("#\(name)", .tag(name))
                }
                ForEach(store.tagCounts.prefix(8)) { tag in
                    chip("#\(tag.name)", .tag(tag.name))
                }
            }
            .padding(.horizontal, 14)
        }
        .scrollClipDisabled()
    }

    private func chip(_ label: String, _ value: TimelineFilter, icon: String? = nil) -> some View {
        Chip(label: label, systemImage: icon, selected: filter == value) {
            Haptics.select()
            withAnimation(.snappy) { filter = filter == value && value != .all ? .all : value }
        }
    }
}

struct NoticeRow: View {
    let icon: String
    let tint: Color
    let title: String
    let detail: String?
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(alignment: .top, spacing: 11) {
                Image(systemName: icon)
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(tint)
                    .frame(width: 20)
                VStack(alignment: .leading, spacing: 3) {
                    Text(title)
                        .font(Typo.sans(14, .semibold))
                        .foregroundStyle(Theme.fg)
                    if let detail {
                        Text(detail)
                            .font(Typo.sans(12.5))
                            .foregroundStyle(Theme.fg2)
                    }
                }
                Spacer(minLength: 0)
                Image(systemName: "chevron.right")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(Theme.fg3)
            }
            .padding(13)
            .background(tint.opacity(0.1), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .strokeBorder(tint.opacity(0.3), lineWidth: 0.75)
            }
        }
        .buttonStyle(.plain)
    }
}

struct SyncStatusButton: View {
    @Environment(SyncEngine.self) private var sync
    @Environment(MemoStore.self) private var store
    let action: () -> Void

    var body: some View {
        let waiting = store.outbox.waitingCount
        Button(action: action) {
            HStack(spacing: 5) {
                if !sync.isOnline {
                    Image(systemName: "wifi.slash")
                    Text(waiting > 0 ? "Offline · \(waiting)" : "Offline")
                } else if sync.isSyncing && (waiting > 0 || sync.isBootstrapping) {
                    ProgressView().controlSize(.mini)
                    Text("Syncing")
                } else if waiting > 0 {
                    Image(systemName: "icloud.and.arrow.up")
                    Text("\(waiting) waiting")
                } else {
                    Image(systemName: "checkmark.icloud")
                        .foregroundStyle(Theme.fg3)
                }
            }
            .font(Typo.sans(12, .semibold))
            .foregroundStyle(Theme.fg2)
            .animation(.snappy, value: waiting)
        }
        .accessibilityLabel(sync.isOnline ? "Sync status" : "Offline")
    }
}

extension View {
    func timelineRow(top: CGFloat, bottom: CGFloat, horizontal: CGFloat = 14) -> some View {
        self
            .listRowInsets(EdgeInsets(top: top, leading: horizontal, bottom: bottom, trailing: horizontal))
            .listRowSeparator(.hidden)
            .listRowBackground(Color.clear)
    }
}
