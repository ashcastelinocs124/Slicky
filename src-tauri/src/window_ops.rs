use tauri::{
    window::Color, AppHandle, Emitter, LogicalSize, Manager, PhysicalPosition, Runtime,
    WebviewWindow,
};

/// Compact size when the user opens Slicky from the Dock (settings shell).
pub const APP_WINDOW_WIDTH: f64 = 300.0;
pub const APP_WINDOW_HEIGHT: f64 = 360.0;

/// Small popup after a screenshot.
pub const POPUP_WINDOW_WIDTH: f64 = 280.0;
pub const POPUP_WINDOW_HEIGHT: f64 = 300.0;

fn main_window<R: Runtime>(app: &AppHandle<R>) -> Result<WebviewWindow<R>, String> {
    app.get_webview_window("main")
        .ok_or_else(|| "main window not found".to_string())
}

#[cfg(target_os = "macos")]
fn activate_app<R: Runtime>(app: &AppHandle<R>) {
    let _ = app.run_on_main_thread(|| {
        use objc2_app_kit::NSApplication;
        use objc2_foundation::MainThreadMarker;
        let mtm = unsafe { MainThreadMarker::new_unchecked() };
        let ns_app = NSApplication::sharedApplication(mtm);
        #[allow(deprecated)]
        ns_app.activateIgnoringOtherApps(true);
    });
}

#[cfg(not(target_os = "macos"))]
fn activate_app<R: Runtime>(_app: &AppHandle<R>) {}

/// Remove macOS window shadow / chrome so the app has no visible outline —
/// only the React panels (read-bar / read-panel) are visible.
#[cfg(target_os = "macos")]
pub fn strip_window_chrome<R: Runtime>(win: &WebviewWindow<R>) {
    let Ok(ptr) = win.ns_window() else {
        return;
    };
    unsafe {
        use objc2_app_kit::NSWindow;
        let ns_window: &NSWindow = &*ptr.cast();
        ns_window.setHasShadow(false);
        ns_window.setOpaque(false);
    }
}

#[cfg(not(target_os = "macos"))]
pub fn strip_window_chrome<R: Runtime>(_win: &WebviewWindow<R>) {}

#[cfg(target_os = "macos")]
fn apply_aggressive_popup_level<R: Runtime>(win: &WebviewWindow<R>) {
    let Ok(ptr) = win.ns_window() else {
        return;
    };
    unsafe {
        use objc2_app_kit::{
            NSWindow, NSWindowCollectionBehavior, NSPopUpMenuWindowLevel,
        };
        let ns_window: &NSWindow = &*ptr.cast();
        ns_window.setLevel(NSPopUpMenuWindowLevel);
        ns_window.setHidesOnDeactivate(false);
        let behavior = NSWindowCollectionBehavior::CanJoinAllSpaces
            | NSWindowCollectionBehavior::FullScreenAuxiliary
            | NSWindowCollectionBehavior::Stationary
            | NSWindowCollectionBehavior::IgnoresCycle;
        ns_window.setCollectionBehavior(behavior);
    }
}

#[cfg(target_os = "macos")]
fn order_front_aggressive<R: Runtime>(win: &WebviewWindow<R>) {
    let Ok(ptr) = win.ns_window() else {
        return;
    };
    unsafe {
        use objc2_app_kit::NSWindow;
        let ns_window: &NSWindow = &*ptr.cast();
        ns_window.orderFrontRegardless();
        ns_window.makeKeyAndOrderFront(None);
    }
}

#[cfg(target_os = "macos")]
fn schedule_popup_refront<R: Runtime>(app: AppHandle<R>) {
    for delay_ms in [80_u64, 220] {
        let app = app.clone();
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_millis(delay_ms));
            let app2 = app.clone();
            let _ = app.run_on_main_thread(move || {
                if let Some(win) = app2.get_webview_window("main") {
                    if win.is_visible().unwrap_or(false) {
                        activate_app(&app2);
                        order_front_aggressive(&win);
                    }
                }
            });
        });
    }
}

fn prepare_window<R: Runtime>(win: &WebviewWindow<R>) {
    let _ = win.set_background_color(Some(Color(0, 0, 0, 0)));
    strip_window_chrome(win);
}

