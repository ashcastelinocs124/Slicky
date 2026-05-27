//! Filesystem watcher for macOS screenshots.
//!
//! macOS's built-in shortcuts (`⌘⇧3`, `⌘⇧4`, `⌘⇧5`) save their output as a
//! PNG into a user-configurable directory (Desktop by default). Rather than
//! trying to intercept the system shortcut — which sits at a higher OS
//! priority than anything Tauri can register — we just watch that directory
//! and fire off our explain flow whenever a new screenshot file appears.
//!
//! The watcher uses lightweight polling instead of pulling in a native fs
//! events crate; macOS screenshot creation is human-scale (a couple a
//! minute, max), so a 400 ms cadence has negligible cost and avoids extra
//! dependencies on FSEvents bindings.

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{Duration, SystemTime};

use tauri::{AppHandle, Emitter, Runtime};

use crate::window_ops;

const POLL_INTERVAL: Duration = Duration::from_millis(400);
/// Only react to files modified within this window of "now". This stops us
/// from emitting events for files we missed because Slickly was offline.
const RECENT_WINDOW: Duration = Duration::from_secs(10);
/// Give the OS a moment after we first see the file in case the bytes are
/// still being flushed to disk.
const SETTLE_DELAY: Duration = Duration::from_millis(180);

/// Spawn the watcher on a dedicated thread. Survives the lifetime of the app.
pub fn spawn<R: Runtime>(app: AppHandle<R>) {
    std::thread::Builder::new()
        .name("slickly-screenshot-watcher".into())
        .spawn(move || run(app))
        .expect("failed to spawn screenshot watcher thread");
}

fn run<R: Runtime>(app: AppHandle<R>) {
    let dir = screenshot_dir();
    eprintln!(
        "[slickly] screenshot watcher started in: {} (exists={})",
        dir.display(),
        dir.is_dir()
    );

    // Explicit startup probe: if we can't read the directory at all,
    // shout once so the user immediately understands they need to grant
    // macOS TCC permission. Without this, the watcher just polls an
    // empty list forever and the user has no idea why nothing happens.
    match std::fs::read_dir(&dir) {
        Ok(_) => eprintln!("[slickly] screenshot directory is readable ✓"),
        Err(e) => eprintln!(
            "[slickly] startup probe: cannot read {}: {}",
            dir.display(),
            e
        ),
    }

    let initial = scan_png(&dir);
    eprintln!(
        "[slickly] seeded watcher with {} existing PNG(s)",
        initial.len()
    );
    let mut known: HashSet<PathBuf> = initial.into_iter().map(|(p, _)| p).collect();

    loop {
        std::thread::sleep(POLL_INTERVAL);
        let entries = scan_png(&dir);
        let now = SystemTime::now();
        for (path, mtime) in entries {
            if known.contains(&path) {
                continue;
            }
            known.insert(path.clone());

            let age = now.duration_since(mtime).unwrap_or(Duration::ZERO);
            if age > RECENT_WINDOW {
                eprintln!(
                    "[slickly] skip stale PNG {} (age {:?})",
                    path.display(),
                    age
                );
                continue;
            }

            // Skip our own captures if the user reconfigured screenshots
            // into a directory we also write to.
            if path
                .file_name()
                .and_then(|n| n.to_str())
                .map(|n| n.starts_with("slickly-"))
                .unwrap_or(false)
            {
                continue;
            }

            std::thread::sleep(SETTLE_DELAY);
            let payload = path.to_string_lossy().into_owned();
            eprintln!("[slickly] new screenshot detected: {}", payload);

            // Show the popup on the AppKit main thread, then emit to the
            // webview. Ordering matters: the user should see "Explaining…"
            // immediately, even while OpenAI is still loading.
            let app_main = app.clone();
            let payload_emit = payload.clone();
            let _ = app.run_on_main_thread(move || {
                match window_ops::present_popup_near_cursor(&app_main) {
                    Ok(()) => eprintln!("[slickly] popup presented for screenshot"),
                    Err(e) => eprintln!("[slickly] failed to present popup: {e}"),
                }
                match app_main.emit("slickly://new-screenshot", payload_emit) {
                    Ok(()) => eprintln!("[slickly] emitted slickly://new-screenshot"),
                    Err(e) => eprintln!("[slickly] failed to emit event: {e}"),
                }
            });
        }
    }
}

fn scan_png(dir: &Path) -> Vec<(PathBuf, SystemTime)> {
    let mut out = Vec::new();
    let rd = match std::fs::read_dir(dir) {
        Ok(rd) => rd,
        Err(e) => {
            // We hit this loop hundreds of times; we only want to shout
            // when the *kind* of error changes (and especially on the first
            // PermissionDenied), so we don't spam stderr.
            use std::io::ErrorKind;
            use std::sync::atomic::{AtomicI32, Ordering};
            static LAST_KIND: AtomicI32 = AtomicI32::new(i32::MIN);
            let code = match e.kind() {
                ErrorKind::PermissionDenied => 1,
                ErrorKind::NotFound => 2,
                _ => 3,
            };
            if LAST_KIND.swap(code, Ordering::Relaxed) != code {
                if e.kind() == ErrorKind::PermissionDenied {
                    eprintln!(
                        "[slickly] PERMISSION DENIED reading {}\n           \
                         macOS is blocking access to this folder. Grant it under:\n           \
                         System Settings → Privacy & Security → Files and Folders → Desktop Folder.\n           \
                         (In `tauri dev`, enable your *terminal* app there — Terminal.app or iTerm.\n           \
                         In a packaged build, enable Slickly.)",
                        dir.display()
                    );
                } else {
                    eprintln!(
                        "[slickly] cannot read {}: {} ({:?})",
                        dir.display(),
                        e,
                        e.kind()
                    );
                }
            }
            return out;
        }
    };
    for entry in rd.flatten() {
        let path = entry.path();
        let is_png = path
            .extension()
            .and_then(|x| x.to_str())
            .map(|x| x.eq_ignore_ascii_case("png"))
            .unwrap_or(false);
        if !is_png {
            continue;
        }
        if let Ok(meta) = entry.metadata() {
            if let Ok(t) = meta.modified() {
                out.push((path, t));
            }
        }
    }
    out
}

/// Resolve the directory where macOS saves screenshots, honoring whatever
/// the user has configured via `defaults write com.apple.screencapture location`.
/// Falls back to `~/Desktop` if anything goes wrong.
fn screenshot_dir() -> PathBuf {
    if let Ok(out) = Command::new("defaults")
        .args(["read", "com.apple.screencapture", "location"])
        .output()
    {
        if out.status.success() {
            let raw = String::from_utf8_lossy(&out.stdout)
                .trim()
                .trim_matches('"')
                .to_string();
            if !raw.is_empty() {
                let resolved = expand_tilde(&raw);
                if resolved.is_dir() {
                    return resolved;
                }
            }
        }
    }
    home_dir().join("Desktop")
}

fn home_dir() -> PathBuf {
    std::env::var_os("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."))
}

fn expand_tilde(s: &str) -> PathBuf {
    if let Some(rest) = s.strip_prefix("~/") {
        home_dir().join(rest)
    } else if s == "~" {
        home_dir()
    } else {
        PathBuf::from(s)
    }
}
