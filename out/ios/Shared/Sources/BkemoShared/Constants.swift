import Foundation

public enum NoteType {
    public static let blinko = 0
    public static let note = 1
    public static let todo = 2
}

public enum MemoSource {
    public static let manual = ""
    public static let share = "share"
    public static let widgetMemo = "widget.memo"
    public static let widgetTodo = "widget.todo"
    public static let shortcut = "shortcut"
}

public enum BkemoServer {
    public static let endpoint = "https://bk.hax429.me"
}
