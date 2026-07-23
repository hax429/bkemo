import SwiftUI

struct PriorityToggle: View {
    @Binding var isImportant: Bool
    @Binding var isUrgent: Bool

    var body: some View {
        HStack(spacing: 8) {
            chip(label: "#important", color: .yellow, selected: $isImportant)
            chip(label: "#urgent", color: .red, selected: $isUrgent)
            Spacer()
        }
    }

    private func chip(label: String, color: Color, selected: Binding<Bool>) -> some View {
        Button {
            selected.wrappedValue.toggle()
        } label: {
            Text(label)
                .font(.system(.caption, design: .monospaced))
                .padding(.horizontal, 10).padding(.vertical, 5)
                .background(selected.wrappedValue ? color.opacity(0.25) : Color(.secondarySystemBackground))
                .foregroundStyle(selected.wrappedValue ? color : .secondary)
                .overlay(RoundedRectangle(cornerRadius: 8).stroke(selected.wrappedValue ? color : Color.secondary.opacity(0.2), lineWidth: 1))
                .cornerRadius(8)
        }
        .buttonStyle(.plain)
    }
}