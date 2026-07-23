import SwiftUI

struct MemoRow: View {
    let item: MemoItem
    let onToggleDone: () -> Void

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            if item.isTodo {
                Button(action: onToggleDone) {
                    Image(systemName: item.isCompleted ? "checkmark.circle.fill" : "circle")
                        .foregroundStyle(item.isCompleted ? Color.accentColor : .secondary)
                        .font(.system(size: 18))
                }
                .buttonStyle(.plain)
            } else {
                Image(systemName: "circle.fill")
                    .font(.system(size: 5.5))
                    .foregroundStyle(.tertiary)
                    .padding(.top, 7)
            }

            VStack(alignment: .leading, spacing: 5) {
                Text(item.content.split(separator: "\n").first.map(String.init) ?? item.content)
                    .lineLimit(2)
                    .font(.system(size: 15.5))
                    .strikethrough(item.isCompleted, color: .secondary)
                    .foregroundStyle(item.isCompleted ? .secondary : .primary)
                HStack(spacing: 7) {
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
                }
            }
        }
        .padding(.vertical, 4)
    }

    private func priorityDot(_ c: Color) -> some View {
        Circle().fill(c).frame(width: 7, height: 7)
    }

    private func badge(_ text: String, system: String, color: Color) -> some View {
        HStack(spacing: 3) {
            Image(systemName: system)
            Text(text)
                .lineLimit(1)
        }
        .font(.caption2)
        .foregroundStyle(color)
    }
}
