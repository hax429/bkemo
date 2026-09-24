import SwiftUI
import UIKit
import Observation
import WidgetKit
import BkemoShared

/// Palette ported from `app/src/styles/bkemo-theme.css` (dusk / coffee /
/// developer dark presets and the light variant).
enum Preset: String {
    case dusk, coffee, developer

    static func from(accent: String) -> Preset {
        switch accent.lowercased() {
        case "#5e6ad2": return .developer
        case "#e2a96b": return .coffee
        default: return .dusk
        }
    }
}

struct Palette {
    let bg: UIColor
    let surface: UIColor
    let surface2: UIColor
    let fg: UIColor
    let fg2: UIColor
    let fg3: UIColor
    let border: UIColor
    let important: UIColor
    let urgent: UIColor

    static func resolve(_ preset: Preset, dark: Bool) -> Palette {
        guard dark else {
            return Palette(
                bg: .init(hex: 0xF6F5F2), surface: .init(hex: 0xFFFFFF), surface2: .init(hex: 0xEEEDE9),
                fg: .init(hex: 0x1C1D21), fg2: .init(hex: 0x5C616B), fg3: .init(hex: 0x9AA0AA),
                border: UIColor(red: 28 / 255, green: 29 / 255, blue: 33 / 255, alpha: 0.08),
                important: .init(hex: 0xB9820F), urgent: .init(hex: 0xD23036)
            )
        }
        switch preset {
        case .coffee:
            return Palette(
                bg: .init(hex: 0x16130E), surface: .init(hex: 0x1E1A13), surface2: .init(hex: 0x27211A),
                fg: .init(hex: 0xF4EEE2), fg2: .init(hex: 0xB6AA95), fg3: .init(hex: 0x837868),
                border: UIColor(red: 245 / 255, green: 231 / 255, blue: 205 / 255, alpha: 0.08),
                important: .init(hex: 0xE0A83E), urgent: .init(hex: 0xE5484D)
            )
        case .developer:
            return Palette(
                bg: .init(hex: 0x08090A), surface: .init(hex: 0x101113), surface2: .init(hex: 0x1A1B1F),
                fg: .init(hex: 0xF7F8F8), fg2: .init(hex: 0x8A8F98), fg3: .init(hex: 0x62666D),
                border: .init(hex: 0x23252A),
                important: .init(hex: 0xE0A83E), urgent: .init(hex: 0xE5484D)
            )
        case .dusk:
            return Palette(
                bg: .init(hex: 0x14121A), surface: .init(hex: 0x1B1923), surface2: .init(hex: 0x24222F),
                fg: .init(hex: 0xF4EEFF), fg2: .init(hex: 0xA89DBB), fg3: .init(hex: 0x786E8A),
                border: UIColor(red: 244 / 255, green: 238 / 255, blue: 1, alpha: 0.08),
                important: .init(hex: 0xE0A83E), urgent: .init(hex: 0xE5484D)
            )
        }
    }
}

enum Theme {
    /// Set by `Appearance`; dynamic colors read it at trait-resolution time.
    nonisolated(unsafe) static var preset: Preset = .from(accent: BkemoClient.AppearancePreferences.cached().accent)

    private static func dynamic(_ pick: @escaping (Palette) -> UIColor) -> Color {
        Color(uiColor: UIColor { traits in
            pick(Palette.resolve(preset, dark: traits.userInterfaceStyle == .dark))
        })
    }

    static let bg = dynamic(\.bg)
    static let surface = dynamic(\.surface)
    static let surface2 = dynamic(\.surface2)
    static let fg = dynamic(\.fg)
    static let fg2 = dynamic(\.fg2)
    static let fg3 = dynamic(\.fg3)
    static let border = dynamic(\.border)
    static let important = dynamic(\.important)
    static let urgent = dynamic(\.urgent)

    static let radius: CGFloat = 14
}

enum Typo {
    /// SN Pro (SIL OFL, bundled in Fonts/) is the default face. Only the four
    /// bundled weights exist, so every weight maps to the nearest file rather
    /// than relying on synthetic bolding.
    static func snProName(_ weight: Font.Weight) -> String {
        switch weight {
        case .medium: return "SNPro-Medium"
        case .semibold: return "SNPro-Semibold"
        case .bold, .heavy, .black: return "SNPro-Bold"
        default: return "SNPro-Regular"
        }
    }

    static func sans(_ size: CGFloat, _ weight: Font.Weight = .regular, relativeTo style: Font.TextStyle = .body) -> Font {
        .custom(snProName(weight), size: size, relativeTo: style)
    }

    static func sansUIFont(_ size: CGFloat, _ weight: Font.Weight = .regular) -> UIFont {
        UIFont(name: snProName(weight), size: size) ?? .systemFont(ofSize: size, weight: weight.uiWeight)
    }

    static func kicker(_ size: CGFloat = 10.5) -> Font {
        .system(size: size, weight: .medium, design: .monospaced)
    }

    static func memo(serif: Bool, size: CGFloat = 16, weight: Font.Weight = .regular) -> Font {
        serif ? .system(size: size, weight: weight, design: .serif) : sans(size, weight)
    }

