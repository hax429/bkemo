import Foundation
#if canImport(Darwin)
import Darwin
#endif

/// Local Unix-domain socket the Tauri process writes to. Tauri still owns
/// the global hotkey; this just tells an already-running helper to
/// show/toggle, carrying whatever bearer token Tauri currently holds (this
/// helper never signs in on its own — see docs/plans/mac.md).
struct IPCCommand: Decodable {
    let cmd: String
    let token: String?
    let endpoint: String?
    let section: String?
}

enum CaptureIPC {
    /// `~/Library/Application Support/me.hax429.bk/capture.sock` — must match
    /// the path the Rust side connects to in `native_capture.rs`.
    static var socketURL: URL {
        if let directory = ProcessInfo.processInfo.environment["BKEMO_NATIVE_TEST_DIRECTORY"] {
            return URL(fileURLWithPath: directory).appendingPathComponent("capture.sock")
        }
        return FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Application Support/me.hax429.bk", isDirectory: true)
            .appendingPathComponent("capture.sock")
    }
}

/// Raw BSD sockets, not `Network.framework` — deliberately. `Network.framework`
/// models every connection (including local Unix-domain ones) as a full
/// connection state machine (waiting → preparing → ready) meant for real
/// network protocols, which adds real per-connection latency that's
/// noticeable on a control channel that's supposed to feel instant for a
/// global-hotkey handoff. A plain blocking `accept()`/`read()` loop on its
/// own thread measured ~0.01ms per round trip in testing.
final class IPCServer {
    private var listenFD: Int32 = -1
    var onCommand: ((IPCCommand) -> Void)?

    func start() {
        let socketURL = CaptureIPC.socketURL
        try? FileManager.default.createDirectory(
            at: socketURL.deletingLastPathComponent(), withIntermediateDirectories: true)
        unlink(socketURL.path)

        let fd = socket(AF_UNIX, SOCK_STREAM, 0)
        guard fd >= 0 else {
            logError("socket() failed: \(errnoString())")
            return
        }

        let path = socketURL.path
        var addr = sockaddr_un()
        addr.sun_family = sa_family_t(AF_UNIX)
        let maxLen = MemoryLayout.size(ofValue: addr.sun_path) - 1
        guard path.utf8.count <= maxLen else {
            logError("socket path too long (\(path.utf8.count) > \(maxLen)): \(path)")
            close(fd)
            return
        }
        withUnsafeMutableBytes(of: &addr.sun_path) { rawPtr in
            let base = rawPtr.baseAddress!.assumingMemoryBound(to: CChar.self)
            path.withCString { _ = strcpy(base, $0) }
        }

        let bound = withUnsafePointer(to: &addr) { ptr -> Int32 in
            ptr.withMemoryRebound(to: sockaddr.self, capacity: 1) { sockaddrPtr in
                bind(fd, sockaddrPtr, socklen_t(MemoryLayout<sockaddr_un>.size))
            }
        }
        guard bound == 0 else {
            logError("bind() failed: \(errnoString())")
            close(fd)
            return
        }
        // 128, not the POSIX-minimum 8: a handful of ⌃W presses in one
        // session was enough to exhaust a backlog of 8 in testing and start
        // silently refusing new connections, which is a much worse failure
        // mode than "backlog slightly oversized for a single-client socket."
        guard listen(fd, 128) == 0 else {
            logError("listen() failed: \(errnoString())")
            close(fd)
            return
        }

        chmod(path, 0o600)
        listenFD = fd
        Thread.detachNewThread { [weak self] in
            self?.acceptLoop(fd: fd)
        }
    }

    private func acceptLoop(fd: Int32) {
        while true {
            let clientFD = accept(fd, nil, nil)
            if clientFD < 0 {
                if errno == EINTR { continue }
                logError("accept() failed: \(errnoString())")
                break
            }
            handle(clientFD)
        }
    }

    private func handle(_ fd: Int32) {
        defer { close(fd) }
        var timeout = timeval(tv_sec: 3, tv_usec: 0)
        setsockopt(fd, SOL_SOCKET, SO_RCVTIMEO, &timeout, socklen_t(MemoryLayout<timeval>.size))
        var data = Data()
        var chunk = [UInt8](repeating: 0, count: 4096)
        while data.count < 65536 {
            let n = chunk.withUnsafeMutableBytes { read(fd, $0.baseAddress, $0.count) }
            if n <= 0 { break }
            data.append(contentsOf: chunk[0..<n])
            if data.contains(0x0A) { break }
        }
        guard let newlineIndex = data.firstIndex(of: 0x0A) else { return }
        let line = data[data.startIndex..<newlineIndex]
        guard let command = try? JSONDecoder().decode(IPCCommand.self, from: Data(line)) else { return }
        let onCommand = onCommand
        DispatchQueue.main.async { onCommand?(command) }
    }

    private func errnoString() -> String { String(cString: strerror(errno)) }

    private func logError(_ message: String) {
        FileHandle.standardError.write(Data("[ipc] \(message)\n".utf8))
    }
}
