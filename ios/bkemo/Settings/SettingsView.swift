import SwiftUI
import BkemoShared

struct SettingsView: View {
    @ObservedObject var gate = BiometricGate.shared
    @EnvironmentObject private var appearance: AppearanceStore
    @State private var biometric = BiometricGate.preferenceEnabled(
        storedValue: AppGroup.defaults.object(forKey: AppGroup.biometricKey)
    )

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    LazyVGrid(columns: Array(repeating: GridItem(.flexible()), count: 5), spacing: 14) {
                        ForEach(AppearanceStore.swatches, id: \.self) { hex in
                            Button {
                                appearance.setAccent(hex)
                            } label: {
                                ZStack {
                                    Circle()
                                        .fill(Color(hex: hex) ?? .accentColor)
                                        .frame(width: 34, height: 34)
                                    if appearance.preferences.accent.caseInsensitiveCompare(hex) == .orderedSame {
                                        Image(systemName: "checkmark")
                                            .font(.system(size: 13, weight: .bold))
                                            .foregroundStyle(.white)
                                            .shadow(color: .black.opacity(0.35), radius: 1)
                                    }
                                }
                                .frame(maxWidth: .infinity)
                            }
                            .buttonStyle(.plain)
                            .accessibilityLabel("Accent \(hex)")
                        }
                    }
                    .padding(.vertical, 6)

                    if let message = appearance.syncError {
                        Label(message, systemImage: "icloud.slash")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    } else {
                        Label("Synced with your bkemo account", systemImage: "checkmark.icloud")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                } header: {
                    Text("Accent color")
                } footer: {
                    Text("Used for actions and selections. Priority colors stay gold and red.")
                }

                Section {
                    Toggle("Biometric lock", isOn: $biometric)
                        .onChange(of: biometric) { _, on in gate.setEnabled(on) }
                } header: {
                    Text("Security")
                } footer: {
                    Text("Optional device-local identity verification. Face ID or Touch ID is handled by iOS; bkemo never receives or stores biometric data.")
                }
				Section {
                    Button("Sign out", role: .destructive) {
                        AuthManager.shared.logout()
                    }
                } header: { Text("Account") }
            }
            .navigationTitle("Settings")
            .navigationBarTitleDisplayMode(.inline)
            .task { await appearance.refresh() }
        }
    }
}