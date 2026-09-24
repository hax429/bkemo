import Foundation
import Observation
import UIKit
import BkemoShared

/// Entry points that should land in the composer or search: widgets, home
/// screen quick actions, `bkemo://` links.
@MainActor
@Observable
final class Router {
    static let shared = Router()

    struct ComposeRequest: Equatable {
        let id = UUID()
        let type: Int?
    }

    private(set) var composeRequest: ComposeRequest?
    private(set) var searchRequest: UUID?

    func compose(type: Int? = nil) {
        composeRequest = ComposeRequest(type: type)
    }

    func search() {
        searchRequest = UUID()
    }

    /// `bkemo://compose?type=todo`, `bkemo://search`
    func handle(url: URL) {
        guard url.scheme == "bkemo" else { return }
        switch url.host {
        case "compose", "new":
            let type = URLComponents(url: url, resolvingAgainstBaseURL: false)?
                .queryItems?.first { $0.name == "type" }?.value
            compose(type: type == "todo" ? NoteType.todo : type == "memo" ? NoteType.blinko : nil)
        case "search":
            search()
        default:
            break
        }
    }

    func handle(shortcut: UIApplicationShortcutItem) {
        switch shortcut.type {
        case "me.hax429.bk.newMemo": compose(type: NoteType.blinko)
        case "me.hax429.bk.newTodo": compose(type: NoteType.todo)
        case "me.hax429.bk.search": search()
        default: break
        }
    }

    /// Widget buttons run an intent that leaves the requested type here.
    func consumeWidgetRequest() {
        let defaults = AppGroup.defaults
        guard let type = defaults.object(forKey: AppGroup.pendingComposeKey) as? Int else { return }
        defaults.removeObject(forKey: AppGroup.pendingComposeKey)
        compose(type: type)
    }
}
