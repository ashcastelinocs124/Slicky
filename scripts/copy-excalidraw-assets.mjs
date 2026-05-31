/**
 * Copy Excalidraw's hand-drawn fonts from node_modules into public/fonts so the
 * embedded canvas can load them locally (window.EXCALIDRAW_ASSET_PATH = "/").
 *
 * Run automatically via the `predev` / `prebuild` npm lifecycle hooks, so both
 * `npm run tauri dev` and `npm run tauri build` get the fonts. The fonts are
 * gitignored (~13MB) — they live in node_modules and are copied on demand.
 */
import { cpSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const src = resolve(
  root,
  "node_modules/@excalidraw/excalidraw/dist/prod/fonts"
);
const dest = resolve(root, "public/fonts");

if (!existsSync(src)) {
  // Don't hard-fail dev startup if deps aren't installed yet.
  console.error(
    `[copy-assets] Excalidraw fonts not found at ${src}. Run \`npm install\` first.`
  );
  process.exit(0);
}

mkdirSync(dirname(dest), { recursive: true });
cpSync(src, dest, { recursive: true });
console.log("[copy-assets] copied Excalidraw fonts -> public/fonts");
