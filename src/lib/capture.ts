import { invoke } from "@tauri-apps/api/core";

/**
 * Result of a successful interactive screencapture.
 *
 * `path` is a temporary file in the app cache dir; pass it to
 * `save_history_entry` if the user chooses "Save to library", otherwise
 * the file is safe to leave on disk and will be cleaned up by macOS.
 */
export interface CaptureResult {
  path: string;
  b64: string;
}

export class CaptureCancelled extends Error {
  constructor() {
    super("Cancelled");
    this.name = "CaptureCancelled";
  }
}

/**
 * Launch macOS interactive screen capture and resolve once the user has
 * selected a region.
 *
 * Rejects with `CaptureCancelled` if the user pressed Esc. Any other error
 * indicates a real failure (e.g. screencapture binary missing).
 */
export async function captureRegion(): Promise<CaptureResult> {
  try {
    return await invoke<CaptureResult>("capture_screenshot");
  } catch (err) {
    const msg = String(err);
    if (msg === "Cancelled" || msg.toLowerCase().includes("cancel")) {
      throw new CaptureCancelled();
    }
    throw new Error(msg);
  }
}

/** Convert a stored screenshot path back into a base64 string for previews. */
export async function readScreenshotB64(path: string): Promise<string> {
  return await invoke<string>("read_screenshot_b64", { path });
}
