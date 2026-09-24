import Foundation
import BkemoShared

enum TimelineFilter: Hashable {
    case all, pinned, todo, today, archived
    case tag(String)

    var title: String {
        switch self {
        case .all: return "Memos"
        case .pinned: return "Pinned"
        case .todo: return "Todos"
        case .today: return "Today"
        case .archived: return "Archive"
        case .tag(let name): return "#\(name)"
        }
    }
}

struct TimelineSections {
    struct Day: Identifiable {
        let day: Date
        let memos: [Memo]
        /// Overrides the date header (Today's "Due today" / "On this day").
        var title: String? = nil
        var id: Date { day }
    }

    var pinned: [Memo] = []
    var days: [Day] = []
    var matched = 0
    var shown = 0

    var isEmpty: Bool { pinned.isEmpty && days.isEmpty }
    var hasMore: Bool { shown < matched }
}

/// Filtering + day grouping, memoized per store revision so typing in the
/// composer or scrolling never re-filters thousands of memos.
@MainActor
final class TimelineQuery {
    private struct Key: Equatable {
        let revision: Int
        let filter: TimelineFilter
        let day: Date?
        let search: String
        let limit: Int
    }

    private var key: Key?
    private var cached = TimelineSections()

    func sections(
        store: MemoStore,
        filter: TimelineFilter,
        day: Date?,
        search: String,
        limit: Int
    ) -> TimelineSections {
        let search = search.trimmingCharacters(in: .whitespacesAndNewlines)
        let key = Key(revision: store.revision, filter: filter, day: day, search: search, limit: limit)
        if key == self.key { return cached }
        cached = Self.build(memos: store.memos, filter: filter, day: day, search: search, limit: limit)
        self.key = key
        return cached
    }

    static func build(
        memos: [Memo],
        filter: TimelineFilter,
        day: Date?,
        search: String,
        limit: Int,
        calendar: Calendar = .current
    ) -> TimelineSections {
        var matches = memos.filter { memo in
            if filter == .archived ? !memo.isArchived : memo.isArchived { return false }
            switch filter {
            case .pinned where !memo.isTop: return false
            case .todo where !memo.isTodo: return false
            case .today:
                guard Self.todayGroup(memo, calendar: calendar) != nil else { return false }
            case .tag(let tag):
                let tags = TagParser.extract(memo.content)
                if !tags.contains(where: { $0 == tag || $0.hasPrefix(tag + "/") }) { return false }
            default: break
            }
            if let day, calendar.startOfDay(for: memo.createdAt) != day { return false }
            if !search.isEmpty, !memo.content.localizedCaseInsensitiveContains(search) { return false }
            return true
        }
        if filter == .today {
            return Self.todaySections(matches, calendar: calendar)
        }
        if filter == .todo {
            // Open todos first, newest first within each group (sort is stable).
            matches = matches.enumerated().sorted { lhs, rhs in
                if lhs.element.isDone != rhs.element.isDone { return !lhs.element.isDone }
                return lhs.offset < rhs.offset
            }.map(\.element)
        }

        var result = TimelineSections()
        result.matched = matches.count
        let hoistPinned = filter == .all && day == nil && search.isEmpty
        if hoistPinned {
            result.pinned = matches.filter(\.isTop)
            matches.removeAll(where: \.isTop)
            result.matched = result.pinned.count + matches.count
        }

        let window = matches.prefix(max(0, limit))
        result.shown = result.pinned.count + window.count
        var days: [TimelineSections.Day] = []
        var bucket: [Memo] = []
        var bucketDay: Date?
        for memo in window {
            let start = calendar.startOfDay(for: memo.createdAt)
            if start != bucketDay, let current = bucketDay {
                days.append(.init(day: current, memos: bucket))
                bucket.removeAll(keepingCapacity: true)
            }
            bucketDay = start
            bucket.append(memo)
        }
        if let bucketDay { days.append(.init(day: bucketDay, memos: bucket)) }
        if filter == .todo, !days.isEmpty {
            // Todo ordering isn't chronological; don't split by day.
            result.days = [.init(day: .distantFuture, memos: Array(window))]
        } else {
            result.days = days
        }
        return result
    }

    private enum TodayGroup { case due, written, onThisDay(year: Int) }

    /// Today mirrors the web: tasks due today, what was written today, and
    /// "on this day" memos from the same month/day in earlier years.
    private static func todayGroup(_ memo: Memo, calendar: Calendar) -> TodayGroup? {
        if let due = memo.dueDate, calendar.isDateInToday(due) { return .due }
        if calendar.isDateInToday(memo.createdAt) { return .written }
        let now = calendar.dateComponents([.year, .month, .day], from: .now)
        let then = calendar.dateComponents([.year, .month, .day], from: memo.createdAt)
        if then.month == now.month, then.day == now.day, let year = then.year, year < (now.year ?? .max) {
            return .onThisDay(year: year)
        }
        return nil
    }

    private static func todaySections(_ memos: [Memo], calendar: Calendar) -> TimelineSections {
        var due: [Memo] = [], written: [Memo] = []
        var byYear: [Int: [Memo]] = [:]
        for memo in memos {
            switch todayGroup(memo, calendar: calendar) {
            case .due: due.append(memo)
            case .written: written.append(memo)
            case .onThisDay(let year): byYear[year, default: []].append(memo)
            case nil: break
            }
        }
        // Open tasks first; the sort is stable, so newest-first holds within each half.
        due = due.enumerated().sorted { lhs, rhs in
            if lhs.element.isDone != rhs.element.isDone { return !lhs.element.isDone }
            return lhs.offset < rhs.offset
        }.map(\.element)

        var result = TimelineSections()
        if !due.isEmpty { result.days.append(.init(day: .distantFuture, memos: due, title: "Due today")) }
        if !written.isEmpty { result.days.append(.init(day: calendar.startOfDay(for: .now), memos: written, title: "Written today")) }
        let thisYear = calendar.component(.year, from: .now)
        for year in byYear.keys.sorted(by: >) {
            let memos = byYear[year]!
            let ago = thisYear - year
            result.days.append(.init(
                day: calendar.startOfDay(for: memos[0].createdAt),
                memos: memos,
                title: "On this day · \(year) · \(ago == 1 ? "1 year ago" : "\(ago) years ago")"
            ))
        }
        result.matched = memos.count
        result.shown = memos.count
        return result
    }
}
