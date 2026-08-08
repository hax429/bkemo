import SwiftUI
import UIKit

enum BkemoFont {
    /// PostScript names from bundled Outfit static faces.
    private static let regularName = "Outfit-Regular"
    private static let mediumName = "Outfit-Medium"
    private static let semiboldName = "Outfit-SemiBold"

    static func ui(_ size: CGFloat, weight: Font.Weight = .regular) -> Font {
        .custom(postScriptName(for: weight), size: size)
    }

    static func uiKit(_ size: CGFloat, weight: UIFont.Weight = .regular) -> UIFont {
        UIFont(name: postScriptName(for: weight), size: size)
            ?? .systemFont(ofSize: size, weight: weight)
    }

    static func configureAppearance() {
        let title = uiKit(16, weight: .semibold)
        let large = uiKit(28, weight: .semibold)

        let nav = UINavigationBarAppearance()
        nav.configureWithDefaultBackground()
        nav.titleTextAttributes = [.font: title]
        nav.largeTitleTextAttributes = [.font: large]
        UINavigationBar.appearance().standardAppearance = nav
        UINavigationBar.appearance().compactAppearance = nav
        UINavigationBar.appearance().scrollEdgeAppearance = nav
    }

    private static func postScriptName(for weight: Font.Weight) -> String {
        switch weight {
        case .medium: return mediumName
        case .semibold, .bold, .heavy, .black: return semiboldName
        default: return regularName
        }
    }

    private static func postScriptName(for weight: UIFont.Weight) -> String {
        if weight >= .semibold { return semiboldName }
        if weight >= .medium { return mediumName }
        return regularName
    }
}
