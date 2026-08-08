const COMMANDS: &[&str] = &["setcolor", "share_file"];

fn main() {
  tauri_plugin::Builder::new(COMMANDS)
    .ios_path("ios")
    .build();
}
