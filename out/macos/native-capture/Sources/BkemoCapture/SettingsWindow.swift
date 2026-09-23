import AppKit
import SwiftUI

@MainActor
final class SettingsWindowController {
    let model = SettingsModel()
    private var window: NSWindow?
    func configure(token: String?, endpoint: String?, section: String? = nil) {
        model.configure(token: token, endpoint: endpoint, section: section)
        if window?.isVisible == true { Task { await model.refresh() } }
    }
    func show(token: String?, endpoint: String?, section: String?) {
        model.configure(token: token, endpoint: endpoint, section: section)
        if window == nil {
            let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 940, height: 720), styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView], backing: .buffered, defer: false)
            window.title = "bkemo Settings"
            window.titlebarAppearsTransparent = true
            window.isReleasedWhenClosed = false
            window.minSize = NSSize(width: 760, height: 520)
            // Glass window: opaque+clear background lets the NSVisualEffectView
            // behind the SwiftUI content (see NativeSettingsView) show the
            // desktop blur through, instead of a flat system-color panel.
            window.isOpaque = false
            window.backgroundColor = .clear
            window.contentView = NSHostingView(rootView: NativeSettingsView(model: model))
            window.setFrameAutosaveName("bkemo.native.settings")
            window.center()
            self.window = window
        }
        NSApp.activate(ignoringOtherApps: true)
        window?.makeKeyAndOrderFront(nil)
        Task { await model.refresh() }
    }
}
private struct SidebarSection { let id: String; let title: String; let icon: String; let tint: Color }

