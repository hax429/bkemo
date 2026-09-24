import SwiftUI
import UIKit

/// Imperative access to the live text view (insert at caret, focus) without
/// round-tripping the caret through SwiftUI state on every keystroke.
@MainActor
final class TextViewHandle {
    fileprivate weak var textView: PlaceholderTextView?

    var cursor: Int { textView?.selectedRange.location ?? 0 }
    var isFirstResponder: Bool { textView?.isFirstResponder ?? false }

    func focus() {
        guard let textView else { return }
        if !textView.isFirstResponder { textView.becomeFirstResponder() }
    }

    func blur() { textView?.resignFirstResponder() }

    /// Keep the caret on screen after the editor changes size.
    func scrollToCaret() {
        guard let textView, let end = textView.selectedTextRange?.end else { return }
        textView.layoutIfNeeded()
        let caret = textView.caretRect(for: end).insetBy(dx: 0, dy: -8)
        textView.scrollRectToVisible(caret, animated: true)
    }

    func insert(_ string: String) {
        guard let textView else { return }
        textView.insertText(string)
    }

    func replace(_ range: NSRange, with string: String) {
        guard let textView,
              let start = textView.position(from: textView.beginningOfDocument, offset: range.location),
              let end = textView.position(from: start, offset: range.length),
              let textRange = textView.textRange(from: start, to: end) else { return }
        textView.replace(textRange, withText: string)
    }

    /// Inserts `prefix` at the start of the caret's line (checklists).
    func prefixCurrentLine(_ prefix: String) {
        guard let textView else { return }
        let ns = textView.text as NSString
        let caret = min(textView.selectedRange.location, ns.length)
        let lineStart = ns.lineRange(for: NSRange(location: caret, length: 0)).location
        let line = ns.substring(with: ns.lineRange(for: NSRange(location: caret, length: 0)))
        if line.hasPrefix(prefix) { return }
        replace(NSRange(location: lineStart, length: 0), with: prefix)
        textView.selectedRange = NSRange(location: caret + (prefix as NSString).length, length: 0)
    }
}

final class PlaceholderTextView: UITextView {
    let placeholderLabel = UILabel()
    /// Focus requested before the view was in a window (cold launch).
    var wantsFocus = false

    override func didMoveToWindow() {
        super.didMoveToWindow()
        if wantsFocus, window != nil, !isFirstResponder {
            becomeFirstResponder()
        }
    }

    override init(frame: CGRect, textContainer: NSTextContainer?) {
        super.init(frame: frame, textContainer: textContainer)
        placeholderLabel.numberOfLines = 1
        placeholderLabel.textColor = .placeholderText
        placeholderLabel.isUserInteractionEnabled = false
        addSubview(placeholderLabel)
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    override var font: UIFont? {
        didSet { placeholderLabel.font = font }
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        let x = textContainerInset.left + textContainer.lineFragmentPadding
        let width = bounds.width - x - textContainerInset.right
        placeholderLabel.frame = CGRect(
            x: x, y: textContainerInset.top,
            width: max(0, width), height: placeholderLabel.font?.lineHeight ?? 20
        )
    }

    func refreshPlaceholder() {
        placeholderLabel.isHidden = !text.isEmpty
    }
}

struct ComposerTextView: UIViewRepresentable {
    @Binding var text: String
    @Binding var isFocused: Bool
    var cursor: Binding<Int>?
    let handle: TextViewHandle
    var placeholder: String
    var font: UIFont
    var minHeight: CGFloat = 24
    var maxHeight: CGFloat = 220
    /// Fill the proposed size instead of hugging content (full-screen editor).
    var fills = false
    var insets = UIEdgeInsets(top: 4, left: 0, bottom: 4, right: 0)
    /// Natural height of the text at the current width, reported as it changes.
    var onContentHeight: ((CGFloat) -> Void)? = nil

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    func makeUIView(context: Context) -> PlaceholderTextView {
        let view = PlaceholderTextView()
        view.delegate = context.coordinator
        view.backgroundColor = .clear
        view.textContainerInset = insets
        view.textContainer.lineFragmentPadding = 0
        view.font = font
        view.textColor = .label
        view.keyboardDismissMode = .interactive
        view.autocapitalizationType = .sentences
        view.isScrollEnabled = fills
        view.alwaysBounceVertical = fills
        view.text = text
        view.placeholderLabel.text = placeholder
        view.refreshPlaceholder()
        view.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        view.setContentHuggingPriority(.defaultLow, for: .horizontal)
        handle.textView = view
        return view
    }

