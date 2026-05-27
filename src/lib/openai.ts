/**
 * Thin wrapper around the OpenAI Chat Completions API focused on vision
 * prompts for Slickly. Kept dependency-free so this file is portable.
 *
 * SECURITY: the API key lives in the user's local `settings.json` and is
 * read on demand. We never log it. Requests use `fetch` directly and are
 * permitted through Tauri's CSP allowlist for api.openai.com.
 */

export type ExplainMode = "explain" | "simpler" | "example";

export interface ExplainParams {
  apiKey: string;
  model: string;
  /** Base64-encoded PNG bytes (no data URL prefix). */
  imageB64: string;
  mode: ExplainMode;
  /** Optional prior explanation for "simpler"/"example" follow-ups. */
  previousExplanation?: string;
  signal?: AbortSignal;
}

export interface ExplainResult {
  text: string;
  /** Best-effort short title (first sentence / first heading-ish line). */
  title: string;
}

const PROMPTS: Record<ExplainMode, string> = {
  explain:
    "You are Slickly, a concise tutor. The user just snipped a region of their screen. " +
    "Identify the single most important concept, term, formula, code construct, or UI element shown, " +
    "and explain it clearly in 3-6 short sentences. " +
    "Start your answer with a bold one-line title (Markdown **like this**) naming the concept, " +
    "then a blank line, then the explanation. " +
    "Do not describe the screenshot ('I see a screenshot of...'); just explain the concept. " +
    "Plain prose, no lists unless the concept is genuinely list-shaped.",
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
};

function deriveTitle(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return "Untitled";
  const firstLine = trimmed.split("\n")[0]!.trim();
  const stripped = firstLine.replace(/^\*+|\*+$/g, "").replace(/^#+\s*/, "");
  return (stripped || trimmed).slice(0, 90);
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
  const { apiKey, model, imageB64, mode, previousExplanation, signal } = params;
  if (!apiKey) {
    throw new OpenAIError("Missing OpenAI API key. Open Settings to add one.", 0);
  }

  const userContent: Array<Record<string, unknown>> = [
    { type: "text", text: PROMPTS[mode] },
  ];

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
      // Slickly always sends small region screenshots, so low detail is enough
      // and roughly halves token cost vs "auto".
      detail: "low",
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
          "You are Slickly, a hyper-concise on-screen explainer. Always answer in clean Markdown.",
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
  return { text: text.trim(), title: deriveTitle(text) };
}
