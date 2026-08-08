import Foundation
import LocalAuthentication
import BkemoShared

@MainActor
final class BiometricGate: ObservableObject {
    static let shared = BiometricGate()
    @Published var unlocked = false
    @Published var error: String?

    static func preferenceEnabled(storedValue: Any?) -> Bool {
        storedValue as? Bool ?? false
    }

    var enabled: Bool {
        Self.preferenceEnabled(storedValue: AppGroup.defaults.object(forKey: AppGroup.biometricKey))
    }

    func authenticate(completion: @escaping (Bool) -> Void) {
        guard enabled else { unlocked = true; completion(true); return }
        let ctx = LAContext()
        var err: NSError?
        guard ctx.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &err) else {
            ctx.evaluatePolicy(
                .deviceOwnerAuthentication,
                localizedReason: "Verify your identity on this device to open bkemo. This optional lock stays on your device."
            ) { ok, e in
                Task { @MainActor in
                    self.unlocked = ok
                    self.error = ok ? nil : e?.localizedDescription
                    completion(ok)
                }
            }
            return
        }
        ctx.evaluatePolicy(
            .deviceOwnerAuthenticationWithBiometrics,
            localizedReason: "Verify your identity on this device to open bkemo. bkemo does not receive biometric data."
        ) { ok, e in
            Task { @MainActor in
                self.unlocked = ok
                self.error = ok ? nil : e?.localizedDescription
                completion(ok)
            }
        }
    }

    func relock() { unlocked = !enabled }
    func setEnabled(_ on: Bool) { AppGroup.defaults.set(on, forKey: AppGroup.biometricKey) }
}