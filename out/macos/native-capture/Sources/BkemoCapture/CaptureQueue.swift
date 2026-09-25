import Foundation
import BkemoShared

/// A note waiting to be uploaded. Persisted to disk immediately on save so
/// the capture panel can close instantly without waiting on the network —
/// mirrors the Rust capture queue's persist-then-drain approach.
struct PendingCapture: Codable {
    var id: String = UUID().uuidString
    var endpoint: String
    var token: String
    var content: String
    var type: Int
    var isImportant: Bool
    var isUrgent: Bool
    var dueDate: Date?
    var attempts: Int = 0
}

actor CaptureQueue {
    private let fileURL: URL
    private var draining = false

    init() {
        let dir = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Application Support/me.hax429.bk", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        self.fileURL = dir.appendingPathComponent("capture-queue.json")
    }

    nonisolated func enqueue(_ job: PendingCapture) {
        Task { await self.append(job) }
    }

    private func append(_ job: PendingCapture) {
        var jobs = readAll()
        jobs.append(job)
        writeAll(jobs)
        drain()
    }

    private func readAll() -> [PendingCapture] {
        guard let data = try? Data(contentsOf: fileURL) else { return [] }
        return (try? JSONDecoder().decode([PendingCapture].self, from: data)) ?? []
    }

    private func writeAll(_ jobs: [PendingCapture]) {
        guard let data = try? JSONEncoder().encode(jobs) else { return }
        try? data.write(to: fileURL, options: .atomic)
    }

    private func remove(id: String) {
        writeAll(readAll().filter { $0.id != id })
    }

    private func bumpAttempt(id: String) -> Int {
        var jobs = readAll()
        var attempts = 0
        if let index = jobs.firstIndex(where: { $0.id == id }) {
            jobs[index].attempts += 1
            attempts = jobs[index].attempts
        }
        writeAll(jobs)
        return attempts
    }

    private func backoffNanoseconds(for attempts: Int) -> UInt64 {
        let secs = min(UInt64(1) << min(attempts, 8), 300)
        return secs * 1_000_000_000
    }

    /// Resumes draining any jobs left over from a previous run (e.g. helper
    /// was relaunched while offline).
    func resume() {
        drain()
    }

    private func drain() {
        guard !draining else { return }
        draining = true
        Task { await self.drainLoop() }
    }

    private func drainLoop() async {
        while true {
            guard let job = readAll().first else { break }
            let client = BkemoClient(endpoint: job.endpoint, token: job.token)
            do {
                _ = try await client.upsert(Memo(
                    content: job.content,
                    type: job.type,
                    isImportant: job.isImportant,
                    isUrgent: job.isUrgent,
                    dueDate: job.dueDate
                ))
                remove(id: job.id)
            } catch {
                let attempts = bumpAttempt(id: job.id)
                try? await Task.sleep(nanoseconds: backoffNanoseconds(for: attempts))
            }
        }
        draining = false
    }
}
