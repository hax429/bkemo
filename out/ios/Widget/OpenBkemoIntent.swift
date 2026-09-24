import AppIntents
import BkemoShared

/// Widget button: opens the app with the composer focused on `type`.
/// Compiled into both the widget and the app so the system can open the app.
struct OpenBkemoIntent: AppIntent {
    static let title: LocalizedStringResource = "Open bkemo composer"
    static let openAppWhenRun = true
    static let isDiscoverable = false

    @Parameter(title: "Type") var type: Int

    init() { self.type = NoteType.blinko }
    init(type: Int) { self.type = type }

    func perform() async throws -> some IntentResult {
        AppGroup.defaults.set(type, forKey: AppGroup.pendingComposeKey)
        #if BKEMO_APP
        // Running inside an already-active app: no scene-phase change will pick it up.
        await MainActor.run { Router.shared.consumeWidgetRequest() }
        #endif
        return .result()
    }
}
