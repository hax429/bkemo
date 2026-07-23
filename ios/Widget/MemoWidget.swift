import WidgetKit
import SwiftUI
import SwiftData
import BkemoShared

// MARK: Timeline providers

struct MemoProvider: TimelineProvider {
    func placeholder(in context: Context) -> MemoEntry { .placeholder }
    func getSnapshot(in context: Context, completion: @escaping (MemoEntry) -> Void) { completion(.placeholder) }
    func getTimeline(in context: Context, completion: @escaping (Timeline<MemoEntry>) -> Void) {
        let entry = currentEntry()
        completion(Timeline(entries: [entry], policy: .after(.now.addingTimeInterval(900))))
    }
}

struct MemoEntry: TimelineEntry {
    let date: Date
    let lastContent: String
    let lastIsTodo: Bool
}

extension MemoEntry {
    static let placeholder = MemoEntry(date: .now, lastContent: "No captures yet", lastIsTodo: false)
}

// MARK: Views

struct MemoWidgetView: View {
    @Environment(\.widgetFamily) var family
    let entry: MemoProvider.Entry

    var body: some View {
        switch family {
        case .systemSmall:
            VStack(spacing: 10) {
                MemoButton(type: 0, label: "Memo")
                TodoButton(type: 2, label: "Todo")
            }
            .padding(8)
            .containerBackground(.fill.tertiary, for: .widget)
        case .systemMedium:
            HStack(spacing: 12) {
                VStack(spacing: 10) {
                    MemoButton(type: 0, label: "Memo")
                    TodoButton(type: 2, label: "Todo")
                }
                VStack(alignment: .leading, spacing: 4) {
                    Text("Last memo")
                        .font(.caption2).foregroundStyle(.secondary)
                    Text(entry.lastContent)
                        .font(.caption)
                        .lineLimit(2)
                }
                Spacer()
            }
            .padding(10)
            .containerBackground(.fill.tertiary, for: .widget)
        default:
            EmptyView()
        }
    }
}

struct MemoButton: View {
    let type: Int
    let label: String
    var body: some View {
        Button(intent: OpenBkemoIntent(type: type)) {
            Text(label)
                .font(.caption.bold())
                .padding(.vertical, 8)
                .frame(maxWidth: .infinity)
                .background(Color.accentColor.opacity(0.2))
                .foregroundStyle(.primary)
                .cornerRadius(8)
        }
        .buttonStyle(.plain)
    }
}

struct TodoButton: View {
    let type: Int
    let label: String
    var body: some View {
        Button(intent: OpenBkemoIntent(type: type)) {
            HStack(spacing: 4) {
                Image(systemName: "checkmark.circle")
                Text(label)
            }
            .font(.caption.bold())
            .padding(.vertical, 8)
            .frame(maxWidth: .infinity)
            .background(Color.red.opacity(0.2))
            .foregroundStyle(.primary)
            .cornerRadius(8)
        }
        .buttonStyle(.plain)
    }
}

// MARK: Widget registration

struct MemoWidget: Widget {
    let kind = "MemoWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: MemoProvider()) { entry in
            MemoWidgetView(entry: entry)
        }
        .configurationDisplayName("bkemo")
        .description("One-tap memo or todo.")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}



// MARK: Helpers

private func currentEntry() -> MemoEntry {
    let schema = Schema([LocalMemo.self])
    let config = ModelConfiguration("Memo", schema: schema, url: AppGroup.storeURL, cloudKitDatabase: .none)
    guard let container = try? ModelContainer(for: schema, configurations: [config]) else { return .placeholder }
    let context = ModelContext(container)
    let descriptor = FetchDescriptor<LocalMemo>(sortBy: [SortDescriptor(\.createdAt, order: .reverse)])
    guard let memo = try? context.fetch(descriptor).first else { return .placeholder }
    return MemoEntry(date: .now, lastContent: memo.content, lastIsTodo: memo.type == NoteType.todo)
}