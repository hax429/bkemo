import SwiftUI
import UIKit
import ImageIO
import CryptoKit
import BkemoShared

/// Authenticated, downsampled attachment thumbnails with memory + disk cache,
/// so images stay visible offline once seen.
actor ImageLoader {
    static let shared = ImageLoader()

    private let memory = NSCache<NSString, UIImage>()
    private var inFlight: [String: Task<UIImage?, Never>] = [:]

    init() {
        memory.countLimit = 150
    }

    nonisolated func cached(path: String) -> UIImage? {
        memory.object(forKey: path as NSString)
    }

    func image(path: String, client: BkemoClient, maxPixel: CGFloat) async -> UIImage? {
        if let hit = memory.object(forKey: path as NSString) { return hit }
        if let task = inFlight[path] { return await task.value }
        let task = Task<UIImage?, Never>.detached(priority: .utility) {
            let file = AppGroup.imageCacheURL.appendingPathComponent(Self.fileName(for: path))
            if let data = try? Data(contentsOf: file), let image = Self.downsample(data, maxPixel: maxPixel) {
                return image
            }
            guard let data = try? await client.fileData(path: path) else { return nil }
            try? data.write(to: file, options: .atomic)
            return Self.downsample(data, maxPixel: maxPixel)
        }
        inFlight[path] = task
        let image = await task.value
        inFlight[path] = nil
        if let image { memory.setObject(image, forKey: path as NSString) }
        return image
    }

    private static func fileName(for path: String) -> String {
        SHA256.hash(data: Data(path.utf8)).map { String(format: "%02x", $0) }.joined()
    }

    private static func downsample(_ data: Data, maxPixel: CGFloat) -> UIImage? {
        let options = [kCGImageSourceShouldCache: false] as CFDictionary
        guard let source = CGImageSourceCreateWithData(data as CFData, options) else { return nil }
        let thumbOptions = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceShouldCacheImmediately: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceThumbnailMaxPixelSize: maxPixel,
        ] as CFDictionary
        guard let cg = CGImageSourceCreateThumbnailAtIndex(source, 0, thumbOptions) else { return nil }
        return UIImage(cgImage: cg)
    }
}

struct AttachmentImage: View {
    let path: String
    @State private var image: UIImage?

    var body: some View {
        ZStack {
            Rectangle().fill(Theme.surface2)
            if let image {
                Image(uiImage: image)
                    .resizable()
                    .scaledToFill()
                    .transition(.opacity)
            } else {
                Image(systemName: "photo")
                    .font(.system(size: 15))
                    .foregroundStyle(Theme.fg3)
            }
        }
        .clipped()
        .task(id: path) {
            if let hit = ImageLoader.shared.cached(path: path) {
                image = hit
                return
            }
            let loaded = await ImageLoader.shared.image(path: path, client: Session.shared.client, maxPixel: 600)
            withAnimation(.easeOut(duration: 0.2)) { image = loaded }
        }
    }
}
