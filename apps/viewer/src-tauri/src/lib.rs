mod commands;

use tauri::{Emitter, Manager};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![
            commands::open_document,
            commands::save_document,
            commands::validate_document,
            commands::search_document,
            commands::import_pdf,
            commands::import_markdown,
            commands::export_pdf,
        ])
        .setup(|app| {
            let args: Vec<String> = std::env::args().collect();
            if let Some(file_path) = args.get(1) {
                if file_path.ends_with(".jdf") || file_path.ends_with(".md") || file_path.ends_with(".pdf") {
                    let path = file_path.clone();
                    let handle = app.handle().clone();
                    tauri::async_runtime::spawn(async move {
                        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
                        if let Some(window) = handle.get_webview_window("main") {
                            let _ = window.emit("open-file", path);
                        }
                    });
                }
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
