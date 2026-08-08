import AppIntents
import BkemoShared

struct OpenBkemoIntent: AppIntent {
    static var title: LocalizedStringResource = "Open bkemo"
    static var openAppWhenRun: Bool = true

    @Parameter(title: "Type") var type: Int

    init() { self.type = 0 }
    init(type: Int) { self.type = type }

    func perform() async throws -> some IntentResult {
        AppGroup.defaults.set(type, forKey: AppGroup.pendingTypeKey)
        return .result()
    }
}