import Foundation

public enum TagParser {
    public static func extract(_ text: String) -> [String] {
        let withoutCode = text.replacingOccurrences(of: "\\{\\{[\\s\\S]*?\\}\\}", with: "", options: .regularExpression)
            .replacingOccurrences(of: "```[\\s\\S]*?```", with: "", options: .regularExpression)
        var tags: [String] = []
        let pattern = "(?<=\\s|^)#[^\\s#]+(?=\\s|$)"
        guard let regex = try? NSRegularExpression(pattern: pattern) else { return [] }
        let range = NSRange(withoutCode.startIndex..., in: withoutCode)
        for match in regex.matches(in: withoutCode, range: range) {
            if let r = Range(match.range, in: withoutCode) {
                tags.append(String(withoutCode[r]).dropFirst().description)
            }
        }
        return tags
    }
}