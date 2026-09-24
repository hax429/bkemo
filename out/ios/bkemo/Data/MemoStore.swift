import Foundation
import Observation
import WidgetKit
import BkemoShared

/// Local-first source of truth for everything the UI shows.
///
/// Launch path: `init` decodes only the small head snapshot (first screen +
/// pinned) and the outbox, so the first frame never waits on the full mirror.
/// `loadFull()` swaps in the complete timeline off the main thread right after.
@MainActor
@Observable
final class MemoStore {
    static let shared: MemoStore = {
        #if DEBUG
        if DemoMode.isOn {
            let store = MemoStore(memos: DemoMode.memos)
            // One unsynced capture so the pending state is visible.
            if let offline = store.memos.first(where: { $0.serverId == nil }) { store.update(offline) }
            return store
        }
        #endif
        return MemoStore()
    }()

    /// Every note on this device, newest first (archived included).
    private(set) var memos: [Memo] = []
    private(set) var outbox = OutboxQueue()
    private(set) var isFullyLoaded = false
    /// Bumped on every change; derived caches key off it.
    private(set) var revision = 0

    /// Op currently being sent by the sync engine.
    @ObservationIgnored var inFlightOpId: UUID?

    @ObservationIgnored private var touchedBeforeLoad: Set<UUID> = []
    @ObservationIgnored private var removedBeforeLoad: Set<UUID> = []
    @ObservationIgnored private var saveTask: Task<Void, Never>?
    @ObservationIgnored private var saveDeferred = false
    @ObservationIgnored private var loadTask: Task<Void, Never>?
    @ObservationIgnored private var statsCache: (revision: Int, value: TimelineStats)?
    @ObservationIgnored private var tagCache: (revision: Int, value: [TagCount])?

    static let headCount = 60
    /// False for in-memory stores (tests); nothing touches the App Group.
    @ObservationIgnored private let persists: Bool

    init(memos: [Memo]? = nil, outbox: OutboxQueue? = nil) {
        persists = memos == nil
        if let memos {
            self.memos = memos
            self.outbox = outbox ?? OutboxQueue()
            isFullyLoaded = true
        } else {
            self.memos = MemoCoding.read([Memo].self, from: AppGroup.headURL) ?? []
            self.outbox = MemoCoding.read(OutboxQueue.self, from: AppGroup.outboxURL) ?? OutboxQueue()
        }
        overlayOutbox()
    }

    // MARK: Loading

    func loadFull() async {
        if isFullyLoaded { return }
        if let loadTask { return await loadTask.value }
        let task = Task { @MainActor in
            let full = await Task.detached(priority: .userInitiated) {
                MemoCoding.read([Memo].self, from: AppGroup.timelineURL)
            }.value
            if let full {
                var byId = Dictionary(full.map { ($0.localId, $0) }, uniquingKeysWith: { first, _ in first })
                for id in removedBeforeLoad { byId[id] = nil }
                for memo in memos where touchedBeforeLoad.contains(memo.localId) {
                    byId[memo.localId] = memo
                }
                memos = Self.sorted(Array(byId.values))
            }
            touchedBeforeLoad.removeAll()
            removedBeforeLoad.removeAll()
            overlayOutbox()
            isFullyLoaded = true
            bump()
            if saveDeferred { scheduleSave() }
        }
        loadTask = task
        await task.value
    }

    /// Re-applies queued snapshots so the UI always reflects unsent edits,
    /// even if the timeline file lagged behind the outbox.
    private func overlayOutbox() {
        for op in outbox.ops {
            switch op.kind {
            case .upsert:
                if let index = memos.firstIndex(where: { $0.localId == op.memo.localId }) {
                    memos[index] = op.memo
                } else {
                    memos.append(op.memo)
                }
            case .delete:
                memos.removeAll { $0.localId == op.memo.localId }
            }
        }
        memos = Self.sorted(memos)
    }

    // MARK: Queries

    func memo(localId: UUID) -> Memo? {
        memos.first { $0.localId == localId }
    }

    func syncState(of memo: Memo) -> SyncBadge {
        guard let op = outbox.ops.first(where: { $0.memo.localId == memo.localId }) else { return .synced }
        return op.failed ? .failed(op.lastError ?? "Rejected by server") : .pending
    }

    var stats: TimelineStats {
        if let statsCache, statsCache.revision == revision { return statsCache.value }
        let value = TimelineStats(memos: memos)
        statsCache = (revision, value)
        return value
    }

    var tagCounts: [TagCount] {
        if let tagCache, tagCache.revision == revision { return tagCache.value }
        var counts: [String: Int] = [:]
        for memo in memos where !memo.isArchived {
            for tag in Set(TagParser.extract(memo.content)) { counts[tag, default: 0] += 1 }
        }
        let value = counts
            .map { TagCount(name: $0.key, count: $0.value) }
            .sorted { $0.count == $1.count ? $0.name < $1.name : $0.count > $1.count }
        tagCache = (revision, value)
        return value
    }

    // MARK: Local mutations (instant, offline-safe)

