import { useMemo } from "react";

/**
 * Lightweight Markdown renderer. We intentionally avoid pulling in a real
 * Markdown library — explanations are short, predictable, and we want a
 * tiny bundle. Supported:
 *   - ATX headings (#, ##, ###)
 *   - **bold** and *italic*
 *   - `inline code`
 *   - ```fenced``` code blocks
 *   - blank-line paragraph breaks
 *   - hard line breaks within paragraphs
 *
 * All inline output is escaped before transformation so model output cannot
 * inject HTML into the floating window.
 */
export function Markdown({ text }: { text: string }) {
  const html = useMemo(() => renderMarkdown(text), [text]);
  return (
    <div
      className="selectable prose-slickly leading-relaxed"
      // The renderer guarantees escaped, allow-listed HTML.
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderInline(line: string): string {
  let out = escapeHtml(line);
  // Inline code first so its contents aren't re-parsed for bold/italic.
  out = out.replace(
    /`([^`]+)`/g,
    (_m, c) =>
      `<code class="px-1 py-0.5 rounded bg-black/60 text-[12px] font-mono text-white">${c}</code>`
  );
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");
  return out;
}

function renderMarkdown(src: string): string {
  if (!src) return "";
  const lines = src.replace(/\r\n/g, "\n").split("\n");
  const blocks: string[] = [];
  let i = 0;
  let paragraph: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    const inner = paragraph.map(renderInline).join("<br/>");
    blocks.push(`<p class="mb-2 last:mb-0">${inner}</p>`);
    paragraph = [];
  };

  while (i < lines.length) {
    const line = lines[i]!;
    // Fenced code block.
    if (/^```/.test(line)) {
      flushParagraph();
      const lang = line.replace(/^```/, "").trim();
      i += 1;
      const codeLines: string[] = [];
      while (i < lines.length && !/^```/.test(lines[i]!)) {
        codeLines.push(lines[i]!);
        i += 1;
      }
      i += 1; // closing fence
      const escaped = escapeHtml(codeLines.join("\n"));
      blocks.push(
        `<pre class="my-2 p-2 rounded-lg bg-black/80 overflow-x-auto text-[12px] font-mono text-white"><code data-lang="${escapeHtml(
          lang
        )}">${escaped}</code></pre>`
      );
      continue;
    }
    // Heading.
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) {
      flushParagraph();
      const level = heading[1]!.length;
      const sizes = ["text-base font-semibold", "text-sm font-semibold uppercase tracking-wide", "text-sm font-medium"];
      blocks.push(
        `<h${level} class="${sizes[level - 1]} mb-1 text-slick-text">${renderInline(
          heading[2]!
        )}</h${level}>`
      );
      i += 1;
      continue;
    }
    // Blank line ends paragraph.
    if (line.trim() === "") {
      flushParagraph();
      i += 1;
      continue;
    }
    paragraph.push(line);
    i += 1;
  }
  flushParagraph();
  return blocks.join("");
}
