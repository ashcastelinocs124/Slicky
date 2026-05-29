import { invoke } from "@tauri-apps/api/core";

/**
 * Persistent shapes. These mirror the Rust structs in `src-tauri/src/storage.rs`
 * so the JSON flowing across the IPC boundary needs no transformation.
 */

export interface Variant {
  kind: "original" | "simpler" | "example" | "detail";
  text: string;
}

export interface HistoryEntry {
  id: string;
  /** ISO-8601 UTC string. */
  created_at: string;
  title: string;
  /** The currently displayed explanation text. */
  explanation: string;
  /** Each generated variant, kept for re-display. */
  variants: Variant[];
  /** Permanent screenshot location once saved; empty before save. */
  screenshot_path: string;
  model: string;
}

export interface Settings {
  api_key: string;
  model: string;
  shortcut: string;
  capture_trigger: "screenshot" | "triple_click";
  obsidian_sync_enabled: boolean;
  obsidian_base_url: string;
  obsidian_api_key: string;
  /** Optional user-provided learning/background context for tailored explanations. */
  background_context: string;
}

const DEFAULT_SETTINGS: Settings = {
  api_key: "",
  model: "gpt-5",
  // Empty by default — Slicky's primary trigger is the screenshot folder
  // watcher, which detects macOS's own ⌘⇧4 / ⌘⇧3 / ⌘⇧5 captures.
  shortcut: "",
  capture_trigger: "screenshot",
  obsidian_sync_enabled: false,
  obsidian_base_url: "https://127.0.0.1:27124",
  obsidian_api_key: "",
  background_context: "",
};

export async function loadHistory(): Promise<HistoryEntry[]> {
  return await invoke<HistoryEntry[]>("load_history");
}

/**
 * Persist a history entry. Pass `sourceScreenshotPath` to copy a temp
 * screenshot into the app's permanent screenshots folder.
 */
export async function saveHistoryEntry(
  entry: HistoryEntry,
  sourceScreenshotPath?: string
): Promise<HistoryEntry> {
  return await invoke<HistoryEntry>("save_history_entry", {
    entry,
    sourceScreenshotPath: sourceScreenshotPath ?? null,
  });
}

export async function deleteHistoryEntry(id: string): Promise<void> {
  await invoke("delete_history_entry", { id });
}

export async function clearHistory(): Promise<void> {
  await invoke("clear_history");
}

export async function loadSettings(): Promise<Settings> {
  try {
    const s = await invoke<Settings>("load_settings");
    return { ...DEFAULT_SETTINGS, ...s };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export async function saveSettings(settings: Settings): Promise<Settings> {
  return await invoke<Settings>("save_settings", { settings });
}

export async function reregisterShortcut(accelerator: string): Promise<void> {
  await invoke("reregister_shortcut", { accelerator });
}

export async function syncExplanationToObsidian(entry: HistoryEntry): Promise<void> {
  await invoke("sync_explanation_to_obsidian", { entry });
}

/**
 * Build a minimal HistoryEntry skeleton. IDs and timestamps are filled by
 * the Rust side on save, but we set them client-side so we can show the
 * unsaved entry immediately in the UI.
 */
export function newEntrySkeleton(
  title: string,
  explanation: string,
  model: string
): HistoryEntry {
  return {
    id: crypto.randomUUID(),
    created_at: new Date().toISOString(),
    title,
    explanation,
    variants: [{ kind: "original", text: explanation }],
    screenshot_path: "",
    model,
  };
}
