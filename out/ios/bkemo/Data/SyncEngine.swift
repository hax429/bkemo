import Foundation
import Network
import Observation
import UIKit
import BkemoShared

/// Moves the outbox to the server and the server's change feed into the store.
///
/// All network work is single-flight: `kick()` coalesces requests, and a run is
/// always flush-then-pull so a pull can never observe a half-mapped create.
@MainActor
@Observable
final class SyncEngine {
    static let shared = SyncEngine()

    private(set) var isOnline = true
    private(set) var isSyncing = false
    private(set) var isBootstrapping = false
    private(set) var lastSyncedAt: Date?
    private(set) var lastError: String?

    @ObservationIgnored private let store: MemoStore
    @ObservationIgnored private let session: Session
    @ObservationIgnored private var runTask: Task<Void, Never>?
    @ObservationIgnored private var rerunRequested = false
    @ObservationIgnored private var retryTask: Task<Void, Never>?
    @ObservationIgnored private var retryDelay: Duration = .seconds(3)
    @ObservationIgnored private var eventTask: Task<Void, Never>?
    @ObservationIgnored private var pollTask: Task<Void, Never>?
    @ObservationIgnored private var monitor: NWPathMonitor?

    init(store: MemoStore = .shared, session: Session = .shared) {
        self.store = store
        self.session = session
        if let last = AppGroup.defaults.object(forKey: AppGroup.lastSyncKey) as? Double {
            lastSyncedAt = Date(timeIntervalSince1970: last)
        }
    }

    // MARK: Lifecycle

    /// Called once the first frame is on screen.
    func startMonitoring() {
        guard monitor == nil else { return }
        let monitor = NWPathMonitor()
        monitor.pathUpdateHandler = { [weak self] path in
            Task { @MainActor in
                guard let self else { return }
                let online = path.status == .satisfied
                let cameOnline = online && !self.isOnline
                self.isOnline = online
                if cameOnline {
                    self.retryDelay = .seconds(3)
                    self.kick()
                }
            }
        }
        monitor.start(queue: DispatchQueue(label: "bkemo.path"))
        self.monitor = monitor
    }

    func enterForeground() {
        kick()
        startLiveUpdates()
    }

    func enterBackground() {
        stopLiveUpdates()
        guard !store.outbox.isEmpty else { return }
        // Give an in-progress capture a chance to reach the server.
        var taskId: UIBackgroundTaskIdentifier = .invalid
        taskId = UIApplication.shared.beginBackgroundTask(withName: "bkemo.flush") {
            UIApplication.shared.endBackgroundTask(taskId)
        }
        Task {
            await self.sync()
            UIApplication.shared.endBackgroundTask(taskId)
        }
    }

    // MARK: Running

    func kick() {
        guard session.canSync else { return }
        if runTask != nil {
            rerunRequested = true
            return
        }
        runTask = Task {
            repeat {
                rerunRequested = false
                await runOnce()
            } while rerunRequested && session.canSync
            runTask = nil
        }
    }

    /// Runs (or joins) a sync and waits for it. Used by pull-to-refresh and background tasks.
    func sync() async {
        kick()
        await runTask?.value
    }

    private func runOnce() async {
        isSyncing = true
        defer { isSyncing = false }
        await store.loadFull()
        store.ingestInbox()

        let flushed = await flushOutbox()
        guard flushed, session.canSync else { return }

        do {
            if AppGroup.defaults.bool(forKey: AppGroup.bootstrappedKey) {
                try await pullChanges()
            } else {
                try await bootstrap()
            }
            let now = Date()
            lastSyncedAt = now
            AppGroup.defaults.set(now.timeIntervalSince1970, forKey: AppGroup.lastSyncKey)
            lastError = nil
            retryDelay = .seconds(3)
        } catch {
            handle(error)
        }
    }

