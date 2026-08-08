import SwiftUI
import BkemoShared

struct TypeToggle: View {
    @Binding var selection: Int

    var body: some View {
        Picker("Type", selection: $selection) {
            Text("Memo").tag(0)
            Text("Todo").tag(2)
        }
        .pickerStyle(.segmented)
        .onChange(of: selection) { _, new in
            AppGroup.defaults.set(new, forKey: AppGroup.lastTypeKey)
        }
    }
}