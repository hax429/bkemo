import XCTest
@testable import BkemoCapture

final class SettingsTests: XCTestCase {
    func testRequiredDefaultsNeverInventOptionalChanges() throws {
        let schema = try JSONDecoder().decode(SettingsValue.self, from: Data(#"{"type":"object","required":["name","enabled"],"properties":{"name":{"type":"string"},"enabled":{"type":"boolean","default":true},"password":{"type":"string"},"limit":{"type":"number","default":10}}}"#.utf8))
        XCTAssertEqual(schema.initialValue["name"], .string(""))
        XCTAssertEqual(schema.initialValue["enabled"], .bool(true))
        XCTAssertEqual(schema.initialValue["limit"], .number(10))
        XCTAssertNil(schema.initialValue.object["password"])
    }
    func testNullableAndEnumeratedDefaults() throws {
        let schema: SettingsValue = .object(["anyOf": .array([.object(["type": .string("null")]), .object(["type": .string("number")])])])
        XCTAssertEqual(schema.initialValue, .number(0))
        let choice: SettingsValue = .object(["enum": .array([.string("merge"), .string("replace")])])
        XCTAssertEqual(choice.initialValue, .string("merge"))
    }
    func testValueRoundTripPreservesBooleanNumberAndNestedObjects() throws {
        let value: SettingsValue = .object(["enabled": .bool(false), "limit": .number(3), "nested": .array([.null, .string("memo")])])
        XCTAssertEqual(try JSONDecoder().decode(SettingsValue.self, from: JSONEncoder().encode(value)), value)
    }
    func testLabelsAndCredentialFields() {
        XCTAssertEqual(settingTitle("quickNote"), "Quick Note shortcut")
        XCTAssertEqual(settingTitle("modelKey"), "Model Key")
        XCTAssertTrue(isSecretField("clientSecret"))
        XCTAssertFalse(isSecretField("modelKey"))
    }
}
