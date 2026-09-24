import UIKit
import SwiftUI
import UniformTypeIdentifiers
import BkemoShared

/// Share sheet → bkemo. The capture is written to the App Group inbox and the
/// app uploads it on next launch/foreground, so sharing works offline and the
/// extension never touches the network except for an optional page title.
@objc(ShareViewController)
final class ShareViewController: UIViewController {
    override func viewDidLoad() {
        super.viewDidLoad()
        let model = ShareModel()
        let host = UIHostingController(rootView: ShareView(model: model, onSave: { [weak self] draft in
            self?.save(draft)
        }, onCancel: { [weak self] in
            self?.extensionContext?.completeRequest(returningItems: nil)
        }))
        host.view.backgroundColor = .clear
        addChild(host)
        host.view.frame = view.bounds
        host.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        view.addSubview(host.view)
        host.didMove(toParent: self)

        let items = (extensionContext?.inputItems as? [NSExtensionItem]) ?? []
        Task { @MainActor in await model.load(from: items) }
    }

    private func save(_ draft: ShareDraft) {
        let memo = Memo(
            content: draft.content,
            type: draft.isTodo ? NoteType.todo : NoteType.blinko,
            source: MemoSource.share
        )
        try? Inbox.write(memo)
        extensionContext?.completeRequest(returningItems: nil)
    }
}

struct ShareDraft {
    var content: String
    var isTodo: Bool
}

@MainActor
@Observable
final class ShareModel {
    var text = ""
    var loading = true

    func load(from items: [NSExtensionItem]) async {
        var url: URL?
        var plain: String?
        for item in items {
            for provider in item.attachments ?? [] {
                if url == nil, provider.hasItemConformingToTypeIdentifier(UTType.url.identifier) {
                    url = try? await provider.loadItem(forTypeIdentifier: UTType.url.identifier) as? URL
                }
                if plain == nil, provider.hasItemConformingToTypeIdentifier(UTType.plainText.identifier) {
                    plain = try? await provider.loadItem(forTypeIdentifier: UTType.plainText.identifier) as? String
                }
            }
        }
        if let url {
            text = url.absoluteString
            loading = false
            if let title = await URLMetadata.fetchTitle(url), text == url.absoluteString {
                text = "\(title)\n\n\(url.absoluteString)"
            }
        } else {
            text = plain ?? ""
            loading = false
        }
    }
}

struct ShareView: View {
    @Bindable var model: ShareModel
    let onSave: (ShareDraft) -> Void
    let onCancel: () -> Void

    @State private var isTodo = false
    @FocusState private var focused: Bool

    private var accent: Color {
        let value = BkemoClient.AppearancePreferences.cached().accent
            .trimmingCharacters(in: CharacterSet.alphanumerics.inverted)
        let rgb = UInt64(value, radix: 16) ?? 0xE2A96B
        return Color(red: Double((rgb >> 16) & 0xff) / 255, green: Double((rgb >> 8) & 0xff) / 255, blue: Double(rgb & 0xff) / 255)
    }

    private var trimmed: String { model.text.trimmingCharacters(in: .whitespacesAndNewlines) }

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 14) {
                Picker("Type", selection: $isTodo) {
                    Text("Memo").tag(false)
                    Text("Todo").tag(true)
                }
                .pickerStyle(.segmented)
                .frame(maxWidth: 200)

                ZStack(alignment: .topLeading) {
                    TextEditor(text: $model.text)
                        .font(.system(size: 17, design: .serif))
                        .scrollContentBackground(.hidden)
                        .focused($focused)
                    if model.loading {
                        ProgressView().padding(8)
                    }
                }
                .padding(10)
                .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 14, style: .continuous))

                Text("Saved on this iPhone first — syncs to bk.hax429.me when bkemo is next online.")
                    .font(.system(size: 12))
                    .foregroundStyle(.secondary)
            }
            .padding(18)
            .navigationTitle("Save to bkemo")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel", action: onCancel)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") { onSave(ShareDraft(content: trimmed, isTodo: isTodo)) }
                        .fontWeight(.semibold)
                        .disabled(trimmed.isEmpty)
                }
            }
            .onAppear { focused = true }
        }
        .tint(accent)
        .preferredColorScheme(BkemoClient.AppearancePreferences.cached().theme == "light" ? .light : .dark)
    }
}
