import AppKit

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
    private var controller: CapturePanelController?
    private let settings = SettingsWindowController()
    private let ipc = IPCServer()

    func applicationDidFinishLaunching(_ notification: Notification) {
        let controller = CapturePanelController()
        self.controller = controller

        ipc.onCommand = { [weak self, weak controller] command in
            DispatchQueue.main.async {
                switch command.cmd {
                case "settings":
                    self?.settings.show(token: command.token, endpoint: command.endpoint, section: command.section)
                case "session":
                    self?.settings.configure(token: command.token, endpoint: command.endpoint)
                    controller?.configure(token: command.token, endpoint: command.endpoint)
                case "show":
                    controller?.show(token: command.token, endpoint: command.endpoint)
                case "toggle":
                    controller?.toggle(token: command.token, endpoint: command.endpoint)
                default:
                    break
                }
            }
        }
        ipc.start()
        let appearance = UserDefaults.standard.string(forKey: "nativeAppearance") ?? "system"
        NSApp.appearance = appearance == "system" ? nil : NSAppearance(named: appearance == "dark" ? .darkAqua : .aqua)
        let menu = NSMenu()
        let appMenu = NSMenu()
        appMenu.addItem(withTitle: "Close Window", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")
        let root = NSMenuItem(); root.submenu = appMenu; menu.addItem(root)
        let edit = NSMenu(title: "Edit")
        for (title, action, key) in [("Undo", "undo:", "z"), ("Cut", "cut:", "x"), ("Copy", "copy:", "c"), ("Paste", "paste:", "v"), ("Select All", "selectAll:", "a")] {
            edit.addItem(withTitle: title, action: Selector(action), keyEquivalent: key)
        }
        let editItem = NSMenuItem(); editItem.submenu = edit; menu.addItem(editItem)
        NSApp.mainMenu = menu
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        false
    }
}
