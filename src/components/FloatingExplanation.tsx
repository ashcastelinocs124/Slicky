import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";

import {
  captureRegion,
  CaptureCancelled,
  readScreenshotB64,
  type CaptureResult,
} from "../lib/capture";
import { explainImage, OpenAIError, type ExplainMode } from "../lib/openai";
import {
  loadSettings,
  newEntrySkeleton,
  saveHistoryEntry,
  syncExplanationToObsidian,
  type HistoryEntry,
  type Settings,
} from "../lib/storage";
import { Markdown } from "./Markdown";
import { SlickyLogo } from "./SlickyLogo";

type Status =
  | { kind: "idle" }
  | { kind: "capturing" }
  | { kind: "explaining"; mode: ExplainMode }
  | { kind: "ready"; mode: ExplainMode }
  | { kind: "error"; message: string };

interface Props {
  /** Set by App when the Rust watcher detects a new screenshot file. */
  incomingScreenshot?: string | null;
  onIncomingScreenshotHandled?: () => void;
  onOpenHistory: () => void;
  onOpenSettings: () => void;
}

/**
 * The main floating-window experience. Owns the capture → explain → display
 * pipeline plus its buttons and keyboard shortcuts.
 */
export function FloatingExplanation({
  incomingScreenshot,
  onIncomingScreenshotHandled,
  onOpenHistory,
  onOpenSettings,
}: Props) {
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [settings, setSettings] = useState<Settings | null>(null);
  const [capture, setCapture] = useState<CaptureResult | null>(null);
  const [entry, setEntry] = useState<HistoryEntry | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  /** data: URL for the current capture, used as the popup thumbnail. */
  const [thumbDataUrl, setThumbDataUrl] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  /** Avoid stale React state blocking back-to-back watcher events. */
  const pipelineBusyRef = useRef(false);

  // Load settings on mount.
  useEffect(() => {
    loadSettings().then(setSettings).catch(() => setSettings(null));
  }, []);

  const showWindow = useCallback(async () => {
    try {
      await invoke("show_main_window");
    } catch {
      // Best-effort fallback: try via window handle.
      try {
        const w = getCurrentWindow();
        await w.show();
        await w.setFocus();
      } catch {
        /* ignore */
      }
    }
  }, []);

  /**
   * Show the popup anchored to the user's current cursor position. We use
   * this instead of `showWindow` after a capture so the explanation appears
   * right next to where the user was just working — no need to switch back
   * to Slicky's "home" position on a different monitor.
   */
  const showPopupNearCursor = useCallback(async () => {
    try {
      await invoke("show_popup_near_cursor");
    } catch {
      await showWindow();
    }
  }, [showWindow]);

  /**
   * Ensure we have an API key before doing anything that talks to OpenAI.
   * Surfaces a friendly error and opens Settings if not.
   */
  const ensureKey = useCallback(async (): Promise<Settings | null> => {
    const s = await loadSettings();
    setSettings(s);
    if (!s.api_key) {
      await showPopupNearCursor();
      setStatus({
        kind: "error",
        message: "Add your OpenAI API key in Settings to use Slicky.",
      });
      onOpenSettings();
      return null;
    }
    return s;
  }, [onOpenSettings, showPopupNearCursor]);

  /**
   * Given a captured (or watched) image, run the first explanation and
   * render the popup. Shared between manual capture and screenshot watcher.
   */
  const explainCapture = useCallback(
    async (s: Settings, cap: CaptureResult) => {
      setCapture(cap);
      setThumbDataUrl(`data:image/png;base64,${cap.b64}`);
      // Anchor the popup to the user's current cursor — this is what makes
      // Slicky "appear where you snipped" instead of forcing the user to
      // ⌘-Tab back to a window parked somewhere else.
      await showPopupNearCursor();
      setStatus({ kind: "explaining", mode: "explain" });

      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;

      try {
        const result = await explainImage({
          apiKey: s.api_key,
          model: s.model,
          imageB64: cap.b64,
          mode: "explain",
          backgroundContext: s.background_context,
          signal: ac.signal,
        });
        const next = newEntrySkeleton(result.title, result.text, s.model);
        setEntry(next);
        void syncExplanationToObsidian(next).catch((err) => {
          console.warn("[slicky] Obsidian sync failed:", err);
        });
        setStatus({ kind: "ready", mode: "explain" });
      } catch (e) {
        if ((e as Error).name === "AbortError") {
          setStatus({ kind: "idle" });
          return;
        }
        setStatus({
          kind: "error",
          message:
            e instanceof OpenAIError ? e.message : (e as Error).message ?? "Unknown error",
        });
      }
    },
    [showPopupNearCursor]
  );

  /**
   * Manual capture flow — uses Slicky's own interactive region selector.
   * Reachable via the header "camera" button and the optional manual hotkey.
   */
  const startCapture = useCallback(async () => {
    if (status.kind === "capturing" || status.kind === "explaining") return;
    abortRef.current?.abort();
    const s = await ensureKey();
    if (!s) return;

    try {
      await invoke("hide_main_window");
    } catch {
      /* ignore */
    }
    // Give macOS a frame or two to actually unmap the window before
    // screencapture starts compositing the screen contents.
    await new Promise((r) => setTimeout(r, 120));

    setStatus({ kind: "capturing" });
    setEntry(null);
    setSavedId(null);
    setThumbDataUrl(null);

    let cap: CaptureResult;
    try {
      cap = await captureRegion();
    } catch (e) {
      if (e instanceof CaptureCancelled) {
        setStatus({ kind: "idle" });
        return;
      }
      await showPopupNearCursor();
      setStatus({ kind: "error", message: (e as Error).message });
      return;
    }
    await explainCapture(s, cap);
  }, [status.kind, ensureKey, explainCapture, showPopupNearCursor]);

  /**
   * Watcher-driven flow: a macOS screenshot just landed at `path`. Read its
   * bytes and run the same explain pipeline as a manual capture.
   */
  const explainScreenshotPath = useCallback(
    async (path: string) => {
      if (pipelineBusyRef.current) return;
      pipelineBusyRef.current = true;
      try {
        // Rust already presented the window; keep UI in sync and show
        // "Explaining…" immediately (don't wait for OpenAI).
        await showPopupNearCursor();
        setStatus({ kind: "capturing" });
        setEntry(null);
        setSavedId(null);
        setThumbDataUrl(null);

        const s = await ensureKey();
        if (!s) return;

        let b64: string;
        try {
          b64 = await readScreenshotB64(path);
        } catch (e) {
          setStatus({ kind: "error", message: (e as Error).message });
          return;
        }
        await explainCapture(s, { path, b64 });
      } finally {
        pipelineBusyRef.current = false;
      }
    },
    [ensureKey, explainCapture, showPopupNearCursor]
  );

  // Watcher path: App.tsx forwards the file path here.
  useEffect(() => {
    if (!incomingScreenshot) return;
    void explainScreenshotPath(incomingScreenshot).finally(() => {
      onIncomingScreenshotHandled?.();
    });
  }, [
    incomingScreenshot,
    explainScreenshotPath,
    onIncomingScreenshotHandled,
  ]);

  // Listen for the optional manual-hotkey trigger from Rust.
  useEffect(() => {
    let unlisten: UnlistenFn | undefined;
    listen("slickly://trigger-capture", () => {
      void startCapture();
    }).then((fn) => {
      unlisten = fn;
    });
    return () => {
      unlisten?.();
    };
  }, [startCapture]);

  const requestVariant = useCallback(
    async (mode: Exclude<ExplainMode, "explain">) => {
      if (!capture || !entry || !settings?.api_key) return;
      // Re-use the variant if we've already generated it for this entry.
      const existing = entry.variants.find((v) => v.kind === mode);
      if (existing) {
        setEntry({ ...entry, explanation: existing.text });
        setStatus({ kind: "ready", mode });
        return;
      }

      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;
      setStatus({ kind: "explaining", mode });
      try {
        const result = await explainImage({
          apiKey: settings.api_key,
          model: settings.model,
          imageB64: capture.b64,
          mode,
          backgroundContext: settings.background_context,
          previousExplanation:
            entry.variants.find((v) => v.kind === "original")?.text ?? entry.explanation,
          signal: ac.signal,
        });
        const nextVariants = [...entry.variants, { kind: mode, text: result.text }];
        setEntry({
          ...entry,
          title: result.title || entry.title,
          explanation: result.text,
          variants: nextVariants,
        });
        setStatus({ kind: "ready", mode });
      } catch (e) {
        if ((e as Error).name === "AbortError") return;
        setStatus({
          kind: "error",
          message:
            e instanceof OpenAIError ? e.message : (e as Error).message ?? "Unknown error",
        });
      }
    },
    [capture, entry, settings]
  );

  const handleSave = useCallback(async () => {
    if (!entry) return;
    try {
      const saved = await saveHistoryEntry(entry, capture?.path);
      setEntry(saved);
      setSavedId(saved.id);
    } catch (e) {
      setStatus({ kind: "error", message: (e as Error).message });
    }
  }, [entry, capture]);

  const handleClose = useCallback(async () => {
    abortRef.current?.abort();
    try {
      await invoke("hide_main_window");
    } catch {
      /* ignore */
    }
    setStatus({ kind: "idle" });
  }, []);

  // Keyboard-first: cmd-enter retry, cmd-s save, esc close, cmd-1/2/3 variants.
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      const mod = ev.metaKey || ev.ctrlKey;
      if (ev.key === "Escape") {
        ev.preventDefault();
        void handleClose();
        return;
      }
      if (!mod) return;
      if (ev.key === "Enter") {
        ev.preventDefault();
        void startCapture();
      } else if (ev.key.toLowerCase() === "s" && entry) {
        ev.preventDefault();
        void handleSave();
      } else if (ev.key === "1" && entry) {
        ev.preventDefault();
        void requestVariant("simpler");
      } else if (ev.key === "2" && entry) {
        ev.preventDefault();
        void requestVariant("example");
      } else if (ev.key === "3" && entry) {
        ev.preventDefault();
        void requestVariant("detail");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [startCapture, handleSave, handleClose, requestVariant, entry]);

  const busy = status.kind === "capturing" || status.kind === "explaining";
  const hint = useMemo(() => {
    if (status.kind === "capturing") return "Drag to select a region…";
    if (status.kind === "explaining")
      return status.mode === "simpler"
        ? "Simplifying…"
        : status.mode === "example"
          ? "Finding an example…"
          : status.mode === "detail"
            ? "Explaining in detail…"
          : "Explaining…";
    return null;
  }, [status]);

  return (
    <div className="flex h-screen w-screen flex-col bg-transparent">
      <div className="surface flex h-full w-full flex-col overflow-hidden animate-fade-in">
        <Header
          onCapture={startCapture}
          onOpenHistory={onOpenHistory}
          onOpenSettings={onOpenSettings}
          onClose={handleClose}
          busy={busy}
        />

        <div className="read-panel legible overflow-y-auto thin-scroll px-3 py-2.5 text-[13px] leading-relaxed text-white">
          {status.kind === "idle" && !entry && <EmptyState onCapture={startCapture} />}

          {hint && <LoadingBlock label={hint} />}

          {status.kind === "error" && (
            <ErrorBlock
              message={status.message}
              onRetry={startCapture}
              onOpenSettings={onOpenSettings}
            />
          )}

          {entry && status.kind !== "capturing" && (
            <article>
              {thumbDataUrl && (
                <img
                  src={thumbDataUrl}
                  alt="snippet"
                  className="mb-2 max-h-20 rounded object-contain"
                />
              )}
              <h2 className="mb-1 text-[13px] font-semibold leading-snug text-white">
                {entry.title}
              </h2>
              <Markdown text={entry.explanation} />
            </article>
          )}
        </div>

        <Footer
          hasEntry={!!entry}
          busy={busy}
          savedId={savedId}
          currentMode={status.kind === "ready" ? status.mode : null}
          onSimpler={() => requestVariant("simpler")}
          onExample={() => requestVariant("example")}
          onDetail={() => requestVariant("detail")}
          onSave={handleSave}
          onClose={handleClose}
        />
      </div>
    </div>
  );
}

