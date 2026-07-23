import SwiftUI

struct PriorityToggle: View {
    @Binding var isImportant: Bool
    @Binding var isUrgent: Bool

    var body: some View {
        HStack(spacing: 8) {
            chip(label: "#important", color: Color(red: 0.92, green: 0.75, blue: 0.28), selected: $isImportant)
            chip(label: "#urgent", color: Color(red: 0.92, green: 0.32, blue: 0.28), selected: $isUrgent)
            Spacer()
        }
    }

    private func chip(label: String, color: Color, selected: Binding<Bool>) -> some View {
        Button {
            selected.wrappedValue.toggle()
        } label: {
            Text(label)
                .font(.system(size: 12, weight: .medium, design: .monospaced))
                .padding(.horizontal, 11)
                .padding(.vertical, 7)
                .foregroundStyle(selected.wrappedValue ? color : .secondary)
                .background(
                    Capsule(style: .continuous)
                        .fill(selected.wrappedValue ? color.opacity(0.18) : Color(.secondarySystemBackground))
                )
                .overlay {
                    Capsule(style: .continuous)
                        .stroke(selected.wrappedValue ? color.opacity(0.55) : Color.primary.opacity(0.08), lineWidth: 0.75)
                }
        }
        .buttonStyle(.plain)
    }
}
