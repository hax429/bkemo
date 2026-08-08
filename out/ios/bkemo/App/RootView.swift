import SwiftUI
import SwiftData
import BkemoShared

struct RootView: View {
    @Environment(\.scenePhase) private var scenePhase
    @EnvironmentObject private var appearance: AppearanceStore
    @ObservedObject var gate = BiometricGate.shared
    @ObservedObject private var feedback = CaptureFeedback.shared
    @ObservedObject private var auth = AuthManager.shared
    @Query(filter: #Predicate<LocalMemo> { $0.syncState == "error" })
    private var failedMemos: [LocalMemo]
    @State private var showSettings = false

    var body: some View {
        Group {
            if gate.unlocked {
                NavigationStack {
                    ComposerView()
                        .safeAreaInset(edge: .top, spacing: 0) {
                            VStack(spacing: 6) {
                                if let message = auth.securityAlertMessage {
                                    Button {
                                        auth.securityAlertMessage = nil
                                    } label: {
                                        Label(message, systemImage: "exclamationmark.shield")
                                            .font(.system(size: 12.5, weight: .medium))
                                            .foregroundStyle(.white)
                                            .padding(.horizontal, 12)
                                            .padding(.vertical, 9)
                                            .frame(maxWidth: .infinity, alignment: .leading)
                                            .background(Color.orange.opacity(0.92), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                                    }
                                    .buttonStyle(.plain)
                                    .padding(.horizontal, 16)
                                }
                                if !failedMemos.isEmpty {
                                    NavigationLink {
                                        RecentListView()
                                    } label: {
                                        Label(
                                            "\(failedMemos.count) failed — open Recent to retry",
                                            systemImage: "exclamationmark.triangle.fill"
                                        )
                                        .font(.system(size: 12.5, weight: .medium))
                                        .foregroundStyle(.white)
                                        .padding(.horizontal, 12)
                                        .padding(.vertical, 9)
                                        .frame(maxWidth: .infinity, alignment: .leading)
                                        .background(Color.red.opacity(0.92), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                                    }
                                    .buttonStyle(.plain)
                                    .padding(.horizontal, 16)
                                }
                            }
                            .padding(.bottom, 6)
                        }
                        .overlay {
                            InAppBannerHost()
                        }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background(Color(.systemBackground))
                    .navigationBarTitleDisplayMode(.inline)
                    .toolbar {
                        ToolbarItem(placement: .topBarLeading) {
                            NavigationLink {
                                RecentListView()
                            } label: {
                                ZStack(alignment: .topTrailing) {
                                    Image(systemName: "list.bullet.rectangle")
                                        .font(.system(size: 15, weight: .medium))
                                        .frame(width: 28, height: 28)
                                    if !failedMemos.isEmpty {
                                        Circle()
                                            .fill(Color.red)
                                            .frame(width: 8, height: 8)
                                            .offset(x: 2, y: -1)
                                    }
                                }
                            }
                            .accessibilityLabel("Recent")
                        }
                        ToolbarItem(placement: .principal) {
                            HStack(spacing: 7) {
                                Image(systemName: "square.and.pencil")
                                    .font(.system(size: 14, weight: .semibold))
                                    .foregroundStyle(.tint)
                                Text("bkemo")
                                    .font(BkemoFont.ui(16, weight: .semibold))
                            }
                        }
                        ToolbarItem(placement: .topBarTrailing) {
                            Button { showSettings = true } label: {
                                Image(systemName: "gearshape")
                                    .font(.system(size: 15, weight: .medium))
                            }
                            .accessibilityLabel("Settings")
                        }
                    }
                    .sheet(isPresented: $showSettings) { SettingsView() }
                }
            } else {
                lockScreen
            }
        }
        .onAppear {
            feedback.failedCount = failedMemos.count
            if AuthManager.shared.isLoggedIn {
                gate.authenticate { _ in }
                SyncEngine.shared.startForegroundSync()
            }
        }
        .onChange(of: failedMemos.count) { _, count in
            feedback.failedCount = count
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

    private var lockScreen: some View {
        VStack(spacing: 16) {
            Spacer()
            Image(systemName: "lock.square")
                .font(.system(size: 44, weight: .light))
                .foregroundStyle(.tint)
            Text("bkemo locked")
                .font(.system(size: 22, weight: .semibold, design: .rounded))
            Text("Optional device-local identity verification keeps captures hidden. iOS verifies you; bkemo never receives biometric data.")
                .font(.system(size: 14))
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 12)
            Button("Unlock") { gate.authenticate { _ in } }
                .buttonStyle(.borderedProminent)
                .buttonBorderShape(.roundedRectangle(radius: 12))
                .controlSize(.large)
                .padding(.top, 6)
            Spacer()
        }
        .padding(28)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(.systemBackground))
    }
}
