import Foundation

public enum AppGroup {
    public static let identifier = "group.me.hax429.bk"

    public static var containerURL: URL {
        FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: identifier)
            ?? FileManager.default.temporaryDirectory
    }

    public static var defaults: UserDefaults {
        UserDefaults(suiteName: identifier) ?? .standard
    }

    public static var storeURL: URL {
        containerURL.appendingPathComponent("Memo.store")
    }

    public static let tokenKey = "bkemo.token"
    public static let pendingTypeKey = "bkemo.pendingType"
    public static let lastSyncKey = "bkemo.lastSync"
    public static let noteChangesCursorKey = "bkemo.noteChangesCursor"
    public static let lastTypeKey = "bkemo.lastType"
    public static let biometricKey = "bkemo.biometricEnabled"
    public static let voiceHintKey = "bkemo.hasSeenVoiceHint"
    public static let appearanceKey = "bkemo.appearancePreferences"
}