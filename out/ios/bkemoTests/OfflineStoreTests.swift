import XCTest
import BkemoShared
@testable import bkemo

@MainActor
final class OutboxQueueTests: XCTestCase {
    func testRepeatedEditsCoalesceIntoOneUpsert() {
        var queue = OutboxQueue()
        var memo = Memo(content: "a")
        queue.upsert(memo)
        memo.content = "b"
        queue.upsert(memo)

        XCTAssertEqual(queue.ops.count, 1)
        XCTAssertEqual(queue.ops[0].memo.content, "b")
        XCTAssertEqual(queue.ops[0].stamp, 1)
    }

    func testDeletingNeverSyncedMemoDropsItEntirely() {
        var queue = OutboxQueue()
        let memo = Memo(content: "draft")
        queue.upsert(memo)
        queue.delete(memo, inFlightOpId: nil)
        XCTAssertTrue(queue.isEmpty)
    }

    func testDeleteDuringInFlightCreateWaitsForServerId() {
        var queue = OutboxQueue()
        let memo = Memo(content: "racing")
        queue.upsert(memo)
        let create = queue.ops[0]
        queue.delete(memo, inFlightOpId: create.id)

        XCTAssertEqual(queue.ops.map(\.kind), [.delete])
        queue.completeUpsert(opId: create.id, localId: memo.localId, serverId: 42, stamp: create.stamp)
        XCTAssertEqual(queue.ops.first?.memo.serverId, 42)
    }

    func testStaleUpsertResponseKeepsNewerEdit() {
        var queue = OutboxQueue()
        var memo = Memo(content: "v1")
        queue.upsert(memo)
        let sent = queue.ops[0]
        memo.content = "v2"
        queue.upsert(memo)

        queue.completeUpsert(opId: sent.id, localId: memo.localId, serverId: 7, stamp: sent.stamp)
        XCTAssertEqual(queue.ops.count, 1)
        XCTAssertEqual(queue.ops[0].memo.serverId, 7)
        XCTAssertEqual(queue.ops[0].memo.content, "v2")
    }

    func testFailedOpsAreSkippedUntilRetried() {
        var queue = OutboxQueue()
        let first = Memo(content: "bad")
        let second = Memo(content: "good")
        queue.upsert(first)
        queue.upsert(second)
        queue.noteAttemptFailed(opId: queue.ops[0].id, message: "400", permanent: true)

        XCTAssertEqual(queue.next?.memo.localId, second.localId)
        XCTAssertEqual(queue.failedCount, 1)
        queue.retryFailed()
        XCTAssertEqual(queue.next?.memo.localId, first.localId)
    }
}

@MainActor
final class MemoStoreTests: XCTestCase {
    func testCaptureIsImmediatelyVisibleAndQueued() {
        let store = MemoStore(memos: [])
        let memo = store.create(content: "offline thought", type: NoteType.blinko)

        XCTAssertEqual(store.memos.first?.localId, memo.localId)
        XCTAssertEqual(store.outbox.waitingCount, 1)
        XCTAssertEqual(store.syncState(of: memo), .pending)
    }

    func testRemoteSnapshotDoesNotClobberUnsyncedEdit() {
        var synced = Memo(serverId: 5, content: "server")
        let store = MemoStore(memos: [synced])
        synced.content = "local edit"
        store.update(synced)

        var remote = Memo(serverId: 5, content: "server changed")
        remote.localId = UUID()
        store.mergeRemote(changed: [remote], removedIds: [])

        XCTAssertEqual(store.memos.count, 1)
        XCTAssertEqual(store.memos[0].content, "local edit")
    }

    func testRemoteMergeKeepsStableIdentityAndRemovesTrashed() {
        let local = Memo(serverId: 1, content: "old")
        let gone = Memo(serverId: 2, content: "trash me")
        let store = MemoStore(memos: [local, gone])

        store.mergeRemote(changed: [Memo(serverId: 1, content: "new")], removedIds: [2])

        XCTAssertEqual(store.memos.count, 1)
        XCTAssertEqual(store.memos[0].localId, local.localId)
        XCTAssertEqual(store.memos[0].content, "new")
    }