struct NativeSettingsView: View {
    @ObservedObject var model: SettingsModel
    @AppStorage("nativeAppearance") private var appearance = "system"
    private let sections: [SidebarSection] = [
        .init(id: "desktop", title: "This Mac", icon: "desktopcomputer", tint: .gray),
        .init(id: "prefs", title: "Preferences", icon: "slider.horizontal.3", tint: .gray),
        .init(id: "appear", title: "Workspace appearance", icon: "paintpalette.fill", tint: .pink),
        .init(id: "account", title: "Account", icon: "person.crop.circle.fill", tint: .blue),
        .init(id: "security", title: "Security & API", icon: "key.fill", tint: .orange),
        .init(id: "ai", title: "AI", icon: "sparkles", tint: .purple),
        .init(id: "task", title: "Schedule Task", icon: "clock.fill", tint: .green),
        .init(id: "storage", title: "Storage", icon: "externaldrive.fill", tint: .indigo),
        .init(id: "mcp", title: "MCP connections", icon: "point.3.connected.trianglepath.dotted", tint: .teal),
        .init(id: "data", title: "Data Transfer", icon: "arrow.up.arrow.down", tint: .cyan),
        .init(id: "apidocs", title: "API Docs", icon: "curlybraces", tint: .gray),
        .init(id: "about", title: "About", icon: "info.circle.fill", tint: .gray),
    ]
    private var available: [SidebarSection] {
        sections.filter { section in
            ["desktop", "about"].contains(section.id) || (model.snapshot != nil && section.id == "apidocs") ||
            model.snapshot?.config.contains(where: { $0.section == section.id }) == true || model.snapshot?.operations.contains(where: { $0.section == section.id }) == true
        }
    }
    var body: some View {
        NavigationSplitView {
            List(selection: $model.selection) {
                ForEach(available, id: \.id) { section in
                    SidebarRow(section: section).tag(section.id)
                }
            }
            .listStyle(.sidebar)
            .scrollContentBackground(.hidden)
            .navigationSplitViewColumnWidth(min: 210, ideal: 235, max: 300)
            .safeAreaInset(edge: .bottom) {
                HStack(spacing: 6) {
                    Image(systemName: model.online ? "checkmark.icloud.fill" : "icloud.slash")
                        .foregroundStyle(model.online ? .green : .secondary)
                    Text(model.snapshot?.account.name ?? "Local settings").font(.caption)
                    Spacer()
                }
                .padding(.horizontal, 14).padding(.vertical, 10)
                .glassEffect(.regular, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                .padding(.horizontal, 10).padding(.bottom, 8)
            }
        } detail: {
            VStack(spacing: 0) {
                if let message = model.message {
                    HStack(alignment: .top, spacing: 10) {
                        Image(systemName: "info.circle").foregroundStyle(.secondary)
                        Text(message).font(.callout).textSelection(.enabled)
                        Spacer()
                        if model.snapshot?.version != 1 && model.snapshot != nil { Button("Open in browser", action: model.openBrowser) }
                    }
                    .padding(14)
                    .glassEffect(.regular, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                    .padding(.horizontal, 20).padding(.top, 16)
                }
                detail
            }
            .navigationTitle(sections.first(where: { $0.id == model.selection })?.title ?? "Settings")
            .toolbar {
                if model.hasConfigEdits {
                    ToolbarItem {
                        Button("Save Changes") { Task { await model.saveConfigEdits() } }
                            .disabled(model.busy || model.savingConfig)
                    }
                }
                ToolbarItem { Button { Task { await model.refresh() } } label: { Label("Refresh", systemImage: "arrow.clockwise") }.disabled(model.busy) }
            }
            .searchable(text: $model.search, prompt: "Search settings")
        }
        .background(VisualEffectBackground())
        .preferredColorScheme(appearance == "system" ? nil : appearance == "dark" ? .dark : .light)
        .onChange(of: appearance) { _, next in NSApp.appearance = next == "system" ? nil : NSAppearance(named: next == "dark" ? .darkAqua : .aqua) }
    }
    @ViewBuilder private var detail: some View {
        if model.selection == "desktop" && model.search.isEmpty {
            Form {
                Section("Native windows") {
                    Picker("Appearance", selection: $appearance) { Text("System").tag("system"); Text("Light").tag("light"); Text("Dark").tag("dark") }
                    Text("Applies to Settings and Quick Note. Workspace appearance is configured separately.").font(.caption).foregroundStyle(.secondary)
                }
                DesktopSettingsForm(model: model).id(model.desktop)
                Section("Account") {
                    Button("Open main window") { Task { _ = try? await ParentBridge.request("main.show") } }
                }
            }.formStyle(.grouped).scrollContentBackground(.hidden)
        } else if model.selection == "about" && model.search.isEmpty {
            VStack(spacing: 18) {
                Image(systemName: "note.text").font(.system(size: 52)).padding(28).glassEffect(.regular, in: RoundedRectangle(cornerRadius: 28))
                Text("bkemo").font(.largeTitle.bold())
                Text("A place for your notes and tasks.").foregroundStyle(.secondary)
                Text("Native Settings and Quick Note · macOS 26 or later").font(.caption)
            }.frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if model.selection == "apidocs" && model.search.isEmpty {
            Form { Section("API reference") { Text("Use a scoped access token with the bkemo API."); Text(model.endpoint + "/docs").textSelection(.enabled); Button("Open API reference") { if let url = URL(string: model.endpoint + "/docs") { NSWorkspace.shared.open(url) } } } }.formStyle(.grouped).scrollContentBackground(.hidden)
        } else if let snapshot = model.snapshot, snapshot.version == 1 {
            Form {
                let config = snapshot.config.filter { matches($0.section, $0.title) }
                let operations = snapshot.operations.filter { matches($0.section, $0.title) }
                if config.isEmpty && operations.isEmpty { Text("No available settings match this view.").foregroundStyle(.secondary) }
                // One card for every row on this page — not one card per
                // field — with a single page-level Save (toolbar) instead
                // of a save button per row.
                if !config.isEmpty {
                    Section {
                        ForEach(config) { setting in SettingEditor(setting: setting, model: model).id("\(snapshot.account.id):\(setting.key)") }
                    }
                }
                if !operations.isEmpty {
                    Section("Manage") { ForEach(operations) { operation in SettingsActionView(operation: operation, model: model).id("\(snapshot.account.id):\(operation.id)") } }
                }
            }.formStyle(.grouped).scrollContentBackground(.hidden).disabled(model.busy)
        } else {
            ContentUnavailableView("Account settings", systemImage: "person.crop.circle", description: Text("Connect through the main bkemo window, then refresh."))
        }
    }
    private func matches(_ section: String, _ title: String) -> Bool {
        model.search.isEmpty ? section == model.selection : title.localizedCaseInsensitiveContains(model.search)
    }
}
private struct SidebarRow: View {
    let section: SidebarSection
    var body: some View {
        Label {
            Text(section.title)
        } icon: {
            RoundedRectangle(cornerRadius: 7, style: .continuous)
                .fill(section.tint.gradient)
                .frame(width: 26, height: 26)
                .overlay(Image(systemName: section.icon).font(.system(size: 13, weight: .medium)).foregroundStyle(.white))
        }
        .padding(.vertical, 2)
    }
}
struct DesktopSettingsForm: View {
    @ObservedObject var model: SettingsModel
    @State private var value: SettingsValue
    @State private var message: String?
    init(model: SettingsModel) { self.model = model; _value = State(initialValue: model.desktop) }
    var body: some View {
        Section("Shortcuts and startup") {
            ForEach(["enabled", "aiEnabled", "systemTrayEnabled", "autostart"], id: \.self) { key in
                Toggle(settingTitle(key), isOn: Binding(get: { value[key].bool }, set: { value[key] = .bool($0); save() }))
            }
            ForEach(["quickNote", "quickAI"], id: \.self) { key in
                TextField(settingTitle(key), text: Binding(get: { value[key].string }, set: { value[key] = .string($0) }))
            }
            Text("Use chords such as Control+W. Control+Q remains reserved for the main window.").font(.caption).foregroundStyle(.secondary)
            Toggle("Text selection toolbar", isOn: Binding(get: { value["textSelectionToolbar"]["enabled"].bool }, set: { value["textSelectionToolbar"]["enabled"] = .bool($0); save() }))
            Picker("Selection modifier", selection: Binding(get: { value["textSelectionToolbar"]["triggerModifier"].string }, set: { value["textSelectionToolbar"]["triggerModifier"] = .string($0); save() })) {
                Text("Shift").tag("shift"); Text("Control").tag("ctrl"); Text("Option").tag("alt"); Text("Command").tag("meta")
            }
            Button("Save shortcuts", action: save)
            if let message { Text(message).foregroundStyle(.secondary) }
        }
    }
    private func save() { Task { do { try await model.saveDesktop(value); message = "Saved and registered" } catch { message = error.localizedDescription } } }
}