    func updateUIView(_ view: PlaceholderTextView, context: Context) {
        context.coordinator.parent = self
        handle.textView = view
        if view.text != text {
            view.text = text
            view.refreshPlaceholder()
        }
        if view.font != font { view.font = font }
        // Match the keyboard to the page it sits on, not the window default.
        let keyboard: UIKeyboardAppearance = context.environment.colorScheme == .dark ? .dark : .light
        if view.keyboardAppearance != keyboard {
            view.keyboardAppearance = keyboard
            if view.isFirstResponder { view.reloadInputViews() }
        }
        if fills, !view.isScrollEnabled {
            view.isScrollEnabled = true
            view.alwaysBounceVertical = true
        } else if !fills, view.alwaysBounceVertical {
            view.alwaysBounceVertical = false
        }
        if view.placeholderLabel.text != placeholder { view.placeholderLabel.text = placeholder }
        view.wantsFocus = isFocused
        if isFocused, !view.isFirstResponder, view.window != nil {
            DispatchQueue.main.async { view.becomeFirstResponder() }
        } else if !isFocused, view.isFirstResponder {
            DispatchQueue.main.async { view.resignFirstResponder() }
        }
    }

    func sizeThatFits(_ proposal: ProposedViewSize, uiView: PlaceholderTextView, context: Context) -> CGSize? {
        let width = proposal.width ?? uiView.bounds.width
        guard width > 0, width.isFinite else { return nil }
        if fills { return CGSize(width: width, height: proposal.height ?? maxHeight) }
        let fitting = uiView.sizeThatFits(CGSize(width: width, height: .greatestFiniteMagnitude)).height
        context.coordinator.report(fitting)
        let height = min(max(fitting, minHeight), maxHeight)
        let shouldScroll = fitting > maxHeight
        if uiView.isScrollEnabled != shouldScroll {
            DispatchQueue.main.async { uiView.isScrollEnabled = shouldScroll }
        }
        return CGSize(width: width, height: height)
    }

    final class Coordinator: NSObject, UITextViewDelegate {
        var parent: ComposerTextView

        private var reportedHeight: CGFloat = -1

        init(_ parent: ComposerTextView) { self.parent = parent }

        /// Deduped and deferred: sizeThatFits runs mid-layout, where state
        /// writes are not allowed.
        func report(_ height: CGFloat) {
            guard parent.onContentHeight != nil, abs(height - reportedHeight) >= 1 else { return }
            reportedHeight = height
            DispatchQueue.main.async { [weak self] in self?.parent.onContentHeight?(height) }
        }

        func textViewDidChange(_ textView: UITextView) {
            parent.text = textView.text ?? ""
            parent.cursor?.wrappedValue = textView.selectedRange.location
            (textView as? PlaceholderTextView)?.refreshPlaceholder()
            // In fill mode sizeThatFits no longer measures content, so measure here.
            if textView.bounds.width > 0 {
                report(textView.sizeThatFits(CGSize(width: textView.bounds.width, height: .greatestFiniteMagnitude)).height)
            }
        }

        func textViewDidChangeSelection(_ textView: UITextView) {
            guard let cursor = parent.cursor, cursor.wrappedValue != textView.selectedRange.location else { return }
            DispatchQueue.main.async { cursor.wrappedValue = textView.selectedRange.location }
        }

        func textViewDidBeginEditing(_ textView: UITextView) {
            if !parent.isFocused { parent.isFocused = true }
        }

        func textViewDidEndEditing(_ textView: UITextView) {
            if parent.isFocused { parent.isFocused = false }
        }

        /// Continue checklists / bullets on Return, like the web editor.
        func textView(_ textView: UITextView, shouldChangeTextIn range: NSRange, replacementText text: String) -> Bool {
            guard text == "\n" else { return true }
            let ns = textView.text as NSString
            let lineRange = ns.lineRange(for: NSRange(location: range.location, length: 0))
            let line = ns.substring(with: NSRange(location: lineRange.location, length: max(0, range.location - lineRange.location)))
            let continuation: String?
            if line.hasPrefix("- [ ] ") || line.hasPrefix("- [x] ") {
                continuation = line.count > 6 ? "- [ ] " : nil
            } else if line.hasPrefix("- ") {
                continuation = line.count > 2 ? "- " : nil
            } else {
                return true
            }
            if let continuation {
                textView.insertText("\n" + continuation)
            } else {
                // Empty item: end the list instead of continuing it.
                let start = textView.position(from: textView.beginningOfDocument, offset: lineRange.location)
                let end = textView.position(from: textView.beginningOfDocument, offset: range.location)
                if let start, let end, let r = textView.textRange(from: start, to: end) {
                    textView.replace(r, withText: "")
                }
            }
            return false
        }
    }
}
