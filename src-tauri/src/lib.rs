// src-tauri/src/lib.rs

mod commands;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            commands::generate_anchor_id,
            commands::read_note_pair,
            commands::write_note_pair,
            commands::render_markdown,
            commands::plain_text_from_markdown,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
