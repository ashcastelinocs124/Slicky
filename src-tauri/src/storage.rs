use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, Runtime};

const HISTORY_FILE: &str = "history.json";
const SETTINGS_FILE: &str = "settings.json";
const SCREENSHOTS_DIR: &str = "screenshots";

/// One saved explanation. Matches the shape produced by the React UI so we
/// can pass it round-trip without translation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HistoryEntry {
    pub id: String,
    pub created_at: String,
    pub title: String,
    pub explanation: String,
    #[serde(default)]
    pub variants: Vec<Variant>,
    /// Path to a saved PNG screenshot under app data, or empty if not saved.
    #[serde(default)]
    pub screenshot_path: String,
    #[serde(default)]
    pub model: String,
    /// Mermaid source of the "Draw it" diagram, if one was generated. Optional
    /// so pre-existing history.json entries (written before this feature)
    /// still deserialize, and absent so they stay clean on re-save.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mermaid: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Variant {
    pub kind: String, // "simpler" | "example" | "original"
    pub text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Settings {
    #[serde(default)]
    pub api_key: String,
    #[serde(default = "default_model")]
    pub model: String,
    #[serde(default = "default_shortcut")]
    pub shortcut: String,
    #[serde(default = "default_capture_trigger")]
    pub capture_trigger: String,
    #[serde(default)]
    pub obsidian_sync_enabled: bool,
    #[serde(default = "default_obsidian_base_url")]
    pub obsidian_base_url: String,
    #[serde(default)]
    pub obsidian_api_key: String,
    #[serde(default)]
    pub background_context: String,
}

fn default_model() -> String {
    // GPT-5 is our default for the best vision + reasoning quality. Users
    // can downgrade to a faster/cheaper variant in Settings.
    "gpt-5".into()
}

fn default_shortcut() -> String {
    // Empty = no manual shortcut. macOS's own ⌘⇧4 saves a screenshot which
    // our watcher then picks up automatically.
    String::new()
}

pub fn default_capture_trigger() -> String {
    "screenshot".into()
}

fn default_obsidian_base_url() -> String {
    "https://127.0.0.1:27124".into()
}

fn data_dir<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app data dir unavailable: {e}"))?;
    fs::create_dir_all(&dir).map_err(|e| format!("create data dir: {e}"))?;
    Ok(dir)
}

pub fn ensure_storage_dirs<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    let dir = data_dir(app)?;
    fs::create_dir_all(dir.join(SCREENSHOTS_DIR)).map_err(|e| format!("create screenshots dir: {e}"))?;
    Ok(())
}

/// Atomically replace `target` with `contents` by writing to a sibling temp file
/// and renaming. This protects history.json against a corrupt half-write if the
/// process crashes mid-save.
fn write_atomic(target: &Path, contents: &[u8]) -> Result<(), String> {
    let parent = target
        .parent()
        .ok_or_else(|| "target has no parent".to_string())?;
    fs::create_dir_all(parent).map_err(|e| format!("create dir: {e}"))?;

    let tmp = parent.join(format!(
        ".{}.tmp-{}",
        target
            .file_name()
            .map(|s| s.to_string_lossy().into_owned())
            .unwrap_or_else(|| "out".into()),
        uuid::Uuid::new_v4()
    ));

    {
        let mut f = fs::File::create(&tmp).map_err(|e| format!("open tmp: {e}"))?;
        f.write_all(contents).map_err(|e| format!("write tmp: {e}"))?;
        f.sync_all().map_err(|e| format!("sync tmp: {e}"))?;
    }
    fs::rename(&tmp, target).map_err(|e| format!("rename tmp: {e}"))?;
    Ok(())
}

fn read_history_file<R: Runtime>(app: &AppHandle<R>) -> Result<Vec<HistoryEntry>, String> {
    let path = data_dir(app)?.join(HISTORY_FILE);
    if !path.exists() {
        return Ok(Vec::new());
    }
    let raw = fs::read_to_string(&path).map_err(|e| format!("read history: {e}"))?;
    if raw.trim().is_empty() {
        return Ok(Vec::new());
    }
    serde_json::from_str::<Vec<HistoryEntry>>(&raw)
        .map_err(|e| format!("parse history: {e}"))
}

fn write_history_file<R: Runtime>(app: &AppHandle<R>, entries: &[HistoryEntry]) -> Result<(), String> {
    let path = data_dir(app)?.join(HISTORY_FILE);
    let json = serde_json::to_vec_pretty(entries).map_err(|e| format!("encode history: {e}"))?;
    write_atomic(&path, &json)
}

