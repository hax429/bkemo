import Foundation
import BkemoShared

@MainActor
final class AuthManager: ObservableObject {
    static let shared = AuthManager()
    @Published var isLoggedIn = false
    @Published var requires2faUserId: Int?
    @Published var authError: String?

    private(set) var client: BkemoClient

    private init() {
        let token = Keychain.get(AppGroup.tokenKey)
        self.client = BkemoClient(token: token)
        self.isLoggedIn = token != nil
    }

    func login(username: String, password: String) async {
        authError = nil
        do {
            let resp = try await client.login(username: username, password: password)
            if let id = resp.requiresTwoFactor, id, let uid = resp.userId {
                requires2faUserId = uid
                return
            }
            if let token = resp.token {
                Keychain.set(token, forKey: AppGroup.tokenKey)
                client.token = token
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
            let resp = try await client.verify2fa(userId: uid, code: code)
            if let token = resp.token {
                Keychain.set(token, forKey: AppGroup.tokenKey)
                client.token = token
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
        client.token = nil
        isLoggedIn = false
        requires2faUserId = nil
    }

    func handleUnauthorized() {
        Keychain.remove(AppGroup.tokenKey)
        client.token = nil
        isLoggedIn = false
    }
}