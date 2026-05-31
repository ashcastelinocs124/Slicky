# Slicky

Snip anything on your Mac — get an instant AI explanation.

Press **⌘⇧4** (or ⌘⇧3 / ⌘⇧5), drag out a region with the native macOS screenshot tool, and a small frosted chat popup appears with the snippet thumbnail and an AI explanation of what's inside. Ask for a simpler version, a concrete example, or save it to a local library you can browse later.

Built with **Tauri 2 + React + TypeScript + Tailwind**.

---

## Features

- **No new shortcut to learn** — Slicky watches your macOS screenshot folder and reacts to **⌘⇧4 / ⌘⇧3 / ⌘⇧5** automatically.
- **Optional trigger mode** — switch to **⌥ + double-click** in Settings to capture a fixed region around your cursor instead.
- **Vision-aware explanations** via the OpenAI Chat Completions API. Defaults to **`gpt-5`**, with the rest of the GPT-5 family, o3 / o4-mini, and the GPT-4 family one click away in Settings.
- **Floating, always-on-top, translucent chat popup** with the screenshot thumbnail above the explanation.
- **Buttons**: *Explain simpler* (`⌘1`), *Give example* (`⌘2`), *Explain in detail* (`⌘3`), *Draw it* (`⌘4`), *Save to library* (`⌘S`), *Close* (`Esc`).
- **Draw it (`⌘4`)** — generate a **first-principles diagram** that builds the concept up from its fundamentals (primitive ideas at the bottom, arrows composing upward to the whole), rendered as a live, editable **Excalidraw** canvas in a separate window.
- **Local library** stored as plain JSON in your app data folder, with snippet thumbnails.
- **Obsidian auto-save** via the Obsidian Local REST API plugin. When enabled, each explanation is saved as `Slicky/<title>.md` using Slicky's AI-generated title.
- **Optional manual hotkey** for when you'd rather use Slicky's own region selector (off by default).
- Fully **keyboard-first** — every action has a shortcut, including `↑/↓` in the library and `/` to search.

### First-principles diagrams (`⌘4`)

After an explanation appears, press **`⌘4`** (or click **Draw it**). Slicky asks the model
for a bottom-up Mermaid `flowchart TD` of the concept — grounded on both the snippet image
and the explanation just shown — converts it to native Excalidraw elements with the official
[`@excalidraw/mermaid-to-excalidraw`](https://github.com/excalidraw/mermaid-to-excalidraw)
converter, and renders it in a separate always-on-top window. The canvas is fully editable;
**Regenerate** asks for a fresh take, and Excalidraw's own menu exports to `.excalidraw` / PNG / SVG.
Fonts are bundled locally, so it works offline. Saving the entry to your library also persists
the diagram's Mermaid source.

## Prerequisites

- macOS 11+
- Node.js 18+ and npm
- Rust (stable) — install via [rustup](https://rustup.rs/) if needed
- Xcode Command Line Tools (`xcode-select --install`)
- An [OpenAI API key](https://platform.openai.com/api-keys) with vision-model access

The first time you press the hotkey, macOS will ask for **Screen Recording** permission for the Slicky app — grant it in *System Settings → Privacy & Security → Screen Recording*.

## Quickstart

```bash
npm install
npm run tauri dev
```

A floating window will appear. Open *Settings*, paste your OpenAI API key, save. Now press `⌘⇧4` anywhere on your Mac, drag out a region, and the explanation popup will appear within a second or two of macOS writing the screenshot to disk.

> Slicky resolves your screenshot folder via `defaults read com.apple.screencapture location` (falling back to `~/Desktop`). Anything that drops a fresh `.png` there will be picked up.
> In **Double-click image** mode, hold `⌥` and click twice near an image/chart. Slicky captures a fixed region around the cursor. During `tauri dev`, macOS may ask for Accessibility permission for your terminal app.

### Optional Obsidian sync

1. Install and enable [Obsidian Local REST API](https://github.com/coddingtonbear/obsidian-local-rest-api).
2. In Obsidian, open *Settings → Local REST API* and copy your API key.
3. In Slicky Settings, enable **Auto-save new explanations to Obsidian**, paste the API key, and keep the default URL unless you changed the plugin port.

Slicky writes through `https://127.0.0.1:27124` and creates a note at `Slicky/<title>.md` in your vault (for example `Slicky/Neural Networks.md`). The Obsidian API key is stored locally in Slicky's settings file.

## Production build

```bash
npm run tauri build
```

The signed `.app` and DMG land under `src-tauri/target/release/bundle/`.

## How it's wired up

```
src/
  App.tsx                       view shell (floating | history | settings)
  components/
    FloatingExplanation.tsx     capture → explain → render pipeline
    History.tsx                 saved-entries library
    Settings.tsx                API key / model / shortcut
    Markdown.tsx                tiny safe MD renderer
  lib/
    capture.ts                  invokes Rust screencapture and reads bytes
    openai.ts                   Chat Completions client with vision prompt
    storage.ts                  IPC wrappers for the Rust JSON store

src-tauri/src/
  lib.rs                        Tauri builder, command registration
  capture.rs                    spawns `/usr/sbin/screencapture -i` (manual mode)
  obsidian.rs                   saves explanations as titled notes in Obsidian vault
  screenshot_watcher.rs         polls the macOS screenshot folder for new PNGs
  triple_click.rs               polls for ⌥ + double-click and captures near cursor
  shortcut.rs                   optional manual hotkey via global-shortcut plugin
  storage.rs                    history.json + settings.json on disk
  window_ops.rs                 show/hide/resize the floating window
```

### Flow

1. On launch, Rust spawns a polling watcher on the user's macOS screenshot directory.
2. When ⌘⇧4 / ⌘⇧3 / ⌘⇧5 writes a fresh `.png` into that directory, the watcher emits `slickly://new-screenshot` with the file path.
3. The frontend reads the bytes via `read_screenshot_b64`, then POSTs the base64 image to `https://api.openai.com/v1/chat/completions` with a tutor-style system prompt.
4. The result is rendered into the floating popup. If Obsidian sync is enabled, Slicky saves a note named after the explanation title.
5. **Save to library** copies the screenshot into the persistent app data dir and appends an entry to `history.json`.

The optional manual hotkey (Settings → "Manual hotkey") still works the old way: it calls `capture_screenshot`, which spawns `/usr/sbin/screencapture -i -x -t png <tmpfile>` for Slicky's own interactive region selector.

### Where your data lives

```
~/Library/Application Support/app.slicky.desktop/
  ├── settings.json     (api_key, model, shortcut)
  ├── history.json      (array of saved explanations)
  └── screenshots/      (PNGs for saved entries)
```

The API key never leaves your machine except in outgoing HTTPS requests to `api.openai.com`, which is explicitly allow-listed in the Tauri CSP.

## Known MVP limitations

- macOS only (the Rust manual capture command spawns `/usr/sbin/screencapture`, and the watcher path resolution relies on `defaults`).
- The watcher only fires when macOS writes a screenshot **to disk** — pressing `Ctrl+⌘⇧4` (copy-to-clipboard) won't trigger Slicky. Either drop the Ctrl or use the manual hotkey for clipboard-only flows.
- Plain JSON store rather than SQLite — fine up to thousands of entries; swap for `tauri-plugin-sql` later if needed.
- Non-streaming OpenAI calls; the first token latency is whatever the chosen model gives you.
- App icon is a placeholder gradient; replace `src-tauri/icons/icon.png` before shipping.