    @discardableResult
    func create(
        content: String,
        type: Int,
        isImportant: Bool = false,
        isUrgent: Bool = false,
        source: String = MemoSource.manual
    ) -> Memo {
        let memo = Memo(content: content, type: type, isImportant: isImportant, isUrgent: isUrgent, source: source)
        insertLocal(memo)
        return memo
    }

    private func insertLocal(_ memo: Memo) {
        outbox.upsert(memo)
        persistOutbox()
        memos.insert(memo, at: 0)
        memos = Self.sorted(memos)
        touch(memo.localId)
        didChange()
    }

    func update(_ memo: Memo) {
        var next = memo
        next.updatedAt = .now
        guard let index = memos.firstIndex(where: { $0.localId == next.localId }) else { return }
        outbox.upsert(next)
        persistOutbox()
        memos[index] = next
        touch(next.localId)
        didChange()
    }

    func togglePin(_ memo: Memo) {
        var next = memo
        next.isTop.toggle()
        update(next)
    }

    func toggleArchive(_ memo: Memo) {
        var next = memo
        next.isArchived.toggle()
        if next.isArchived { next.isTop = false }
        update(next)
    }

    func toggleDone(_ memo: Memo) {
        var next = memo
        next.completedAt = memo.isDone ? nil : .now
        update(next)
    }

    /// Flips the `- [ ]` / `- [x]` marker on `line` (0-based) of the content.
    func toggleChecklist(_ memo: Memo, line: Int) {
        var lines = memo.content.components(separatedBy: "\n")
        guard lines.indices.contains(line), let toggled = Checklist.toggle(lines[line]) else { return }
        lines[line] = toggled
        var next = memo
        next.content = lines.joined(separator: "\n")
        update(next)
    }

    func delete(_ memo: Memo) {
        outbox.delete(memo, inFlightOpId: inFlightOpId)
        persistOutbox()
        memos.removeAll { $0.localId == memo.localId }
        if !isFullyLoaded {
            removedBeforeLoad.insert(memo.localId)
            touchedBeforeLoad.remove(memo.localId)
        }
        didChange()
    }

    func retryFailed() {
        outbox.retryFailed()
        persistOutbox()
        bump()
    }

    /// Drops a rejected change and lets the next pull restore server state.
    func discard(_ op: PendingOp) {
        outbox.remove(opId: op.id)
        persistOutbox()
        if op.memo.serverId == nil {
            memos.removeAll { $0.localId == op.memo.localId }
        }
        AppGroup.defaults.removeObject(forKey: AppGroup.cursorKey)
        AppGroup.defaults.set(false, forKey: AppGroup.bootstrappedKey)
        didChange()
    }

    /// Pulls captures written by the share extension, widgets, and intents.
    func ingestInbox() {
        #if DEBUG
        if DemoMode.isOn { return }  // never drain a real inbox into the throwaway demo store
        #endif
        let items = Inbox.pending()
        guard !items.isEmpty else { return }
        let known = Set(memos.map(\.localId)).union(outbox.dirtyLocalIds)
        for item in items {
            if !known.contains(item.memo.localId) {
                insertLocal(item.memo)
            }
            Inbox.remove(item.url)
        }
    }

    /// One-time import of unsynced v1 captures.
    func importCaptures(_ captured: [Memo]) {
        let known = Set(memos.map(\.localId))
        for memo in captured where !known.contains(memo.localId) {
            insertLocal(memo)
        }
    }

    // MARK: Sync engine hooks

    func completeUpsert(_ op: PendingOp, serverId: Int) {
        outbox.completeUpsert(opId: op.id, localId: op.memo.localId, serverId: serverId, stamp: op.stamp)
        persistOutbox()
        if let index = memos.firstIndex(where: { $0.localId == op.memo.localId }) {
            memos[index].serverId = serverId
        }
        didChange()
    }

    func completeDelete(_ op: PendingOp) {
        outbox.remove(opId: op.id)
        persistOutbox()
        bump()
    }

    func noteFailure(_ op: PendingOp, message: String, permanent: Bool) {
        outbox.noteAttemptFailed(opId: op.id, message: message, permanent: permanent)
        persistOutbox()
        bump()
    }

    /// Applies server snapshots. Memos with unsent local changes keep their
    /// local state; the next flush makes the server agree.
    func mergeRemote(changed: [Memo], removedIds: [Int]) {
        guard !changed.isEmpty || !removedIds.isEmpty else { return }
        let dirtyLocal = outbox.dirtyLocalIds
        let dirtyServer = outbox.dirtyServerIds
        var indexByServerId: [Int: Int] = [:]
        for (index, memo) in memos.enumerated() {
            if let id = memo.serverId { indexByServerId[id] = index }
        }
        var didMutate = false
        for var remote in changed {
            guard let serverId = remote.serverId, !dirtyServer.contains(serverId) else { continue }
            if let index = indexByServerId[serverId] {
                let local = memos[index]
                if dirtyLocal.contains(local.localId) { continue }
                remote.localId = local.localId
                if remote.source.isEmpty { remote.source = local.source }
                if local != remote {
                    memos[index] = remote
                    didMutate = true
                }
            } else {
                memos.append(remote)
                indexByServerId[serverId] = memos.count - 1
                didMutate = true
            }
        }
        if !removedIds.isEmpty {
            let removed = Set(removedIds).subtracting(dirtyServer)
            let before = memos.count
            memos.removeAll { memo in
                guard let id = memo.serverId else { return false }
                return removed.contains(id) && !dirtyLocal.contains(memo.localId)
            }
            didMutate = didMutate || memos.count != before
        }
        guard didMutate else { return }
        memos = Self.sorted(memos)
        didChange()
    }

