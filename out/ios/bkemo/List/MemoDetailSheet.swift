import SwiftUI

struct MemoDetailView: View {
    let item: MemoItem
    var startEditing: Bool = false

    @State private var content: String = ""
    @State private var type: Int = 0
    @State private var isImportant = false
    @State private var isUrgent = false
    @State private var editing = false
    @State private var saving = false
    @State private var deleting = false
    @State private var operationError: String?
    @State private var showDeleteConfirm = false
    @Environment(\.dismiss) private var dismiss

    var editable: Bool {
        item.serverId != nil && !(item.isPending || item.isError)
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                metaRow

                if editing {
                    TextEditor(text: $content)
                        .font(.system(size: 18))
                        .scrollContentBackground(.hidden)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled(false)
                        .frame(minHeight: 280)
                        .padding(.horizontal, 2)
                    if type == 2 {
                        PriorityToggle(isImportant: $isImportant, isUrgent: $isUrgent)
                    }
                } else {
                    MemoLinkText(text: content.isEmpty ? " " : content)
                        .font(.system(size: 18))
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.top, 2)
                }

                if let err = item.syncError, item.isError {
                    Label(err, systemImage: "exclamationmark.triangle.fill")
                        .font(.caption)
                        .foregroundStyle(.red)
                }
                if let operationError {
                    Text(operationError)
                        .font(.caption)
                        .foregroundStyle(.red)
                }
                if item.isPending || item.isError {
                    Text(item.isError
                         ? "This capture failed to sync. Retry from Recent, or delete it."
                         : "Still syncing to your account.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            .padding(.horizontal, 20)
            .padding(.top, 8)
            .padding(.bottom, 28)
        }
        .background(Color(.systemBackground))
        .navigationTitle(item.isTodo ? "Todo" : "Memo")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                HStack(spacing: 14) {
                    if editing {
                        Button(saving ? "Saving…" : "Save") { update() }
                            .disabled(saving || !editable)
                            .fontWeight(.semibold)
                    } else if editable {
                        Button("Edit") { editing = true }
                    }
                    Button(role: .destructive) {
                        showDeleteConfirm = true
                    } label: {
                        Image(systemName: "trash")
                    }
                    .disabled(deleting)
                    .accessibilityLabel("Delete")
                }
            }
        }
        .onAppear {
            content = item.content
            type = item.type
            isImportant = item.isImportant
            isUrgent = item.isUrgent
            editing = startEditing && editable
        }
        .confirmationDialog("Delete this capture?", isPresented: $showDeleteConfirm) {
            Button("Delete", role: .destructive) {
                deleting = true
                operationError = nil
                Task {
                    do {
                        try await SyncEngine.shared.delete(item: item)
                        dismiss()
                    } catch {
                        operationError = error.localizedDescription
                        deleting = false
                    }
                }
            }
            Button("Cancel", role: .cancel) {}
        }
    }

    private var metaRow: some View {
        HStack(spacing: 10) {
            Text(item.isTodo ? "TODO" : "MEMO")
                .font(.system(size: 10.5, weight: .medium, design: .monospaced))
                .tracking(0.9)
                .foregroundStyle(.secondary)
            if item.isImportant {
                Circle().fill(.yellow).frame(width: 7, height: 7)
            }
            if item.isUrgent {
                Circle().fill(.red).frame(width: 7, height: 7)
            }
            Spacer()
            if editing {
                TypeToggle(selection: $type)
                    .frame(width: 160)
                    .disabled(!editable)
            }
        }
    }

    private func update() {
        let trimmed = content.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, editable else { return }
        saving = true
        operationError = nil
        Task {
            do {
                try await SyncEngine.shared.updateRemote(
                    item: item,
                    content: trimmed,
                    type: type,
                    isImportant: isImportant,
                    isUrgent: isUrgent
                )
                editing = false
                saving = false
            } catch {
                operationError = error.localizedDescription
                saving = false
            }
        }
    }
}
