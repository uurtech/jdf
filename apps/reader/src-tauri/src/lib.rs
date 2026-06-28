mod commands;

use std::sync::Mutex;
use tauri::{Emitter, Manager, RunEvent, WebviewUrl, WebviewWindowBuilder, WindowEvent};

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
async fn open_in_new_window(app: tauri::AppHandle, path: String) -> Result<(), String> {
    let label = format!("win-{}", std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0));

    let app_clone = app.clone();
    let path_clone = path.clone();

    // Build the window on the main thread via run_on_main_thread to avoid
    // blocking the IPC channel (WebView2 on Windows deadlocks otherwise).
    app.run_on_main_thread(move || {
        let window = WebviewWindowBuilder::new(
            &app_clone,
            &label,
            WebviewUrl::App("index.html".into()),
        )
        .title("JDF Reader")
        .inner_size(1200.0, 800.0)
        .min_inner_size(800.0, 600.0)
        .decorations(false)
        .build();

        if let Ok(win) = window {
            if !path_clone.is_empty() {
                let w = win.clone();
                let p = path_clone.clone();
                tauri::async_runtime::spawn(async move {
                    for _ in 0..40 {
                        tokio::time::sleep(std::time::Duration::from_millis(150)).await;
                        if w.emit("open-file", p.clone()).is_ok() {
                            break;
                        }
                    }
                });
            }
        }
    }).map_err(|e| format!("{}", e))?;

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
        .on_window_event(|window, event| {
            if let WindowEvent::Destroyed = event {
                // On Windows/Linux, exit when all windows are closed.
                // macOS keeps the app alive in the dock (handled by Tauri default).
                #[cfg(not(target_os = "macos"))]
                {
                    let app = window.app_handle();
                    let remaining = app.webview_windows().len();
                    if remaining == 0 {
                        app.exit(0);
                    }
                }
            }
            let _ = window;
        })
        .setup(|app| {
            let args: Vec<String> = std::env::args().collect();
            if let Some(file_path) = args.get(1) {
                let lower = file_path.to_lowercase();
                if lower.ends_with(".jdf") || lower.ends_with(".jdfx") || lower.ends_with(".md") || lower.ends_with(".markdown") || lower.ends_with(".pdf") {
                    let path = file_path.clone();
                    let pending = app.state::<PendingFile>();
                    if let Ok(mut g) = pending.0.lock() { *g = Some(path.clone()); }
                    let handle = app.handle().clone();
                    tauri::async_runtime::spawn(async move {
                        for _ in 0..40 {
                            tokio::time::sleep(std::time::Duration::from_millis(150)).await;
                            if try_emit_open(&handle, &path) {
                                if let Some(p) = handle.try_state::<PendingFile>() {
                                    if let Ok(mut g) = p.0.lock() { *g = None; }
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
        match &event {
            #[cfg(target_os = "macos")]
            RunEvent::Opened { urls } => {
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
                            if let Ok(mut g) = pending.0.lock() { *g = Some(path.clone()); }
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
            RunEvent::ExitRequested { code, .. } => {
                if code.is_none() {
                    // All windows closed — let the app exit.
                }
            }
            _ => {}
        }
        let _ = app_handle;
    });
}
