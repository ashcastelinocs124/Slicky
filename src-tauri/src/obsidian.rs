use reqwest::blocking::Client;
use tauri::AppHandle;

use crate::storage::{self, HistoryEntry};

const DAILY_ENDPOINT: &str = "/periodic/daily/";
const SLICKY_HEADING: &str = "Slicky";

#[tauri::command]
pub fn sync_explanation_to_obsidian(app: AppHandle, entry: HistoryEntry) -> Result<(), String> {
    let settings = storage::read_settings(&app)?;
    if !settings.obsidian_sync_enabled {
        eprintln!("[slicky] Obsidian sync skipped: disabled in Settings");
        return Ok(());
    }
    if settings.obsidian_api_key.trim().is_empty() {
        eprintln!("[slicky] Obsidian sync failed: missing API key in Settings");
        return Err("Obsidian sync is enabled, but no Local REST API key is set.".into());
    }

    let client = Client::builder()
        // The Local REST API defaults to a self-signed certificate on 127.0.0.1.
        .danger_accept_invalid_certs(true)
        .build()
        .map_err(|e| format!("build Obsidian client: {e}"))?;

    let base_url = settings.obsidian_base_url.trim().trim_end_matches('/');
    let url = format!("{base_url}{DAILY_ENDPOINT}");
    let note_body = format_obsidian_entry(&entry);
    eprintln!("[slicky] Obsidian sync: appending to daily note at {url}");

    let patch = client
        .patch(&url)
        .bearer_auth(settings.obsidian_api_key.trim())
        .header("Operation", "append")
        .header("Target-Type", "heading")
        .header("Target", SLICKY_HEADING)
        .header("Content-Type", "text/plain; charset=utf-8")
        .body(note_body.clone())
        .send()
        .map_err(|e| format!("connect to Obsidian: {e}"))?;

    if patch.status().is_success() {
        eprintln!("[slicky] Obsidian sync succeeded via PATCH");
        return Ok(());
    }
    let patch_status = patch.status();
    eprintln!("[slicky] Obsidian PATCH returned {patch_status}; trying daily-note append fallback");

    // First sync into a daily note may not have a "Slicky" heading yet.
    let fallback_body = format!("## {SLICKY_HEADING}\n\n{note_body}");
    let post = client
        .post(&url)
        .bearer_auth(settings.obsidian_api_key.trim())
        .header("Content-Type", "text/plain; charset=utf-8")
        .body(fallback_body)
        .send()
        .map_err(|e| format!("append to Obsidian daily note: {e}"))?;

    if post.status().is_success() {
        eprintln!("[slicky] Obsidian sync succeeded via POST fallback");
        Ok(())
    } else {
        eprintln!(
            "[slicky] Obsidian sync failed: PATCH {patch_status} then POST {}",
            post.status()
        );
        Err(format!(
            "Obsidian sync failed: PATCH {} then POST {}",
            patch_status,
            post.status()
        ))
    }
}

fn format_obsidian_entry(entry: &HistoryEntry) -> String {
    let title = if entry.title.trim().is_empty() {
        "Untitled"
    } else {
        entry.title.trim()
    };
    let created = if entry.created_at.trim().is_empty() {
        "unknown time"
    } else {
        entry.created_at.trim()
    };

    format!(
        "### {title}\n\n{}\n\n- Source: Slicky\n- Model: `{}`\n- Captured: `{}`\n\n",
        entry.explanation.trim(),
        entry.model.trim(),
        created
    )
}
