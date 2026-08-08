import SwiftUI
import UIKit

/// Plain blue tappable URLs. Tap → Live / Archive dialog → system browser.
struct MemoLinkText: View {
    let text: String
    @State private var pendingURL: URL?
    @State private var showChooser = false

    var body: some View {
        Text(attributed)
            .textSelection(.enabled)
            .environment(\.openURL, OpenURLAction { url in
                pendingURL = url
                showChooser = true
                return .handled
            })
            .confirmationDialog("Open link", isPresented: $showChooser, titleVisibility: .visible) {
                Button("Live") {
                    if let pendingURL {
                        UIApplication.shared.open(pendingURL)
                    }
                }
                Button("Archive") {
                    if let pendingURL, let archive = archiveLookupURL(for: pendingURL) {
                        UIApplication.shared.open(archive)
                    }
                }
                Button("Cancel", role: .cancel) {}
            } message: {
                Text(pendingURL?.absoluteString ?? "")
            }
    }

    private var attributed: AttributedString {
        var result = AttributedString(text)
        guard let detector = try? NSDataDetector(types: NSTextCheckingResult.CheckingType.link.rawValue) else {
            return result
        }
        let ns = text as NSString
        let matches = detector.matches(in: text, options: [], range: NSRange(location: 0, length: ns.length))
        for match in matches {
            guard let range = Range(match.range, in: text),
                  let url = match.url else { continue }
            if let attrRange = Range(range, in: result) {
                result[attrRange].link = url
                result[attrRange].foregroundColor = .accentColor
            }
        }
        return result
    }

    private func archiveLookupURL(for url: URL) -> URL? {
        let encoded = url.absoluteString.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? url.absoluteString
        return URL(string: "https://web.archive.org/web/*/\(encoded)")
    }
}