    /// Sends queued ops in order. Returns false when it stopped on a transient error.
    private func flushOutbox() async -> Bool {
        while session.canSync, let op = store.outbox.next {
            store.inFlightOpId = op.id
            defer { store.inFlightOpId = nil }
            do {
                switch op.kind {
                case .upsert:
                    var memo = op.memo
                    if memo.serverId == nil { memo.serverId = store.memo(localId: memo.localId)?.serverId }
                    let serverId = try await session.client.upsert(memo)
                    store.completeUpsert(op, serverId: serverId)
                case .delete:
                    let latest = store.outbox.op(id: op.id)?.memo ?? op.memo
                    if let serverId = latest.serverId {
                        try await session.client.noteBatchTrash(ids: [serverId])
                    }
                    store.completeDelete(op)
                }
            } catch APIError.unauthorized {
                session.handleUnauthorized()
                return false
            } catch let error as APIError where error.isTransient {
                store.noteFailure(op, message: error.localizedDescription, permanent: false)
                handle(error)
                return false
            } catch {
                store.noteFailure(op, message: Self.describe(error), permanent: true)
            }
        }
        return true
    }

    private func pullChanges() async throws {
        var cursor = AppGroup.defaults.object(forKey: AppGroup.cursorKey) as? Int
        var hasMore = true
        while hasMore {
            let page = try await session.client.noteChanges(cursor: cursor)
            store.mergeRemote(changed: page.changed, removedIds: page.removedIds)
            hasMore = page.hasMore && page.cursor != cursor
            cursor = page.cursor
            AppGroup.defaults.set(page.cursor, forKey: AppGroup.cursorKey)
        }
    }

    /// First sync on this device: pin the change cursor, then page the full
    /// list. Anything edited meanwhile is replayed by the next pull.
    private func bootstrap() async throws {
        isBootstrapping = true
        defer { isBootstrapping = false }
        let start = try await session.client.noteChanges(cursor: nil, bootstrap: true)
        let pageSize = 100
        for archived in [false, true] {
            var page = 1
            while page <= 200 {
                let rows = try await session.client.noteList(page: page, size: pageSize, archived: archived)
                store.mergeRemote(changed: rows.compactMap { Memo(remote: $0) }, removedIds: [])
                if rows.count < pageSize { break }
                page += 1
            }
        }
        AppGroup.defaults.set(start.cursor, forKey: AppGroup.cursorKey)
        AppGroup.defaults.set(true, forKey: AppGroup.bootstrappedKey)
        try await pullChanges()
    }

    private func handle(_ error: Error) {
        if case APIError.unauthorized = error {
            session.handleUnauthorized()
            return
        }
        lastError = Self.describe(error)
        scheduleRetry()
    }

    private func scheduleRetry() {
        retryTask?.cancel()
        let delay = retryDelay
        retryDelay = min(retryDelay * 2, .seconds(120))
        retryTask = Task {
            try? await Task.sleep(for: delay)
            guard !Task.isCancelled else { return }
            kick()
        }
    }

    private static func describe(_ error: Error) -> String {
        if case APIError.transport = error { return "You're offline" }
        if case APIError.http(let code, _) = error { return "Server error \(code)" }
        return error.localizedDescription
    }

    // MARK: Live updates

    private func startLiveUpdates() {
        guard session.canSync, eventTask == nil else { return }
        eventTask = Task { [weak self] in
            while !Task.isCancelled {
                guard let self, self.session.canSync else { return }
                do {
                    for try await event in self.session.client.noteEvents() {
                        if event.kind == "security" {
                            self.session.securityAlert = "Security alert — review it on bkemo web or Mac."
                        } else {
                            self.kick()
                        }
                    }
                } catch APIError.unauthorized {
                    self.session.handleUnauthorized()
                    return
                } catch {}
                try? await Task.sleep(for: .seconds(5))
            }
        }
        pollTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(60))
                guard !Task.isCancelled else { return }
                self?.kick()
            }
        }
    }

    private func stopLiveUpdates() {
        eventTask?.cancel()
        pollTask?.cancel()
        eventTask = nil
        pollTask = nil
    }

    func reset() {
        stopLiveUpdates()
        retryTask?.cancel()
        lastSyncedAt = nil
        lastError = nil
    }
}
