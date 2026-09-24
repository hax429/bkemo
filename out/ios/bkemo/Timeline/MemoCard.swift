import SwiftUI
import BkemoShared

struct MemoCard: View {
    let memo: Memo
    let badge: SyncBadge
    var showsDate = false
    let actions: MemoActions

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            header
            if memo.isTodo {
                HStack(alignment: .top, spacing: 11) {
                    Button {
                        Haptics.tap()
                        actions.toggleDone(memo)
                    } label: {
                        Image(systemName: memo.isDone ? "checkmark.circle.fill" : "circle")
                            .font(.system(size: 21, weight: .light))
                            .foregroundStyle(memo.isDone ? Color.accentColor : Theme.fg3)
                            .contentTransition(.symbolEffect(.replace))
                    }
                    .buttonStyle(.plain)
                    .padding(.top, 1)
                    .accessibilityLabel(memo.isDone ? "Mark not done" : "Mark done")
                    content
                }
            } else {
                content
            }
            if !images.isEmpty { imageGrid }
            if !files.isEmpty { fileList }
        }
        .padding(.horizontal, 15)
        .padding(.vertical, 13)
        .card(highlighted: memo.isTop)
        .contentShape(RoundedRectangle(cornerRadius: Theme.radius, style: .continuous))
    }

    private var content: some View {
        MemoContentView(content: memo.content, dimmed: memo.isDone) { line in
            actions.toggleTask(memo, line)
        }
        .strikethrough(memo.isTodo && memo.isDone, color: Theme.fg3)
    }

    private var header: some View {
        HStack(spacing: 7) {
            Text(showsDate ? DateText.full(memo.createdAt) : DateText.clock(memo.createdAt))
                .font(Typo.kicker(11))
                .foregroundStyle(Theme.fg3)
            if memo.isTop {
                Image(systemName: "pin.fill")
                    .font(.system(size: 9.5, weight: .semibold))
                    .foregroundStyle(Color.accentColor)
                    .rotationEffect(.degrees(40))
            }
            if memo.isImportant { PriorityDot(color: Theme.important) }
            if memo.isUrgent { PriorityDot(color: Theme.urgent) }
            if let due = memo.dueDate, memo.isTodo, !memo.isDone {
                Label(due.formatted(.dateTime.month(.abbreviated).day()), systemImage: "calendar")
                    .font(Typo.sans(11, .medium))
                    .foregroundStyle(due < .now ? Theme.urgent : Theme.fg3)
                    .labelStyle(.titleAndIcon)
            }
            Spacer(minLength: 6)
            syncIndicator
            Menu {
                MemoMenuItems(memo: memo, actions: actions)
            } label: {
                Image(systemName: "ellipsis")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(Theme.fg3)
                    .frame(width: 30, height: 22)
                    .contentShape(Rectangle())
            }
            .accessibilityLabel("More")
        }
    }

    @ViewBuilder
    private var syncIndicator: some View {
        switch badge {
        case .synced:
            EmptyView()
        case .pending:
            Image(systemName: "icloud.and.arrow.up")
                .font(.system(size: 11, weight: .medium))
                .foregroundStyle(Theme.fg3)
                .accessibilityLabel("Waiting to sync")
        case .failed:
            Image(systemName: "exclamationmark.icloud.fill")
                .font(.system(size: 12))
                .foregroundStyle(Theme.urgent)
                .accessibilityLabel("Sync failed")
        }
    }

    private var images: [MemoAttachment] { memo.attachments.filter(\.isImage) }
    private var files: [MemoAttachment] { memo.attachments.filter { !$0.isImage } }

    private var imageGrid: some View {
        let shown = Array(images.prefix(6))
        let columns = shown.count == 1 ? 1 : shown.count == 2 || shown.count == 4 ? 2 : 3
        return LazyVGrid(
            columns: Array(repeating: GridItem(.flexible(), spacing: 6), count: columns),
            spacing: 6
        ) {
            ForEach(shown, id: \.path) { item in
                AttachmentImage(path: item.path)
                    .aspectRatio(columns == 1 ? 16 / 10 : 1, contentMode: .fit)
                    .clipShape(RoundedRectangle(cornerRadius: 9, style: .continuous))
            }
        }
    }

    private var fileList: some View {
        VStack(alignment: .leading, spacing: 6) {
            ForEach(files, id: \.path) { file in
                Label(file.name, systemImage: "paperclip")
                    .font(Typo.sans(13))
                    .foregroundStyle(Theme.fg2)
                    .lineLimit(1)
            }
        }
    }
}

/// Everything a row can ask the timeline to do.
struct MemoActions {
    var edit: (Memo) -> Void
    var toggleDone: (Memo) -> Void
    var toggleTask: (Memo, Int) -> Void
    var togglePin: (Memo) -> Void
    var toggleArchive: (Memo) -> Void
    var delete: (Memo) -> Void
}

struct MemoMenuItems: View {
    let memo: Memo
    let actions: MemoActions

    var body: some View {
        Button { actions.edit(memo) } label: { Label("Edit", systemImage: "pencil") }
        Button { actions.togglePin(memo) } label: {
            Label(memo.isTop ? "Unpin" : "Pin", systemImage: memo.isTop ? "pin.slash" : "pin")
        }
        if memo.isTodo {
            Button { actions.toggleDone(memo) } label: {
                Label(memo.isDone ? "Mark not done" : "Mark done", systemImage: "checkmark.circle")
            }
        }
        Button {
            UIPasteboard.general.string = memo.content
            Haptics.success()
        } label: { Label("Copy", systemImage: "doc.on.doc") }
        ShareLink(item: memo.content) { Label("Share", systemImage: "square.and.arrow.up") }
        Divider()
        Button { actions.toggleArchive(memo) } label: {
            Label(memo.isArchived ? "Unarchive" : "Archive", systemImage: memo.isArchived ? "tray.and.arrow.up" : "archivebox")
        }
        Button(role: .destructive) { actions.delete(memo) } label: { Label("Delete", systemImage: "trash") }
    }
}
