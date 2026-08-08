import SwiftUI
import UIKit

/// UITextView wrapper that exposes cursor position for `#tag` suggestions.
struct CaptureTextEditor: UIViewRepresentable {
    @Binding var text: String
    @Binding var selectedUTF16: Int
    @Binding var isFocused: Bool

    var placeholder: String = ""
    var fontSize: CGFloat = 22
    var onTextChange: ((String) -> Void)?

    private static let textInsets = UIEdgeInsets(top: 8, left: 12, bottom: 12, right: 12)

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    func makeUIView(context: Context) -> UIView {
        let container = UIView()
        container.backgroundColor = .clear

        let view = UITextView()
        view.translatesAutoresizingMaskIntoConstraints = false
        view.delegate = context.coordinator
        view.backgroundColor = .clear
        view.textContainerInset = Self.textInsets
        view.textContainer.lineFragmentPadding = 0
        view.font = BkemoFont.uiKit(fontSize)
        view.keyboardDismissMode = .interactive
        view.autocorrectionType = .yes
        view.autocapitalizationType = .none
        view.smartDashesType = .yes
        view.smartQuotesType = .yes
        view.tintColor = .tintColor
        view.textColor = .label
        view.adjustsFontForContentSizeCategory = false
        view.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)

        let placeholder = UILabel()
        placeholder.translatesAutoresizingMaskIntoConstraints = false
        placeholder.numberOfLines = 0
        placeholder.font = BkemoFont.uiKit(fontSize)
        placeholder.textColor = .placeholderText
        placeholder.isUserInteractionEnabled = false

        container.addSubview(view)
        container.addSubview(placeholder)
        NSLayoutConstraint.activate([
            view.topAnchor.constraint(equalTo: container.topAnchor),
            view.leadingAnchor.constraint(equalTo: container.leadingAnchor),
            view.trailingAnchor.constraint(equalTo: container.trailingAnchor),
            view.bottomAnchor.constraint(equalTo: container.bottomAnchor),

            // Match UITextView's first-line origin (inset + lineFragmentPadding).
            placeholder.topAnchor.constraint(
                equalTo: view.topAnchor,
                constant: Self.textInsets.top
            ),
            placeholder.leadingAnchor.constraint(
                equalTo: view.leadingAnchor,
                constant: Self.textInsets.left
            ),
            placeholder.trailingAnchor.constraint(
                equalTo: view.trailingAnchor,
                constant: -Self.textInsets.right
            ),
        ])

        context.coordinator.textView = view
        context.coordinator.placeholderLabel = placeholder
        return container
    }

    func updateUIView(_ container: UIView, context: Context) {
        context.coordinator.parent = self
        guard let uiView = context.coordinator.textView,
              let placeholderLabel = context.coordinator.placeholderLabel else { return }

        let desiredFont = BkemoFont.uiKit(fontSize)
        if uiView.font != desiredFont {
            uiView.font = desiredFont
            placeholderLabel.font = desiredFont
        }

        placeholderLabel.text = placeholder
        placeholderLabel.isHidden = !text.isEmpty

        let maxLen = (text as NSString).length
        let desiredLocation = min(max(0, selectedUTF16), maxLen)

        if uiView.text != text {
            context.coordinator.isProgrammatic = true
            uiView.text = text
            uiView.selectedRange = NSRange(location: desiredLocation, length: 0)
            context.coordinator.isProgrammatic = false
        } else if uiView.selectedRange.location != desiredLocation || uiView.selectedRange.length != 0 {
            context.coordinator.isProgrammatic = true
            uiView.selectedRange = NSRange(location: desiredLocation, length: 0)
            context.coordinator.isProgrammatic = false
        }

        if isFocused {
            if !uiView.isFirstResponder {
                DispatchQueue.main.async { uiView.becomeFirstResponder() }
            }
        } else if uiView.isFirstResponder {
            DispatchQueue.main.async { uiView.resignFirstResponder() }
        }
    }

    /// Insert `string` at the current selection and move the caret after it.
    static func insert(_ string: String, into text: inout String, at selectedUTF16: inout Int) {
        let ns = text as NSString
        let location = min(max(0, selectedUTF16), ns.length)
        text = ns.replacingCharacters(in: NSRange(location: location, length: 0), with: string)
        selectedUTF16 = location + (string as NSString).length
    }

    /// Replace an existing UTF-16 range and place the caret after the replacement.
    static func replace(
        range: NSRange,
        with string: String,
        into text: inout String,
        selectedUTF16: inout Int
    ) {
        let ns = text as NSString
        let safe = NSRange(
            location: min(range.location, ns.length),
            length: min(range.length, max(0, ns.length - min(range.location, ns.length)))
        )
        text = ns.replacingCharacters(in: safe, with: string)
        selectedUTF16 = safe.location + (string as NSString).length
    }

    final class Coordinator: NSObject, UITextViewDelegate {
        var parent: CaptureTextEditor
        var isProgrammatic = false
        weak var textView: UITextView?
        weak var placeholderLabel: UILabel?

        init(_ parent: CaptureTextEditor) {
            self.parent = parent
        }

        func textViewDidChange(_ textView: UITextView) {
            parent.text = textView.text ?? ""
            parent.selectedUTF16 = textView.selectedRange.location
            placeholderLabel?.isHidden = !(textView.text ?? "").isEmpty
            parent.onTextChange?(parent.text)
        }

        func textViewDidChangeSelection(_ textView: UITextView) {
            guard !isProgrammatic else { return }
            parent.selectedUTF16 = textView.selectedRange.location
        }

        func textViewDidBeginEditing(_ textView: UITextView) {
            if !parent.isFocused { parent.isFocused = true }
        }

        func textViewDidEndEditing(_ textView: UITextView) {
            if parent.isFocused { parent.isFocused = false }
        }
    }
}
