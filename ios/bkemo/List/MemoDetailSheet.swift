import SwiftUI

struct MemoDetailSheet: View {
    let item: MemoItem
    let onDelete: () -> Void
    @State private var content: String = ""
    @State private var type: Int = 0
    @State private var isImportant = false
    @State private var isUrgent = false
    @State private var saving = false
    @State private var showDeleteConfirm = false
    @Environment(\.dismiss) private var dismiss

    var editable: Bool {
        item.serverId != nil && !(item.isPending || item.isError)
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 12) {
                    TypeToggle(selection: $type)
                    TextEditor(text: $content)
                        .frame(minHeight: 160)
                        .padding(8)
                        .background(Color(.secondarySystemBackground))
                        .cornerRadius(10)
                        .disabled(!editable)
                    if type == 2 {
                        PriorityToggle(isImportant: $isImportant, isUrgent: $isUrgent)
                            .disabled(!editable)
                    }
                    if let err = item.syncError, item.isError {
                        Text(err).font(.caption).foregroundStyle(.red)
                    }
                    if editable {
                        Button("Save", action: update).buttonStyle(.borderedProminent).disabled(saving)
                    }
                    Button("Delete", role: .destructive) { showDeleteConfirm = true }
                        .buttonStyle(.bordered)
                        .disabled(item.isPending)
                    if item.isPending {
                        Text("Pending capture — not synced yet").font(.caption).foregroundStyle(.secondary)
                    }
                }
                .padding()
            }
            .navigationTitle(item.isTodo ? "Todo" : "Memo")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .topBarTrailing) { Button("Done") { dismiss() } } }
        }
        .onAppear {
            content = item.content
            type = item.type
            isImportant = item.isImportant
            isUrgent = item.isUrgent
        }
        .confirmationDialog("Delete this capture?", isPresented: $showDeleteConfirm) {
            Button("Delete", role: .destructive) { onDelete(); dismiss() }
            Button("Cancel", role: .cancel) {}
        }
    }

    private func update() {
        let trimmed = content.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, editable else { return }
        saving = true
        Task {
            await SyncEngine.shared.updateRemote(item: item, content: trimmed, type: type, isImportant: isImportant, isUrgent: isUrgent)
            saving = false
            dismiss()
        }
    }
}