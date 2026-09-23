import SwiftUI

struct CaptureView: View {
    @ObservedObject var model: CaptureViewModel
    var onRequestHide: () -> Void
    @FocusState private var isFocused: Bool

    static let width: CGFloat = 600

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Spacer()
                Button(action: onRequestHide) {
                    Image(systemName: "xmark")
                        .font(.system(size: 11, weight: .semibold))
                }
                .buttonStyle(.plain)
                .foregroundStyle(.secondary)
            }

            TextEditor(text: $model.text)
                .font(.system(size: 14))
                .scrollContentBackground(.hidden)
                .scrollDisabled(true)
                .fixedSize(horizontal: false, vertical: true)
                .focused($isFocused)

            // Live preview of just bold/italic/lists/todo/H1 — always
            // visible while there's something to show, not a manual toggle.
            if !model.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                Divider().opacity(0.15)
                MarkdownPreview(markdown: model.text)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .fixedSize(horizontal: false, vertical: true)
            }

            HStack(spacing: 10) {
                if let status = model.statusMessage {
                    Text(status)
                        .font(.caption)
                        .foregroundStyle(.red)
                        .lineLimit(1)
                }
                Spacer()
                Text("\u{2318}\u{21A9} to save")
                    .font(.system(size: 11, design: .monospaced))
                    .foregroundStyle(.tertiary)
            }

            Button(action: submit) { EmptyView() }
                .keyboardShortcut(.return, modifiers: .command)
                .hidden()
        }
        .padding(14)
        .frame(width: Self.width)
        .fixedSize(horizontal: false, vertical: true)
        .captureGlass()
        .onExitCommand(perform: onRequestHide)
        .onChange(of: model.focusToken) { _, _ in isFocused = true }
        .onAppear { isFocused = true }
    }

    private func submit() {
        onRequestHide()
        model.save()
    }
}
