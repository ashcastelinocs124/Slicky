//! Option+double-click capture mode.
//!
//! This polls global mouse/key state and, when enabled in Settings, captures a
//! fixed region around the cursor after two nearby Option-clicks.

use std::collections::VecDeque;
use std::path::PathBuf;
use std::process::Command;
use std::time::{Duration, Instant};

use device_query::{DeviceQuery, DeviceState, Keycode};
use tauri::{AppHandle, Emitter, Manager, Runtime};

use crate::{storage, window_ops};

const POLL_INTERVAL: Duration = Duration::from_millis(35);
const DOUBLE_CLICK_WINDOW: Duration = Duration::from_millis(650);
const REQUIRED_CLICK_COUNT: usize = 2;
const POST_CAPTURE_COOLDOWN: Duration = Duration::from_millis(1400);
const MAX_CLICK_DISTANCE_PX: i32 = 18;
const CAPTURE_WIDTH: i32 = 600;
const CAPTURE_HEIGHT: i32 = 420;

pub fn spawn<R: Runtime>(app: AppHandle<R>) {
    std::thread::Builder::new()
        .name("slicky-double-click-capture".into())
        .spawn(move || run(app))
        .expect("failed to spawn double-click capture thread");
}

fn run<R: Runtime>(app: AppHandle<R>) {
    let device = DeviceState::new();
    let mut click_chain: VecDeque<(Instant, (i32, i32))> = VecDeque::new();
    let mut left_was_down = false;
    let mut last_capture = Instant::now() - POST_CAPTURE_COOLDOWN;

    loop {
        std::thread::sleep(POLL_INTERVAL);

        let mouse = device.get_mouse();
        let left_is_down = mouse.button_pressed.get(1).copied().unwrap_or(false);
        let just_clicked = left_is_down && !left_was_down;
        left_was_down = left_is_down;

        if !just_clicked {
            continue;
        }

        if !triple_click_enabled(&app) {
            click_chain.clear();
            continue;
        }

        let keys = device.get_keys();
        let option_down = keys.contains(&Keycode::LOption)
            || keys.contains(&Keycode::ROption)
            || keys.contains(&Keycode::LAlt)
            || keys.contains(&Keycode::RAlt);
        if !option_down {
            click_chain.clear();
            continue;
        }

        let now = Instant::now();
        if now.duration_since(last_capture) < POST_CAPTURE_COOLDOWN {
            continue;
        }

        let position = mouse.coords;
        click_chain.push_back((now, position));
        while click_chain
            .front()
            .map(|(t, _)| now.duration_since(*t) > DOUBLE_CLICK_WINDOW)
            .unwrap_or(false)
        {
            click_chain.pop_front();
        }
        while click_chain.len() > REQUIRED_CLICK_COUNT {
            click_chain.pop_front();
        }

        if click_chain.len() == REQUIRED_CLICK_COUNT && clicks_are_near(&click_chain) {
            last_capture = now;
            click_chain.clear();
            match capture_around_cursor(&app, position) {
                Ok(path) => emit_capture(&app, path),
                Err(e) => eprintln!("[slicky] double-click capture failed: {e}"),
            }
        }
    }
}

fn triple_click_enabled<R: Runtime>(app: &AppHandle<R>) -> bool {
    storage::read_settings(app)
        .map(|s| s.capture_trigger == "triple_click")
        .unwrap_or(false)
}

fn clicks_are_near(clicks: &VecDeque<(Instant, (i32, i32))>) -> bool {
    let Some((_, first)) = clicks.front() else {
        return false;
    };
    clicks.iter().all(|(_, pos)| {
        (pos.0 - first.0).abs() <= MAX_CLICK_DISTANCE_PX
            && (pos.1 - first.1).abs() <= MAX_CLICK_DISTANCE_PX
    })
}

fn capture_around_cursor<R: Runtime>(
    app: &AppHandle<R>,
    cursor: (i32, i32),
) -> Result<String, String> {
    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
        let _ = cursor;
        Err("Double-click capture is only implemented on macOS".into())
    }

    #[cfg(target_os = "macos")]
    {
        let cache_dir = app
            .path()
            .app_cache_dir()
            .map_err(|e| format!("cache dir unavailable: {e}"))?;
        std::fs::create_dir_all(&cache_dir)
            .map_err(|e| format!("failed to create cache dir: {e}"))?;

        let path: PathBuf = cache_dir.join(format!("slicky-triple-{}.png", uuid::Uuid::new_v4()));
        let x = cursor.0 - CAPTURE_WIDTH / 2;
        let y = cursor.1 - CAPTURE_HEIGHT / 2;
        let region = format!("{x},{y},{CAPTURE_WIDTH},{CAPTURE_HEIGHT}");

        let status = Command::new("/usr/sbin/screencapture")
            .arg("-x")
            .arg("-t")
            .arg("png")
            .arg("-R")
            .arg(region)
            .arg(&path)
            .status()
            .map_err(|e| format!("failed to spawn screencapture: {e}"))?;

        if !status.success() || !path.exists() {
            return Err(format!("screencapture exited with status {status}"));
        }

        Ok(path.to_string_lossy().into_owned())
    }
}

fn emit_capture<R: Runtime>(app: &AppHandle<R>, path: String) {
    let app_main = app.clone();
    let payload = path.clone();
    let _ = app.run_on_main_thread(move || {
        match window_ops::present_popup_near_cursor(&app_main) {
            Ok(()) => eprintln!("[slicky] popup presented for double-click capture"),
            Err(e) => eprintln!("[slicky] failed to present popup: {e}"),
        }
        match app_main.emit("slickly://new-screenshot", payload) {
            Ok(()) => eprintln!("[slicky] emitted double-click screenshot"),
            Err(e) => eprintln!("[slicky] failed to emit double-click screenshot: {e}"),
        }
    });
}
