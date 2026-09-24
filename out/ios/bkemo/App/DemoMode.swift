#if DEBUG
import Foundation
import BkemoShared

/// `-bkemo-demo` launch argument (Debug builds only): an in-memory store with
/// sample memos and no network, for UI work and screenshots.
enum DemoMode {
    static let isOn = ProcessInfo.processInfo.arguments.contains("-bkemo-demo")

    static var memos: [Memo] {
        let now = Date()
        func ago(_ hours: Double) -> Date { now.addingTimeInterval(-hours * 3600) }
        var memos: [Memo] = [
            Memo(serverId: 1, content: "Launch speed is a feature. Every millisecond before the keyboard appears is a thought lost. #bkemo/ios", createdAt: ago(0.3)),
            Memo(serverId: 2, content: "Groceries\n- [x] oat milk\n- [ ] sourdough\n- [ ] miso paste", createdAt: ago(1.6)),
            Memo(serverId: 3, content: "Call the landlord about the heater", type: NoteType.todo, isImportant: true, isUrgent: true, createdAt: ago(3)),
            Memo(serverId: 4, content: "> The best way to have a good idea is to have lots of ideas.\n\n— Linus Pauling #quotes", isTop: true, createdAt: ago(80)),
            Memo(serverId: 5, content: "Reading: **The Design of Everyday Things** — affordances vs. signifiers. https://jnd.org #reading", createdAt: ago(26)),
            Memo(serverId: 6, content: "Ship the offline outbox before the redesign polish.", type: NoteType.todo, completedAt: ago(20), createdAt: ago(30)),
            Memo(serverId: 7, content: "## Weekend\nHike the ridge trail if the weather holds. Pack the thermos. #life", createdAt: ago(50)),
            Memo(serverId: 8, content: "Renew passport photos", type: NoteType.todo, dueDate: now, createdAt: ago(5)),
        ]
        memos.append(Memo(content: "Captured on the subway, no signal. #bkemo/ios", createdAt: ago(0.1)))
        for day in 3..<120 where day % 3 != 0 {
            for n in 0..<(day % 5) {
                memos.append(Memo(serverId: 100 + day * 10 + n, content: "Note \(n + 1) from \(day) days ago #archive/log", createdAt: ago(Double(day * 24 + n))))
            }
        }
        return MemoStore.sorted(memos)
    }
}
#endif

#if DEBUG
import Darwin

/// Logs process-start → first-frame time (Debug only) to keep launch honest.
enum LaunchMetrics {
    private static var reported = false

    static func firstFrame() {
        guard !reported else { return }
        reported = true
        var info = kinfo_proc()
        var size = MemoryLayout<kinfo_proc>.stride
        var mib: [Int32] = [CTL_KERN, KERN_PROC, KERN_PROC_PID, getpid()]
        guard sysctl(&mib, u_int(mib.count), &info, &size, nil, 0) == 0 else { return }
        let start = info.kp_proc.p_starttime
        let started = Double(start.tv_sec) + Double(start.tv_usec) / 1_000_000
        let ms = (Date().timeIntervalSince1970 - started) * 1000
        print("[bkemo] first frame \(Int(ms)) ms after process start")
    }
}
#endif
