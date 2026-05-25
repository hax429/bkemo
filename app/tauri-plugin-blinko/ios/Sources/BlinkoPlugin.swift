import SwiftRs
import Tauri
import UIKit
import WebKit

struct SetColorArgs: Decodable {
  let hex: String
}

struct ShareFileArgs: Decodable {
  let url: String
  let filename: String?
}

class BlinkoPlugin: Plugin {

  // Sets the iOS status bar background color from a hex string.
  // Overlays a UIView on top of the status bar area so the WKWebView content
  // doesn't bleed through.
  @objc public func setcolor(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(SetColorArgs.self)
    DispatchQueue.main.async {
      guard let color = UIColor(hex: args.hex) else {
        invoke.reject("Invalid hex color: \(args.hex)")
        return
      }
      self.applyStatusBarColor(color)
      invoke.resolve()
    }
  }

  // Opens iOS app-specific settings screen (Settings > Blinko).
  @objc public func openAppSettings(_ invoke: Invoke) throws {
    DispatchQueue.main.async {
      if let url = URL(string: UIApplication.openSettingsURLString) {
        UIApplication.shared.open(url, options: [:], completionHandler: nil)
      }
      invoke.resolve()
    }
  }

  // Presents the native iOS share sheet for a remote URL.
  // The user can AirDrop, open in Safari, copy the link, etc.
  @objc public func shareFile(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(ShareFileArgs.self)
    DispatchQueue.main.async {
      guard let url = URL(string: args.url) else {
        invoke.reject("Invalid URL: \(args.url)")
        return
      }

      let items: [Any] = [url]
      let activityVC = UIActivityViewController(activityItems: items, applicationActivities: nil)

      // Exclude activity types that don't make sense for remote URLs
      activityVC.excludedActivityTypes = [
        .assignToContact,
        .saveToCameraRoll,
        .addToReadingList,
      ]

      guard let rootVC = self.rootViewController() else {
        invoke.reject("Could not find root view controller")
        return
      }

      // iPad requires a source view for the popover
      if let popover = activityVC.popoverPresentationController {
        popover.sourceView = rootVC.view
        popover.sourceRect = CGRect(
          x: rootVC.view.bounds.midX,
          y: rootVC.view.bounds.midY,
          width: 0,
          height: 0
        )
        popover.permittedArrowDirections = []
      }

      rootVC.present(activityVC, animated: true)
      invoke.resolve()
    }
  }

  // MARK: - Private helpers

  private func applyStatusBarColor(_ color: UIColor) {
    let tag = 9_001  // unique tag to find/replace the overlay view
    for window in UIApplication.shared.windows {
      // Remove any previous overlay
      window.viewWithTag(tag)?.removeFromSuperview()

      // Get the actual status bar frame from the window scene
      var statusBarFrame = CGRect(x: 0, y: 0, width: window.bounds.width, height: 44)
      if let windowScene = window.windowScene,
         let statusBarManager = windowScene.statusBarManager {
        statusBarFrame = statusBarManager.statusBarFrame
      }

      guard statusBarFrame.height > 0 else { continue }

      let overlay = UIView(frame: statusBarFrame)
      overlay.tag = tag
      overlay.backgroundColor = color
      overlay.isUserInteractionEnabled = false
      window.addSubview(overlay)
    }
  }

  private func rootViewController() -> UIViewController? {
    // Walk up the presented chain to find the topmost presented controller
    guard let window = UIApplication.shared.windows.first(where: { $0.isKeyWindow }),
          var rootVC = window.rootViewController else { return nil }
    while let presented = rootVC.presentedViewController {
      rootVC = presented
    }
    return rootVC
  }
}

// MARK: - UIColor hex initialiser

extension UIColor {
  convenience init?(hex: String) {
    let cleaned = hex.trimmingCharacters(in: CharacterSet.alphanumerics.inverted)
    var value: UInt64 = 0
    guard Scanner(string: cleaned).scanHexInt64(&value) else { return nil }
    let a, r, g, b: UInt64
    switch cleaned.count {
    case 6:
      (a, r, g, b) = (255, value >> 16, value >> 8 & 0xFF, value & 0xFF)
    case 8:
      (a, r, g, b) = (value >> 24, value >> 16 & 0xFF, value >> 8 & 0xFF, value & 0xFF)
    default:
      return nil
    }
    self.init(
      red: CGFloat(r) / 255,
      green: CGFloat(g) / 255,
      blue: CGFloat(b) / 255,
      alpha: CGFloat(a) / 255
    )
  }
}

@_cdecl("init_plugin_blinko")
func initPlugin() -> Plugin {
  return BlinkoPlugin()
}
