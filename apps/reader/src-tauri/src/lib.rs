mod commands;

use std::sync::Mutex;
use tauri::{Emitter, Manager, RunEvent, WebviewUrl, WebviewWindowBuilder};

#[derive(Default)]
struct PendingFile(Mutex<Option<String>>);

fn try_emit_open(handle: &tauri::AppHandle, path: &str) -> bool {
    if let Some(window) = handle.get_webview_window("main") {
        let _ = window.emit("open-file", path.to_string());
        true
    } else {
        false
    }
}

/// Frontend calls this on mount; we hand back any path that was queued
/// (e.g. from `open file.jdf` on the CLI or a Finder double-click) and clear
/// the slot so it isn't replayed on a future mount.
#[tauri::command]
fn consume_pending_file(state: tauri::State<'_, PendingFile>) -> Option<String> {
    state.0.lock().ok().and_then(|mut g| g.take())
}

#[tauri::command]
fn open_in_new_window(app: tauri::AppHandle, path: String) -> Result<(), String> {
    // Generate a unique label
    let label = format!("win-{}", std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0));

    let window = WebviewWindowBuilder::new(
        &app,
        &label,
        WebviewUrl::App("index.html".into()),
    )
    .title("JDF Reader")
    .inner_size(1200.0, 800.0)
    .min_inner_size(800.0, 600.0)
    .build()
    .map_err(|e| format!("{}", e))?;

    if !path.is_empty() {
        let path_clone = path.clone();
        let win = window.clone();
        tauri::async_runtime::spawn(async move {
            for _ in 0..40 {
                tokio::time::sleep(std::time::Duration::from_millis(150)).await;
                if win.emit("open-file", path_clone.clone()).is_ok() {
                    break;
                }
            }
        });
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .manage(PendingFile::default())
        .invoke_handler(tauri::generate_handler![
            commands::open_document,
            commands::save_document,
            commands::validate_document,
            commands::search_document,
            commands::import_pdf,
            commands::import_markdown,
            commands::import_markdown_content,
            commands::export_pdf,
            open_in_new_window,
            consume_pending_file,
        ])
        .setup(|app| {
            let args: Vec<String> = std::env::args().collect();
            if let Some(file_path) = args.get(1) {
                let lower = file_path.to_lowercase();
                if lower.ends_with(".jdf") || lower.ends_with(".jdfx") || lower.ends_with(".md") || lower.ends_with(".markdown") || lower.ends_with(".pdf") {
                    let path = file_path.clone();
                    let pending = app.state::<PendingFile>();
                    *pending.0.lock().unwrap() = Some(path.clone());
                    let handle = app.handle().clone();
                    tauri::async_runtime::spawn(async move {
                        for _ in 0..40 {
                            tokio::time::sleep(std::time::Duration::from_millis(150)).await;
                            if try_emit_open(&handle, &path) {
                                if let Some(p) = handle.try_state::<PendingFile>() {
                                    *p.0.lock().unwrap() = None;
                                }
                                break;
                            }
                        }
                    });
                }
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app_handle, event| {
        #[cfg(target_os = "macos")]
        if let RunEvent::Opened { urls } = &event {
            for url in urls {
                let path = match url.to_file_path() {
                    Ok(p) => p.to_string_lossy().to_string(),
                    Err(_) => url.to_string(),
                };
                let lower = path.to_lowercase();
                if !(lower.ends_with(".jdf") || lower.ends_with(".jdfx") || lower.ends_with(".md") || lower.ends_with(".markdown") || lower.ends_with(".pdf")) {
                    continue;
                }
                if !try_emit_open(app_handle, &path) {
                    if let Some(pending) = app_handle.try_state::<PendingFile>() {
                        *pending.0.lock().unwrap() = Some(path.clone());
                    }
                    let path_clone = path.clone();
                    let handle = app_handle.clone();
                    tauri::async_runtime::spawn(async move {
                        for _ in 0..40 {
                            tokio::time::sleep(std::time::Duration::from_millis(150)).await;
                            if try_emit_open(&handle, &path_clone) {
                                break;
                            }
                        }
                    });
                }
            }
        }
        let _ = (app_handle, event);
    });
}
