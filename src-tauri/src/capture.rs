use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use serde::Serialize;
use std::path::PathBuf;
use std::process::Command;
use tauri::{AppHandle, Manager};

#[derive(Debug, Serialize)]
pub struct CaptureResult {
    /// Absolute filesystem path of the saved screenshot.
    pub path: String,
    /// Base64-encoded PNG bytes ready for the OpenAI vision API.
    pub b64: String,
}

/// Run macOS `screencapture` in interactive mode and return the resulting
/// PNG as both an on-disk path and a base64 string.
///
/// Runs synchronously on a Tauri worker thread; the interactive selection UI
/// blocks until the user finishes or cancels. On cancel we return a friendly
/// "Cancelled" string so the frontend can quietly drop the request.
#[tauri::command]
pub fn capture_screenshot(app: AppHandle) -> Result<CaptureResult, String> {
    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
        return Err("Screen capture is only implemented on macOS in this MVP".into());
    }

    #[cfg(target_os = "macos")]
    {
        let cache_dir = app
            .path()
            .app_cache_dir()
            .map_err(|e| format!("cache dir unavailable: {e}"))?;
        std::fs::create_dir_all(&cache_dir)
            .map_err(|e| format!("failed to create cache dir: {e}"))?;

        let filename = format!("slickly-{}.png", uuid::Uuid::new_v4());
        let path: PathBuf = cache_dir.join(filename);

        let status = Command::new("/usr/sbin/screencapture")
            .arg("-i") // interactive selection
            .arg("-x") // mute the capture sound
            .arg("-t")
            .arg("png")
            .arg(&path)
            .status()
            .map_err(|e| format!("failed to spawn screencapture: {e}"))?;

        if !status.success() {
            return Err(format!(
                "screencapture exited with status {status} (Esc to cancel?)"
            ));
        }

        if !path.exists() {
            // User cancelled the selection — screencapture exits 0 but writes no file.
            return Err("Cancelled".into());
        }

        let bytes =
            std::fs::read(&path).map_err(|e| format!("failed to read screenshot: {e}"))?;
        if bytes.is_empty() {
            return Err("Cancelled".into());
        }
        let b64 = B64.encode(&bytes);

        Ok(CaptureResult {
            path: path.to_string_lossy().into_owned(),
            b64,
        })
    }
}

/// Read an existing screenshot file (referenced from history) and return it
/// as a base64-encoded data URL payload.
#[tauri::command]
pub fn read_screenshot_b64(path: String) -> Result<String, String> {
    let bytes = std::fs::read(&path).map_err(|e| format!("failed to read {path}: {e}"))?;
    Ok(B64.encode(&bytes))
}
