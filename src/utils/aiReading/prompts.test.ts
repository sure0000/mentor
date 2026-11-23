import { describe, expect, it } from "vitest";
import {
  DEFAULT_PROMPTS,
  PROMPT_PLACEHOLDERS,
  PromptKey,
  fillPrompt,
  sourceLangText,
} from "./prompts";
import { buildQaSystem, QA_EXTRA_OPEN, QA_SOURCES_OPEN } from "./bookQa";

describe("default prompts", () => {
  it("contain exactly the declared placeholders", () => {
    for (const key of Object.keys(DEFAULT_PROMPTS) as PromptKey[]) {
      const used = Array.from(
        new Set(DEFAULT_PROMPTS[key].match(/\{\w+\}/g) || [])
      ).sort();
      expect(used, key).toEqual([...PROMPT_PLACEHOLDERS[key]].sort());
    }
  });

  it("are written in Chinese", () => {
    for (const key of Object.keys(DEFAULT_PROMPTS) as PromptKey[]) {
      expect(DEFAULT_PROMPTS[key], key).toMatch(/[一-鿿]/);
    }
  });
});

describe("fillPrompt", () => {
  it("replaces every occurrence and keeps unknown placeholders", () => {
    expect(fillPrompt("{to}/{to} {x}", { to: "中文" })).toBe("中文/中文 {x}");
  });

  it("does not re-expand placeholders inside inserted text", () => {
    expect(fillPrompt("{word}|{to}", { word: "{to}", to: "英语" })).toBe(
      "{to}|英语"
    );
  });

  it("leaves no placeholders in the dictionary prompt", () => {
    const out = fillPrompt(DEFAULT_PROMPTS.aiDict, {
      word: "entropy",
      to: "中文",
      sentence: "（未提供）",
    });
    expect(out).not.toMatch(/\{\w+\}/);
  });
});

describe("sourceLangText", () => {
  it("maps automatic source to a readable value", () => {
    expect(sourceLangText("")).toBe("自动识别");
    expect(sourceLangText("Automatic")).toBe("自动识别");
    expect(sourceLangText("English")).toBe("English");
  });
});

describe("buildQaSystem", () => {
  it("always appends the fixed format rules to a custom base prompt", () => {
    const system = buildQaSystem("只用一句话回答。");
    expect(system.startsWith("只用一句话回答。")).toBe(true);
    expect(system).toContain(QA_EXTRA_OPEN);
    expect(system).toContain(QA_SOURCES_OPEN);
  });
});
