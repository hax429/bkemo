import SwiftUI
import SwiftData
import BkemoShared

@main
struct bkemoApp: App {
    let container: ModelContainer

    init() {
        container = ModelContainerSetup.make()
        _ = SyncMonitor.shared
        _ = SyncEngine.shared
    }

    var body: some Scene {
        WindowGroup {
            Group {
                if AuthManager.shared.isLoggedIn {
                    RootView()
                } else {
                    SignInView()
                }
            }
            .modelContainer(container)
            .tint(.accentColor)
        }
    }
}