import SwiftUI
import SwiftData
import BkemoShared

struct RootView: View {
    @Environment(\.scenePhase) private var scenePhase
    @EnvironmentObject private var appearance: AppearanceStore
    @ObservedObject var gate = BiometricGate.shared
    @State private var showSettings = false

    var body: some View {
        Group {
            if gate.unlocked {
                NavigationStack {
                    VStack(spacing: 0) {
                        ComposerView()
                        Rectangle()
                            .fill(Color.primary.opacity(0.08))
                            .frame(height: 0.5)
                        RecentListView()
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background(Color(.systemBackground))
                    .navigationBarTitleDisplayMode(.inline)
                    .toolbar {
                        ToolbarItem(placement: .principal) {
                            HStack(spacing: 7) {
                                Image(systemName: "square.and.pencil")
                                    .font(.system(size: 14, weight: .semibold))
                                    .foregroundStyle(.tint)
                                Text("bkemo")
                                    .font(.system(size: 16, weight: .semibold, design: .rounded))
                            }
                        }
                        ToolbarItem(placement: .topBarTrailing) {
                            Button { showSettings = true } label: {
                                Image(systemName: "slider.horizontal.3")
                                    .font(.system(size: 14, weight: .medium))
                            }
                        }
                    }
                    .sheet(isPresented: $showSettings) { SettingsView() }
                }
            } else {
                VStack(spacing: 14) {
                    Spacer()
                    Image(systemName: "lock.square")
                        .font(.system(size: 42, weight: .light))
                        .foregroundStyle(.tint)
                    Text("bkemo locked")
                        .font(.system(size: 20, weight: .semibold, design: .rounded))
                    Text("Optional device-local identity verification keeps captures hidden. iOS verifies you; bkemo never receives biometric data.")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                    Button("Unlock") { gate.authenticate { _ in } }
                        .buttonStyle(.borderedProminent)
                        .buttonBorderShape(.roundedRectangle(radius: 10))
                        .padding(.top, 4)
                    Spacer()
                }
                .padding(24)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(Color(.systemBackground))
            }
        }
        .onAppear {
            if AuthManager.shared.isLoggedIn {
                gate.authenticate { _ in }
                SyncEngine.shared.startForegroundSync()
            }
        }
        .onDisappear {
            SyncEngine.shared.cancelForegroundSync()
        }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active {
                if AuthManager.shared.isLoggedIn {
                    gate.authenticate { _ in }
                }
                SyncEngine.shared.startForegroundSync()
                Task {
                    await appearance.refresh()
                }
            } else if phase == .background {
                SyncEngine.shared.cancelForegroundSync()
                gate.relock()
            }
        }
    }
}