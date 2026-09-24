import AppIntents
import BkemoShared

/// Siri / Shortcuts / Action button capture. Runs without opening the app and
/// saves locally first, so it works with no connection.
struct CaptureMemoIntent: AppIntent {
    static let title: LocalizedStringResource = "Capture in bkemo"
    static let description = IntentDescription("Save a memo or todo to bkemo. Works offline; it syncs when you're back online.")
    static let openAppWhenRun = false

    @Parameter(title: "Text", inputOptions: String.IntentInputOptions(multiline: true))
    var text: String

    @Parameter(title: "Save as todo", default: false)
    var asTodo: Bool

    static var parameterSummary: some ParameterSummary {
        Summary("Capture \(\.$text) in bkemo") {
            \.$asTodo
        }
    }

    @MainActor
    func perform() async throws -> some IntentResult & ProvidesDialog {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return .result(dialog: "Nothing to save.") }
        let memo = Memo(content: trimmed, type: asTodo ? NoteType.todo : NoteType.blinko, source: MemoSource.shortcut)
        try Inbox.write(memo)
        MemoStore.shared.ingestInbox()
        SyncEngine.shared.kick()
        return .result(dialog: asTodo ? "Todo saved to bkemo." : "Saved to bkemo.")
    }
}

struct BkemoShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: CaptureMemoIntent(),
            phrases: [
                "Capture in \(.applicationName)",
                "New \(.applicationName) memo",
                "Save to \(.applicationName)",
            ],
            shortTitle: "Capture",
            systemImageName: "square.and.pencil"
        )
    }
}
