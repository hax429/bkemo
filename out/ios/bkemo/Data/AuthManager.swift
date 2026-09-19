import Foundation
import UIKit
import BkemoShared

@MainActor
final class AuthManager: ObservableObject {
    static let shared = AuthManager()
    @Published var isLoggedIn = false
    @Published var authError: String?
    /// Minimal redirect notice — revoke/dismiss only on Mac or Web.
    @Published var securityAlertMessage: String?

    private(set) var client: BkemoClient

    private init() {
        let token = Keychain.get(AppGroup.tokenKey)
        self.client = BkemoClient(token: token)
        self.isLoggedIn = token != nil
    }

    /// Pairs the app with an access token created in bkemo → Settings →
    /// Security & API. There is no password login on iOS — the token's
    /// scopes (view-only, read & write, full access, …) determine what the
    /// app can do, enforced server-side.
    func pairWithAccessToken(_ token: String) async {
        authError = nil
        let trimmed = token.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            authError = "Paste an access token."
            return
        }
        client.token = trimmed
        do {
            _ = try await client.fetchProfile()
            Keychain.set(trimmed, forKey: AppGroup.tokenKey)
            AppGroup.defaults.removeObject(forKey: AppGroup.noteChangesCursorKey)
            isLoggedIn = true
        } catch APIError.unauthorized {
            client.token = nil
            authError = "That token isn't valid or has been revoked."
        } catch {
            client.token = nil
            authError = error.localizedDescription
        }
    }

    func logout() {
        Keychain.remove(AppGroup.tokenKey)
        AppGroup.defaults.removeObject(forKey: AppGroup.noteChangesCursorKey)
        client.token = nil
        isLoggedIn = false
    }

    func handleUnauthorized() {
        Keychain.remove(AppGroup.tokenKey)
        AppGroup.defaults.removeObject(forKey: AppGroup.noteChangesCursorKey)
        client.token = nil
        isLoggedIn = false
    }
}