function Header({
  onCapture,
  onOpenHistory,
  onOpenSettings,
  onClose,
  busy,
}: {
  onCapture: () => void;
  onOpenHistory: () => void;
  onOpenSettings: () => void;
  onClose: () => void;
  busy: boolean;
}) {
  return (
    <div
      data-tauri-drag-region
      className="read-bar mx-1.5 mt-1.5 flex items-center justify-between rounded-lg px-2.5 py-1.5"
    >
      <div className="flex items-center gap-2">
        <SlickyLogo size={18} className="shrink-0" />
        <span className="text-[11px] font-semibold tracking-wide text-white">
          Slicky
        </span>
        <span className="text-[10px] text-muted">
          <kbd>⌘</kbd> <kbd>⇧</kbd> <kbd>4</kbd>
        </span>
      </div>
      <div className="flex items-center gap-1">
        <IconButton title="Capture again (⌘↩)" onClick={onCapture} disabled={busy}>
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
            <rect x="3" y="6" width="18" height="13" rx="2" />
            <circle cx="12" cy="12.5" r="3.5" />
            <path d="M8 6l1.5-2h5L16 6" />
          </svg>
        </IconButton>
        <IconButton title="History" onClick={onOpenHistory}>
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
            <path d="M3 12a9 9 0 1 0 3-6.7" />
            <path d="M3 4v5h5" />
            <path d="M12 7v5l3 2" />
          </svg>
        </IconButton>
        <IconButton title="Settings" onClick={onOpenSettings}>
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
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1A2 2 0 1 1 7 4.7l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" />
          </svg>
        </IconButton>
        <IconButton title="Hide (Esc)" onClick={onClose}>
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
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </IconButton>
      </div>
    </div>
  );
}

