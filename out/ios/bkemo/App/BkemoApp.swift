import SwiftUI
import BkemoShared

@main
struct BkemoApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var delegate
    @Environment(\.scenePhase) private var scenePhase

    @State private var store = MemoStore.shared
    @State private var session = Session.shared
    @State private var sync = SyncEngine.shared
    @State private var appearance = Appearance.shared
    @State private var router = Router.shared
    @State private var gate = BiometricGate.shared
    @State private var tags = TagDirectory.shared

    init() {
        Typo.configureNavigationBar()
        Router.shared.consumeWidgetRequest()
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .id(appearance.themeEpoch)
                .environment(store)
                .environment(session)
                .environment(sync)
                .environment(appearance)
                .environment(router)
                .environment(gate)
                .environment(tags)
                .tint(appearance.accent)
                .font(Typo.sans(17))
                .preferredColorScheme(appearance.colorScheme)
                .onOpenURL { router.handle(url: $0) }
        }
        .onChange(of: scenePhase) { old, phase in
            switch phase {
            case .active where old == .background || old == .inactive:
                router.consumeWidgetRequest()
                store.ingestInbox()
                if session.isSignedIn { sync.enterForeground() }
            case .background:
                store.flushToDisk()
                sync.enterBackground()
                gate.relock()
                BackgroundSync.schedule()
            default:
                break
            }
        }
    }
}

struct RootView: View {
    @Environment(Session.self) private var session
    @Environment(MemoStore.self) private var store
    @Environment(SyncEngine.self) private var sync
    @Environment(BiometricGate.self) private var gate
    @Environment(Appearance.self) private var appearance
    @Environment(TagDirectory.self) private var tags

    var body: some View {
        ZStack {
            Theme.bg.ignoresSafeArea()
            if session.isSignedIn {
                TimelineView()
            } else {
                SignInView()
            }
            if gate.locked {
                LockCover().transition(.opacity)
            }
        }
        .task {
            // Everything here waits until the first frame is on screen.
            #if DEBUG
            LaunchMetrics.firstFrame()
            #endif
            await Task.yield()
            await store.loadFull()
            await LegacyMigration.runIfNeeded(into: store)
            store.ingestInbox()
            sync.startMonitoring()
            guard session.isSignedIn else { return }
            sync.enterForeground()
            await tags.refresh()
            await appearance.refresh()
        }
    }
}
