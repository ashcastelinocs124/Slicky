import { useCallback, useEffect, useState } from "react";

import {
  loadSettings,
  reregisterShortcut,
  saveSettings,
  type Settings as SettingsT,
} from "../lib/storage";
import { SlicklyLogo } from "./SlicklyLogo";

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
        model: (settings.model || "gpt-5").trim(),
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
            <SlicklyLogo size={18} className="shrink-0 rounded-[4px]" />
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
            label="Trigger"
            help={
              <>
                Slickly watches your macOS screenshot folder. Press <kbd>⌘</kbd>{" "}
                <kbd>⇧</kbd> <kbd>4</kbd> (or <kbd>⌘</kbd> <kbd>⇧</kbd> <kbd>3</kbd> /{" "}
                <kbd>⌘</kbd> <kbd>⇧</kbd> <kbd>5</kbd>) anywhere on your Mac and the
                popup will appear with an explanation of whatever you snipped.
              </>
            }
          >
            <div className="rounded-md border border-white/10 bg-black/20 px-2 py-1.5 text-[12px] text-slick-subtle">
              <span className="text-slick-text">
                <kbd>⌘</kbd> <kbd>⇧</kbd> <kbd>4</kbd>
              </span>{" "}
              · auto-detected from macOS screenshots
            </div>
          </Field>

          <Field
            label="Manual hotkey (optional)"
            help={
              <>
                If you'd rather use Slickly's own interactive selector, set an
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