function IconButton({
  children,
  title,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  title: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      disabled={disabled}
      className="rounded-md p-1.5 text-muted transition hover:bg-white/15 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
    >
      {children}
    </button>
  );
}

function EmptyState({ onCapture }: { onCapture: () => void }) {
  return (
    <div className="legible flex h-full min-h-[120px] flex-col items-center justify-center gap-2 px-3 text-center">
      <SlickyLogo size={32} />
      <div className="text-[12px] font-medium text-white">Snip anything to learn it.</div>
      <div className="max-w-[220px] text-[11px] leading-relaxed text-muted">
        Take any screenshot with <kbd>⌘</kbd> <kbd>⇧</kbd> <kbd>4</kbd> — Slicky picks it up
        the moment it lands on your Desktop and explains what's inside.
      </div>
      <button
        type="button"
        onClick={onCapture}
        className="mt-1 rounded-md bg-white px-2.5 py-1 text-[11px] font-semibold text-black transition hover:bg-white/90"
      >
        Or capture manually
      </button>
    </div>
  );
}

function LoadingBlock({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 py-2 text-muted">
      <span className="relative inline-flex h-2.5 w-2.5">
        <span className="absolute inline-flex h-full w-full animate-pulse-slow rounded-full bg-white opacity-50" />
        <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-white" />
      </span>
      <span className="text-[12px]">{label}</span>
    </div>
  );
}

