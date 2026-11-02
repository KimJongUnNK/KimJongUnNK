fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "notify",
            "open_link",
            "overlay_state",
            "overlay_save",
            "overlay_toggle_mod",
            "overlay_open_folder",
            "overlay_devtools",
        ]),
    ))
    .expect("failed to run tauri-build");
}
