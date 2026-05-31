/**
 * Mermaid → Excalidraw conversion. Isolated from `diagram.ts` because it pulls
 * in the heavy `@excalidraw/*` runtime and needs a real browser DOM (Mermaid
 * renders an SVG to compute layout). Only the diagram window imports this.
 */
import { parseMermaidToExcalidraw } from "@excalidraw/mermaid-to-excalidraw";
import { convertToExcalidrawElements } from "@excalidraw/excalidraw";

export type DiagramScene = {
  elements: ReturnType<typeof convertToExcalidrawElements>;
  files: NonNullable<Awaited<ReturnType<typeof parseMermaidToExcalidraw>>["files"]>;
};

/**
 * Convert Mermaid text into native Excalidraw elements ready to load into the
 * canvas. Throws if the Mermaid is unparseable (caller shows a fallback).
 */
export async function mermaidToScene(mermaid: string): Promise<DiagramScene> {
  const { elements, files } = await parseMermaidToExcalidraw(mermaid);
  return {
    elements: convertToExcalidrawElements(elements),
    files: files ?? {},
  };
}
