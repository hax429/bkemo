import Foundation

/// Hand-off channel from the share extension, widgets, and intents to the app.
///
/// Every capture is its own atomically written file, so writers in different
/// processes never contend for a shared database. The app drains the directory
/// on launch and whenever it becomes active.
public enum Inbox {
    public static func write(_ memo: Memo) throws {
        let url = AppGroup.inboxURL.appendingPathComponent("\(memo.localId.uuidString).json")
        try MemoCoding.write(memo, to: url)
    }

    public static func pending() -> [(url: URL, memo: Memo)] {
        let urls = (try? FileManager.default.contentsOfDirectory(
            at: AppGroup.inboxURL,
            includingPropertiesForKeys: nil
        )) ?? []
        return urls
            .filter { $0.pathExtension == "json" }
            .compactMap { url in
                guard let memo = MemoCoding.read(Memo.self, from: url) else {
                    // Unreadable file: drop it rather than retry forever.
                    try? FileManager.default.removeItem(at: url)
                    return nil
                }
                return (url, memo)
            }
            .sorted { $0.memo.createdAt < $1.memo.createdAt }
    }

    public static func remove(_ url: URL) {
        try? FileManager.default.removeItem(at: url)
    }
}

/// Read-only view of the first screen of the timeline, for widgets.
public enum TimelineHead {
    public static func read() -> [Memo] {
        MemoCoding.read([Memo].self, from: AppGroup.headURL) ?? []
    }
}
