import XCTest
import SwiftData
import BkemoShared
@testable import bkemo

@MainActor
final class MemoReconcilerTests: XCTestCase {
    func testMergeReplacesChangedMemoAndRemovesDeletedMemo() {
        let existing = [
            MemoItem(remote: ["id": 1, "content": "old", "createdAt": "2026-01-01T00:00:00Z"]),
            MemoItem(remote: ["id": 2, "content": "remove", "createdAt": "2026-01-02T00:00:00Z"]),
        ]

        let merged = MemoReconciler.mergeRemote(
            existing: existing,
            changed: [["id": 1, "content": "new", "type": NoteType.todo]],
            removedIds: [2]
        )

        XCTAssertEqual(merged.count, 1)
        XCTAssertEqual(merged.first?.serverId, 1)
        XCTAssertEqual(merged.first?.content, "new")
        XCTAssertEqual(merged.first?.type, NoteType.todo)
    }

    func testReconcileUpdatesMatchingLocalMemoAndDeletesRemovedMemo() throws {
        let container = try makeContainer()
        let context = container.mainContext
        let changed = LocalMemo(content: "old", type: NoteType.blinko, source: "")
        changed.serverId = 1
        changed.syncState = "synced"
        let removed = LocalMemo(content: "remove", type: NoteType.blinko, source: "")
        removed.serverId = 2
        removed.syncState = "error"
        context.insert(changed)
        context.insert(removed)
        try context.save()

        try MemoReconciler.reconcileLocal(
            changed: [[
                "id": 1,
                "content": "updated",
                "type": NoteType.todo,
                "isImportant": true,
                "completedAt": "2026-07-23T10:00:00Z",
            ]],
            removedIds: [2],
            context: context
        )

        let rows = try context.fetch(FetchDescriptor<LocalMemo>())
        XCTAssertEqual(rows.count, 1)
        XCTAssertEqual(rows.first?.serverId, 1)
        XCTAssertEqual(rows.first?.content, "updated")
        XCTAssertEqual(rows.first?.syncState, "synced")
        XCTAssertTrue(rows.first?.isImportant == true)
        XCTAssertNotNil(rows.first?.completedAt)
    }

    func testRemoveDeletesSyncedLocalMemoImmediately() throws {
        let container = try makeContainer()
        let context = container.mainContext
        let memo = LocalMemo(content: "trash", type: NoteType.blinko, source: "")
        memo.serverId = 42
        memo.syncState = "synced"
        context.insert(memo)
        try context.save()

        try MemoReconciler.remove(serverId: 42, context: context)

        XCTAssertTrue(try context.fetch(FetchDescriptor<LocalMemo>()).isEmpty)
    }

    private func makeContainer() throws -> ModelContainer {
        let schema = Schema([LocalMemo.self])
        let configuration = ModelConfiguration(schema: schema, isStoredInMemoryOnly: true)
        return try ModelContainer(for: schema, configurations: [configuration])
    }
}
