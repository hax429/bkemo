import SwiftUI
import BkemoShared

/// Flat tag suggestion list — mirrors web `.bk-suggest-menu` / `.bk-suggest-row`.
struct TagSuggestMenu: View {
    let items: [TagParser.SuggestItem]
    let onPick: (TagParser.SuggestItem) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if items.isEmpty {
                Text("TYPE A TAG")
                    .font(.system(size: 11, weight: .medium, design: .monospaced))
                    .tracking(0.6)
                    .foregroundStyle(.tertiary)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 10)
                    .frame(maxWidth: .infinity, alignment: .leading)
            } else {
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 0) {
                        ForEach(items) { item in
                            Button {
                                onPick(item)
                            } label: {
                                HStack(spacing: 10) {
                                    Text(item.label)
                                        .font(.system(size: 12, weight: .medium, design: .monospaced))
                                        .tracking(0.3)
                                        .foregroundStyle(.primary)
                                    if item.isNew {
                                        Text("new")
                                            .font(.system(size: 12))
                                            .foregroundStyle(.tertiary)
                                    }
                                    Spacer(minLength: 0)
                                }
                                .padding(.horizontal, 12)
                                .padding(.vertical, 9)
                                .contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
                .frame(maxHeight: 220)
            }
        }
        .background(Color(.systemBackground))
        .overlay {
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .stroke(Color.primary.opacity(0.12), lineWidth: 0.75)
        }
        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
        .padding(.horizontal, 12)
        .padding(.bottom, 8)
    }
}
