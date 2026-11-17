import { describe, expect, it, vi } from "vitest";

vi.mock("../../assets/lib/kookit-extra-browser.min", () => ({
  ConfigService: { getReaderConfig: () => "" },
}));

import { buildConversationPrompt, formatUsage } from "./claudeCode";

describe("buildConversationPrompt", () => {
  it("returns the bare question without history", () => {
    expect(buildConversationPrompt([], "什么是熵？")).toBe("什么是熵？");
  });

  it("includes history in order", () => {
    const prompt = buildConversationPrompt(
      [
        { role: "user", content: "第一问" },
        { role: "assistant", content: "第一答" },
      ],
      "第二问"
    );
    expect(prompt.indexOf("第一问")).toBeLessThan(prompt.indexOf("第一答"));
    expect(prompt.endsWith("第二问")).toBe(true);
  });

  it("truncates history by characters, keeping the most recent turns", () => {
    const prompt = buildConversationPrompt(
      [
        { role: "user", content: "旧".repeat(50) },
        { role: "assistant", content: "新".repeat(50) },
      ],
      "问题",
      60
    );
    expect(prompt).toContain("新".repeat(50));
    expect(prompt).not.toContain("旧");
  });
});

describe("formatUsage", () => {
  it("formats seconds and dollars", () => {
    expect(formatUsage(0.01234, 2500)).toBe("2.5s · $0.0123");
  });
});
