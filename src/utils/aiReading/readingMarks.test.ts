import { describe, expect, it } from "vitest";
import { estimateGuideCost } from "./bookGuide";
import { normalizeForMatch } from "./chapterPoints";
import {
  READING_MARKS_VERSION,
  annotationKey,
  buildReadingMarksPrompt,
  countByKind,
  isMarksValid,
  locateParagraphs,
  locateQuote,
  normalizeAnnotations,
  splitParagraphs,
  toChapterMarks,
} from "./readingMarks";

const PARAS = [
  "上一章我们讲了信息的度量。",
  "所谓信道容量，是指信道在单位时间内能够可靠传输的最大信息量。",
  "香农证明了，只要传输速率低于信道容量，就存在编码方法使错误率任意小。",
  "这个结论在当时令人震惊。",
];
const TEXT = PARAS.join("\n");

describe("splitParagraphs", () => {
  it("splits by line and drops empty lines", () => {
    expect(splitParagraphs("a\n\n b \nc").paragraphs).toEqual(["a", "b", "c"]);
  });
  it("cuts very long paragraphs at sentence ends", () => {
    const long = "这是一句话。".repeat(300);
    const { paragraphs } = splitParagraphs(long);
    expect(paragraphs.length).toBeGreaterThan(1);
    expect(paragraphs.every((p) => p.length <= 800)).toBe(true);
    expect(paragraphs.join("")).toBe(long);
  });
  it("truncates by character budget", () => {
    const r = splitParagraphs("aaaa\nbbbb\ncccc", 9);
    expect(r.paragraphs).toEqual(["aaaa", "bbbb"]);
    expect(r.truncated).toBe(true);
  });
});

describe("normalizeAnnotations", () => {
  it("verifies quotes, fixes paragraph numbers, sorts by position, flags fabricated", () => {
    const list = normalizeAnnotations(
      [
        { kind: "idea", para: 1, quote: "只要传输速率低于信道容量", footnote: "编号错了" },
        { kind: "term", para: 2, quote: "信道容量", footnote: "单位时间最大可靠信息量" },
        { kind: "idea", para: 3, quote: "信道容量是通信最重要的指标", footnote: "编造" },
        { kind: "term", para: 2, quote: "信道容量", footnote: "重复" },
        { kind: "term", para: 2, quote: "无注脚" , footnote: "" },
        { kind: "bogus", para: 2, quote: "信道", footnote: "x" },
      ],
      PARAS
    );
    expect(list.map((a) => [a.kind, a.para, a.verified])).toEqual([
      ["term", 2, true],
      ["idea", 3, true],
      ["idea", 3, false],
    ]);
  });
  it("accepts short terms only inside the given paragraph", () => {
    const paras = ["信息熵是不确定性的度量。", "熵越大越难预测。"];
    const [inPara] = normalizeAnnotations([{ kind: "term", para: 2, quote: "熵", footnote: "f" }], paras);
    expect(inPara.verified).toBe(true);
    const [wrong] = normalizeAnnotations([{ kind: "term", para: 9, quote: "熵", footnote: "f" }], paras);
    expect(wrong.verified).toBe(false);
  });
  it("caps the number per kind", () => {
    const raw = Array.from({ length: 20 }, (_, i) => ({ kind: "idea", para: 1, quote: "观点" + i, footnote: "f" }));
    expect(normalizeAnnotations(raw, PARAS).length).toBe(8);
  });
});

describe("toChapterMarks / isMarksValid", () => {
  const raw = {
    overview: "低于信道容量即可可靠通信",
    annotations: [
      { kind: "idea", para: 3, quote: "只要传输速率低于信道容量，就存在编码方法使错误率任意小", footnote: "香农第二定理" },
      { kind: "term", para: 2, quote: "信道容量", footnote: "定义" },
    ],
  };
  const ctx = {
    docIndex: 4,
    chapterTitle: "第二章",
    chapterText: TEXT,
    paragraphs: PARAS,
    truncated: false,
    costUsd: 0.001,
    durationMs: 10,
  };
  it("builds marks in reading order", () => {
    const m = toChapterMarks(raw, ctx);
    expect(m.version).toBe(READING_MARKS_VERSION);
    expect(m.annotations.map((a) => a.kind)).toEqual(["term", "idea"]);
    expect(countByKind(m.annotations)).toEqual({ term: 1, idea: 1 });
    expect(annotationKey(m.annotations[0])).toMatch(/^term-/);
    expect(isMarksValid(m, { docIndex: 4, text: TEXT })).toBe(true);
    expect(isMarksValid(m, { docIndex: 4, text: TEXT + "改" })).toBe(false);
  });
  it("throws on missing annotations; allows an empty list", () => {
    expect(() => toChapterMarks({}, ctx)).toThrow();
    expect(toChapterMarks({ annotations: [] }, ctx).annotations).toEqual([]);
  });
  it("rejects v1 caches", () => {
    expect(isMarksValid({ ...toChapterMarks(raw, ctx), version: 1 }, { docIndex: 4, text: TEXT })).toBe(false);
  });
});

describe("buildReadingMarksPrompt", () => {
  it("numbers paragraphs", () => {
    const p = buildReadingMarksPrompt({
      bookTitle: "书",
      chapterTitle: "章",
      paragraphs: PARAS,
      truncated: false,
      previousTitles: [],
    });
    expect(p).toContain("[1] 上一章");
    expect(p).toContain("[4] 这个结论");
    expect(p).toContain("1–4");
  });
});

describe("locateParagraphs / locateQuote", () => {
  // 页面文本：段落之间有标题、额外空白与不同的引号
  const page = normalizeForMatch("第二章 信道\n" + PARAS.map((p) => "  " + p + " ").join("\n\n"));
  const norm = PARAS.map(normalizeForMatch);
  it("locates every paragraph in order", () => {
    const spans = locateParagraphs(page, norm);
    expect(spans.every(Boolean)).toBe(true);
    spans.forEach((s, i) => expect(page.slice(s![0], s![1])).toBe(norm[i]));
  });
  it("falls back to head/tail when the middle differs", () => {
    const long = "甲".repeat(30) + "中间部分" + "乙".repeat(30);
    const pageText = "甲".repeat(30) + "中间部份有差异" + "乙".repeat(30);
    const [span] = locateParagraphs(pageText, [long]);
    expect(span).toEqual([0, pageText.length]);
  });
  it("returns null for missing paragraphs", () => {
    expect(locateParagraphs(page, ["完全不存在的一段文字"])).toEqual([null]);
  });
  it("locates quotes near their paragraph", () => {
    const spans = locateParagraphs(page, norm);
    const q = normalizeForMatch("可靠传输的最大信息量");
    const span = locateQuote(page, q, spans[1]);
    expect(page.slice(span![0], span![1])).toBe(q);
    expect(locateQuote(page, "ab", null)).toBeNull();
    // 短术语只在所在段落内定位
    expect(locateQuote(page, normalizeForMatch("信道"), spans[1])).not.toBeNull();
  });
});

describe("estimateGuideCost without summary", () => {
  it("does not add the summary call", () => {
    const e = estimateGuideCost([{ text: "x".repeat(1000) }], () => false, 30000, false);
    expect(e.calls).toBe(1);
    const e2 = estimateGuideCost([{ text: "x".repeat(1000) }], () => false, 30000);
    expect(e2.calls).toBe(2);
  });
});
