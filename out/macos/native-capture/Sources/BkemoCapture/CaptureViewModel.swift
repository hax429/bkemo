import Foundation
import BkemoShared

@MainActor
final class CaptureViewModel: ObservableObject {
    @Published var text: String = ""
    @Published var statusMessage: String?
    @Published var focusToken: Int = 0

    private var token: String?
    private var endpoint = "https://bk.hax429.me"
    private let queue = CaptureQueue()

    /// Called every time Tauri shows/toggles the panel — the token can
    /// change between opens (sign-in, sign-out, rotation) since this helper
    /// never signs in on its own.
    func configure(token: String?, endpoint: String?) {
        self.token = token
        if let endpoint, !endpoint.isEmpty { self.endpoint = endpoint }
        statusMessage = token == nil ? "Sign in to bkemo in the main window to save notes." : nil
    }

    func requestFocus() {
        focusToken += 1
    }

    /// Persists to the local queue and returns immediately; the network
    /// upload happens in the background with its own retry/backoff.
    func save() {
        let parsed = TaskSyntax.parse(text)
        guard !parsed.content.isEmpty else { return }
        guard let token else {
            statusMessage = "Sign in to bkemo in the main window before saving this note."
            return
        }
        queue.enqueue(PendingCapture(
            endpoint: endpoint,
            token: token,
            content: parsed.content,
            type: parsed.isTodo ? NoteType.todo : NoteType.blinko,
            isImportant: parsed.isImportant,
            isUrgent: parsed.isUrgent,
            dueDate: parsed.dueDate
        ))
        clear()
    }

    func clear() {
        text = ""
        statusMessage = token == nil ? "Sign in to bkemo in the main window to save notes." : nil
    }
}