function ErrorBlock({
  message,
  onRetry,
  onOpenSettings,
}: {
  message: string;
  onRetry: () => void;
  onOpenSettings: () => void;
}) {
  const isKeyIssue = /api key|401|unauthor/i.test(message);
  return (
    <div className="rounded-lg bg-red-950/80 p-3">
      <div className="mb-2 text-[12px] font-semibold text-red-200">Something went wrong</div>
      <div className="mb-3 text-[12px] leading-relaxed text-red-100/90 selectable">
        {message}
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onRetry}
          className="rounded-md bg-white/10 px-2.5 py-1 text-[12px] hover:bg-white/15"
        >
          Try again
        </button>
        {isKeyIssue && (
          <button
            type="button"
            onClick={onOpenSettings}
            className="rounded-md bg-white/10 px-2.5 py-1 text-[12px] hover:bg-white/15"
          >
            Open Settings
          </button>
        )}
      </div>
    </div>
  );
}

function Footer({
  hasEntry,
  busy,
  savedId,
  currentMode,
  onSimpler,
  onExample,
  onDetail,
  onSave,
  onClose,
}: {
  hasEntry: boolean;
  busy: boolean;
  savedId: string | null;
  currentMode: ExplainMode | null;
  onSimpler: () => void;
  onExample: () => void;
  onDetail: () => void;
  onSave: () => void;
  onClose: () => void;
}) {
  return (
    <div className="read-bar mx-1.5 mb-1.5 flex items-center justify-between gap-1 rounded-lg px-2 py-1.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <FooterButton
          onClick={onSimpler}
          disabled={!hasEntry || busy}
          active={currentMode === "simpler"}
          shortcut="⌘1"
        >
          Explain simpler
        </FooterButton>
        <FooterButton
          onClick={onExample}
          disabled={!hasEntry || busy}
          active={currentMode === "example"}
          shortcut="⌘2"
        >
          Give example
        </FooterButton>
        <FooterButton
          onClick={onDetail}
          disabled={!hasEntry || busy}
          active={currentMode === "detail"}
          shortcut="⌘3"
        >
          Explain in detail
        </FooterButton>
        <FooterButton
          onClick={onSave}
          disabled={!hasEntry || busy || savedId !== null}
          shortcut="⌘S"
        >
          {savedId ? "Saved ✓" : "Save to library"}
        </FooterButton>
      </div>
      <FooterButton onClick={onClose} disabled={false} shortcut="Esc" subtle>
        Close
      </FooterButton>
    </div>
  );
}

function FooterButton({
  children,
  onClick,
  disabled,
  active,
  shortcut,
  subtle,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled: boolean;
  active?: boolean;
  shortcut?: string;
  subtle?: boolean;
}) {
  const base =
    "group inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10.5px] font-medium transition";
  const tone = active
    ? "bg-white/20 text-white"
    : subtle
      ? "text-muted hover:bg-white/15 hover:text-white"
      : "bg-white/10 text-white hover:bg-white/15";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`${base} ${tone} disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-white/5`}
    >
      <span>{children}</span>
      {shortcut && (
        <kbd className="hidden group-hover:inline-flex group-focus-visible:inline-flex">
          {shortcut}
        </kbd>
      )}
    </button>
  );
}
