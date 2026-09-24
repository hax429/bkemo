import UIKit
import BackgroundTasks
import BkemoShared

final class AppDelegate: NSObject, UIApplicationDelegate {
    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        BackgroundSync.register()
        return true
    }

    func application(
        _ application: UIApplication,
        configurationForConnecting connectingSceneSession: UISceneSession,
        options: UIScene.ConnectionOptions
    ) -> UISceneConfiguration {
        if let item = options.shortcutItem {
            MainActor.assumeIsolated { Router.shared.handle(shortcut: item) }
        }
        let config = UISceneConfiguration(name: nil, sessionRole: connectingSceneSession.role)
        config.delegateClass = SceneDelegate.self
        return config
    }
}

final class SceneDelegate: NSObject, UIWindowSceneDelegate {
    func windowScene(
        _ windowScene: UIWindowScene,
        performActionFor shortcutItem: UIApplicationShortcutItem,
        completionHandler: @escaping (Bool) -> Void
    ) {
        MainActor.assumeIsolated { Router.shared.handle(shortcut: shortcutItem) }
        completionHandler(true)
    }
}

/// Periodic flush + pull while the app is in the background, so captures made
/// offline land on the server even if the app isn't reopened.
enum BackgroundSync {
    static let identifier = "me.hax429.bk.sync"

    static func register() {
        BGTaskScheduler.shared.register(forTaskWithIdentifier: identifier, using: nil) { task in
            guard let task = task as? BGAppRefreshTask else { return }
            handle(task)
        }
    }

    static func schedule() {
        let request = BGAppRefreshTaskRequest(identifier: identifier)
        request.earliestBeginDate = Date(timeIntervalSinceNow: 15 * 60)
        try? BGTaskScheduler.shared.submit(request)
    }

    private static func handle(_ task: BGAppRefreshTask) {
        schedule()
        let work = Task { @MainActor in
            guard Session.shared.canSync else {
                task.setTaskCompleted(success: true)
                return
            }
            await SyncEngine.shared.sync()
            MemoStore.shared.flushToDisk()
            task.setTaskCompleted(success: MemoStore.shared.outbox.waitingCount == 0)
        }
        task.expirationHandler = { work.cancel() }
    }
}
