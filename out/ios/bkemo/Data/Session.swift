import Foundation
import Observation
import BkemoShared

/// Account pairing. The signed-in flag lives in UserDefaults so the first
/// frame never touches the keychain; the token is read lazily on first sync.
@MainActor
@Observable
final class Session {
    static let shared = Session()

    private(set) var isSignedIn: Bool
    /// Token was rejected. Local data and the outbox are kept until re-pairing.
    var needsReauth = false
    var securityAlert: String?
    private(set) var profileName: String?

    /// Debug demo session: signed in, never touches the network.
    @ObservationIgnored private(set) var isDemo = false
    @ObservationIgnored private var token: String?
    @ObservationIgnored private var tokenLoaded = false

    private init() {
        let defaults = AppGroup.defaults
        #if DEBUG
        if DemoMode.isOn {
            isSignedIn = true
            isDemo = true
            profileName = "Demo"
            return
        }
        #endif
        if let flag = defaults.object(forKey: AppGroup.hasSessionKey) as? Bool {
            isSignedIn = flag
        } else {
            // First launch after the v1 → v2 upgrade: one keychain read to carry the pairing over.
            let legacy = Keychain.get(AppGroup.tokenKey)
            token = legacy
            tokenLoaded = true
            isSignedIn = legacy != nil
            defaults.set(isSignedIn, forKey: AppGroup.hasSessionKey)
        }
        profileName = defaults.string(forKey: AppGroup.profileNameKey)
    }

    var client: BkemoClient {
        if !tokenLoaded {
            token = Keychain.get(AppGroup.tokenKey)
            tokenLoaded = true
        }
        return BkemoClient(token: token)
    }

    var canSync: Bool { isSignedIn && !needsReauth && !isDemo }

    func pair(with rawToken: String) async throws {
        let trimmed = rawToken.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { throw PairingError.empty }
        let profile: BkemoClient.ProfileResponse
        do {
            profile = try await BkemoClient(token: trimmed).fetchProfile()
        } catch APIError.unauthorized {
            throw PairingError.rejected
        }
        Keychain.set(trimmed, forKey: AppGroup.tokenKey)
        token = trimmed
        tokenLoaded = true
        let name = profile.user.nickname?.nonEmpty ?? profile.user.name
        profileName = name
        AppGroup.defaults.set(name, forKey: AppGroup.profileNameKey)
        AppGroup.defaults.set(true, forKey: AppGroup.hasSessionKey)
        needsReauth = false
        isSignedIn = true
    }

    func handleUnauthorized() {
        guard isSignedIn else { return }
        needsReauth = true
    }

    func signOut() {
        Keychain.remove(AppGroup.tokenKey)
        token = nil
        tokenLoaded = true
        let defaults = AppGroup.defaults
        for key in [AppGroup.cursorKey, AppGroup.bootstrappedKey, AppGroup.profileNameKey, AppGroup.lastSyncKey] {
            defaults.removeObject(forKey: key)
        }
        defaults.set(false, forKey: AppGroup.hasSessionKey)
        profileName = nil
        needsReauth = false
        isSignedIn = false
    }

    enum PairingError: LocalizedError {
        case empty, rejected

        var errorDescription: String? {
            switch self {
            case .empty: return "Paste an access token."
            case .rejected: return "That token isn't valid or has been revoked."
            }
        }
    }
}

extension String {
    var nonEmpty: String? { isEmpty ? nil : self }
}
