import Foundation
import SwiftUI

@MainActor
final class CaptureFeedback: ObservableObject {
    static let shared = CaptureFeedback()

    enum Banner: Equatable {
        case hidden
        case saved
        case synced
        case failed(String)
    }

    @Published private(set) var banner: Banner = .hidden
    @Published var failedCount: Int = 0

    private var trackedLocalId: UUID?
    private var hideTask: Task<Void, Never>?

    func showSaved(localId: UUID) {
        trackedLocalId = localId
        present(.saved, autoHideAfter: 2.2)
    }

    func noteSynced(localId: UUID) {
        guard trackedLocalId == localId || trackedLocalId == nil else { return }
        trackedLocalId = nil
        present(.synced, autoHideAfter: 1.4)
    }

    func noteSyncedBurst() {
        if case .saved = banner { return }
        present(.synced, autoHideAfter: 1.4)
    }

    func showFailed(_ message: String) {
        present(.failed(message), autoHideAfter: 3.2)
    }

    func dismiss() {
        hideTask?.cancel()
        banner = .hidden
    }

    private func present(_ value: Banner, autoHideAfter: TimeInterval) {
        hideTask?.cancel()
        withAnimation(.easeOut(duration: 0.22)) {
            banner = value
        }
        hideTask = Task {
            try? await Task.sleep(for: .seconds(autoHideAfter))
            guard !Task.isCancelled else { return }
            withAnimation(.easeIn(duration: 0.18)) {
                if banner == value { banner = .hidden }
            }
        }
    }
}

struct InAppBannerHost: View {
    @ObservedObject private var feedback = CaptureFeedback.shared

    var body: some View {
        VStack(spacing: 0) {
            if feedback.banner != .hidden {
                bannerBody
                    .transition(.move(edge: .top).combined(with: .opacity))
                    .padding(.horizontal, 16)
                    .padding(.top, 6)
            }
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .allowsHitTesting(false)
    }

    @ViewBuilder
    private var bannerBody: some View {
        let style = bannerStyle
        HStack(spacing: 8) {
            Image(systemName: style.icon)
                .font(.system(size: 13, weight: .semibold))
            Text(style.title)
                .font(.system(size: 13, weight: .semibold))
            Spacer(minLength: 0)
        }
        .foregroundStyle(style.fg)
        .padding(.horizontal, 14)
        .padding(.vertical, 11)
        .background {
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .fill(style.bg)
                .shadow(color: .black.opacity(0.18), radius: 10, y: 4)
        }
        .overlay {
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .stroke(Color.primary.opacity(0.08), lineWidth: 0.5)
        }
    }

    private var bannerStyle: (icon: String, title: String, bg: Color, fg: Color) {
        switch feedback.banner {
        case .hidden:
            return ("", "", .clear, .clear)
        case .saved:
            return ("checkmark.circle.fill", "Saved", Color(.secondarySystemBackground), .primary)
        case .synced:
            return ("icloud.and.arrow.up", "Synced", Color.accentColor.opacity(0.92), .white)
        case .failed(let message):
            return ("exclamationmark.triangle.fill", message, Color.red.opacity(0.92), .white)
        }
    }
}
