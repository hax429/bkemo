import SwiftUI

struct SignInView: View {
    @State private var username = ""
    @State private var password = ""
    @State private var code = ""
    @State private var loading = false
    @FocusState private var focusedField: Field?
    @ObservedObject var auth = AuthManager.shared

    private enum Field { case username, password, code }

    var body: some View {
        GeometryReader { proxy in
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    Spacer(minLength: max(28, proxy.size.height * 0.1))

                    Text("PRIVATE · FAST · YOURS")
                        .font(.system(size: 11, weight: .medium, design: .monospaced))
                        .tracking(1.2)
                        .foregroundStyle(.secondary)

                    HStack(alignment: .center, spacing: 13) {
                        Image(systemName: "square.and.pencil")
                            .font(.system(size: 31, weight: .medium))
                            .foregroundStyle(.tint)
                        Text("bkemo")
                            .font(.system(size: 40, weight: .bold, design: .rounded))
                    }
                    .padding(.top, 13)

                    Text("Capture before the thought gets away.")
                        .font(.system(size: 16))
                        .foregroundStyle(.secondary)
                        .padding(.top, 7)

                    Text(auth.requires2faUserId == nil ? "SIGN IN" : "TWO-FACTOR AUTHENTICATION")
                        .font(.system(size: 11, weight: .medium, design: .monospaced))
                        .tracking(1)
                        .foregroundStyle(.secondary)
                        .padding(.top, 46)
                        .padding(.bottom, 10)

                    if auth.requires2faUserId != nil {
                        TextField("Verification code", text: $code)
                            .keyboardType(.numberPad)
                            .textContentType(.oneTimeCode)
                            .focused($focusedField, equals: .code)
                            .bkemoField()
                            .autocorrectionDisabled()
                    } else {
                        TextField("Username", text: $username)
                            .textContentType(.username)
                            .focused($focusedField, equals: .username)
                            .bkemoField()
                            .autocorrectionDisabled()
                            .textInputAutocapitalization(.never)
                        SecureField("Password", text: $password)
                            .textContentType(.password)
                            .focused($focusedField, equals: .password)
                            .bkemoField()
                            .padding(.top, 10)
                    }

                    if let error = auth.authError {
                        Label(error, systemImage: "exclamationmark.circle")
                            .font(.caption)
                            .foregroundStyle(.red)
                            .padding(.top, 12)
                    }

                    Button(action: submit) {
                        HStack(spacing: 8) {
                            if loading { ProgressView().controlSize(.small) }
                            Text(auth.requires2faUserId == nil ? "Sign in" : "Verify")
                                .fontWeight(.semibold)
                            Image(systemName: "arrow.right")
                        }
                        .frame(maxWidth: .infinity)
                        .frame(height: 48)
                    }
                    .buttonStyle(.borderedProminent)
                    .buttonBorderShape(.roundedRectangle(radius: 12))
                    .disabled(!canSubmit)
                    .padding(.top, 18)

                    Spacer(minLength: 28)

                    Text("bk.hax429.me")
                        .font(.system(size: 10.5, design: .monospaced))
                        .foregroundStyle(.tertiary)
                        .frame(maxWidth: .infinity)
                }
                .frame(maxWidth: 430)
                .frame(minHeight: proxy.size.height, alignment: .top)
                .padding(.horizontal, 24)
                .frame(maxWidth: .infinity)
            }
            .scrollDismissesKeyboard(.interactively)
            .background(Color(.systemBackground).ignoresSafeArea())
            .onAppear { focusedField = auth.requires2faUserId == nil ? .username : .code }
        }
    }

    private var canSubmit: Bool {
        if loading { return false }
        return auth.requires2faUserId == nil
            ? !username.isEmpty && !password.isEmpty
            : !code.isEmpty
    }

    private func submit() {
        guard canSubmit else { return }
        Task {
            loading = true
            if auth.requires2faUserId == nil {
                await auth.login(username: username, password: password)
            } else {
                await auth.verify2fa(code: code)
            }
            loading = false
        }
    }
}

private extension View {
    func bkemoField() -> some View {
        self
            .textFieldStyle(.plain)
            .font(.system(size: 16))
            .padding(.horizontal, 14)
            .frame(height: 50)
            .background(Color(.secondarySystemBackground))
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .stroke(Color.primary.opacity(0.11), lineWidth: 0.75)
            }
    }
}
