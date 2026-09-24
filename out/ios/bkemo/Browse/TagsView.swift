import SwiftUI

struct TagsView: View {
    let onPick: (String) -> Void
    @Environment(MemoStore.self) private var store
    @State private var search = ""

    var body: some View {
        NavigationStack {
            let tags = store.tagCounts.filter { search.isEmpty || $0.name.localizedCaseInsensitiveContains(search) }
            List {
                if tags.isEmpty {
                    Text(store.tagCounts.isEmpty ? "Add #tags to memos and they'll gather here." : "No matching tags")
                        .font(Typo.sans(14))
                        .foregroundStyle(Theme.fg3)
                        .listRowBackground(Color.clear)
                }
                ForEach(tags.sorted { $0.name.localizedStandardCompare($1.name) == .orderedAscending }) { tag in
                    Button { onPick(tag.name) } label: {
                        HStack(spacing: 10) {
                            let depth = tag.name.split(separator: "/").count - 1
                            Text("#")
                                .font(.system(size: 15, weight: .semibold, design: .monospaced))
                                .foregroundStyle(Color.accentColor)
                            Text(depth > 0 ? String(tag.name.split(separator: "/").last ?? "") : tag.name)
                                .font(Typo.sans(16))
                                .foregroundStyle(Theme.fg)
                            Spacer()
                            Text("\(tag.count)")
                                .font(Typo.kicker(12))
                                .foregroundStyle(Theme.fg3)
                        }
                        .padding(.leading, CGFloat(tag.name.split(separator: "/").count - 1) * 18)
                    }
                    .listRowBackground(Theme.surface)
                }
            }
            .scrollContentBackground(.hidden)
            .background(Theme.bg)
            .searchable(text: $search, prompt: "Filter tags")
            .navigationTitle("Tags")
            .navigationBarTitleDisplayMode(.inline)
        }
    }
}
