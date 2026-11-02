fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "notify",
            "open_link",
            "overlay_state",
            "overlay_update",
            "overlay_toggle_mod",
            "overlay_open_folder",
            "overlay_devtools",
            "overlay_menu_toggle",
            "overlay_button_visible",
        ]),
    ))
    .expect("failed to run tauri-build");
}
