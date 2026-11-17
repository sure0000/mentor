import { describe, expect, it } from "vitest";
import {
  CHAPTER_POINTS_VERSION,
  MAX_CHAPTER_CHARS,
  buildChapterPointsPrompt,
  extractJson,
  hashText,
  isPointsValid,
  normalizeForMatch,
  toChapterPoints,
  verifyQuote,
} from "./chapterPoints";

const CHAPTER =
  "关键定义：所谓“信道容量”，是指信道在单位时间内能够可靠传输的最大信息量。\n香农证明了，只要传输速率低于信道容量，就存在编码方法使错误率任意小。";

describe("verifyQuote", () => {
  const source = normalizeForMatch(CHAPTER);
  it("accepts verbatim quotes", () => {
    expect(verifyQuote("信道在单位时间内能够可靠传输的最大信息量", source)).toBe(true);
  });
  it("tolerates whitespace, quote marks and punctuation differences", () => {
    expect(verifyQuote("所谓 \"信道容量\" ,是指信道", source)).toBe(true);
    expect(verifyQuote("香农证明了只要传输速率低于信道容量", source)).toBe(true);
  });
  it("rejects fabricated or paraphrased quotes", () => {
    expect(verifyQuote("信道容量是通信系统最重要的指标", source)).toBe(false);
  });
  it("rejects quotes too short to be evidence", () => {
    expect(verifyQuote("信道", source)).toBe(false);
    expect(verifyQuote("", source)).toBe(false);
  });
});

describe("toChapterPoints", () => {
  const ctx = {
    docIndex: 6,
    chapterTitle: "第7章",
    chapterText: CHAPTER,
    truncated: false,
    costUsd: 0.01,
    durationMs: 1000,
  };
  it("marks each quote as verified or not", () => {
    const p = toChapterPoints(
      {
        question: "什么是信道容量？",
        points: [
          { point: "定义了信道容量", quote: "是指信道在单位时间内能够可靠传输的最大信息量" },
          { point: "编造的要点", quote: "这句话在原文里不存在哦" },
        ],
        concepts: [{ term: "信道容量", explanation: "最大可靠传输量", quote: "所谓“信道容量”" }],
        relation: "",
      },
      ctx
    );
    expect(p.points.map((x) => x.quote.verified)).toEqual([true, false]);
    expect(p.concepts[0].quote.verified).toBe(true);
    expect(p.version).toBe(CHAPTER_POINTS_VERSION);
    expect(isPointsValid(p, { docIndex: 6, text: CHAPTER })).toBe(true);
  });
  it("drops malformed items and rejects empty output", () => {
    expect(() => toChapterPoints({ points: [{ quote: "x" }] }, ctx)).toThrow();
    expect(() => toChapterPoints(null, ctx)).toThrow();
  });
});

describe("isPointsValid", () => {
  it("expires when the chapter text changes", () => {
    const p = { version: CHAPTER_POINTS_VERSION, docIndex: 1, textHash: hashText("a"), points: [] };
    expect(isPointsValid(p, { docIndex: 1, text: "a" })).toBe(true);
    expect(isPointsValid(p, { docIndex: 1, text: "b" })).toBe(false);
    expect(isPointsValid(p, { docIndex: 2, text: "a" })).toBe(false);
  });
});

describe("buildChapterPointsPrompt", () => {
  it("truncates very long chapters and says so", () => {
    const long = "字".repeat(MAX_CHAPTER_CHARS + 10);
    const { prompt, truncated } = buildChapterPointsPrompt({
      bookTitle: "书",
      chapter: { title: "长章", text: long },
      previousTitles: [],
    });
    expect(truncated).toBe(true);
    expect(prompt).toContain(`前 ${MAX_CHAPTER_CHARS} 字`);
    expect(prompt.length).toBeLessThan(MAX_CHAPTER_CHARS + 500);
  });
  it("includes previous chapter titles for context", () => {
    const { prompt } = buildChapterPointsPrompt({
      bookTitle: "书",
      chapter: { title: "第3章", text: "正文" },
      previousTitles: ["第1章", "第2章"],
    });
    expect(prompt).toContain("第1章 / 第2章");
  });
});

describe("extractJson", () => {
  it("reads fenced or surrounded JSON", () => {
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJson('好的：{"a":{"b":2}} 以上')).toEqual({ a: { b: 2 } });
  });
  it("throws when there is no JSON", () => {
    expect(() => extractJson("没有")).toThrow();
  });
});
