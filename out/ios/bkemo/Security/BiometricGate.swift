import SwiftUI
import LocalAuthentication
import Observation
import BkemoShared

/// Optional device-local lock. Off by default so launch never waits on Face ID.
@MainActor
@Observable
final class BiometricGate {
    static let shared = BiometricGate()

    private(set) var locked: Bool
    private var authenticating = false

    static func preferenceEnabled(storedValue: Any?) -> Bool {
        storedValue as? Bool ?? false
    }

    var enabled: Bool {
        Self.preferenceEnabled(storedValue: AppGroup.defaults.object(forKey: AppGroup.biometricKey))
    }

    private init() {
        locked = Self.preferenceEnabled(storedValue: AppGroup.defaults.object(forKey: AppGroup.biometricKey))
    }

    func setEnabled(_ on: Bool) {
        AppGroup.defaults.set(on, forKey: AppGroup.biometricKey)
        if !on { locked = false }
    }

    func relock() {
        if enabled { locked = true }
    }

    func unlock() {
        guard locked, !authenticating else { return }
        authenticating = true
        let context = LAContext()
        context.evaluatePolicy(
            .deviceOwnerAuthentication,
            localizedReason: "Unlock bkemo. Face ID stays on this device."
        ) { ok, _ in
            Task { @MainActor in
                self.authenticating = false
                if ok { withAnimation(.easeOut(duration: 0.2)) { self.locked = false } }
            }
        }
    }
}

struct LockCover: View {
    @Environment(BiometricGate.self) private var gate

    var body: some View {
        ZStack {
            Rectangle().fill(.ultraThinMaterial).ignoresSafeArea()
            Theme.bg.opacity(0.6).ignoresSafeArea()
            VStack(spacing: 14) {
                Image(systemName: "lock.fill")
                    .font(.system(size: 30, weight: .light))
                    .foregroundStyle(Color.accentColor)
                Text("bkemo is locked")
                    .font(Typo.sans(22, .semibold))
                    .foregroundStyle(Theme.fg)
                Button("Unlock") { gate.unlock() }
                    .buttonStyle(.borderedProminent)
                    .buttonBorderShape(.capsule)
                    .controlSize(.large)
                    .padding(.top, 4)
            }
        }
        .onAppear { gate.unlock() }
    }
}
