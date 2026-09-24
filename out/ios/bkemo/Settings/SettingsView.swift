import SwiftUI
import BkemoShared

struct SettingsView: View {
    @Environment(Session.self) private var session
    @Environment(SyncEngine.self) private var sync
    @Environment(MemoStore.self) private var store
    @Environment(Appearance.self) private var appearance
    @Environment(BiometricGate.self) private var gate
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL

    @State private var focusOnLaunch = AppGroup.defaults.object(forKey: AppGroup.focusOnLaunchKey) as? Bool ?? true
    @State private var lockEnabled = BiometricGate.shared.enabled
    @State private var confirmSignOut = false

    var body: some View {
        @Bindable var appearance = appearance
        NavigationStack {
            Form {
                accountSection
                syncSection
                Section {
                    LazyVGrid(columns: Array(repeating: GridItem(.flexible()), count: 9), spacing: 8) {
                        ForEach(Appearance.swatches, id: \.self) { hex in
                            let selected = appearance.preferences.accent.caseInsensitiveCompare(hex) == .orderedSame
                            Button {
                                Haptics.select()
                                appearance.setAccent(hex)
                            } label: {
                                Circle()
                                    .fill(Color(hex: hex) ?? .accentColor)
                                    .frame(width: 26, height: 26)
                                    .overlay {
                                        if selected {
                                            Circle().strokeBorder(Theme.fg, lineWidth: 2).padding(-4)
                                        }
                                    }
                            }
                            .buttonStyle(.plain)
                            .accessibilityLabel("Accent \(hex)")
                            .accessibilityAddTraits(selected ? .isSelected : [])
                        }
                    }
                    .padding(.vertical, 6)
                    Toggle("Match system appearance", isOn: $appearance.followSystem)
                    if !appearance.followSystem {
                        Picker("Theme", selection: Binding(
                            get: { appearance.preferences.theme == "light" ? "light" : "dark" },
                            set: { appearance.setDark($0 == "dark") }
                        )) {
                            Text("Dark").tag("dark")
                            Text("Light").tag("light")
                        }
                        .pickerStyle(.segmented)
                    }
                    Toggle("Serif memo text", isOn: $appearance.serifMemos)
                } header: {
                    Kicker("Appearance")
                } footer: {
                    Text("Accent and theme follow your bkemo account on every device.")
                }
                .listRowBackground(Theme.surface)

                Section {
                    Toggle("Keyboard ready on launch", isOn: $focusOnLaunch)
                        .onChange(of: focusOnLaunch) { _, on in
                            AppGroup.defaults.set(on, forKey: AppGroup.focusOnLaunchKey)
                        }
                    Toggle("Face ID lock", isOn: $lockEnabled)
                        .onChange(of: lockEnabled) { _, on in gate.setEnabled(on) }
                } header: {
                    Kicker("Capture & privacy")
                } footer: {
                    Text("Widgets, the share sheet, and Siri (“Capture in bkemo”) save offline too.")
                }
                .listRowBackground(Theme.surface)

                Section {
                    Button("Sign out", role: .destructive) { confirmSignOut = true }
                } footer: {
                    Text(versionText)
                        .frame(maxWidth: .infinity)
                        .padding(.top, 12)
                }
                .listRowBackground(Theme.surface)
            }
            .scrollContentBackground(.hidden)
            .background(Theme.bg.ignoresSafeArea())
            .navigationTitle("Settings")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }.fontWeight(.semibold)
                }
            }
            .onDisappear { appearance.commitPreset() }
            .preferredColorScheme(appearance.colorScheme)
            .confirmationDialog(signOutTitle, isPresented: $confirmSignOut, titleVisibility: .visible) {
                Button("Sign out and erase this iPhone's copy", role: .destructive) {
                    SyncEngine.shared.reset()
                    store.wipe()
                    session.signOut()
                    dismiss()
                }
            }
        }
    }

    private var accountSection: some View {
        Section {
            HStack(spacing: 12) {
                Text(String((session.profileName ?? "b").prefix(1)).uppercased())
                    .font(Typo.sans(17, .semibold))
                    .foregroundStyle(.white)
                    .frame(width: 40, height: 40)
                    .background(Circle().fill(Color.accentColor))
                VStack(alignment: .leading, spacing: 2) {
                    Text(session.profileName ?? "bkemo")
                        .font(Typo.sans(16, .semibold))
                    Text("bk.hax429.me")
                        .font(Typo.kicker(11))
                        .foregroundStyle(Theme.fg3)
                }
            }
            .padding(.vertical, 2)
            Button {
                if let url = URL(string: BkemoServer.endpoint) { openURL(url) }
            } label: {
                Label("Open bkemo on the web", systemImage: "safari")
            }
        } header: {
            Kicker("Account")
        }
        .listRowBackground(Theme.surface)
    }

    private var syncSection: some View {
        Section {
            LabeledContent("Status") {
                Text(statusText).foregroundStyle(Theme.fg2)
            }
            LabeledContent("Memos on this iPhone") {
                Text(store.memos.count.formatted()).foregroundStyle(Theme.fg2)
            }
            if store.outbox.waitingCount > 0 {
                LabeledContent("Waiting to upload") {
                    Text("\(store.outbox.waitingCount)").foregroundStyle(Theme.fg2)
                }
            }
            ForEach(store.outbox.ops.filter(\.failed)) { op in
                VStack(alignment: .leading, spacing: 6) {
                    Text(op.memo.content)
                        .font(Typo.sans(14))
                        .lineLimit(2)
                    Text(op.lastError ?? "Rejected")
                        .font(Typo.sans(12))
                        .foregroundStyle(Theme.urgent)
                    HStack {
                        Button("Retry") {
                            store.retryFailed()
                            sync.kick()
                        }
                        Spacer()
                        Button("Discard change", role: .destructive) { store.discard(op) }
                    }
                    .buttonStyle(.borderless)
                    .font(Typo.sans(13, .semibold))
                }
                .padding(.vertical, 4)
            }
            Button {
                Task { await sync.sync() }
            } label: {
                HStack {
                    Text("Sync now")
                    Spacer()
                    if sync.isSyncing { ProgressView() }
                }
            }
            .disabled(!session.canSync)
        } header: {
            Kicker("Sync")
        }
        .listRowBackground(Theme.surface)
    }

    private var statusText: String {
        if session.needsReauth { return "Needs reconnect" }
        if !sync.isOnline { return "Offline — saving locally" }
        if let error = sync.lastError, !store.outbox.isEmpty { return error }
        if let last = sync.lastSyncedAt {
            return "Synced \(last.formatted(.relative(presentation: .named)))"
        }
        return "Not synced yet"
    }

    private var signOutTitle: String {
        let waiting = store.outbox.ops.count
        return waiting > 0
            ? "\(waiting) change\(waiting == 1 ? " hasn't" : "s haven't") synced yet and will be lost."
            : "Sign out of bkemo on this iPhone?"
    }

    private var versionText: String {
        let info = Bundle.main.infoDictionary
        let version = info?["CFBundleShortVersionString"] as? String ?? "–"
        let build = info?["CFBundleVersion"] as? String ?? "–"
        return "bkemo \(version) (\(build))"
    }
}