#[tauri::command]
pub fn load_history(app: AppHandle) -> Result<Vec<HistoryEntry>, String> {
    let mut entries = read_history_file(&app)?;
    // Newest first — the UI assumes this so it doesn't have to re-sort on every render.
    entries.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    Ok(entries)
}

/// Save a new history entry. If `source_screenshot_path` is provided, the file
/// is copied into the persistent screenshots dir and `entry.screenshot_path`
/// is overwritten with the new permanent path.
#[tauri::command]
pub fn save_history_entry(
    app: AppHandle,
    mut entry: HistoryEntry,
    source_screenshot_path: Option<String>,
) -> Result<HistoryEntry, String> {
    if entry.id.is_empty() {
        entry.id = uuid::Uuid::new_v4().to_string();
    }
    if entry.created_at.is_empty() {
        entry.created_at = chrono::Utc::now().to_rfc3339();
    }

    if let Some(src) = source_screenshot_path {
        if !src.is_empty() {
            let dest_dir = data_dir(&app)?.join(SCREENSHOTS_DIR);
            fs::create_dir_all(&dest_dir).map_err(|e| format!("create screenshots dir: {e}"))?;
            let dest = dest_dir.join(format!("{}.png", entry.id));
            fs::copy(&src, &dest).map_err(|e| format!("copy screenshot: {e}"))?;
            entry.screenshot_path = dest.to_string_lossy().into_owned();
        }
    }

    let mut entries = read_history_file(&app).unwrap_or_default();
    // If the entry already exists (re-save / update), replace it in place.
    if let Some(pos) = entries.iter().position(|e| e.id == entry.id) {
        entries[pos] = entry.clone();
    } else {
        entries.push(entry.clone());
    }
    write_history_file(&app, &entries)?;
    Ok(entry)
}

#[tauri::command]
pub fn delete_history_entry(app: AppHandle, id: String) -> Result<(), String> {
    let mut entries = read_history_file(&app)?;
    let before = entries.len();
    entries.retain(|e| {
        if e.id == id {
            // Best-effort cleanup of the associated screenshot.
            if !e.screenshot_path.is_empty() {
                let _ = fs::remove_file(&e.screenshot_path);
            }
            false
        } else {
            true
        }
    });
    if entries.len() == before {
        return Err(format!("no entry with id {id}"));
    }
    write_history_file(&app, &entries)
}

#[tauri::command]
pub fn clear_history(app: AppHandle) -> Result<(), String> {
    let entries = read_history_file(&app).unwrap_or_default();
    for e in &entries {
        if !e.screenshot_path.is_empty() {
            let _ = fs::remove_file(&e.screenshot_path);
        }
    }
    write_history_file(&app, &[])
}

#[tauri::command]
pub fn load_settings(app: AppHandle) -> Result<Settings, String> {
    read_settings(&app)
}

pub fn read_settings<R: Runtime>(app: &AppHandle<R>) -> Result<Settings, String> {
    let path = data_dir(app)?.join(SETTINGS_FILE);
    if !path.exists() {
        return Ok(Settings {
            model: default_model(),
            shortcut: default_shortcut(),
            capture_trigger: default_capture_trigger(),
            obsidian_base_url: default_obsidian_base_url(),
            ..Default::default()
        });
    }
    let raw = fs::read_to_string(&path).map_err(|e| format!("read settings: {e}"))?;
    let mut s: Settings = serde_json::from_str(&raw).map_err(|e| format!("parse settings: {e}"))?;
    if s.model.is_empty() {
        s.model = default_model();
    }
    if s.shortcut.is_empty() {
        s.shortcut = default_shortcut();
    }
    if s.capture_trigger.is_empty() {
        s.capture_trigger = default_capture_trigger();
    }
    if s.obsidian_base_url.is_empty() {
        s.obsidian_base_url = default_obsidian_base_url();
    }
    Ok(s)
}

#[tauri::command]
pub fn save_settings(app: AppHandle, settings: Settings) -> Result<Settings, String> {
    let path = data_dir(&app)?.join(SETTINGS_FILE);
    let json = serde_json::to_vec_pretty(&settings).map_err(|e| format!("encode settings: {e}"))?;
    write_atomic(&path, &json)?;
    Ok(settings)
}
