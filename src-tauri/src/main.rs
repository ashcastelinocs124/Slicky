// Prevent an extra terminal window from opening on Windows in release builds.
// On macOS this attribute is a no-op but kept for portability.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    slicky_lib::run();
}
