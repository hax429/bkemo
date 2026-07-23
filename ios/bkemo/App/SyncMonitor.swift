import Foundation
import Network
import SwiftUI
import BkemoShared

@MainActor
final class SyncMonitor: ObservableObject {
    static let shared = SyncMonitor()
    @Published var isOnline = false
    private let monitor = NWPathMonitor()

    init() {
        monitor.pathUpdateHandler = { [weak self] path in
            Task { @MainActor in
                guard let self else { return }
                let online = path.status == .satisfied
                let changed = online != self.isOnline
                self.isOnline = online
                if changed, online {
                    await SyncEngine.shared.replayPending()
                    await SyncEngine.shared.refreshRecentList(force: false)
                    await ListStore.shared.reload()
                }
            }
        }
        monitor.start(queue: .main)
    }
}