    func testDeletedMemoIsNotResurrectedByPull() {
        let memo = Memo(serverId: 9, content: "bye")
        let store = MemoStore(memos: [memo])
        store.delete(memo)
        store.mergeRemote(changed: [Memo(serverId: 9, content: "bye")], removedIds: [])
        XCTAssertTrue(store.memos.isEmpty)
    }

    func testCompleteUpsertAssignsServerId() {
        let store = MemoStore(memos: [])
        let memo = store.create(content: "hi", type: NoteType.todo)
        let op = store.outbox.ops[0]
        store.completeUpsert(op, serverId: 77)

        XCTAssertEqual(store.memo(localId: memo.localId)?.serverId, 77)
        XCTAssertTrue(store.outbox.isEmpty)
        XCTAssertEqual(store.syncState(of: memo), .synced)
    }

    func testChecklistToggleEditsContent() {
        let memo = Memo(serverId: 3, content: "list\n- [ ] milk\n- [x] eggs")
        let store = MemoStore(memos: [memo])
        store.toggleChecklist(memo, line: 1)
        store.toggleChecklist(store.memos[0], line: 2)
        XCTAssertEqual(store.memos[0].content, "list\n- [x] milk\n- [ ] eggs")
    }

    func testHeadKeepsPinnedAndSkipsArchived() {
        let pinned = Memo(content: "pin", isTop: true, createdAt: .distantPast)
        let archived = Memo(content: "old", isArchived: true)
        let head = MemoStore.head(of: [archived, Memo(content: "new"), pinned])
        XCTAssertEqual(Set(head.map(\.content)), ["pin", "new"])
    }
}

final class MemoDecodingTests: XCTestCase {
    func testRemoteRowParsesFractionalDatesAndAttachments() {
        let memo = Memo(remote: [
            "id": 12,
            "content": "hello #ios",
            "type": 2,
            "isTop": true,
            "createdAt": "2026-09-01T10:00:00.123Z",
            "completedAt": NSNull(),
            "attachments": [["name": "a.png", "path": "/api/file/a.png", "type": "image/png"]],
        ])
        XCTAssertEqual(memo?.serverId, 12)
        XCTAssertEqual(memo?.localId, Memo.stableLocalId(serverId: 12))
        XCTAssertNotNil(memo?.createdAt)
        XCTAssertEqual(memo?.createdAt.timeIntervalSince1970 ?? 0, 1_788_256_800.123, accuracy: 0.01)
        XCTAssertNil(memo?.completedAt)
        XCTAssertEqual(memo?.attachments.first?.isImage, true)
        XCTAssertTrue(memo?.isTop == true)
    }

    func testCodableRoundTrip() throws {
        let memo = Memo(serverId: 1, content: "x", attachments: [.init(name: "f", path: "/p", type: "")])
        let data = try MemoCoding.encoder().encode([memo])
        let back = try MemoCoding.decoder().decode([Memo].self, from: data)
        XCTAssertEqual(back.first?.content, "x")
        XCTAssertEqual(back.first?.localId, memo.localId)
    }
}

final class MarkdownTests: XCTestCase {
    func testBlocksRecognizeTasksHeadingsAndTagsAsText() {
        let blocks = MemoMarkdown.parse("# Title\n#tag starts a line\n- [x] done\n- item\n```\ncode\n```")
        guard blocks.count == 5 else { return XCTFail("got \(blocks)") }
        if case .heading(let level, _) = blocks[0] { XCTAssertEqual(level, 1) } else { XCTFail() }
        if case .paragraph = blocks[1] {} else { XCTFail("#tag line must stay a paragraph") }
        if case .task(let line, let checked, _) = blocks[2] {
            XCTAssertEqual(line, 2)
            XCTAssertTrue(checked)
        } else { XCTFail() }
        if case .bullet(let marker, _, _) = blocks[3] { XCTAssertEqual(marker, "•") } else { XCTFail() }
        if case .code(let text) = blocks[4] { XCTAssertEqual(text, "code") } else { XCTFail() }
    }

