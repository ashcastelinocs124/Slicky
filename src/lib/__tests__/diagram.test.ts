import { describe, it, expect } from "vitest";
import {
  extractMermaid,
  buildDiagramMessages,
  DIAGRAM_SYSTEM_PROMPT,
} from "../diagram";

describe("extractMermaid", () => {
  it("strips a ```mermaid fence", () => {
    const raw = "Here:\n```mermaid\nflowchart TD\n  A --> B\n```\nthanks";
    expect(extractMermaid(raw)).toBe("flowchart TD\n  A --> B");
  });

  it("strips a plain ``` fence", () => {
    const raw = "```\nflowchart TD\n  A --> B\n```";
    expect(extractMermaid(raw)).toBe("flowchart TD\n  A --> B");
  });

  it("returns trimmed body when there is no fence", () => {
    const raw = "  flowchart TD\n  A --> B  ";
    expect(extractMermaid(raw)).toBe("flowchart TD\n  A --> B");
  });
});

describe("buildDiagramMessages", () => {
  it("includes the image and the prior explanation as grounding", () => {
    const msgs = buildDiagramMessages({
      imageB64: "AAAA",
      explanation: "A derivative is a rate of change.",
    });
    const json = JSON.stringify(msgs);
    expect(json).toContain("data:image/png;base64,AAAA");
    expect(json).toContain("rate of change");
    expect(DIAGRAM_SYSTEM_PROMPT.toLowerCase()).toContain("flowchart td");
  });

  it("starts with a system message then a user message", () => {
    const msgs = buildDiagramMessages({ imageB64: "x", explanation: "y" }) as Array<{
      role: string;
    }>;
    expect(msgs[0].role).toBe("system");
    expect(msgs[1].role).toBe("user");
  });

  it("instructs a visual diagram: shapes, emoji, and color", () => {
    const json = JSON.stringify(
      buildDiagramMessages({ imageB64: "x", explanation: "y" })
    ).toLowerCase();
    expect(json).toContain("circle");
    expect(json).toContain("emoji");
    expect(json).toContain("fill:");
  });
});
