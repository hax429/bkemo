import SwiftUI
import BkemoShared

struct SignInView: View {
    var isReconnect = false

    @Environment(Session.self) private var session
    @Environment(\.dismiss) private var dismiss
    @State private var token = ""
    @State private var working = false
    @State private var error: String?
    @FocusState private var focused: Bool

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                Spacer(minLength: isReconnect ? 24 : 72)
                Kicker("Private · Fast · Yours")
                Text("bkemo")
                    .font(Typo.sans(52, .bold))
                    .foregroundStyle(Theme.fg)
                    .padding(.top, 8)
                Text(isReconnect
                     ? "Paste a fresh access token. Everything you captured offline will sync right after."
                     : "Capture before the thought gets away — online or not.")
                    .font(Typo.sans(17))
                    .foregroundStyle(Theme.fg2)
                    .padding(.top, 6)

                VStack(alignment: .leading, spacing: 10) {
                    Kicker("Access token")
                    HStack(spacing: 8) {
                        SecureField("bk_…", text: $token)
                            .textContentType(.password)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                            .focused($focused)
                            .submitLabel(.go)
                            .onSubmit(connect)
                        Button {
                            if let pasted = UIPasteboard.general.string { token = pasted }
                        } label: {
                            Text("Paste")
                                .font(Typo.sans(13, .semibold))
                        }
                        .buttonStyle(.bordered)
                        .buttonBorderShape(.capsule)
                        .controlSize(.small)
                    }
                    .padding(.horizontal, 14)
                    .frame(height: 52)
                    .card()
                    Text("Create one on bk.hax429.me → Settings → Security & API. It stays in this iPhone's keychain.")
                        .font(Typo.sans(12.5))
                        .foregroundStyle(Theme.fg3)
                }
                .padding(.top, 44)

                if let error {
                    Label(error, systemImage: "exclamationmark.circle")
                        .font(Typo.sans(13))
                        .foregroundStyle(Theme.urgent)
                        .padding(.top, 14)
                }

                Button(action: connect) {
                    HStack(spacing: 8) {
                        if working { ProgressView().tint(.white) }
                        Text(isReconnect ? "Reconnect" : "Connect")
                            .font(Typo.sans(16, .semibold))
                    }
                    .frame(maxWidth: .infinity)
                    .frame(height: 52)
                }
                .buttonStyle(.borderedProminent)
                .buttonBorderShape(.roundedRectangle(radius: 14))
                .disabled(working || token.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                .padding(.top, 22)

                Text(BkemoServer.endpoint.replacingOccurrences(of: "https://", with: ""))
                    .font(Typo.kicker(11))
                    .foregroundStyle(Theme.fg3)
                    .frame(maxWidth: .infinity)
                    .padding(.top, 40)
            }
            .padding(.horizontal, 26)
            .frame(maxWidth: 460)
            .frame(maxWidth: .infinity)
        }
        .scrollDismissesKeyboard(.interactively)
        .background(Theme.bg.ignoresSafeArea())
        .onAppear { focused = true }
    }

    private func connect() {
        guard !working else { return }
        working = true
        error = nil
        Task {
            do {
                try await session.pair(with: token)
                Haptics.success()
                SyncEngine.shared.enterForeground()
                if isReconnect { dismiss() }
            } catch {
                self.error = error.localizedDescription
            }
            working = false
        }
    }
}
