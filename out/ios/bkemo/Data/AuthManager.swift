import Foundation
import UIKit
import BkemoShared

@MainActor
final class AuthManager: ObservableObject {
    static let shared = AuthManager()
    @Published var isLoggedIn = false
    @Published var requires2faUserId: Int?
    @Published var authError: String?
    /// Minimal redirect notice — revoke/dismiss only on Mac or Web.
    @Published var securityAlertMessage: String?

    private(set) var client: BkemoClient

    private init() {
        let token = Keychain.get(AppGroup.tokenKey)
        self.client = BkemoClient(token: token)
        self.isLoggedIn = token != nil
    }

    func login(username: String, password: String) async {
        authError = nil
        do {
            let deviceName = UIDevice.current.name
            let resp = try await client.login(username: username, password: password, deviceName: deviceName)
            if let id = resp.requiresTwoFactor, id, let uid = resp.userId {
                requires2faUserId = uid
                return
            }
            if let token = resp.token {
                Keychain.set(token, forKey: AppGroup.tokenKey)
                client.token = token
                AppGroup.defaults.removeObject(forKey: AppGroup.noteChangesCursorKey)
                isLoggedIn = true
                requires2faUserId = nil
            } else {
                authError = resp.error ?? "Login failed"
            }
        } catch {
            authError = error.localizedDescription
        }
    }

    func verify2fa(code: String) async {
        guard let uid = requires2faUserId else { return }
        authError = nil
        do {
            let deviceName = UIDevice.current.name
            let resp = try await client.verify2fa(userId: uid, code: code, deviceName: deviceName)
            if let token = resp.token {
                Keychain.set(token, forKey: AppGroup.tokenKey)
                client.token = token
                AppGroup.defaults.removeObject(forKey: AppGroup.noteChangesCursorKey)
                isLoggedIn = true
                requires2faUserId = nil
            } else {
                authError = resp.error ?? "Verification failed"
            }
        } catch {
            authError = error.localizedDescription
        }
    }

    func logout() {
        Keychain.remove(AppGroup.tokenKey)
        AppGroup.defaults.removeObject(forKey: AppGroup.noteChangesCursorKey)
        client.token = nil
        isLoggedIn = false
        requires2faUserId = nil
    }

    func handleUnauthorized() {
        Keychain.remove(AppGroup.tokenKey)
        AppGroup.defaults.removeObject(forKey: AppGroup.noteChangesCursorKey)
        client.token = nil
        isLoggedIn = false
    }
}