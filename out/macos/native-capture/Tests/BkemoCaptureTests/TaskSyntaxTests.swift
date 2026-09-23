import XCTest
@testable import BkemoCapture

final class TaskSyntaxTests: XCTestCase {
    func testPlainMemoIsNotATodo() {
        let parsed = TaskSyntax.parse("just a memo")
        XCTAssertEqual(parsed.content, "just a memo")
        XCTAssertFalse(parsed.isTodo)
        XCTAssertNil(parsed.dueDate)
    }

    func testCheckboxPromotesToTodoAndStripsLoneMarker() {
        let parsed = TaskSyntax.parse("- [ ] buy milk")
        XCTAssertTrue(parsed.isTodo)
        XCTAssertEqual(parsed.content, "buy milk")
    }

    func testEscapedCheckboxFromTiptapIsNormalized() {
        let parsed = TaskSyntax.parse("\\-\\[\\] buy milk")
        XCTAssertTrue(parsed.isTodo)
        XCTAssertEqual(parsed.content, "buy milk")
    }

    func testMultiItemChecklistKeepsAllCheckboxes() {
        let parsed = TaskSyntax.parse("- [ ] one\n- [x] two")
        XCTAssertTrue(parsed.isTodo)
        XCTAssertEqual(parsed.content, "- [ ] one\n- [x] two")
    }

    func testDueTodaySetsEndOfDayAndPromotesToTodo() {
        let parsed = TaskSyntax.parse("water plants due:today")
        XCTAssertTrue(parsed.isTodo)
        XCTAssertEqual(parsed.content, "water plants")
        XCTAssertNotNil(parsed.dueDate)
        let cal = Calendar.current
        XCTAssertTrue(cal.isDateInToday(parsed.dueDate!))
    }

    func testDueNoneClearsWithoutSettingATodo() {
        let parsed = TaskSyntax.parse("random note due:none")
        XCTAssertNil(parsed.dueDate)
        XCTAssertFalse(parsed.isTodo)
        XCTAssertEqual(parsed.content, "random note")
    }

    func testUnrecognizedDueValueIsLeftInPlace() {
        let parsed = TaskSyntax.parse("check due:whenever")
        XCTAssertNil(parsed.dueDate)
        XCTAssertEqual(parsed.content, "check due:whenever")
    }

    func testImportantAndUrgentTagsAreStrippedAndFlagged() {
        let parsed = TaskSyntax.parse("ship the release #important #urgent")
        XCTAssertTrue(parsed.isImportant)
        XCTAssertTrue(parsed.isUrgent)
        XCTAssertEqual(parsed.content, "ship the release")
    }

    func testUrlIsNotMistakenForDueToken() {
        let parsed = TaskSyntax.parse("see https://example.com/due:today for context")
        XCTAssertNil(parsed.dueDate)
        XCTAssertEqual(parsed.content, "see https://example.com/due:today for context")
    }
}
