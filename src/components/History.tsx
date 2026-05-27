import { useCallback, useEffect, useMemo, useState } from "react";

import { readScreenshotB64 } from "../lib/capture";
import {
  clearHistory,
  deleteHistoryEntry,
  loadHistory,
  type HistoryEntry,
  type Variant,
} from "../lib/storage";
import { Markdown } from "./Markdown";
import { SlickyLogo } from "./SlickyLogo";

interface Props {
  onBack: () => void;
}

/**
 * Library of saved explanations. Keyboard-first:
 *   - ↑/↓ to move through entries
 *   - ⌫ to delete the selected entry
 *   - Esc to go back
 *   - / to focus the search box
 */
export function History({ onBack }: Props) {
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [thumb, setThumb] = useState<string | null>(null);
  const [variantKind, setVariantKind] =
    useState<Variant["kind"]>("original");

  const refresh = useCallback(async () => {
    const list = await loadHistory();
    setEntries(list);
    setSelectedId((prev) => prev ?? list[0]?.id ?? null);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const filtered = useMemo(() => {
    if (!query.trim()) return entries;
    const q = query.toLowerCase();
    return entries.filter(
      (e) =>
        e.title.toLowerCase().includes(q) ||
        e.explanation.toLowerCase().includes(q)
    );
  }, [entries, query]);

  const selected = useMemo(
    () => filtered.find((e) => e.id === selectedId) ?? filtered[0] ?? null,
    [filtered, selectedId]
  );

  // Reset variant view when switching entries.
  useEffect(() => {
    setVariantKind("original");
  }, [selected?.id]);

  // Lazy-load the screenshot thumbnail for the selected entry.
  useEffect(() => {
    setThumb(null);
    if (!selected?.screenshot_path) return;
    let cancelled = false;
    readScreenshotB64(selected.screenshot_path)
      .then((b64) => {
        if (!cancelled) setThumb(`data:image/png;base64,${b64}`);
      })
      .catch(() => {
        /* missing file is fine */
      });
    return () => {
      cancelled = true;
    };
  }, [selected?.screenshot_path]);

  const handleDelete = useCallback(
    async (id: string) => {
      try {
        await deleteHistoryEntry(id);
        setEntries((prev) => {
          const next = prev.filter((e) => e.id !== id);
          if (selectedId === id) {
            setSelectedId(next[0]?.id ?? null);
          }
          return next;
        });
      } catch {
        /* keep UI optimistic; user can retry */
      }
    },
    [selectedId]
  );

  const handleClearAll = useCallback(async () => {
    if (!confirm("Delete every saved explanation? This can't be undone.")) return;
    await clearHistory();
    setEntries([]);
    setSelectedId(null);
  }, []);

  // Keyboard navigation.
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      const target = ev.target as HTMLElement | null;
      const inEditable =
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable);
      if (ev.key === "Escape") {
        if (inEditable) return;
        ev.preventDefault();
        onBack();
        return;
      }
      if (ev.key === "/" && !inEditable) {
        ev.preventDefault();
        document.getElementById("history-search")?.focus();
        return;
      }
      if (inEditable) return;
      if ((ev.key === "Backspace" || ev.key === "Delete") && selected) {
        ev.preventDefault();
        void handleDelete(selected.id);
        return;
      }
      if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
        if (filtered.length === 0) return;
        ev.preventDefault();
        const idx = filtered.findIndex((e) => e.id === selected?.id);
        const next =
          ev.key === "ArrowDown"
            ? Math.min(idx + 1, filtered.length - 1)
            : Math.max(idx - 1, 0);
        setSelectedId(filtered[next]!.id);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [filtered, selected, handleDelete, onBack]);

  const currentText = useMemo(() => {
    if (!selected) return "";
    if (variantKind === "original") return selected.explanation;
    return (
      selected.variants.find((v) => v.kind === variantKind)?.text ??
      selected.explanation
    );
  }, [selected, variantKind]);

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
              Library
            </span>
            <span className="text-[11px] text-slick-subtle">
              {entries.length} {entries.length === 1 ? "entry" : "entries"}
            </span>
          </div>
          {entries.length > 0 && (
            <button
              type="button"
              onClick={handleClearAll}
              className="rounded-md px-2 py-1 text-[11px] text-slick-subtle transition hover:bg-red-500/15 hover:text-red-200"
            >
              Clear all
            </button>
          )}
        </div>

        <div className="grid h-full grid-cols-[180px_1fr] overflow-hidden">
          <aside className="read-bar mx-1.5 mb-1.5 flex h-full flex-col rounded-lg border-r border-white/10">
            <div className="border-b border-white/5 p-2">
              <input
                id="history-search"
                type="text"
                placeholder="Search…  /"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="w-full rounded-md border border-white/10 bg-black/30 px-2 py-1 text-[12px] text-slick-text placeholder:text-slick-subtle focus:border-white/35 focus:outline-none"
              />
            </div>
            <div className="flex-1 overflow-y-auto thin-scroll">
              {filtered.length === 0 ? (
                <div className="p-3 text-[11px] text-slick-subtle">
                  {entries.length === 0
                    ? "Nothing saved yet. Press ⌘⇧E to capture."
                    : "No matches."}
                </div>
              ) : (
                <ul>
                  {filtered.map((e) => (
                    <li key={e.id}>
                      <button
                        type="button"
                        onClick={() => setSelectedId(e.id)}
                        className={`block w-full px-3 py-2 text-left transition ${
                          selected?.id === e.id
                            ? "bg-white/12"
                            : "hover:bg-white/5"
                        }`}
                      >
                        <div className="truncate text-[12px] font-medium text-slick-text">
                          {e.title || "Untitled"}
                        </div>
                        <div className="mt-0.5 truncate text-[10.5px] text-slick-subtle">
                          {formatDate(e.created_at)}
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </aside>

          <section className="read-panel mx-1.5 mb-1.5 mr-1.5 flex h-full flex-col overflow-hidden text-white">
            {selected ? (
              <>
                <header className="border-b border-white/5 px-4 py-3">
                  <h2 className="text-[14px] font-semibold leading-tight text-slick-text">
                    {selected.title || "Untitled"}
                  </h2>
                  <div className="mt-0.5 flex items-center gap-2 text-[11px] text-slick-subtle">
                    <span>{formatDate(selected.created_at)}</span>
                    {selected.model && (
                      <>
                        <span>·</span>
                        <span className="font-mono">{selected.model}</span>
                      </>
                    )}
                  </div>
                  {selected.variants.length > 1 && (
                    <div className="mt-2 flex gap-1">
                      {selected.variants.map((v) => (
                        <button
                          key={v.kind}
                          type="button"
                          onClick={() => setVariantKind(v.kind)}
                          className={`rounded-md px-2 py-0.5 text-[10.5px] capitalize transition ${
                            variantKind === v.kind
                              ? "bg-white/15 text-slick-text"
                              : "bg-white/5 text-slick-subtle hover:bg-white/10"
                          }`}
                        >
                          {v.kind}
                        </button>
                      ))}
                    </div>
                  )}
                </header>
                <div className="legible flex-1 overflow-y-auto thin-scroll px-4 py-3 text-[13px] text-slick-text">
                  {thumb && (
                    <img
                      src={thumb}
                      alt="snippet"
                      className="mb-3 max-h-40 rounded-lg border border-white/10 object-contain"
                    />
                  )}
                  <Markdown text={currentText} />
                </div>
                <footer className="flex items-center justify-end gap-1.5 border-t border-white/10 bg-black/10 px-2 py-2">
                  <button
                    type="button"
                    onClick={() => handleDelete(selected.id)}
                    className="rounded-md px-2 py-1 text-[11.5px] text-slick-subtle transition hover:bg-red-500/15 hover:text-red-200"
                  >
                    Delete (⌫)
                  </button>
                </footer>
              </>
            ) : (
              <div className="flex h-full items-center justify-center text-[12px] text-slick-subtle">
                Select an entry to view it.
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}
