import SwiftUI
import SwiftData
import BkemoShared

struct RootView: View {
    @Environment(\.scenePhase) private var scenePhase
    @ObservedObject var gate = BiometricGate.shared
    @State private var showSettings = false

    var body: some View {
        Group {
            if gate.unlocked {
                NavigationStack {
                    VStack(spacing: 0) {
                        ComposerView()
                        Divider()
                        RecentListView()
                    }
                    .navigationTitle("bkemo")
                    .navigationBarTitleDisplayMode(.inline)
                    .toolbar {
                        ToolbarItem(placement: .topBarTrailing) {
                            Button { showSettings = true } label: { Image(systemName: "gearshape") }
                        }
                    }
                    .sheet(isPresented: $showSettings) { SettingsView() }
                }
            } else {
                VStack(spacing: 16) {
                    Image(systemName: "lock.fill").font(.system(size: 48)).foregroundStyle(.secondary)
                    Text("bkemo locked").font(.title3.bold())
                    Button("Unlock") { gate.authenticate { _ in } }
                        .buttonStyle(.borderedProminent)
                }
            }
        }
        .onAppear {
            if AuthManager.shared.isLoggedIn { gate.authenticate { _ in } }
        }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active {
                Task {
                    await SyncEngine.shared.refreshRecentList(force: false)
                    await SyncEngine.shared.replayPending()
                    await ListStore.shared.reload()
                }
            } else if phase == .background {
                gate.relock()
            }
        }
    }
}