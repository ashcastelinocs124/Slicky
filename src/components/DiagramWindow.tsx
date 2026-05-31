import React, { useEffect, useRef, useState } from "react";
import { listen, emit } from "@tauri-apps/api/event";
import { Excalidraw } from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";

import { mermaidToScene } from "../lib/mermaidScene";

/** Imperative API type, inferred from the component prop to avoid deep imports. */
type ExcalidrawAPI = Parameters<
  NonNullable<React.ComponentProps<typeof Excalidraw>["excalidrawAPI"]>
>[0];

/** Payload pushed from the main window when a diagram is generated. */
interface DiagramScenePayload {
  mermaid: string;
  title?: string;
}

/**
 * The diagram window's React root. Hosts a live Excalidraw canvas (export lives
 * in Excalidraw's own menu) plus a thin top bar with the concept title and a
 * Regenerate action that asks the main window for a fresh diagram.
 */
export default function DiagramWindow() {
  const apiRef = useRef<ExcalidrawAPI | null>(null);
  const [title, setTitle] = useState<string>("Diagram");
  const [error, setError] = useState<string | null>(null);
  const [rawMermaid, setRawMermaid] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const unlisteners: Array<() => void> = [];
    let cancelled = false;

    Promise.all([
      listen<DiagramScenePayload>("slickly://diagram-scene", async (event) => {
        const mermaid = String(event.payload?.mermaid ?? "");
        if (event.payload?.title) setTitle(event.payload.title);
        setRawMermaid(mermaid);
        setError(null);
        try {
          const scene = await mermaidToScene(mermaid);
          apiRef.current?.updateScene({ elements: scene.elements });
          const files = Object.values(scene.files);
          if (files.length) apiRef.current?.addFiles(files);
          apiRef.current?.scrollToContent(scene.elements, { fitToContent: true });
        } catch (err) {
          setError((err as Error).message);
        } finally {
          setBusy(false);
        }
      }),
      // Generation failed on the main side — clear the spinner and surface it
      // here rather than leaving Regenerate stuck on "Regenerating…".
      listen<string>("slickly://diagram-error", (event) => {
        setError(String(event.payload ?? "Diagram generation failed."));
        setBusy(false);
      }),
    ]).then((fns) => {
      if (cancelled) {
        fns.forEach((fn) => fn());
        return;
      }
      fns.forEach((fn) => unlisteners.push(fn));
      // Tell the main window we're listening; it (re)sends the latest scene,
      // closing the first-open race where our emit could precede this listener.
      void emit("slickly://diagram-ready");
    });

    return () => {
      cancelled = true;
      unlisteners.forEach((fn) => fn());
    };
  }, []);

  const regenerate = () => {
    setBusy(true);
    setError(null);
    void emit("slickly://diagram-regenerate");
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          padding: "6px 10px",
          borderBottom: "1px solid #e5e7eb",
          background: "#fafafa",
          font: "600 12px system-ui, sans-serif",
          color: "#111827",
          flex: "0 0 auto",
        }}
      >
        <span
          style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
        >
          {title}
        </span>
        <button
          type="button"
          onClick={regenerate}
          disabled={busy}
          style={{
            border: "1px solid #d1d5db",
            borderRadius: 6,
            padding: "3px 10px",
            background: busy ? "#f3f4f6" : "#fff",
            color: "#111827",
            cursor: busy ? "default" : "pointer",
            font: "600 11px system-ui, sans-serif",
          }}
        >
          {busy ? "Regenerating…" : "Regenerate"}
        </button>
      </div>

      <div style={{ position: "relative", flex: "1 1 auto", minHeight: 0 }}>
        {error && (
          <pre
            style={{
              position: "absolute",
              zIndex: 10,
              top: 0,
              left: 0,
              right: 0,
              margin: 0,
              padding: 12,
              color: "#b91c1c",
              background: "rgba(254,242,242,.96)",
              borderBottom: "1px solid #fecaca",
              maxWidth: "100%",
              whiteSpace: "pre-wrap",
              fontSize: 12,
            }}
          >
            Could not render diagram: {error}
            {rawMermaid ? `\n\n${rawMermaid}` : ""}
          </pre>
        )}
        <Excalidraw excalidrawAPI={(api) => (apiRef.current = api)} />
      </div>
    </div>
  );
}
