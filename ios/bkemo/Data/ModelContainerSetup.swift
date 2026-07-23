import Foundation
import SwiftData
import BkemoShared

enum ModelContainerSetup {
    static func make() -> ModelContainer {
        let schema = Schema([LocalMemo.self])
        let config = ModelConfiguration("Memo", schema: schema, url: AppGroup.storeURL, cloudKitDatabase: .none)
        do {
            return try ModelContainer(for: schema, configurations: [config])
        } catch {
            do {
                try FileManager.default.removeItem(at: AppGroup.storeURL)
            } catch { }
            return try! ModelContainer(for: schema, configurations: [config])
        }
    }
}