    /// Sign-out: forget everything on this device.
    func wipe() {
        saveTask?.cancel()
        memos = []
        outbox.removeAll()
        for url in [AppGroup.timelineURL, AppGroup.headURL, AppGroup.outboxURL] {
            try? FileManager.default.removeItem(at: url)
        }
        try? FileManager.default.removeItem(at: AppGroup.imageCacheURL)
        bump()
        WidgetCenter.shared.reloadAllTimelines()
    }

    // MARK: Persistence

    private func touch(_ id: UUID) {
        if !isFullyLoaded { touchedBeforeLoad.insert(id) }
    }

    private func bump() { revision &+= 1 }

    private func didChange() {
        bump()
        scheduleSave()
    }

    private func persistOutbox() {
        guard persists else { return }
        // Synchronous on purpose: this file is what makes an offline capture durable.
        try? MemoCoding.write(outbox, to: AppGroup.outboxURL)
    }

    private func scheduleSave() {
        guard persists else { return }
        // Never overwrite the full mirror with the head-only launch subset.
        guard isFullyLoaded else { saveDeferred = true; return }
        saveDeferred = false
        saveTask?.cancel()
        let snapshot = memos
        saveTask = Task(priority: .utility) {
            try? await Task.sleep(for: .milliseconds(350))
            guard !Task.isCancelled else { return }
            await Task.detached(priority: .utility) {
                try? MemoCoding.write(snapshot, to: AppGroup.timelineURL)
                try? MemoCoding.write(Self.head(of: snapshot), to: AppGroup.headURL)
            }.value
            WidgetCenter.shared.reloadAllTimelines()
        }
    }

    /// Write any pending save now (app backgrounding).
    func flushToDisk() {
        guard persists, isFullyLoaded, saveTask != nil else { return }
        saveTask?.cancel()
        saveTask = nil
        try? MemoCoding.write(memos, to: AppGroup.timelineURL)
        try? MemoCoding.write(Self.head(of: memos), to: AppGroup.headURL)
    }

    nonisolated static func head(of memos: [Memo]) -> [Memo] {
        let active = memos.filter { !$0.isArchived }
        let pinned = active.filter(\.isTop)
        let recent = active.prefix(headCount).filter { !$0.isTop }
        return pinned + recent
    }

    nonisolated static func sorted(_ memos: [Memo]) -> [Memo] {
        memos.sorted { lhs, rhs in
            if lhs.createdAt != rhs.createdAt { return lhs.createdAt > rhs.createdAt }
            return (lhs.serverId ?? .max) > (rhs.serverId ?? .max)
        }
    }
}

enum SyncBadge: Equatable {
    case synced
    case pending
    case failed(String)
}

struct TagCount: Identifiable, Hashable {
    let name: String
    let count: Int
    var id: String { name }
}

/// Numbers for the header: totals plus a per-day histogram for the heatmap.
struct TimelineStats {
    let memoCount: Int
    let tagCount: Int
    let dayCount: Int
    let perDay: [Date: Int]

    init(memos: [Memo], calendar: Calendar = .current) {
        var perDay: [Date: Int] = [:]
        var tags = Set<String>()
        var count = 0
        for memo in memos where !memo.isArchived {
            count += 1
            perDay[calendar.startOfDay(for: memo.createdAt), default: 0] += 1
            if memo.content.contains("#") {
                tags.formUnion(TagParser.extract(memo.content))
            }
        }
        self.memoCount = count
        self.tagCount = tags.count
        self.dayCount = perDay.count
        self.perDay = perDay
    }
}

enum Checklist {
    /// Returns the line with its task marker flipped, or nil if it isn't a task line.
    static func toggle(_ line: String) -> String? {
        guard let match = parse(line) else { return nil }
        let marker = match.checked ? "[ ]" : "[x]"
        let ns = line as NSString
        return ns.replacingCharacters(in: match.markerRange, with: marker)
    }

    static func parse(_ line: String) -> (checked: Bool, markerRange: NSRange, text: String)? {
        guard let regex = try? NSRegularExpression(pattern: #"^(\s*[-*+]\s+)(\[[ xX]\])\s?(.*)$"#) else { return nil }
        let ns = line as NSString
        guard let match = regex.firstMatch(in: line, range: NSRange(location: 0, length: ns.length)) else { return nil }
        let marker = ns.substring(with: match.range(at: 2))
        return (marker.lowercased() == "[x]", match.range(at: 2), ns.substring(with: match.range(at: 3)))
    }
}
