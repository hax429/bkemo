import XCTest
@testable import bkemo

@MainActor
final class BiometricGateTests: XCTestCase {
    func testMissingPreferenceDefaultsOff() {
        XCTAssertFalse(BiometricGate.preferenceEnabled(storedValue: nil))
    }

    func testExplicitTruePreferenceStaysOn() {
        XCTAssertTrue(BiometricGate.preferenceEnabled(storedValue: true))
    }

    func testExplicitFalsePreferenceStaysOff() {
        XCTAssertFalse(BiometricGate.preferenceEnabled(storedValue: false))
    }
}
