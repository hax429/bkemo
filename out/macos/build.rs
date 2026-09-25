use std::process::Command;

/// Stamp the same build fields as the web bundle (scripts/buildInfo.ts):
/// version from the root package.json, commit count as the build number,
/// short commit (+"-dirty"), and build time. Read at runtime via env!().
fn main() {
    let git = |args: &[&str]| -> String {
        Command::new("git")
            .args(args)
            .current_dir("../..")
            .output()
            .ok()
            .filter(|o| o.status.success())
            .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
            .unwrap_or_default()
    };
    let version = std::fs::read_to_string("../../package.json")
        .ok()
        .and_then(|raw| serde_json::from_str::<serde_json::Value>(&raw).ok())
        .and_then(|pkg| pkg["version"].as_str().map(str::to_string))
        .unwrap_or_else(|| "0.0.0".into());
    let build = git(&["rev-list", "--count", "HEAD"]);
    let commit = git(&["rev-parse", "--short", "HEAD"]);
    let dirty = !git(&["status", "--porcelain", "--untracked-files=no"]).is_empty();
    let built_at = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);

    println!("cargo:rustc-env=BKEMO_VERSION={version}");
    println!("cargo:rustc-env=BKEMO_BUILD={}", if build.is_empty() { "0" } else { &build });
    println!("cargo:rustc-env=BKEMO_COMMIT={}{}", if commit.is_empty() { "unknown" } else { &commit }, if dirty { "-dirty" } else { "" });
    println!("cargo:rustc-env=BKEMO_BUILT_AT={built_at}");
    // Re-stamp on every commit/checkout, not only when Rust sources change.
    let git_dir = git(&["rev-parse", "--absolute-git-dir"]);
    if !git_dir.is_empty() {
        println!("cargo:rerun-if-changed={git_dir}/HEAD");
        println!("cargo:rerun-if-changed={git_dir}/index");
    }
    println!("cargo:rerun-if-changed=../../package.json");

    tauri_build::build()
}
