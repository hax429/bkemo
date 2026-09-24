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

    // MARK: Files (v2 local-first store)

    /// Directory holding the timeline mirror and the outbox.
    public static var dataURL: URL { directory("Data") }
    /// Extensions and intents drop one JSON file per capture here; the app drains it.
    public static var inboxURL: URL { directory("Inbox") }
    /// Authenticated attachment thumbnails.
    public static var imageCacheURL: URL { directory("Images") }

    /// Full mirror of every note the account has (active + archived).
    public static var timelineURL: URL { dataURL.appendingPathComponent("timeline.json") }
    /// First screenful of the timeline, decoded synchronously for the first frame.
    public static var headURL: URL { dataURL.appendingPathComponent("head.json") }
    /// Durable queue of local changes not yet acknowledged by the server.
    public static var outboxURL: URL { dataURL.appendingPathComponent("outbox.json") }

    /// Legacy SwiftData store from the v1 app — drained once, then removed.
    public static var legacyStoreURL: URL {
        containerURL.appendingPathComponent("Memo.store")
    }

    private static func directory(_ name: String) -> URL {
        let url = containerURL.appendingPathComponent(name, isDirectory: true)
        if !FileManager.default.fileExists(atPath: url.path) {
            try? FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        }
        return url
    }

    // MARK: Keys

    public static let tokenKey = "bkemo.token"
    public static let hasSessionKey = "bkemo.v2.hasSession"
    public static let profileNameKey = "bkemo.v2.profileName"
    public static let cursorKey = "bkemo.v2.cursor"
    public static let bootstrappedKey = "bkemo.v2.bootstrapped"
    public static let lastSyncKey = "bkemo.lastSync"
    public static let pendingComposeKey = "bkemo.pendingType"
    public static let lastTypeKey = "bkemo.lastType"
    public static let focusOnLaunchKey = "bkemo.v2.focusOnLaunch"
    public static let biometricKey = "bkemo.biometricEnabled"
    public static let appearanceKey = "bkemo.appearancePreferences"
    public static let recentTagsKey = "bkemo.v2.recentTags"
    public static let legacyMigratedKey = "bkemo.v2.legacyMigrated"

    /// v1 key; cleared on migration so it is never mistaken for a v2 cursor.
    public static let legacyCursorKey = "bkemo.noteChangesCursor"
}
