import UIKit
import SwiftUI
import UniformTypeIdentifiers
import SwiftData
import BkemoShared

@objc(ShareViewController)
final class ShareViewController: UIViewController {
    override func viewDidLoad() {
        super.viewDidLoad()
        Task { @MainActor in
            let content = await collectContent()
            let host = UIHostingController(rootView: ShareView(prefilled: content) { [weak self] in
                self?.saveAndDismiss($0)
            } onCancel: { [weak self] in
                self?.extensionContext?.completeRequest(returningItems: nil)
                self?.dismiss(animated: true)
            })
            host.view.frame = view.bounds
            host.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
            view.backgroundColor = .systemBackground
            addChild(host)
            view.addSubview(host.view)
            host.didMove(toParent: self)
        }
    }

    private func saveAndDismiss(_ draft: ShareDraft) {
        Task { @MainActor in
            let schema = Schema([LocalMemo.self])
            let config = ModelConfiguration("Memo", schema: schema, url: AppGroup.storeURL, cloudKitDatabase: .none)
            guard let container = try? ModelContainer(for: schema, configurations: [config]) else {
                extensionContext?.completeRequest(returningItems: nil); return
            }
            let ctx = ModelContext(container)
            let memo = LocalMemo(content: draft.content, type: draft.type, source: MemoSource.share,
                                 isImportant: draft.isImportant, isUrgent: draft.isUrgent)
            ctx.insert(memo)
            try? ctx.save()
            extensionContext?.completeRequest(returningItems: nil)
            dismiss(animated: true)
        }
    }

    private func collectContent() async -> String {
        var url: URL?
        var text: String?
        for item in (extensionContext?.inputItems as? [NSExtensionItem]) ?? [] {
            for provider in item.attachments ?? [] {
                if url == nil, provider.hasItemConformingToTypeIdentifier(UTType.url.identifier) {
                    url = await withCheckedContinuation { c in
                        provider.loadItem(forTypeIdentifier: UTType.url.identifier) { item, _ in
                            c.resume(returning: item as? URL)
                        }
                    }
                }
                if text == nil, provider.hasItemConformingToTypeIdentifier(UTType.text.identifier) {
                    text = await withCheckedContinuation { c in
                        provider.loadItem(forTypeIdentifier: UTType.text.identifier) { item, _ in
                            c.resume(returning: item as? String)
                        }
                    }
                }
            }
        }
        if let url {
            var body = url.absoluteString
            if let title = await URLMetadata.fetchTitle(url) {
                body = "\(title)\n\n\(url.absoluteString)"
            }
            return body
        }
        return text ?? ""
    }
}