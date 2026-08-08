import SwiftUI
import SwiftData
import UIKit
import BkemoShared

struct RecentListView: View {
    @Environment(\.modelContext) private var context
    @Environment(\.dismiss) private var dismiss
    @Query(sort: [SortDescriptor(\LocalMemo.createdAt, order: .reverse)]) private var localMemos: [LocalMemo]
    @ObservedObject private var store = ListStore.shared
    @ObservedObject private var syncEngine = SyncEngine.shared
    @State private var pendingDelete: MemoItem?
    @State private var showDeleteConfirm = false
    @State private var editTarget: MemoItem?

    var body: some View {
        Group {
            if mergedItems.isEmpty && !store.loading {
                emptyState
            } else {
                list
            }
        }
        .background(Color(.systemBackground))
        .navigationTitle("Recent")
        .navigationBarTitleDisplayMode(.inline)
        .navigationDestination(item: $editTarget) { item in
            MemoDetailView(item: item, startEditing: true)
        }
        .task { await store.reload() }
        .confirmationDialog(
            "Delete this capture?",
            isPresented: $showDeleteConfirm,
            titleVisibility: .visible
        ) {
            Button("Delete", role: .destructive) {
                guard let item = pendingDelete else { return }
                Task {
                    try? await SyncEngine.shared.delete(item: item)
                    await store.reload()
                    pendingDelete = nil
                }
            }
            Button("Cancel", role: .cancel) {
                pendingDelete = nil
            }
        }
    }

    private var list: some View {
        List {
            if let error = syncEngine.syncError ?? store.error {
                Section {
                    Label(error, systemImage: "exclamationmark.icloud")
                        .font(.caption)
                        .foregroundStyle(.red)
                        .listRowBackground(Color.clear)
                }
            }

            Section {
                ForEach(mergedItems) { item in
                    NavigationLink {
                        MemoDetailView(item: item, startEditing: false)
                    } label: {
                        MemoRow(item: item) {
                            Task { await toggle(item) }
                        }
                    }
                    .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                        Button(role: .destructive) {
                            pendingDelete = item
                            showDeleteConfirm = true
                        } label: {
                            Label("Delete", systemImage: "trash")
                        }
                    }
                    .swipeActions(edge: .leading, allowsFullSwipe: true) {
                        if item.isTodo {
                            Button {
                                Task { await toggle(item) }
                            } label: {
                                Label(
                                    item.isCompleted ? "Undone" : "Done",
                                    systemImage: item.isCompleted ? "arrow.uturn.backward.circle" : "checkmark.circle"
                                )
                            }
                            .tint(.accentColor)
                        }
                        if item.isError {
                            Button {
                                Task { await SyncEngine.shared.retry(item: item) }
                            } label: {
                                Label("Retry", systemImage: "arrow.clockwise")
                            }
                            .tint(.orange)
                        }
                    }
                    .contextMenu {
                        Button {
                            UIPasteboard.general.string = item.content
                        } label: {
                            Label("Copy", systemImage: "doc.on.doc")
                        }
                        if item.serverId != nil && !(item.isPending || item.isError) {
                            Button {
                                editTarget = item
                            } label: {
                                Label("Edit", systemImage: "pencil")
                            }
                        }
                        if item.isError {
                            Button {
                                Task { await SyncEngine.shared.retry(item: item) }
                            } label: {
                                Label("Retry", systemImage: "arrow.clockwise")
                            }
                        }
                        if item.isTodo {
                            Button {
                                Task { await toggle(item) }
                            } label: {
                                Label(
                                    item.isCompleted ? "Mark undone" : "Mark done",
                                    systemImage: "checkmark.circle"
                                )
                            }
                        }
                        Button(role: .destructive) {
                            pendingDelete = item
                            showDeleteConfirm = true
                        } label: {
                            Label("Delete", systemImage: "trash")
                        }
                    }
                }
            } header: {
                Text("CAPTURES")
                    .font(.system(size: 10.5, weight: .medium, design: .monospaced))
                    .tracking(0.9)
            }
        }
        .listStyle(.plain)
        .overlay {
            if mergedItems.isEmpty && store.loading {
                ProgressView()
            }
        }
    }

    private var emptyState: some View {
        VStack(spacing: 14) {
            Spacer()
            Image(systemName: "tray")
                .font(.system(size: 28, weight: .light))
                .foregroundStyle(.secondary)
            Text("No captures yet")
                .font(.system(size: 11, weight: .medium, design: .monospaced))
                .tracking(0.8)
                .textCase(.uppercase)
                .foregroundStyle(.secondary)
            Button {
                dismiss()
            } label: {
                Text("Capture something")
                    .font(.system(size: 15, weight: .semibold))
                    .frame(maxWidth: 220)
                    .frame(height: 44)
            }
            .buttonStyle(.borderedProminent)
            .buttonBorderShape(.roundedRectangle(radius: 12))
            .padding(.top, 4)
            Spacer()
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
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
