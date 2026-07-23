import Foundation
import LinkPresentation

public actor URLMetadata {
    public static func fetchTitle(_ url: URL, timeout: TimeInterval = 2.0) async -> String? {
        await withCheckedContinuation { continuation in
            let provider = LPMetadataProvider()
            provider.timeout = timeout
            provider.startFetchingMetadata(for: url) { meta, _ in
                if let title = meta?.title, !title.isEmpty {
                    continuation.resume(returning: title)
                } else {
                    continuation.resume(returning: nil)
                }
            }
        }
    }
}