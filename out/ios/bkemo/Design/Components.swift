import SwiftUI

struct Kicker: View {
    let text: String
    var color: Color = Theme.fg3

    init(_ text: String, color: Color = Theme.fg3) {
        self.text = text
        self.color = color
    }

    var body: some View {
        Text(text.uppercased())
            .font(Typo.kicker())
            .tracking(0.9)
            .foregroundStyle(color)
    }
}

struct Chip: View {
    let label: String
    var systemImage: String?
    var selected = false
    var tint: Color?
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 5) {
                if let systemImage {
                    Image(systemName: systemImage).font(.system(size: 11, weight: .semibold))
                }
                Text(label)
                    .font(Typo.sans(13, selected ? .semibold : .medium))
                    .lineLimit(1)
            }
            .padding(.horizontal, 12)
            .frame(height: 30)
            .foregroundStyle(selected ? (tint ?? Color.accentColor) : Theme.fg2)
            .background {
                Capsule(style: .continuous)
                    .fill(selected ? (tint ?? Color.accentColor).opacity(0.16) : Theme.surface)
            }
            .overlay {
                Capsule(style: .continuous)
                    .strokeBorder(selected ? (tint ?? Color.accentColor).opacity(0.45) : Theme.border, lineWidth: 0.75)
            }
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
    }
}

/// Card surface used by memo rows.
struct CardSurface: ViewModifier {
    var highlighted = false

    func body(content: Content) -> some View {
        content
            .background {
                RoundedRectangle(cornerRadius: Theme.radius, style: .continuous)
                    .fill(Theme.surface)
            }
            .overlay {
                RoundedRectangle(cornerRadius: Theme.radius, style: .continuous)
                    .strokeBorder(highlighted ? Color.accentColor.opacity(0.35) : Theme.border, lineWidth: 0.75)
            }
    }
}

extension View {
    func card(highlighted: Bool = false) -> some View { modifier(CardSurface(highlighted: highlighted)) }

    /// Liquid Glass on iOS 26+, material elsewhere.
    @ViewBuilder
    func floatingSurface(cornerRadius: CGFloat) -> some View {
        if #available(iOS 26.0, *) {
            self.glassEffect(.regular, in: RoundedRectangle(cornerRadius: cornerRadius, style: .continuous))
        } else {
            self
                .background(.regularMaterial, in: RoundedRectangle(cornerRadius: cornerRadius, style: .continuous))
                .overlay {
                    RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                        .strokeBorder(Theme.border, lineWidth: 0.75)
                }
                .shadow(color: .black.opacity(0.18), radius: 18, y: 6)
        }
    }
}

struct PriorityDot: View {
    let color: Color
    var body: some View {
        Circle().fill(color).frame(width: 6, height: 6)
    }
}

enum Haptics {
    static func tap() { UIImpactFeedbackGenerator(style: .light).impactOccurred() }
    static func success() { UINotificationFeedbackGenerator().notificationOccurred(.success) }
    static func select() { UISelectionFeedbackGenerator().selectionChanged() }
}

enum DateText {
    private static let time: DateFormatter = {
        let f = DateFormatter()
        f.dateStyle = .none
        f.timeStyle = .short
        return f
    }()

    private static let dayMonth: DateFormatter = {
        let f = DateFormatter()
        f.setLocalizedDateFormatFromTemplate("EEE MMM d")
        return f
    }()

    private static let dayMonthYear: DateFormatter = {
        let f = DateFormatter()
        f.setLocalizedDateFormatFromTemplate("EEE MMM d yyyy")
        return f
    }()

    private static let full: DateFormatter = {
        let f = DateFormatter()
        f.dateStyle = .medium
        f.timeStyle = .short
        return f
    }()

    static func clock(_ date: Date) -> String { time.string(from: date) }
    static func full(_ date: Date) -> String { full.string(from: date) }

    static func section(_ day: Date, calendar: Calendar = .current) -> String {
        if calendar.isDateInToday(day) { return "Today" }
        if calendar.isDateInYesterday(day) { return "Yesterday" }
        if calendar.isDate(day, equalTo: .now, toGranularity: .year) { return dayMonth.string(from: day) }
        return dayMonthYear.string(from: day)
    }
}
