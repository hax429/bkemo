import Foundation
import BkemoShared

/// One local change waiting for the server. Each op carries a full snapshot of
/// the memo, so the outbox file alone is enough to recover a capture even if
/// the timeline mirror was never written.
struct PendingOp: Codable, Identifiable, Hashable {
    enum Kind: String, Codable { case upsert, delete }

    var id = UUID()
    var kind: Kind
    var memo: Memo
    /// Bumped whenever a newer snapshot is coalesced into this op, so a
    /// response for an older snapshot doesn't retire the op.
    var stamp = 0
    var attempts = 0
    var lastError: String?
    /// Rejected by the server; waits for the user to retry or discard.
    var failed = false
}

/// Pure queue logic (no I/O) so coalescing rules are unit-testable.
struct OutboxQueue: Codable, Equatable {
    private(set) var ops: [PendingOp] = []

    var isEmpty: Bool { ops.isEmpty }
    var failedCount: Int { ops.lazy.filter(\.failed).count }
    var waitingCount: Int { ops.lazy.filter { !$0.failed }.count }

    /// Memos whose local state must win over server snapshots until flushed.
    var dirtyLocalIds: Set<UUID> { Set(ops.map(\.memo.localId)) }
    var dirtyServerIds: Set<Int> { Set(ops.compactMap(\.memo.serverId)) }

    func op(id: UUID) -> PendingOp? { ops.first { $0.id == id } }

    /// Next op to send, skipping ones parked as failed.
    var next: PendingOp? { ops.first { !$0.failed } }

    mutating func upsert(_ memo: Memo) {
        if let index = ops.firstIndex(where: { $0.kind == .upsert && $0.memo.localId == memo.localId }) {
            ops[index].memo = memo
            ops[index].stamp += 1
            ops[index].failed = false
            ops[index].lastError = nil
        } else {
            ops.append(PendingOp(kind: .upsert, memo: memo))
        }
    }

    /// Queues a server-side trash. A memo the server never saw is simply
    /// dropped — unless its create is already in flight, in which case the
    /// delete waits so it can use the id the create returns.
    mutating func delete(_ memo: Memo, inFlightOpId: UUID?) {
        let inFlightCreate = ops.contains {
            $0.id == inFlightOpId && $0.kind == .upsert && $0.memo.localId == memo.localId
        }
        ops.removeAll { $0.kind == .upsert && $0.memo.localId == memo.localId }
        guard memo.serverId != nil || inFlightCreate else { return }
        if !ops.contains(where: { $0.kind == .delete && $0.memo.localId == memo.localId }) {
            ops.append(PendingOp(kind: .delete, memo: memo))
        }
    }

    /// Records the server's answer for an upsert snapshot taken at `stamp`.
    mutating func completeUpsert(opId: UUID, localId: UUID, serverId: Int, stamp: Int) {
        for index in ops.indices where ops[index].memo.localId == localId {
            ops[index].memo.serverId = serverId
        }
        if let index = ops.firstIndex(where: { $0.id == opId }), ops[index].stamp == stamp {
            ops.remove(at: index)
        }
    }

    mutating func remove(opId: UUID) {
        ops.removeAll { $0.id == opId }
    }

    mutating func noteAttemptFailed(opId: UUID, message: String, permanent: Bool) {
        guard let index = ops.firstIndex(where: { $0.id == opId }) else { return }
        ops[index].attempts += 1
        ops[index].lastError = message
        ops[index].failed = permanent
    }

    mutating func retryFailed() {
        for index in ops.indices {
            ops[index].failed = false
        }
    }

    mutating func removeAll() {
        ops.removeAll()
    }
}
