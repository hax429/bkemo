import SwiftUI

struct MemoRow: View {
    let item: MemoItem
    let onToggleDone: () -> Void

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            if item.isTodo {
                Button(action: onToggleDone) {
                    if item.isCompleted {
                        Image(systemName: "checkmark.circle.fill")
                            .foregroundStyle(.tint)
                            .font(.system(size: 17))
                    } else {
                        Image(systemName: "circle")
                            .foregroundStyle(.secondary)
                            .font(.system(size: 17))
                    }
                }
                .buttonStyle(.plain)
            } else {
                Image(systemName: "circle.fill").font(.system(size: 6)).foregroundStyle(.secondary)
                    .padding(.top, 6)
            }

            VStack(alignment: .leading, spacing: 4) {
                Text(item.content.split(separator: "\n").first.map(String.init) ?? item.content)
                    .lineLimit(2)
                    .font(.system(size: 15.5))
                    .strikethrough(item.isCompleted, color: .secondary)
                    .foregroundStyle(item.isCompleted ? .secondary : .primary)
                HStack(spacing: 6) {
                    if item.isImportant { priorityDot(.yellow) }
                    if item.isUrgent { priorityDot(.red) }
                    if item.isPending {
                        badge("Pending", system: "arrow.triangle.2.circlepath", color: .secondary)
                    } else if item.isError {
                        badge(item.syncError ?? "Failed", system: "exclamationmark.triangle.fill", color: .red)
                    }
                    if item.source == "share" {
                        badge("share", system: "square.and.arrow.up", color: .secondary)
                    }
                    if !item.source.isEmpty && item.source != "share" {
                        Text(item.source).font(.caption2).foregroundStyle(.secondary)
                    }
                }
            }
        }
        .padding(.vertical, 11)
    }

    private func priorityDot(_ c: Color) -> some View {
        Circle().fill(c).frame(width: 8, height: 8)
    }
    private func badge(_ text: String, system: String, color: Color) -> some View {
        HStack(spacing: 3) {
            Image(systemName: system)
            Text(text)
        }
        .font(.caption2)
        .foregroundStyle(color)
    }
}