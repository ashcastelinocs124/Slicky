import { useCallback, useEffect, useState } from "react";

import {
  loadSettings,
  reregisterShortcut,
  saveSettings,
  type Settings as SettingsT,
} from "../lib/storage";
import { SlickyLogo } from "./SlickyLogo";

interface Props {
  onBack: () => void;
}

const MODELS = [
  { id: "gpt-5", label: "gpt-5 — best quality (default)" },
  { id: "gpt-5-mini", label: "gpt-5-mini — fast & cheap" },
  { id: "gpt-5-nano", label: "gpt-5-nano — cheapest" },
  { id: "o4-mini", label: "o4-mini — reasoning, fast" },
  { id: "o3", label: "o3 — reasoning, deep" },
  { id: "gpt-4.1", label: "gpt-4.1" },
  { id: "gpt-4.1-mini", label: "gpt-4.1-mini" },
  { id: "gpt-4o", label: "gpt-4o" },
  { id: "gpt-4o-mini", label: "gpt-4o-mini" },
];

export function Settings({ onBack }: Props) {
  const [settings, setSettings] = useState<SettingsT | null>(null);
  const [showKey, setShowKey] = useState(false);
  const [status, setStatus] = useState<
    { kind: "idle" } | { kind: "saving" } | { kind: "saved" } | { kind: "error"; message: string }
  >({ kind: "idle" });

  useEffect(() => {
    loadSettings().then(setSettings).catch(() => setSettings(null));
  }, []);

  const update = useCallback(<K extends keyof SettingsT>(key: K, value: SettingsT[K]) => {
    setSettings((prev) => (prev ? { ...prev, [key]: value } : prev));
    setStatus({ kind: "idle" });
  }, []);

  const handleSave = useCallback(async () => {
    if (!settings) return;
    setStatus({ kind: "saving" });
    try {
      const saved = await saveSettings({
        ...settings,
        api_key: settings.api_key.trim(),
        // Empty is a valid value: it disables the manual hotkey entirely
        // and leaves the screenshot watcher as the only trigger.
        shortcut: settings.shortcut.trim(),
        capture_trigger: settings.capture_trigger,
        model: (settings.model || "gpt-5").trim(),
        obsidian_sync_enabled: settings.obsidian_sync_enabled,
        obsidian_base_url: (settings.obsidian_base_url || "https://127.0.0.1:27124").trim(),
        obsidian_api_key: settings.obsidian_api_key.trim(),
        background_context: settings.background_context.trim(),
      });
      setSettings(saved);
      try {
        await reregisterShortcut(saved.shortcut);
      } catch (e) {
        setStatus({ kind: "error", message: `Saved, but shortcut failed: ${(e as Error).message}` });
        return;
      }
      setStatus({ kind: "saved" });
    } catch (e) {
      setStatus({ kind: "error", message: (e as Error).message });
    }
  }, [settings]);

  // Esc to go back, Cmd+S to save.
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") {
        ev.preventDefault();
        onBack();
      } else if ((ev.metaKey || ev.ctrlKey) && ev.key.toLowerCase() === "s") {
        ev.preventDefault();
        void handleSave();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onBack, handleSave]);

  if (!settings) {
    return (
      <div className="flex h-screen w-screen items-center justify-center p-2">
        <div className="surface px-6 py-4 text-[12px] text-slick-subtle">Loading…</div>
      </div>
    );
  }

  return (
    <div className="flex h-screen w-screen flex-col">
      <div className="surface flex h-full w-full flex-col overflow-hidden animate-fade-in">
        <div
          data-tauri-drag-region
          className="read-bar mx-1.5 mt-1.5 flex items-center justify-between rounded-lg px-3 py-2"
        >
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onBack}
              title="Back (Esc)"
              className="rounded-md p-1.5 text-slick-subtle hover:bg-white/10 hover:text-slick-text"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M15 18l-6-6 6-6" />
              </svg>
            </button>
            <SlickyLogo size={18} className="shrink-0 rounded-[4px]" />
            <span className="text-[12px] font-semibold tracking-wide text-slick-text">
              Settings
            </span>
          </div>
          <div className="text-[10.5px] text-slick-subtle">
            <kbd>⌘</kbd> <kbd>S</kbd> to save
          </div>
        </div>

        <div className="read-panel legible overflow-y-auto thin-scroll px-4 py-4 text-white">
          <Field
            label="OpenAI API key"
            help="Stored locally in your app data folder. Never leaves your machine except in requests to api.openai.com."
          >
            <div className="flex gap-2">
              <input
                type={showKey ? "text" : "password"}
                value={settings.api_key}
                onChange={(e) => update("api_key", e.target.value)}
                placeholder="sk-..."
                spellCheck={false}
                autoComplete="off"
                className="flex-1 rounded-md border border-white/10 bg-black/30 px-2 py-1.5 font-mono text-[12px] text-slick-text placeholder:text-slick-subtle focus:border-white/35 focus:outline-none"
              />
              <button
                type="button"
                onClick={() => setShowKey((v) => !v)}
                className="rounded-md border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-slick-text hover:bg-white/10"
              >
                {showKey ? "Hide" : "Show"}
              </button>
            </div>
          </Field>

          <Field
            label="Model"
            help={
              <>
                Vision-capable OpenAI models. <span className="font-mono">gpt-5</span> is
                the default. You can also type a custom model id — anything
                you've been granted access to on your OpenAI account.
              </>
            }
          >
            <input
              type="text"
              list="slickly-models"
              value={settings.model}
              onChange={(e) => update("model", e.target.value)}
              spellCheck={false}
              autoComplete="off"
              className="w-full rounded-md border border-white/10 bg-black/30 px-2 py-1.5 font-mono text-[12px] text-slick-text focus:border-white/35 focus:outline-none"
            />
            <datalist id="slickly-models">
              {MODELS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </datalist>
          </Field>

          <Field
            label="Background context"
            help="Optional. Tell Slicky what you already know, what class you're in, your role, or what kind of explanation helps you."
          >
            <textarea
              value={settings.background_context}
              onChange={(e) => update("background_context", e.target.value)}
              placeholder="Example: I'm a CS124 student learning Java. Explain screenshots like I'm new to programming."
              rows={4}
              spellCheck
              className="w-full resize-none rounded-md border border-white/10 bg-black/30 px-2 py-1.5 text-[12px] leading-relaxed text-slick-text placeholder:text-slick-subtle focus:border-white/35 focus:outline-none"
            />
          </Field>

          <Field
            label="Obsidian auto-save"
            help="Requires the Obsidian Local REST API plugin. Slicky appends each new explanation to today's daily note under a Slicky section."
          >
            <label className="mb-2 flex items-center gap-2 rounded-md border border-white/10 bg-black/20 px-2 py-1.5 text-[12px] text-slick-text">
              <input
                type="checkbox"
                checked={settings.obsidian_sync_enabled}
                onChange={(e) => update("obsidian_sync_enabled", e.target.checked)}
                className="accent-white"
              />
              Auto-save new explanations to Obsidian
            </label>
            <div className="grid gap-2">
              <input
                type="text"
                value={settings.obsidian_base_url}
                onChange={(e) => update("obsidian_base_url", e.target.value)}
                placeholder="https://127.0.0.1:27124"
                spellCheck={false}
                autoComplete="off"
                className="w-full rounded-md border border-white/10 bg-black/30 px-2 py-1.5 font-mono text-[12px] text-slick-text placeholder:text-slick-subtle focus:border-white/35 focus:outline-none"
              />
              <input
                type={showKey ? "text" : "password"}
                value={settings.obsidian_api_key}
                onChange={(e) => update("obsidian_api_key", e.target.value)}
                placeholder="Obsidian Local REST API key"
                spellCheck={false}
                autoComplete="off"
                className="w-full rounded-md border border-white/10 bg-black/30 px-2 py-1.5 font-mono text-[12px] text-slick-text placeholder:text-slick-subtle focus:border-white/35 focus:outline-none"
              />
            </div>
          </Field>

          <Field
            label="Capture trigger"
            help={
              settings.capture_trigger === "triple_click" ? (
                <>
                  Hold <kbd>⌥</kbd> and click the image twice. Slicky captures a region around
                  your cursor and explains it. macOS may require Accessibility permission for your
                  terminal during development.
                </>
              ) : (
                <>
                  Press <kbd>⌘</kbd> <kbd>⇧</kbd> <kbd>4</kbd> (or <kbd>⌘</kbd>{" "}
                  <kbd>⇧</kbd> <kbd>3</kbd> / <kbd>⌘</kbd> <kbd>⇧</kbd> <kbd>5</kbd>)
                  anywhere on your Mac and Slicky explains the screenshot.
                </>
              )
            }
          >
            <div className="grid grid-cols-2 gap-1.5">
              <TriggerOption
                active={settings.capture_trigger === "screenshot"}
                title="Screenshot shortcut"
                detail="⌘⇧4 watcher"
                onClick={() => update("capture_trigger", "screenshot")}
              />
              <TriggerOption
                active={settings.capture_trigger === "triple_click"}
                title="Double-click image"
                detail="⌥ + 2 clicks"
                onClick={() => update("capture_trigger", "triple_click")}
              />
            </div>
          </Field>

          <Field
            label="Manual hotkey (optional)"
            help={
              <>
                If you'd rather use Slicky's own interactive selector, set an
                accelerator like <code className="font-mono">CommandOrControl+Shift+E</code>.
                Leave blank to rely solely on macOS's native screenshot keys.
              </>
            }
          >
            <input
              type="text"
              value={settings.shortcut}
              onChange={(e) => update("shortcut", e.target.value)}
              placeholder="(disabled)"
              spellCheck={false}
              autoComplete="off"
              className="w-full rounded-md border border-white/10 bg-black/30 px-2 py-1.5 font-mono text-[12px] text-slick-text placeholder:text-slick-subtle focus:border-white/35 focus:outline-none"
            />
          </Field>
        </div>

        <footer className="read-bar mx-1.5 mb-1.5 flex items-center justify-between gap-2 rounded-lg px-3 py-2">
          <div className="text-[11px]">
            {status.kind === "saving" && <span className="text-slick-subtle">Saving…</span>}
            {status.kind === "saved" && (
              <span className="text-emerald-300">Saved ✓</span>
            )}
            {status.kind === "error" && (
              <span className="text-red-300 selectable">{status.message}</span>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={onBack}
              className="rounded-md px-2 py-1 text-[11.5px] text-slick-subtle hover:bg-white/10 hover:text-slick-text"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={status.kind === "saving"}
              className="rounded-md border border-white/20 bg-white px-3 py-1 text-[11.5px] font-semibold text-black hover:bg-white/90 disabled:opacity-50"
            >
              Save
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}

function Field({
  label,
  help,
  children,
}: {
  label: string;
  help?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-4">
      <label className="mb-1 block text-[11.5px] font-medium uppercase tracking-wide text-slick-subtle">
        {label}
      </label>
      {children}
      {help && <p className="mt-1 text-[11px] leading-relaxed text-slick-subtle">{help}</p>}
    </div>
  );
}

function TriggerOption({
  active,
  title,
  detail,
  onClick,
}: {
  active: boolean;
  title: string;
  detail: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-md border px-2 py-1.5 text-left transition ${
        active
          ? "border-white/35 bg-white/15 text-white"
          : "border-white/10 bg-black/20 text-slick-subtle hover:bg-white/10 hover:text-white"
      }`}
    >
      <div className="text-[11.5px] font-semibold">{title}</div>
      <div className="mt-0.5 text-[10.5px] opacity-80">{detail}</div>
    </button>
  );
}
