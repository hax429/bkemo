import SwiftUI

/// Workspace sidebar layout, edited as part of `bkemoPrefs`: which toolbar
/// shortcuts show (up to five, in order), the monthly heatmap, and width.
/// Writes go into the page's pending edits like every other row, so the
/// toolbar's one "Save Changes" commits them.
struct SidebarLayoutEditor: View {
    let setting: NativeSetting
    @ObservedObject var model: SettingsModel

    struct Tool: Identifiable { let id: String; let label: String; let symbol: String }
    static let tools: [Tool] = [
        .init(id: "home", label: "Home", symbol: "house"),
        .init(id: "today", label: "Today", symbol: "sun.max"),
        .init(id: "week", label: "This week", symbol: "calendar.day.timeline.leading"),
        .init(id: "matrix", label: "Matrix", symbol: "square.grid.2x2"),
        .init(id: "calendar", label: "Calendar", symbol: "calendar"),
        .init(id: "graph", label: "Graph", symbol: "point.3.connected.trianglepath.dotted"),
        .init(id: "files", label: "Files", symbol: "folder"),
        .init(id: "trash", label: "Trash", symbol: "trash"),
    ]
    static let limit = 5
    static let defaultTools = ["home", "today", "week", "calendar", "trash"]
    static let widthRange: ClosedRange<Double> = 200...420
    static let defaultWidth = 248.0

    private var prefs: SettingsValue {
        model.configEdits[setting.key] ?? (setting.value.isNull ? setting.schema.initialValue : setting.value)
    }
    private func update(_ key: String, _ value: SettingsValue) {
        var next = prefs
        next[key] = value
        model.configEdits[setting.key] = next
    }
    private var shown: [String] {
        let known = Set(Self.tools.map(\.id))
        let raw = prefs["sidebarTools"]
        let ids = raw.isNull ? Self.defaultTools : raw.array.map(\.string)
        var seen = Set<String>()
        return Array(ids.filter { known.contains($0) && seen.insert($0).inserted }.prefix(Self.limit))
    }
    private func setShown(_ ids: [String]) { update("sidebarTools", .array(ids.map { .string($0) })) }
    private func tool(_ id: String) -> Tool { Self.tools.first { $0.id == id } ?? .init(id: id, label: id, symbol: "questionmark") }
    private var width: Double {
        if case .number(let value) = prefs["sidebarWidth"] { return min(max(value, Self.widthRange.lowerBound), Self.widthRange.upperBound) }
        return Self.defaultWidth
    }

    var body: some View {
        Group {
            LabeledContent("Toolbar shortcuts") {
                Text("\(shown.count) of \(Self.limit)").foregroundStyle(shown.count >= Self.limit ? Color.accentColor : .secondary).monospacedDigit()
            }
            // Preview of the toolbar as it appears in the sidebar.
            HStack(spacing: 4) {
                ForEach(shown, id: \.self) { id in
                    VStack(spacing: 3) {
                        Image(systemName: tool(id).symbol).font(.system(size: 15))
                        Text(tool(id).label).font(.system(size: 9)).foregroundStyle(.secondary).lineLimit(1)
                    }.frame(maxWidth: .infinity).padding(.vertical, 6)
                }
                if shown.isEmpty { Text("Toolbar hidden").font(.caption).foregroundStyle(.secondary).padding(8) }
            }
            .padding(4)
            .frame(maxWidth: 280)
            .background(.quaternary.opacity(0.5), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
            .accessibilityHidden(true)

            ForEach(Array(shown.enumerated()), id: \.element) { index, id in
                HStack(spacing: 10) {
                    Image(systemName: tool(id).symbol).foregroundStyle(Color.accentColor).frame(width: 20)
                    Text(tool(id).label)
                    Spacer()
                    Button { move(id, to: index - 1) } label: { Image(systemName: "chevron.up") }
                        .disabled(index == 0).help("Move left").accessibilityLabel("Move \(tool(id).label) left")
                    Button { move(id, to: index + 1) } label: { Image(systemName: "chevron.down") }
                        .disabled(index == shown.count - 1).help("Move right").accessibilityLabel("Move \(tool(id).label) right")
                    Button(role: .destructive) { setShown(shown.filter { $0 != id }) } label: { Image(systemName: "minus.circle") }
                        .help("Remove from toolbar").accessibilityLabel("Remove \(tool(id).label)")
                }
                .buttonStyle(.borderless)
            }
            .onMove { from, to in
                var next = shown
                next.move(fromOffsets: from, toOffset: to)
                setShown(next)
            }

            let hidden = Self.tools.filter { !shown.contains($0.id) }
            if !hidden.isEmpty {
                Menu {
                    ForEach(hidden) { item in
                        Button { setShown(shown + [item.id]) } label: { Label(item.label, systemImage: item.symbol) }
                    }
                } label: {
                    Label(shown.count >= Self.limit ? "Toolbar full — remove one to add another" : "Add shortcut", systemImage: "plus")
                }
                .disabled(shown.count >= Self.limit)
            }

            Toggle(isOn: Binding(get: { prefs["sidebarHeatmap"].bool }, set: { update("sidebarHeatmap", .bool($0)) })) {
                Text("Show monthly heatmap")
                Text("This month between the toolbar and your tags, tinted by memos written each day.")
            }
            LabeledContent("Width") {
                HStack {
                    Slider(value: Binding(get: { width }, set: { update("sidebarWidth", .number(($0 / 4).rounded() * 4)) }), in: Self.widthRange)
                        .frame(width: 160)
                    Text("\(Int(width)) pt").monospacedDigit().foregroundStyle(.secondary).frame(width: 52, alignment: .trailing)
                    Button("Reset") { update("sidebarWidth", .number(Self.defaultWidth)) }
                }
            }
        }
        .disabled(!setting.writable || !model.online || model.busy || model.savingConfig)
    }

    private func move(_ id: String, to index: Int) {
        var next = shown.filter { $0 != id }
        next.insert(id, at: max(0, min(next.count, index)))
        setShown(next)
    }
}