    func testInlineTagsBecomeTagLinks() {
        let text = MemoMarkdown.inline("see #work/ios now")
        let links = text.runs.compactMap(\.link)
        XCTAssertEqual(links.compactMap(MemoMarkdown.tagName), ["work/ios"])
    }
}

@MainActor
final class TimelineQueryTests: XCTestCase {
    func testPinnedHoistedAndTagFilterMatchesChildren() {
        let memos = [
            Memo(content: "a #work/ios", createdAt: .now),
            Memo(content: "b", isTop: true, createdAt: .now.addingTimeInterval(-60)),
            Memo(content: "c #home", createdAt: .now.addingTimeInterval(-86_400 * 2)),
            Memo(content: "d", isArchived: true),
        ]
        let all = TimelineQuery.build(memos: memos, filter: .all, day: nil, search: "", limit: 100)
        XCTAssertEqual(all.pinned.map(\.content), ["b"])
        XCTAssertEqual(all.days.flatMap(\.memos).map(\.content), ["a #work/ios", "c #home"])
        XCTAssertEqual(all.days.count, 2)

        let work = TimelineQuery.build(memos: memos, filter: .tag("work"), day: nil, search: "", limit: 100)
        XCTAssertEqual(work.days.flatMap(\.memos).map(\.content), ["a #work/ios"])

        let archive = TimelineQuery.build(memos: memos, filter: .archived, day: nil, search: "", limit: 100)
        XCTAssertEqual(archive.days.flatMap(\.memos).map(\.content), ["d"])
    }

    func testLimitWindowsResults() {
        let memos = (0..<10).map { Memo(content: "\($0)", createdAt: .now.addingTimeInterval(Double(-$0))) }
        let result = TimelineQuery.build(memos: memos, filter: .all, day: nil, search: "", limit: 4)
        XCTAssertEqual(result.shown, 4)
        XCTAssertTrue(result.hasMore)
    }

    func testTodayCombinesDueWrittenAndOnThisDay() {
        let cal = Calendar.current
        let tomorrow = cal.date(byAdding: .day, value: 1, to: .now)!
        let lastWeek = cal.date(byAdding: .day, value: -7, to: .now)!
        let oneYearAgo = cal.date(byAdding: .year, value: -1, to: .now)!
        let threeYearsAgo = cal.date(byAdding: .year, value: -3, to: .now)!
        let memos = [
            Memo(content: "done today", type: NoteType.todo, dueDate: .now, completedAt: .now, createdAt: lastWeek),
            Memo(content: "due today", type: NoteType.todo, dueDate: .now, createdAt: lastWeek),
            Memo(content: "written today", createdAt: .now),
            Memo(content: "last year", createdAt: oneYearAgo),
            Memo(content: "three years", createdAt: threeYearsAgo),
            Memo(content: "due tomorrow", type: NoteType.todo, dueDate: tomorrow, createdAt: lastWeek),
            Memo(content: "last week", createdAt: lastWeek),
            Memo(content: "archived", isArchived: true, createdAt: .now),
        ]
        let today = TimelineQuery.build(memos: memos, filter: .today, day: nil, search: "", limit: 100)
        XCTAssertEqual(today.days.map(\.title), [
            "Due today", "Written today",
            "On this day · \(cal.component(.year, from: oneYearAgo)) · 1 year ago",
            "On this day · \(cal.component(.year, from: threeYearsAgo)) · 3 years ago",
        ])
        XCTAssertEqual(today.days.map { $0.memos.map(\.content) }, [
            ["due today", "done today"], ["written today"], ["last year"], ["three years"],
        ])
    }
}

final class BiometricGateTests: XCTestCase {
    @MainActor
    func testLockDefaultsOff() {
        XCTAssertFalse(BiometricGate.preferenceEnabled(storedValue: nil))
        XCTAssertTrue(BiometricGate.preferenceEnabled(storedValue: true))
    }
}
