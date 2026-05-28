/**
 * Thin wrapper around the OpenAI Chat Completions API focused on vision
 * prompts for Slicky. Kept dependency-free so this file is portable.
 *
 * SECURITY: the API key lives in the user's local `settings.json` and is
 * read on demand. We never log it. Requests use `fetch` directly and are
 * permitted through Tauri's CSP allowlist for api.openai.com.
 */

export type ExplainMode = "explain" | "simpler" | "example" | "detail";

export interface ExplainParams {
  apiKey: string;
  model: string;
  /** Base64-encoded PNG bytes (no data URL prefix). */
  imageB64: string;
  mode: ExplainMode;
  /** Optional prior explanation for "simpler"/"example" follow-ups. */
  previousExplanation?: string;
  /** Optional user background used to tailor the explanation. */
  backgroundContext?: string;
  signal?: AbortSignal;
}

export interface ExplainResult {
  text: string;
  /** Best-effort short title (first sentence / first heading-ish line). */
  title: string;
}

const PROMPTS: Record<ExplainMode, string> = {
  explain:
    "You are Slicky, a concise tutor. The user just snipped a region of their screen. " +
    "Identify the single most important concept, term, formula, code construct, or UI element shown, " +
    "and explain the concept clearly and concisely. " +
    "If the screenshot is a chart, graph, table, or other data visualization, first explain what the chart is about, " +
    "then add the important visible data points, comparisons, minimums/maximums, or trend. " +
    "If a number is not legible, say it is unclear rather than guessing. " +
    "Start your answer with a bold one-line title (Markdown **like this**) naming the concept, " +
    "then a blank line, then the explanation. " +
    "Do not describe the screenshot ('I see a screenshot of...'); just explain the concept. " +
    "Plain prose, no lists unless the concept or data is genuinely list-shaped.",
  simpler:
    "You previously gave an explanation for the snipped image. Re-explain the same concept " +
    "in even simpler language — imagine a smart 12-year-old has never seen it. " +
    "Use at most 4 short sentences and one familiar analogy. " +
    "Keep the same bold one-line title on the first line, then a blank line, then the explanation.",
  example:
    "You previously explained the concept shown in the snipped image. Now give ONE concrete, " +
    "memorable example that uses or illustrates the concept. Keep the same bold one-line title on " +
    "the first line (you may append ' — Example'), then a blank line, then the example. " +
    "If code is appropriate, use a fenced code block. Otherwise 2-4 sentences.",
  detail:
    "You previously gave a short explanation for the snipped image. Now explain the same concept in detail. " +
    "Keep the same bold one-line title on the first line (you may append ' — In Detail'), then a blank line. " +
    "First explain the concept, key parts, why they matter, how they relate, and any important caveats. " +
    "If the image also contains a chart, graph, table, or data visualization, then walk through the visible data points, axes, labels, units, comparisons, and trend. " +
    "Use clear Markdown with short paragraphs or bullets when helpful.",
};

function deriveTitle(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return "Untitled";
  const firstLine = trimmed.split("\n")[0]!.trim();
  const stripped = firstLine.replace(/^\*+|\*+$/g, "").replace(/^#+\s*/, "");
  return (stripped || trimmed).slice(0, 90);
}

function stripLeadingTitle(text: string): string {
  const trimmed = text.trim();
  const lines = trimmed.split("\n");
  const first = lines[0]?.trim() ?? "";
  const looksLikeTitle = /^#{1,3}\s+\S/.test(first) || /^\*\*[^*]+\*\*$/.test(first);
  if (!looksLikeTitle) return trimmed;

  const rest = lines.slice(1);
  while (rest[0]?.trim() === "") {
    rest.shift();
  }
  return rest.join("\n").trim() || trimmed;
}

export class OpenAIError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "OpenAIError";
    this.status = status;
  }
}

/**
 * Call the Chat Completions endpoint with the image attached. We use
 * non-streaming for the MVP because the floating window is small and the
 * full reply arrives in a second or two.
 */
export async function explainImage(params: ExplainParams): Promise<ExplainResult> {
  const { apiKey, model, imageB64, mode, previousExplanation, backgroundContext, signal } = params;
  if (!apiKey) {
    throw new OpenAIError("Missing OpenAI API key. Open Settings to add one.", 0);
  }

  const userContent: Array<Record<string, unknown>> = [
    { type: "text", text: PROMPTS[mode] },
  ];

  const trimmedBackground = backgroundContext?.trim();
  if (trimmedBackground) {
    userContent.push({
      type: "text",
      text:
        "User background/context for tailoring the explanation. Use this only to choose the right level, examples, and assumptions; do not mention it unless directly useful:\n" +
        `"""\n${trimmedBackground}\n"""`,
    });
  }

  if (mode !== "explain" && previousExplanation) {
    userContent.push({
      type: "text",
      text: `Previous explanation for reference:\n"""\n${previousExplanation}\n"""`,
    });
  }

  userContent.push({
    type: "image_url",
    image_url: {
      url: `data:image/png;base64,${imageB64}`,
      // Charts, tables, and code often hide meaning in small numeric labels.
      // High detail costs more tokens, but avoids losing those data points.
      detail: "high",
    },
  });

  // OpenAI parameter quirks (as of 2026):
  //   - o-series reasoning models (o1/o3/o4-mini, ...) and the GPT-5 family
  //     accept `max_completion_tokens` but reject `max_tokens`. They also
  //     reject any `temperature` other than the default (1) — sending 0.4
  //     gets you a 400 "Unsupported value" error.
  //   - Older chat models (gpt-4o, gpt-4.1) accept both, but `max_tokens` is
  //     considered legacy.
  // We always emit `max_completion_tokens` and only attach `temperature`
  // when the model is known to support a custom value.
  const isReasoning = /^o\d/i.test(model);
  const isGpt5 = /^gpt-5/i.test(model);
  const supportsTemperature = !isReasoning && !isGpt5;

  const body: Record<string, unknown> = {
    model,
    max_completion_tokens: isGpt5 || isReasoning ? 1200 : 800,
    messages: [
      {
        role: "system",
        content:
          "You are Slicky, a hyper-concise on-screen explainer. Always answer in clean Markdown.",
      },
      { role: "user", content: userContent },
    ],
  };
  if (supportsTemperature) {
    body.temperature = 0.4;
  }
  // Keep GPT-5 snappy for an interactive popup. Users who want deeper
  // analysis can pick a non-mini o-series model from Settings.
  if (isGpt5) {
    body.reasoning_effort = "minimal";
  }

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
      const data = await resp.json();
      detail = data?.error?.message ?? JSON.stringify(data);
    } catch {
      detail = await resp.text().catch(() => "");
    }
    throw new OpenAIError(
      `OpenAI request failed (${resp.status}): ${detail || resp.statusText}`,
      resp.status
    );
  }

  const data = await resp.json();
  const text: string = data?.choices?.[0]?.message?.content?.toString?.() ?? "";
  if (!text.trim()) {
    throw new OpenAIError("OpenAI returned an empty response.", 200);
  }
  return { text: stripLeadingTitle(text), title: deriveTitle(text) };
}
