import SwiftUI

/// Date kicker, totals, and a MoeMemos-style activity heatmap.
struct TimelineHeader: View {
    let stats: TimelineStats
    @Binding var selectedDay: Date?

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 22) {
                stat(stats.memoCount, "Memos")
                stat(stats.tagCount, "Tags")
                stat(stats.dayCount, "Days")
                Spacer(minLength: 0)
            }
            Heatmap(perDay: stats.perDay, selectedDay: $selectedDay)
                .frame(height: 7 * 11 + 6 * 3)
        }
        .padding(.horizontal, 15)
        .padding(.vertical, 14)
        .card()
    }

    private func stat(_ value: Int, _ label: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(value.formatted())
                .font(Typo.sans(22, .semibold))
                .foregroundStyle(Theme.fg)
                .contentTransition(.numericText())
            Kicker(label)
        }
    }
}

struct Heatmap: View {
    let perDay: [Date: Int]
    @Binding var selectedDay: Date?

    private let spacing: CGFloat = 3

    var body: some View {
        GeometryReader { proxy in
            let cell = (proxy.size.height - spacing * 6) / 7
            let weeks = max(1, Int((proxy.size.width + spacing) / (cell + spacing)))
            let days = Self.grid(weeks: weeks)
            HStack(alignment: .top, spacing: spacing) {
                ForEach(0..<weeks, id: \.self) { week in
                    VStack(spacing: spacing) {
                        ForEach(0..<7, id: \.self) { weekday in
                            let day = days[week * 7 + weekday]
                            square(day, size: cell)
                        }
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .trailing)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Activity heatmap")
    }

    @ViewBuilder
    private func square(_ day: Date?, size: CGFloat) -> some View {
        if let day {
            let count = perDay[day] ?? 0
            let selected = selectedDay == day
            RoundedRectangle(cornerRadius: 2.5, style: .continuous)
                .fill(count == 0 ? Theme.surface2 : Color.accentColor.opacity(Self.intensity(count)))
                .overlay {
                    if selected {
                        RoundedRectangle(cornerRadius: 2.5, style: .continuous)
                            .strokeBorder(Theme.fg, lineWidth: 1.2)
                    }
                }
                .frame(width: size, height: size)
                .onTapGesture {
                    guard count > 0 else { return }
                    Haptics.select()
                    selectedDay = selected ? nil : day
                }
        } else {
            Color.clear.frame(width: size, height: size)
        }
    }

    private static func intensity(_ count: Int) -> Double {
        switch count {
        case 1: return 0.32
        case 2...3: return 0.52
        case 4...6: return 0.74
        default: return 1
        }
    }

    /// Column-major days ending with the current week; future days are nil.
    private static func grid(weeks: Int, calendar: Calendar = .current) -> [Date?] {
        let today = calendar.startOfDay(for: .now)
        let weekday = (calendar.component(.weekday, from: today) - calendar.firstWeekday + 7) % 7
        guard let start = calendar.date(byAdding: .day, value: -(weeks - 1) * 7 - weekday, to: today) else { return [] }
        return (0..<(weeks * 7)).map { offset in
            guard let day = calendar.date(byAdding: .day, value: offset, to: start), day <= today else { return nil }
            return day
        }
    }
}
