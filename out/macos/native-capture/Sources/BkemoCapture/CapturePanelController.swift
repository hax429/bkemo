import AppKit
import SwiftUI
import Combine

/// Ports the window-level tricks from the Rust `quicknote_panel.rs` (which
/// reached into AppKit via objc from Rust) directly into Swift/AppKit: no
/// animation, floats over every Space including full-screen apps, and
/// deliberately does NOT hide when it loses key status — clicking another
/// app leaves the panel open, matching the existing behavior exactly.
@MainActor
final class CapturePanelController {
    private let panel: NSPanel
    private let hostingView: NSHostingView<CaptureView>
    private let viewModel: CaptureViewModel
    private var cancellable: AnyCancellable?

    private static let width: CGFloat = 600
    private static let minHeight: CGFloat = 100
    private static let maxHeight: CGFloat = 600

    init() {
        let vm = CaptureViewModel()
        self.viewModel = vm

        let panel = NSPanel(
            contentRect: NSRect(x: 0, y: 0, width: Self.width, height: 150),
            styleMask: [.nonactivatingPanel, .titled, .fullSizeContentView, .borderless, .resizable],
            backing: .buffered,
            defer: false
        )
        panel.titleVisibility = .hidden
        panel.titlebarAppearsTransparent = true
        panel.isMovableByWindowBackground = true
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = true
        panel.hidesOnDeactivate = false
        panel.isReleasedWhenClosed = false
        panel.animationBehavior = .none
        panel.collectionBehavior = [.canJoinAllSpaces, .transient, .ignoresCycle, .fullScreenAuxiliary]
        panel.level = .floating
        panel.isFloatingPanel = true
        panel.becomesKeyOnlyIfNeeded = false
        panel.standardWindowButton(.closeButton)?.isHidden = true
        panel.standardWindowButton(.miniaturizeButton)?.isHidden = true
        panel.standardWindowButton(.zoomButton)?.isHidden = true

        self.panel = panel

        let hosting = NSHostingView(rootView: CaptureView(model: vm, onRequestHide: { [weak panel] in
            panel?.orderOut(nil)
        }))
        // Without this, NSHostingView lays its SwiftUI root out using its
        // OWN CURRENT FRAME as the size proposal (like any plain NSView) —
        // it never asks SwiftUI for an "ideal" size bigger than whatever
        // frame it already has. `.intrinsicContentSize` is what makes
        // `fittingSize` below actually reflect the text's real height
        // instead of just echoing back the panel's current bounds.
        hosting.sizingOptions = [.standardBounds, .intrinsicContentSize]
        self.hostingView = hosting
        panel.contentView = hosting

        // Re-measure whenever the content that affects height changes.
        // `.async` so SwiftUI has already re-laid-out with the new value
        // by the time we read `fittingSize`.
        cancellable = Publishers.CombineLatest(vm.$text, vm.$statusMessage)
            .sink { [weak self] _, _ in
                DispatchQueue.main.async { self?.resizeToFitContent() }
            }
        resizeToFitContent()
    }

    func configure(token: String?, endpoint: String?) {
        viewModel.configure(token: token, endpoint: endpoint)
    }

    func show(token: String?, endpoint: String?) {
        viewModel.configure(token: token, endpoint: endpoint)
        present()
    }

    func toggle(token: String?, endpoint: String?) {
        if panel.isVisible {
            panel.orderOut(nil)
        } else {
            show(token: token, endpoint: endpoint)
        }
    }

    private func present() {
        if !panel.isVisible {
            resizeToFitContent()
            centerOnActiveScreen()
        }
        // Paint first, then take key status — activation is the slow part
        // (mirrors the Rust implementation's ordering comment).
        panel.orderFrontRegardless()
        NSApp.activate(ignoringOtherApps: true)
        panel.makeKey()
        viewModel.requestFocus()
    }

    private func resizeToFitContent() {
        applyHeight(hostingView.fittingSize.height)
    }

    private func applyHeight(_ height: CGFloat) {
        let clamped = min(max(height, Self.minHeight), Self.maxHeight)
        var frame = panel.frame
        guard abs(frame.size.height - clamped) > 0.5 else { return }
        let top = frame.origin.y + frame.size.height
        frame.size = NSSize(width: Self.width, height: clamped)
        frame.origin.y = top - clamped
        panel.setFrame(frame, display: panel.isVisible, animate: false)
    }

    private func centerOnActiveScreen() {
        guard let screen = NSScreen.main else { return }
        let visible = screen.visibleFrame
        let x = visible.midX - Self.width / 2
        let y = visible.midY + visible.height * 0.15
        panel.setFrameOrigin(NSPoint(x: x, y: y))
    }
}
