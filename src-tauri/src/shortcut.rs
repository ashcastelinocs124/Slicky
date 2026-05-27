use std::sync::Mutex;

use tauri::{AppHandle, Emitter, Manager, Runtime};
use tauri_plugin_global_shortcut::{
    Builder as ShortcutBuilder, GlobalShortcutExt, Shortcut, ShortcutState,
};

use crate::storage;

/// Tauri-managed state: the currently active global shortcut, so we can
/// unregister it cleanly when the user changes their preference at runtime.
pub struct ActiveShortcut(pub Mutex<Option<Shortcut>>);

/// Construct the plugin with our handler attached. The handler stays alive
/// for the lifetime of the app and fires for every shortcut we register.
pub fn build_plugin<R: Runtime>() -> tauri::plugin::TauriPlugin<R> {
    ShortcutBuilder::new()
        .with_handler(|app, _shortcut, event| {
            // Only react to the key-down edge to avoid firing twice on release.
            if event.state() != ShortcutState::Pressed {
                return;
            }
            // Tell the frontend to kick off the capture flow. The frontend is
            // the orchestrator: it shows the floating window, invokes capture,
            // calls OpenAI, and renders the result.
            let _ = app.emit("slickly://trigger-capture", ());
        })
        .build()
}

/// Resolve the user's preferred manual shortcut and register it if non-empty.
/// The empty string is the documented "disabled" value — Slickly's main
/// trigger is the screenshot-folder watcher, so a manual hotkey is optional.
pub fn register_default(app: &AppHandle) -> Result<(), String> {
    if app.try_state::<ActiveShortcut>().is_none() {
        app.manage(ActiveShortcut(Mutex::new(None)));
    }

    let preferred = storage::load_settings(app.clone())
        .map(|s| s.shortcut)
        .unwrap_or_default();

    apply_shortcut(app, &preferred)
}

/// Public command so the Settings page can change the hotkey live. Pass an
/// empty string to disable the manual shortcut entirely.
#[tauri::command]
pub fn reregister_shortcut(app: AppHandle, accelerator: String) -> Result<(), String> {
    apply_shortcut(&app, &accelerator)
}

fn apply_shortcut(app: &AppHandle, accelerator: &str) -> Result<(), String> {
    if app.try_state::<ActiveShortcut>().is_none() {
        app.manage(ActiveShortcut(Mutex::new(None)));
    }
    let state = app.state::<ActiveShortcut>();
    let mut active = state.0.lock().map_err(|e| format!("lock poisoned: {e}"))?;

    // Always clear the previous binding first so an empty string really
    // does mean "no manual shortcut".
    if let Some(prev) = active.take() {
        let _ = app.global_shortcut().unregister(prev);
    }

    let trimmed = accelerator.trim();
    if trimmed.is_empty() {
        return Ok(());
    }

    let parsed: Shortcut = trimmed
        .parse()
        .map_err(|e| format!("invalid shortcut '{trimmed}': {e}"))?;

    app.global_shortcut()
        .register(parsed.clone())
        .map_err(|e| format!("register shortcut: {e}"))?;
    *active = Some(parsed);
    Ok(())
}
