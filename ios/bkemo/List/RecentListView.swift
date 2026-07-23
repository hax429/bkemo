import SwiftUI
import SwiftData
import BkemoShared

private struct sectionHeader: View {
    let text: String
    init(_ text: String) { self.text = text }
    var body: some View {
        Text(text)
            .font(.system(.caption, design: .monospaced))
            .foregroundStyle(.secondary)
            .padding(.top, 8)
    }
}

struct RecentListView: View {
    @Environment(\.modelContext) private var context
    @Query(sort: [SortDescriptor(\LocalMemo.createdAt, order: .reverse)]) private var localMemos: [LocalMemo]
    @ObservedObject private var store = ListStore.shared
    @State private var selected: MemoItem?

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 8) {
                sectionHeader("Recent")
                ForEach(mergedItems) { item in
                    Button {
                        selected = item
                    } label: {
                        MemoRow(item: item) { Task { await toggle(item) } }
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    .buttonStyle(.plain)
                    if item.id != mergedItems.last?.id { Divider() }
                }
                if mergedItems.isEmpty && store.loading { ProgressView().padding() }
                if mergedItems.isEmpty && !store.loading {
                    Text("No captures yet").font(.caption).foregroundStyle(.secondary).padding()
                }
            }
            .padding(.horizontal)
            .padding(.bottom, 8)
        }
        .task { await store.load() }
        .sheet(item: $selected) { item in
            MemoDetailSheet(item: item, onDelete: { Task { await SyncEngine.shared.delete(item: item); await store.reload() } })
        }
    }

    private var mergedItems: [MemoItem] {
        let local = localMemos.map(MemoItem.init(local:))
        let syncedIds = Set(local.compactMap { $0.serverId })
        let remoteFiltered = store.remoteMemos.filter { !syncedIds.contains($0.serverId ?? -1) }
        let pending = local.filter { $0.isPending || $0.isError }
        let synced = local.filter { !$0.isPending && !$0.isError }
        return pending + synced + remoteFiltered
    }

    private func toggle(_ item: MemoItem) async {
        await SyncEngine.shared.toggleDone(item: item)
        await store.reload()
    }
}