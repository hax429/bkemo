import SwiftUI
import BkemoShared

struct SettingsView: View {
    @ObservedObject var gate = BiometricGate.shared
    @State private var biometric = AppGroup.defaults.object(forKey: AppGroup.biometricKey) as? Bool ?? true

    var body: some View {
        NavigationStack {
            Form {
                Section("Security") {
                    Toggle("Biometric lock", isOn: $biometric)
                        .onChange(of: biometric) { _, on in gate.setEnabled(on) }
                }
				Section {
                    Button("Sign out", role: .destructive) {
                        AuthManager.shared.logout()
                    }
                } header: { Text("Account") }
            }
            .navigationTitle("Settings")
        }
    }
}