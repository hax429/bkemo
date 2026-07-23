import SwiftUI
import BkemoShared

struct SettingsView: View {
    @ObservedObject var gate = BiometricGate.shared
    @EnvironmentObject private var appearance: AppearanceStore
    @Environment(\.dismiss) private var dismiss
    @State private var biometric = BiometricGate.preferenceEnabled(
        storedValue: AppGroup.defaults.object(forKey: AppGroup.biometricKey)
    )

    var body: some View {
        NavigationStack {
            List {
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
                    .padding(.vertical, 8)

                    Label(
                        appearance.syncError ?? "Synced with your bkemo account",
                        systemImage: appearance.syncError == nil ? "checkmark.icloud" : "icloud.slash"
                    )
                    .font(.caption)
                    .foregroundStyle(.secondary)
                } header: {
                    sectionKicker("Accent")
                } footer: {
                    Text("Used for actions and selections. Priority colors stay gold and red.")
                }

                Section {
                    Toggle("Biometric lock", isOn: $biometric)
                        .onChange(of: biometric) { _, on in gate.setEnabled(on) }
                } header: {
                    sectionKicker("Security")
                } footer: {
                    Text("Optional device-local identity verification. Face ID or Touch ID is handled by iOS; bkemo never receives or stores biometric data.")
                }

                Section {
                    Button(role: .destructive) {
                        AuthManager.shared.logout()
                    } label: {
                        Text("Sign out")
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                } header: {
                    sectionKicker("Account")
                }
            }
            .listStyle(.insetGrouped)
            .navigationTitle("Settings")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { dismiss() }
                        .fontWeight(.semibold)
                }
            }
            .task { await appearance.refresh() }
        }
    }

    private func sectionKicker(_ text: String) -> some View {
        Text(text.uppercased())
            .font(.system(size: 10.5, weight: .medium, design: .monospaced))
            .tracking(0.9)
    }
}
