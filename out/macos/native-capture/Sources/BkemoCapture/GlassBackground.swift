import SwiftUI
import AppKit

struct GlassBackground: ViewModifier {
    var cornerRadius: CGFloat
    func body(content: Content) -> some View {
        content.glassEffect(.regular, in: RoundedRectangle(cornerRadius: cornerRadius, style: .continuous))
    }
}
extension View {
    func captureGlass(cornerRadius: CGFloat = 14) -> some View {
        modifier(GlassBackground(cornerRadius: cornerRadius))
    }
}

/// Full-window Liquid Glass backdrop: an `NSVisualEffectView` sitting behind
/// SwiftUI content so the window reads as a translucent glass panel over the
/// desktop, matching the rest of macOS 26's system chrome (System Settings,
/// Finder). SwiftUI has no direct handle on the hosting `NSWindow`'s
/// background from a plain `NSHostingView`, so this goes through AppKit.
struct VisualEffectBackground: NSViewRepresentable {
    var material: NSVisualEffectView.Material = .underWindowBackground
    func makeNSView(context: Context) -> NSVisualEffectView {
        let view = NSVisualEffectView()
        view.material = material
        view.blendingMode = .behindWindow
        view.state = .active
        view.isEmphasized = true
        return view
    }
    func updateNSView(_ nsView: NSVisualEffectView, context: Context) { nsView.material = material }
}
