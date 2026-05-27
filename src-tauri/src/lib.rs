mod capture;
mod screenshot_watcher;
mod shortcut;
mod storage;
mod window_ops;

use tauri::{Manager, RunEvent, window::Color};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(shortcut::build_plugin())
        .setup(|app| {
            if let Err(e) = storage::ensure_storage_dirs(&app.handle()) {
                eprintln!("[slickly] failed to create storage dirs: {e}");
            }

            if let Err(e) = shortcut::register_default(&app.handle()) {
                eprintln!("[slickly] failed to register default shortcut: {e}");
            }

            screenshot_watcher::spawn(app.handle().clone());
            window_ops::configure_main_window_at_startup(&app.handle());

            // Background app: no window on launch. The Dock icon stays, but
            // nothing appears until ⌘⇧4 (popup) or the user clicks the icon
            // (compact settings).
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.set_background_color(Some(Color(0, 0, 0, 0)));
                let _ = win.hide();
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            capture::capture_screenshot,
            capture::read_screenshot_b64,
            storage::load_history,
            storage::save_history_entry,
            storage::delete_history_entry,
            storage::clear_history,
            storage::load_settings,
            storage::save_settings,
            window_ops::show_main_window,
            window_ops::show_popup_near_cursor,
            window_ops::hide_main_window,
            window_ops::resize_main_window,
            shortcut::reregister_shortcut,
        ])
        .build(tauri::generate_context!())
        .expect("error while building Slickly")
        .run(|app_handle, event| {
            if let RunEvent::Reopen {
                has_visible_windows,
                ..
            } = event
            {
                if !has_visible_windows {
                    let _ = window_ops::show_app_window(app_handle);
                }
            }
        });
}
