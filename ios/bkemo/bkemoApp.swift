import SwiftUI
import SwiftData
import WidgetKit
import BkemoShared

@MainActor
final class AppearanceStore: ObservableObject {
    static let shared = AppearanceStore()

    static let swatches = [
        "#e2a96b", "#5E6AD2", "#D97757", "#1F8A5B", "#E2497F",
        "#0F62FE", "#A45EE0", "#9C6644", "#0E7490",
    ]

    @Published private(set) var preferences: BkemoClient.AppearancePreferences
    @Published private(set) var syncError: String?

    private init() {
        if let data = AppGroup.defaults.data(forKey: AppGroup.appearanceKey),
           let saved = try? JSONDecoder().decode(BkemoClient.AppearancePreferences.self, from: data) {
            preferences = saved
        } else {
            preferences = .init()
        }
    }

    var accent: Color { Color(hex: preferences.accent) ?? Color(red: 0.89, green: 0.66, blue: 0.42) }
    var colorScheme: ColorScheme { preferences.theme == "light" ? .light : .dark }

    func refresh() async {
        guard AuthManager.shared.isLoggedIn else { return }
        do {
            if let remote = try await AuthManager.shared.client.appearancePreferences() {
                apply(remote)
            } else {
                try await AuthManager.shared.client.updateAppearancePreferences(preferences)
            }
            syncError = nil
        } catch APIError.unauthorized {
            AuthManager.shared.handleUnauthorized()
        } catch {
            syncError = "Using saved appearance"
        }
    }

    func setAccent(_ hex: String) {
        guard Self.swatches.contains(where: { $0.caseInsensitiveCompare(hex) == .orderedSame }) else { return }
        preferences.accent = hex
        persist()
        WidgetCenter.shared.reloadAllTimelines()
        Task {
            do {
                try await AuthManager.shared.client.updateAppearancePreferences(preferences)
                syncError = nil
            } catch APIError.unauthorized {
                AuthManager.shared.handleUnauthorized()
            } catch {
                syncError = "Accent saved on this iPhone; account sync will retry"
            }
        }
    }

    private func apply(_ value: BkemoClient.AppearancePreferences) {
        preferences = value
        persist()
    }

    private func persist() {
        if let data = try? JSONEncoder().encode(preferences) {
            AppGroup.defaults.set(data, forKey: AppGroup.appearanceKey)
        }
    }
}

extension Color {
    init?(hex: String) {
        let value = hex.trimmingCharacters(in: CharacterSet.alphanumerics.inverted)
        guard value.count == 6, let rgb = UInt64(value, radix: 16) else { return nil }
        self.init(
            red: Double((rgb >> 16) & 0xff) / 255,
            green: Double((rgb >> 8) & 0xff) / 255,
            blue: Double(rgb & 0xff) / 255
        )
    }
}

@main
struct bkemoApp: App {
    let container: ModelContainer
    @StateObject private var auth = AuthManager.shared
    @StateObject private var appearance = AppearanceStore.shared

    init() {
        container = ModelContainerSetup.make()
        SyncEngine.shared.configure(container: container)
        _ = SyncMonitor.shared
    }

    var body: some Scene {
        WindowGroup {
            Group {
                if auth.isLoggedIn {
                    RootView()
                } else {
                    SignInView()
                }
            }
            .modelContainer(container)
            .environmentObject(appearance)
            .tint(appearance.accent)
            .preferredColorScheme(appearance.colorScheme)
            .task(id: auth.isLoggedIn) {
                if auth.isLoggedIn { await appearance.refresh() }
            }
        }
    }
}