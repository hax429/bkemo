import SwiftUI
import SwiftData
import BkemoShared

private struct sectionHeader: View {
    let text: String
    init(_ text: String) { self.text = text }
    var body: some View {
        Text(text.uppercased())
            .font(.system(size: 10.5, weight: .medium, design: .monospaced))
            .tracking(0.9)
            .foregroundStyle(.secondary)
            .padding(.top, 14)
            .padding(.bottom, 8)
    }
}

struct RecentListView: View {
    @Environment(\.modelContext) private var context
    @Query(sort: [SortDescriptor(\LocalMemo.createdAt, order: .reverse)]) private var localMemos: [LocalMemo]
    @ObservedObject private var store = ListStore.shared
    @ObservedObject private var syncEngine = SyncEngine.shared
    @State private var selected: MemoItem?

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 0) {
                sectionHeader("Recent")
                if let error = syncEngine.syncError ?? store.error {
                    Label(error, systemImage: "exclamationmark.icloud")
                        .font(.caption)
                        .foregroundStyle(.red)
                        .padding(.bottom, 8)
                }
                ForEach(mergedItems) { item in
                    MemoRow(item: item) { Task { await toggle(item) } }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .contentShape(Rectangle())
                        .onTapGesture { selected = item }
                    if item.id != mergedItems.last?.id {
                        Rectangle()
                            .fill(Color.primary.opacity(0.075))
                            .frame(height: 0.5)
                            .padding(.leading, 30)
                    }
                }
                if mergedItems.isEmpty && store.loading { ProgressView().padding() }
                if mergedItems.isEmpty && !store.loading {
                    VStack(spacing: 8) {
                        Image(systemName: "tray")
                            .font(.system(size: 24, weight: .light))
                        Text("No captures yet")
                            .font(.system(size: 11, design: .monospaced))
                            .textCase(.uppercase)
                    }
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 34)
                }
            }
            .padding(.horizontal)
            .padding(.bottom, 8)
        }
        .task { await store.reload() }
        .sheet(item: $selected) { item in
            MemoDetailSheet(item: item, onDelete: {
                try await SyncEngine.shared.delete(item: item)
            })
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