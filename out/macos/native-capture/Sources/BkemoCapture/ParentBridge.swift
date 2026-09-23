import Foundation
import Darwin

/// The parent owns local OS integrations. Requests contain preferences only;
/// bearer tokens are never written to this channel or preference files.
enum ParentBridge {
    static func request(_ command: String, input: SettingsValue = .null) async throws -> SettingsValue {
        try await Task.detached {
            let path = CaptureIPC.socketURL.deletingLastPathComponent().appendingPathComponent("native-parent.sock").path
            let fd = socket(AF_UNIX, SOCK_STREAM, 0)
            guard fd >= 0 else { throw SettingsError("Could not contact the bkemo app.") }
            defer { close(fd) }
            var timeout = timeval(tv_sec: 5, tv_usec: 0)
            setsockopt(fd, SOL_SOCKET, SO_RCVTIMEO, &timeout, socklen_t(MemoryLayout<timeval>.size))
            setsockopt(fd, SOL_SOCKET, SO_SNDTIMEO, &timeout, socklen_t(MemoryLayout<timeval>.size))
            var noSignal: Int32 = 1
            setsockopt(fd, SOL_SOCKET, SO_NOSIGPIPE, &noSignal, socklen_t(MemoryLayout<Int32>.size))
            var address = sockaddr_un()
            address.sun_family = sa_family_t(AF_UNIX)
            guard path.utf8.count < MemoryLayout.size(ofValue: address.sun_path) else { throw SettingsError("Application support path is too long.") }
            withUnsafeMutableBytes(of: &address.sun_path) { bytes in path.withCString { _ = strcpy(bytes.baseAddress!.assumingMemoryBound(to: CChar.self), $0) } }
            let connected = withUnsafePointer(to: &address) { pointer in
                pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) { connect(fd, $0, socklen_t(MemoryLayout<sockaddr_un>.size)) }
            }
            guard connected == 0 else { throw SettingsError("Open the main bkemo app to change Mac preferences.") }
            var data = try JSONEncoder().encode(SettingsValue.object(["command": .string(command), "input": input]))
            data.append(10)
            try data.withUnsafeBytes { raw in
                var sent = 0
                while sent < raw.count {
                    let n = write(fd, raw.baseAddress!.advanced(by: sent), raw.count - sent)
                    guard n > 0 else { throw SettingsError("The bkemo app could not receive the change.") }
                    sent += n
                }
            }
            var response = Data()
            var chunk = [UInt8](repeating: 0, count: 4096)
            while response.count < 65536 {
                let count = read(fd, &chunk, chunk.count)
                guard count > 0 else { break }
                response.append(contentsOf: chunk.prefix(count))
                if response.contains(10) { break }
            }
            let result = try JSONDecoder().decode(SettingsValue.self, from: response)
            if !result["error"].string.isEmpty { throw SettingsError(result["error"].string) }
            return result["value"]
        }.value
    }
}
