import SwiftUI

struct SignInView: View {
    @State private var username = ""
    @State private var password = ""
    @State private var code = ""
    @State private var loading = false
    @ObservedObject var auth = AuthManager.shared

    var body: some View {
        NavigationStack {
            VStack(spacing: 16) {
                Image(systemName: "square.and.pencil")
                    .font(.system(size: 48))
                    .foregroundColor(.accentColor)
                Text("bkemo").font(.largeTitle.bold())
                Text("Quick capture").font(.caption).foregroundStyle(.secondary)

                if auth.requires2faUserId != nil {
                    VStack(spacing: 12) {
                        TextField("Verification code", text: $code)
                            .keyboardType(.numberPad)
                            .textFieldStyle(.roundedBorder)
                            .autocorrectionDisabled()
                        Button("Verify") { Task { loading = true; await auth.verify2fa(code: code); loading = false } }
                            .buttonStyle(.borderedProminent).disabled(loading || code.isEmpty)
                    }
                    .padding(.horizontal, 24)
                } else {
                    VStack(spacing: 12) {
                        TextField("Username", text: $username)
                            .textFieldStyle(.roundedBorder)
                            .autocorrectionDisabled()
                            .textInputAutocapitalization(.never)
                        SecureField("Password", text: $password)
                            .textFieldStyle(.roundedBorder)
                        Button("Sign in") { Task { loading = true; await auth.login(username: username, password: password); loading = false } }
                            .buttonStyle(.borderedProminent).disabled(loading || username.isEmpty || password.isEmpty)
                    }
                    .padding(.horizontal, 24)
                }
                if let err = auth.authError {
                    Text(err).font(.caption).foregroundStyle(.red).padding(.horizontal, 24)
                }
                Spacer()
            }
            .padding(.top, 60)
            .navigationTitle("Sign in")
        }
    }
}