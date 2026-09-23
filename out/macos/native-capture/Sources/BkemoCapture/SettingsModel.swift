import Foundation
import AppKit

private final class NoSettingsRedirects: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) { completionHandler(nil) }
}

@MainActor
final class SettingsModel: ObservableObject {
    @Published var snapshot: SettingsSnapshot?
    @Published var message: String?
    @Published var online = false
    @Published var busy = false
    @Published var selection: String? = "desktop"
    @Published var search = ""
    @Published var desktop: SettingsValue = .object([:])
    @Published var results: [String: SettingsValue] = [:]
    /// Edited-but-unsaved config values, keyed by config key. Rows read
    /// through this before falling back to the last-fetched snapshot value,
    /// so every field on every page shares one "Save changes" action instead
    /// of a save button per row.
    @Published var configEdits: [String: SettingsValue] = [:]
    @Published var savingConfig = false
    var hasConfigEdits: Bool { !configEdits.isEmpty }
    private var token: String?
    private(set) var endpoint = ""
    private var generation = 0
    private let session = URLSession(configuration: .ephemeral, delegate: NoSettingsRedirects(), delegateQueue: nil)

    func configure(token: String?, endpoint: String?, section: String? = nil) {
        let nextEndpoint = endpoint ?? self.endpoint
        if token != self.token || nextEndpoint != self.endpoint {
            generation += 1
            snapshot = nil
            results = [:]
            message = nil
            online = false
            busy = false
            configEdits = [:]
        }
        self.token = token
        self.endpoint = nextEndpoint
        if let section, !section.isEmpty { selection = section }
    }
    /// Saves every pending config edit in one pass. Each key still goes
    /// through the existing `config.update` operation (server-validated,
    /// same as any other action) — this just batches the button, not the
    /// server calls. Edits that fail stay pending so the field keeps
    /// showing the user's typed value and Save can be retried.
    func saveConfigEdits() async {
        guard online, snapshot?.version == 1, !savingConfig, !configEdits.isEmpty else { return }
        savingConfig = true
        defer { savingConfig = false }
        var remaining = configEdits
        for (key, value) in configEdits {
            do {
                _ = try await perform("config.update", input: .object(["key": .string(key), "value": value]))
                remaining.removeValue(forKey: key)
            } catch {
                message = error.localizedDescription
            }
        }
        configEdits = remaining
        if remaining.isEmpty { message = nil }
        await refresh()
    }
    func refresh() async {
        let revision = generation
        do { desktop = try await ParentBridge.request("desktop.get") }
        catch { if snapshot == nil { message = error.localizedDescription } }
        guard token != nil else { message = "Sign in through the main bkemo window to manage account settings."; return }
        busy = true
        defer { if revision == generation { busy = false } }
        do {
            let data = try await request(path: "/api/v1/native/settings")
            let loaded = try JSONDecoder().decode(SettingsSnapshot.self, from: data)
            guard revision == generation else { return }
            snapshot = loaded
            online = true
            message = loaded.version == 1 ? nil : "These settings require a newer bkemo app. Open settings in your browser to continue."
        } catch {
            guard revision == generation else { return }
            online = false
            message = error.localizedDescription
        }
    }
    private func request(path: String, body: SettingsValue? = nil) async throws -> Data {
        guard let base = URL(string: endpoint), let url = URL(string: path, relativeTo: base)?.absoluteURL,
              ["https", "http"].contains(url.scheme ?? ""),
              url.scheme == "https" || ["localhost", "127.0.0.1", "::1"].contains(url.host ?? "") else {
            throw SettingsError("Use an HTTPS server address, or a local development server.")
        }
        var request = URLRequest(url: url)
        request.timeoutInterval = 30
        request.setValue("Bearer \(token ?? "")", forHTTPHeaderField: "Authorization")
        request.setValue("macos", forHTTPHeaderField: "X-Bkemo-Platform")
        if let body {
            request.httpMethod = "POST"
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONEncoder().encode(body)
        }
        let revision = generation
        let (data, response) = try await session.data(for: request)
        guard let response = response as? HTTPURLResponse else { throw SettingsError("The server did not return a response.") }
        guard (200..<300).contains(response.statusCode) else {
            if response.statusCode == 401 || response.statusCode == 403 {
                if revision == generation { snapshot = nil; results = [:]; online = false }
                throw SettingsError("Your access changed. Sign in again or refresh your permissions.")
            }
            let json = (try? JSONDecoder().decode(SettingsValue.self, from: data)) ?? .null
            throw SettingsError(json["message"].string.isEmpty ? "Settings request failed (\(response.statusCode))." : json["message"].string)
        }
        return data
    }
    func perform(_ operation: String, input: SettingsValue, confirmed: Bool = false) async throws -> SettingsValue {
        guard online, snapshot?.version == 1, !busy else { throw SettingsError("Refresh your connection before changing settings.") }
        let revision = generation
        busy = true
        defer { if revision == generation { busy = false } }
        var body: SettingsValue = .object(["operation": .string(operation), "confirmed": .bool(confirmed)])
        if !input.isNull { body["input"] = input }
        let data: Data
        do { data = try await request(path: "/api/v1/native/settings/action", body: body) }
        catch {
            if revision == generation, error is URLError { online = false }
            throw error
        }
        guard revision == generation else { throw SettingsError("The account changed. Refresh settings before continuing.") }
        let result = try JSONDecoder().decode(SettingsValue.self, from: data)
        results[operation] = result
        _ = try? await ParentBridge.request("settings.changed")
        return result
    }
    func saveDesktop(_ value: SettingsValue) async throws {
        desktop = try await ParentBridge.request("desktop.save", input: value)
    }
    func openBrowser() {
        guard let url = URL(string: endpoint + "/settings"), ["https", "http"].contains(url.scheme ?? "") else { return }
        NSWorkspace.shared.open(url)
    }
    func chooseUpload() async throws -> String {
        let panel = NSOpenPanel()
        panel.canChooseDirectories = false
        guard await panel.begin() == .OK, let url = panel.url else { throw SettingsError("No file selected.") }
        let data = try Data(contentsOf: url)
        guard data.count <= 100 * 1024 * 1024 else { throw SettingsError("Choose a file smaller than 100 MB.") }
        let boundary = UUID().uuidString
        var request = URLRequest(url: URL(string: endpoint + "/api/file/upload")!)
        request.httpMethod = "POST"
        request.setValue("Bearer \(token ?? "")", forHTTPHeaderField: "Authorization")
        request.setValue("macos", forHTTPHeaderField: "X-Bkemo-Platform")
        request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        let name = url.lastPathComponent.replacingOccurrences(of: "\"", with: "").replacingOccurrences(of: "\r", with: "").replacingOccurrences(of: "\n", with: "")
        var body = Data("--\(boundary)\r\nContent-Disposition: form-data; name=\"file\"; filename=\"\(name)\"\r\nContent-Type: application/octet-stream\r\n\r\n".utf8)
        body.append(data); body.append(Data("\r\n--\(boundary)--\r\n".utf8)); request.httpBody = body
        let (responseData, response) = try await session.data(for: request)
        guard let response = response as? HTTPURLResponse, (200..<300).contains(response.statusCode) else { throw SettingsError("File upload failed.") }
        let result = try JSONDecoder().decode(SettingsValue.self, from: responseData)
        guard !result["filePath"].string.isEmpty else { throw SettingsError("The server did not return an uploaded file.") }
        return result["filePath"].string
    }
    func download(_ result: SettingsValue) async throws {
        guard let url = URL(string: result["downloadUrl"].string, relativeTo: URL(string: endpoint))?.absoluteURL,
              let base = URL(string: endpoint), url.host == base.host, url.scheme == base.scheme, url.port == base.port else { throw SettingsError("Unexpected download address.") }
        var request = URLRequest(url: url)
        request.setValue("Bearer \(token ?? "")", forHTTPHeaderField: "Authorization")
        request.setValue("macos", forHTTPHeaderField: "X-Bkemo-Platform")
        let (temp, response) = try await session.download(for: request)
        guard (response as? HTTPURLResponse)?.statusCode == 200 else { throw SettingsError("Download failed.") }
        let panel = NSSavePanel()
        panel.nameFieldStringValue = result["filename"].string
        if await panel.begin() == .OK, let destination = panel.url { try Data(contentsOf: temp).write(to: destination, options: .atomic) }
    }
}
struct SettingsError: LocalizedError {
    let message: String
    init(_ message: String) { self.message = message }
    var errorDescription: String? { message }
}
