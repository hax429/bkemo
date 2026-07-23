import Foundation
import LocalAuthentication
import BkemoShared

@MainActor
final class BiometricGate: ObservableObject {
    static let shared = BiometricGate()
    @Published var unlocked = false
    @Published var error: String?

    var enabled: Bool { AppGroup.defaults.object(forKey: AppGroup.biometricKey) == nil || (AppGroup.defaults.object(forKey: AppGroup.biometricKey) as? Bool ?? true) }

    func authenticate(completion: @escaping (Bool) -> Void) {
        guard enabled else { unlocked = true; completion(true); return }
        let ctx = LAContext()
        var err: NSError?
        guard ctx.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &err) else {
            ctx.evaluatePolicy(.deviceOwnerAuthentication, localizedReason: "Unlock bkemo") { ok, e in
                Task { @MainActor in
                    self.unlocked = ok
                    self.error = ok ? nil : e?.localizedDescription
                    completion(ok)
                }
            }
            return
        }
        ctx.evaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, localizedReason: "Unlock bkemo") { ok, e in
            Task { @MainActor in
                self.unlocked = ok
                self.error = ok ? nil : e?.localizedDescription
                completion(ok)
            }
        }
    }

    func relock() { unlocked = false }
    func setEnabled(_ on: Bool) { AppGroup.defaults.set(on, forKey: AppGroup.biometricKey) }
}