    static func memoUIFont(serif: Bool, size: CGFloat) -> UIFont {
        guard serif else { return sansUIFont(size) }
        let base = UIFont.systemFont(ofSize: size)
        guard let descriptor = base.fontDescriptor.withDesign(.serif) else { return base }
        return UIFont(descriptor: descriptor, size: size)
    }

    static func configureNavigationBar() {
        let appearance = UINavigationBar.appearance()
        appearance.largeTitleTextAttributes = [.font: sansUIFont(32, .bold)]
        appearance.titleTextAttributes = [.font: sansUIFont(16, .semibold)]
    }
}

private extension Font.Weight {
    var uiWeight: UIFont.Weight {
        switch self {
        case .ultraLight: return .ultraLight
        case .thin: return .thin
        case .light: return .light
        case .medium: return .medium
        case .semibold: return .semibold
        case .bold: return .bold
        case .heavy: return .heavy
        case .black: return .black
        default: return .regular
        }
    }
}

/// Account-synced accent + theme, plus device-local display preferences.
@MainActor
@Observable
final class Appearance {
    static let shared = Appearance()

    static let swatches = [
        "#e2a96b", "#5E6AD2", "#D97757", "#1F8A5B", "#E2497F",
        "#0F62FE", "#A45EE0", "#9C6644", "#0E7490",
    ]

    private(set) var preferences: BkemoClient.AppearancePreferences
    /// Bumped when the dark palette preset changes; the root view is keyed on it
    /// so static dynamic colors re-resolve. Deferred until Settings closes.
    private(set) var themeEpoch = 0
    @ObservationIgnored private var appliedPreset: Preset
    var followSystem: Bool {
        didSet { AppGroup.defaults.set(followSystem, forKey: Self.followSystemKey) }
    }
    var serifMemos: Bool {
        didSet { AppGroup.defaults.set(serifMemos, forKey: Self.serifKey) }
    }

    private static let followSystemKey = "bkemo.v2.followSystem"
    private static let serifKey = "bkemo.v2.serifMemos"

    private init() {
        let cached = BkemoClient.AppearancePreferences.cached()
        let preset = Preset.from(accent: cached.accent)
        preferences = cached
        appliedPreset = preset
        followSystem = AppGroup.defaults.bool(forKey: Self.followSystemKey)
        serifMemos = AppGroup.defaults.object(forKey: Self.serifKey) as? Bool ?? false
        Theme.preset = preset
    }

    func commitPreset() {
        guard preset != appliedPreset else { return }
        appliedPreset = preset
        themeEpoch += 1
    }

    /// Account accent; deepened in light mode so tags and links stay readable on white.
    var accent: Color {
        let value = preferences.accent.trimmingCharacters(in: CharacterSet.alphanumerics.inverted)
        let base = UIColor(hex: UInt32(value, radix: 16) ?? 0xE2A96B)
        return Color(uiColor: UIColor { traits in
            guard traits.userInterfaceStyle == .light else { return base }
            var h: CGFloat = 0, s: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
            base.getHue(&h, saturation: &s, brightness: &b, alpha: &a)
            return UIColor(hue: h, saturation: min(1, s * 1.1), brightness: b * 0.72, alpha: a)
        })
    }
    var preset: Preset { .from(accent: preferences.accent) }
    var colorScheme: ColorScheme? {
        if followSystem { return nil }
        return preferences.theme == "light" ? .light : .dark
    }

    func refresh() async {
        guard Session.shared.canSync else { return }
        guard let remote = try? await Session.shared.client.appearancePreferences() else { return }
        apply(remote)
        commitPreset()
    }

    func setAccent(_ hex: String) {
        var next = preferences
        next.accent = hex
        apply(next)
        push()
    }

    func setDark(_ dark: Bool) {
        var next = preferences
        next.theme = dark ? "dark" : "light"
        apply(next)
        push()
    }

    private func apply(_ value: BkemoClient.AppearancePreferences) {
        guard value != preferences else { return }
        preferences = value
        Theme.preset = .from(accent: value.accent)
        if let data = try? JSONEncoder().encode(value) {
            AppGroup.defaults.set(data, forKey: AppGroup.appearanceKey)
        }
        WidgetCenter.shared.reloadAllTimelines()
    }

    private func push() {
        guard Session.shared.canSync else { return }
        let value = preferences
        Task { try? await Session.shared.client.updateAppearancePreferences(value) }
    }
}

extension UIColor {
    convenience init(hex: UInt32, alpha: CGFloat = 1) {
        self.init(
            red: CGFloat((hex >> 16) & 0xff) / 255,
            green: CGFloat((hex >> 8) & 0xff) / 255,
            blue: CGFloat(hex & 0xff) / 255,
            alpha: alpha
        )
    }
}

extension Color {
    init?(hex: String) {
        let value = hex.trimmingCharacters(in: CharacterSet.alphanumerics.inverted)
        guard value.count == 6, let rgb = UInt32(value, radix: 16) else { return nil }
        self.init(uiColor: UIColor(hex: rgb))
    }
}
