import { describe, it, expect } from "vitest";
import { buildChatBody } from "../openai";

describe("buildChatBody", () => {
  const messages = [{ role: "user", content: "hi" }];

  it("gpt-5: reasoning_effort, no temperature, 1200 default tokens", () => {
    const b = buildChatBody({ model: "gpt-5", messages });
    expect(b.reasoning_effort).toBe("minimal");
    expect(b.temperature).toBeUndefined();
    expect(b.max_completion_tokens).toBe(1200);
  });

  it("o-series: no temperature, no reasoning_effort, 1200 default", () => {
    const b = buildChatBody({ model: "o4-mini", messages });
    expect(b.temperature).toBeUndefined();
    expect(b.reasoning_effort).toBeUndefined();
    expect(b.max_completion_tokens).toBe(1200);
  });

  it("gpt-4o: temperature 0.4, 800 default", () => {
    const b = buildChatBody({ model: "gpt-4o", messages });
    expect(b.temperature).toBe(0.4);
    expect(b.max_completion_tokens).toBe(800);
  });

  it("honors explicit maxTokens", () => {
    const b = buildChatBody({ model: "gpt-4o", messages, maxTokens: 1500 });
    expect(b.max_completion_tokens).toBe(1500);
  });
});
