fn main() {
    // The commit this binary was built from. The tray's update button
    // compares it with the commit of the rolling GitHub release.
    println!("cargo:rerun-if-env-changed=GITHUB_SHA");
    let sha = std::env::var("GITHUB_SHA")
        .ok()
        .filter(|s| !s.trim().is_empty())
        .or_else(|| {
            std::process::Command::new("git")
                .args(["rev-parse", "HEAD"])
                .output()
                .ok()
                .filter(|o| o.status.success())
                .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        })
        .unwrap_or_else(|| "dev".into());
    println!("cargo:rustc-env=LEAN_TEAMS_BUILD={sha}");

    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "notify",
            "open_link",
            "copy_text",
            "copy_screenshot",
        ]),
    ))
    .expect("failed to run tauri-build");
}
