import { useCallback, useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";

import { FloatingExplanation } from "./components/FloatingExplanation";
import { History } from "./components/History";
import { Settings } from "./components/Settings";

type View = "floating" | "history" | "settings";

/**
 * Top-level shell. Screenshot events are handled here (not inside
 * FloatingExplanation) so a new ⌘⇧4 capture still triggers explain even
 * when the user is on Settings or History.
 */
export default function App() {
  const [view, setView] = useState<View>("floating");
  /** Path from the Rust watcher; consumed by FloatingExplanation. */
  const [incomingScreenshot, setIncomingScreenshot] = useState<string | null>(
    null
  );

  useEffect(() => {
    let unlistenSettings: (() => void) | undefined;
    listen("slickly://open-settings", () => {
      setView("settings");
    })
      .then((fn) => {
        unlistenSettings = fn;
      })
      .catch(() => {});

    return () => {
      unlistenSettings?.();
    };
  }, []);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    listen<string>("slickly://new-screenshot", (event) => {
      const path =
        typeof event.payload === "string"
          ? event.payload
          : String(event.payload ?? "");
      if (!path) return;
      console.log("[slickly] app received screenshot:", path);
      setView("floating");
      setIncomingScreenshot(path);
    })
      .then((fn) => {
        unlisten = fn;
        console.log("[slickly] app subscribed to new-screenshot");
      })
      .catch((e) => {
        console.error("[slickly] app failed to subscribe:", e);
      });
    return () => {
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    const dims: Record<View, { width: number; height: number }> = {
      floating: { width: 280, height: 300 },
      history: { width: 480, height: 400 },
      settings: { width: 300, height: 360 },
    };
    const { width, height } = dims[view];
    invoke("resize_main_window", { width, height }).catch(() => {
      /* best-effort */
    });
  }, [view]);

  const goFloating = useCallback(() => setView("floating"), []);
  const goHistory = useCallback(() => setView("history"), []);
  const goSettings = useCallback(() => setView("settings"), []);
  const clearIncomingScreenshot = useCallback(
    () => setIncomingScreenshot(null),
    []
  );

  if (view === "history") {
    return <History onBack={goFloating} />;
  }
  if (view === "settings") {
    return <Settings onBack={goFloating} />;
  }
  return (
    <FloatingExplanation
      incomingScreenshot={incomingScreenshot}
      onIncomingScreenshotHandled={clearIncomingScreenshot}
      onOpenHistory={goHistory}
      onOpenSettings={goSettings}
    />
  );
}
