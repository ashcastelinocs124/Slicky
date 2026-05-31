/**
 * Diagram generation for Slicky's "Draw it" mode. Turns a snipped concept into
 * a bottom-up, first-principles Mermaid `flowchart TD` via OpenAI.
 *
 * This module is intentionally free of the heavy `@excalidraw/*` imports so it
 * stays fast to unit-test. The Mermaid→Excalidraw conversion (which needs a
 * real browser DOM) lives in `mermaidScene.ts` and is only loaded by the
 * diagram window.
 */

import { buildChatBody, OpenAIError } from "./openai";

/**
 * Pull the Mermaid source out of a model reply. Handles ```mermaid fences,
 * bare ``` fences, and un-fenced output. Returns trimmed Mermaid text.
 */
export function extractMermaid(raw: string): string {
  const fence = raw.match(/```(?:mermaid)?\s*([\s\S]*?)```/i);
  return (fence ? fence[1] : raw).trim();
}

export const DIAGRAM_SYSTEM_PROMPT =
  "You are Slicky's diagram engine. You output ONLY a Mermaid `flowchart TD` and nothing else.";

const DIAGRAM_USER_PROMPT =
  "Decompose the concept in the snipped image into its most fundamental primitives — " +
  "the irreducible ideas it rests on — and draw a VISUAL Mermaid `flowchart TD` that " +
  "BUILDS UP from them: leaf nodes are the primitives, arrows flow upward into the " +
  "intermediate ideas they combine into, ending at the full concept as the single top node.\n" +
  "Make it look like a diagram, not a column of identical boxes:\n" +
  "- Vary node SHAPE by role: primitives as circles ((like this)); intermediate ideas as " +
  "rounded nodes (like this); the final top concept as a double circle (((like this))); use a " +
  "diamond {like this} for a condition/branch and a cylinder [(like this)] for a data/source " +
  "when one genuinely fits.\n" +
  "- Start EVERY node label with one relevant emoji, e.g. ((🌱 base case)) or (🔁 recursion).\n" +
  "- COLOR nodes by role with `style` lines using these fills: primitives fill:#b2f2bb " +
  "stroke:#2f9e44, intermediates fill:#a5d8ff stroke:#1971c2, the final concept fill:#ffec99 " +
  "stroke:#f08c00 — e.g. `style A fill:#b2f2bb,stroke:#2f9e44`.\n" +
  "- Label each arrow with how the lower pieces combine when it adds meaning.\n" +
  "Use 5–12 nodes. Keep each label to a few words and free of characters that break Mermaid " +
  "(no unescaped parentheses, quotes, semicolons, or colons inside a label; the emoji and a " +
  "short phrase only). Output ONLY a fenced ```mermaid code block.";

export interface DiagramParams {
  apiKey: string;
  model: string;
  /** Base64-encoded PNG bytes (no data URL prefix). */
  imageB64: string;
  /** The prose explanation already shown, used to keep the diagram consistent. */
  explanation: string;
  signal?: AbortSignal;
}

/**
 * Build the Chat Completions `messages` array for a diagram request. Grounded
 * on both the snippet image and the prose explanation already shown, so the
 * diagram agrees with what the user just read.
 */
export function buildDiagramMessages(params: {
  imageB64: string;
  explanation: string;
}): unknown[] {
  const { imageB64, explanation } = params;
  return [
    { role: "system", content: DIAGRAM_SYSTEM_PROMPT },
    {
      role: "user",
      content: [
        { type: "text", text: DIAGRAM_USER_PROMPT },
        {
          type: "text",
          text:
            "For consistency, here is the prose explanation already shown to the user. " +
            'Make the diagram agree with it:\n"""\n' +
            explanation +
            '\n"""',
        },
        {
          type: "image_url",
          image_url: { url: `data:image/png;base64,${imageB64}`, detail: "high" },
        },
      ],
    },
  ];
}

/** Calls OpenAI and returns the raw Mermaid source (fence already stripped). */
export async function buildDiagramMermaid(params: DiagramParams): Promise<string> {
  const { apiKey, model, imageB64, explanation, signal } = params;
  if (!apiKey) throw new OpenAIError("Missing OpenAI API key.", 0);

  const body = buildChatBody({
    model,
    messages: buildDiagramMessages({ imageB64, explanation }),
    maxTokens: 900,
  });

  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
    signal,
  });

  if (!resp.ok) {
    let detail = "";
    try {
      detail = (await resp.json())?.error?.message ?? "";
    } catch {
      /* ignore parse failure; fall back to status text */
    }
    throw new OpenAIError(
      `Diagram request failed (${resp.status}): ${detail || resp.statusText}`,
      resp.status
    );
  }

  const data = await resp.json();
  const text: string = data?.choices?.[0]?.message?.content?.toString?.() ?? "";
  const mermaid = extractMermaid(text);
  if (!mermaid) throw new OpenAIError("Model returned no Mermaid.", 200);
  return mermaid;
}