fn present_popup<R: Runtime>(
    app: &AppHandle<R>,
    win: &WebviewWindow<R>,
) -> Result<(), String> {
    prepare_window(win);
    let _ = win.set_size(LogicalSize::new(POPUP_WINDOW_WIDTH, POPUP_WINDOW_HEIGHT));
    activate_app(app);
    win.show().map_err(|e| e.to_string())?;
    win.set_always_on_top(true).map_err(|e| e.to_string())?;
    #[cfg(target_os = "macos")]
    {
        apply_aggressive_popup_level(win);
        order_front_aggressive(win);
        schedule_popup_refront(app.clone());
    }
    win.set_focus().map_err(|e| e.to_string())?;
    Ok(())
}

/// Open the application from the Dock — compact settings window, not a large shell.
pub fn show_app_window<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    let win = main_window(app)?;
    prepare_window(&win);
    win.set_size(LogicalSize::new(APP_WINDOW_WIDTH, APP_WINDOW_HEIGHT))
        .map_err(|e| e.to_string())?;
    win.center().map_err(|e| e.to_string())?;
    activate_app(app);
    win.show().map_err(|e| e.to_string())?;
    win.set_always_on_top(false).map_err(|e| e.to_string())?;
    #[cfg(target_os = "macos")]
    {
        let Ok(ptr) = win.ns_window() else {
            return Ok(());
        };
        unsafe {
            use objc2_app_kit::NSWindow;
            let ns_window: &NSWindow = &*ptr.cast();
            ns_window.setLevel(0); // normal window level for settings
        }
    }
    win.set_focus().map_err(|e| e.to_string())?;
    let _ = app.emit("slickly://open-settings", ());
    Ok(())
}

pub fn configure_main_window_at_startup<R: Runtime>(app: &AppHandle<R>) {
    if let Some(win) = app.get_webview_window("main") {
        prepare_window(&win);
        let _ = win.set_size(LogicalSize::new(APP_WINDOW_WIDTH, APP_WINDOW_HEIGHT));
    }
}

#[tauri::command]
pub fn show_main_window(app: AppHandle) -> Result<(), String> {
    show_app_window(&app)
}

#[tauri::command]
pub fn hide_main_window(app: AppHandle) -> Result<(), String> {
    let win = main_window(&app)?;
    win.hide().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn resize_main_window(app: AppHandle, width: f64, height: f64) -> Result<(), String> {
    let win = main_window(&app)?;
    let clamped_w = width.clamp(260.0, 720.0);
    let clamped_h = height.clamp(160.0, 600.0);
    win.set_size(LogicalSize::new(clamped_w, clamped_h))
        .map_err(|e| e.to_string())
}

pub fn present_popup_near_cursor<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    let win = main_window(app)?;

    let cursor = match app.cursor_position() {
        Ok(p) => p,
        Err(_) => {
            return present_popup(app, &win);
        }
    };

    let monitor = app
        .monitor_from_point(cursor.x, cursor.y)
        .ok()
        .flatten()
        .or_else(|| app.primary_monitor().ok().flatten());

    let win_size = LogicalSize::new(POPUP_WINDOW_WIDTH, POPUP_WINDOW_HEIGHT);
    let _ = win.set_size(win_size);

    let mut x = cursor.x + 24.0;
    let mut y = cursor.y + 24.0;

    if let Some(m) = monitor {
        let mp = m.position();
        let ms = m.size();
        let margin = 16.0_f64;
        let min_x = mp.x as f64 + margin;
        let min_y = mp.y as f64 + margin;
        let max_x = (mp.x as f64 + ms.width as f64) - POPUP_WINDOW_WIDTH - margin;
        let max_y = (mp.y as f64 + ms.height as f64) - POPUP_WINDOW_HEIGHT - margin;
        if x > max_x {
            x = (cursor.x - POPUP_WINDOW_WIDTH - 24.0).max(min_x);
        }
        if y > max_y {
            y = (cursor.y - POPUP_WINDOW_HEIGHT - 24.0).max(min_y);
        }
        x = x.clamp(min_x, max_x.max(min_x));
        y = y.clamp(min_y, max_y.max(min_y));
    }

    win.set_position(PhysicalPosition::new(x, y))
        .map_err(|e| e.to_string())?;
    present_popup(app, &win)
}

#[tauri::command]
pub fn show_popup_near_cursor(app: AppHandle) -> Result<(), String> {
    present_popup_near_cursor(&app)
}
