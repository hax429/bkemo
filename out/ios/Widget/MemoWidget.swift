import WidgetKit
import SwiftUI
import BkemoShared

private var widgetAccent: Color {
    let hex = BkemoClient.AppearancePreferences.cached().accent
    let value = hex.trimmingCharacters(in: CharacterSet.alphanumerics.inverted)
    let rgb = UInt64(value, radix: 16) ?? 0xE2A96B
    return Color(
        red: Double((rgb >> 16) & 0xff) / 255,
        green: Double((rgb >> 8) & 0xff) / 255,
        blue: Double(rgb & 0xff) / 255
    )
}

struct MemoEntry: TimelineEntry {
    let date: Date
    let recent: [Memo]
    let todayCount: Int

    static let placeholder = MemoEntry(
        date: .now,
        recent: [Memo(content: "A thought worth keeping"), Memo(content: "Buy oat milk", type: NoteType.todo)],
        todayCount: 3
    )
}

struct MemoProvider: TimelineProvider {
    func placeholder(in context: Context) -> MemoEntry { .placeholder }

    func getSnapshot(in context: Context, completion: @escaping (MemoEntry) -> Void) {
        completion(context.isPreview ? .placeholder : current())
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<MemoEntry>) -> Void) {
        let midnight = Calendar.current.startOfDay(for: .now.addingTimeInterval(86_400))
        completion(Timeline(entries: [current()], policy: .after(midnight)))
    }

    private func current() -> MemoEntry {
        let head = TimelineHead.read().sorted { $0.createdAt > $1.createdAt }
        let today = head.filter { Calendar.current.isDateInToday($0.createdAt) }.count
        return MemoEntry(date: .now, recent: Array(head.prefix(3)), todayCount: today)
    }
}

struct MemoWidgetView: View {
    @Environment(\.widgetFamily) private var family
    let entry: MemoEntry

    var body: some View {
        switch family {
        case .systemSmall: small
        case .systemMedium: medium
        case .accessoryCircular: circular
        case .accessoryRectangular: rectangular
        default: small
        }
    }

    private var small: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("bkemo")
                    .font(.system(size: 15, weight: .bold, design: .serif))
                Spacer()
                Text("\(entry.todayCount) today")
                    .font(.system(size: 10, weight: .medium, design: .monospaced))
                    .foregroundStyle(.secondary)
            }
            Spacer(minLength: 0)
            Button(intent: OpenBkemoIntent(type: NoteType.blinko)) {
                captureLabel("Memo", symbol: "square.and.pencil", filled: true)
            }
            .buttonStyle(.plain)
            Button(intent: OpenBkemoIntent(type: NoteType.todo)) {
                captureLabel("Todo", symbol: "checkmark.circle", filled: false)
            }
            .buttonStyle(.plain)
        }
        .containerBackground(for: .widget) { Color(.systemBackground) }
    }

    private var medium: some View {
        HStack(alignment: .top, spacing: 14) {
            VStack(alignment: .leading, spacing: 8) {
                Text("bkemo")
                    .font(.system(size: 16, weight: .bold, design: .serif))
                Spacer(minLength: 0)
                Link(destination: URL(string: "bkemo://compose?type=memo")!) {
                    captureLabel("Memo", symbol: "square.and.pencil", filled: true)
                }
                Link(destination: URL(string: "bkemo://compose?type=todo")!) {
                    captureLabel("Todo", symbol: "checkmark.circle", filled: false)
                }
            }
            .frame(width: 112)
            VStack(alignment: .leading, spacing: 7) {
                Text("RECENT")
                    .font(.system(size: 9.5, weight: .medium, design: .monospaced))
                    .tracking(0.8)
                    .foregroundStyle(.secondary)
                if entry.recent.isEmpty {
                    Text("Nothing captured yet.")
                        .font(.system(size: 13, design: .serif))
                        .foregroundStyle(.secondary)
                }
                ForEach(entry.recent, id: \.localId) { memo in
                    HStack(alignment: .firstTextBaseline, spacing: 6) {
                        Image(systemName: memo.isTodo ? (memo.isDone ? "checkmark.circle.fill" : "circle") : "circle.fill")
                            .font(.system(size: memo.isTodo ? 10 : 4))
                            .foregroundStyle(memo.isTodo ? widgetAccent : Color.secondary)
                        Text(memo.content.replacingOccurrences(of: "\n", with: " "))
                            .font(.system(size: 13, design: .serif))
                            .lineLimit(2)
                    }
                }
                Spacer(minLength: 0)
            }
        }
        .containerBackground(for: .widget) { Color(.systemBackground) }
    }

    private var circular: some View {
        ZStack {
            AccessoryWidgetBackground()
            Image(systemName: "square.and.pencil")
                .font(.system(size: 20, weight: .semibold))
        }
        .widgetURL(URL(string: "bkemo://compose"))
        .containerBackground(for: .widget) { Color.clear }
    }

    private var rectangular: some View {
        VStack(alignment: .leading, spacing: 2) {
            Label("bkemo", systemImage: "square.and.pencil")
                .font(.system(size: 13, weight: .semibold))
            Text(entry.recent.first?.content.replacingOccurrences(of: "\n", with: " ") ?? "Tap to capture")
                .font(.system(size: 12))
                .lineLimit(2)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .widgetURL(URL(string: "bkemo://compose"))
        .containerBackground(for: .widget) { Color.clear }
    }

    private func captureLabel(_ title: String, symbol: String, filled: Bool) -> some View {
        HStack(spacing: 6) {
            Image(systemName: symbol).font(.system(size: 12, weight: .semibold))
            Text(title).font(.system(size: 13, weight: .semibold))
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 10)
        .frame(height: 32)
        .foregroundStyle(filled ? .white : widgetAccent)
        .background(
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .fill(filled ? widgetAccent : widgetAccent.opacity(0.14))
        )
    }
}

@main
struct MemoWidget: Widget {
    let kind = "MemoWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: MemoProvider()) { entry in
            MemoWidgetView(entry: entry)
        }
        .configurationDisplayName("bkemo")
        .description("Capture a memo or todo in one tap.")
        .supportedFamilies([.systemSmall, .systemMedium, .accessoryCircular, .accessoryRectangular])
    }
}
