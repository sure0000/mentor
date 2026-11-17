import { describe, expect, it } from "vitest";
import { estimateGuideCost } from "./bookGuide";
import { normalizeForMatch } from "./chapterPoints";
import {
  READING_MARKS_VERSION,
  buildReadingMarksPrompt,
  isMarksValid,
  levelShares,
  locateParagraphs,
  locateQuote,
  normalizeSegments,
  splitParagraphs,
  toChapterMarks,
  verifyKeyLines,
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

describe("normalizeSegments", () => {
  it("sorts, clamps, removes overlaps and fills gaps as light", () => {
    const segs = normalizeSegments(
      [
        { from: 3, to: 9, level: "deep", title: "b", reason: "" },
        { from: 0, to: 1, level: "skim", title: "a", reason: "" },
        { from: 2, to: 4, level: "skim", title: "overlap", reason: "" },
        { from: 5, to: 6, level: "bogus" },
      ],
      10
    );
    expect(segs.map((s) => [s.from, s.to, s.level])).toEqual([
      [1, 1, "skim"],
      [2, 4, "skim"],
      [5, 9, "deep"],
      [10, 10, "light"],
    ]);
    expect(segs[3].auto).toBe(true);
  });
  it("returns empty when nothing valid", () => {
    expect(normalizeSegments([{ from: 1, to: 2, level: "x" }], 3)).toEqual([]);
  });
});

describe("verifyKeyLines", () => {
  it("verifies quotes, fixes wrong paragraph numbers, flags fabricated", () => {
    const lines = verifyKeyLines(
      [
        { para: 2, quote: "信道在单位时间内能够可靠传输的最大信息量", note: "定义" },
        { para: 1, quote: "只要传输速率低于信道容量", note: "编号错了" },
        { para: 3, quote: "信道容量是通信最重要的指标", note: "编造" },
        { para: 2, quote: "信道在单位时间内能够可靠传输的最大信息量", note: "重复" },
      ],
      PARAS
    );
    expect(lines.map((l) => [l.para, l.verified])).toEqual([
      [2, true],
      [3, true],
      [3, false],
    ]);
  });
});

describe("toChapterMarks / isMarksValid", () => {
  const raw = {
    overview: "精读第 2–3 段",
    segments: [
      { from: 1, to: 1, level: "skim", title: "回顾", reason: "复述前文" },
      { from: 2, to: 3, level: "deep", title: "信道容量", reason: "核心定义与定理" },
    ],
    keyLines: [{ para: 2, quote: "所谓信道容量", note: "" }],
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
  it("builds marks and fills the tail gap", () => {
    const m = toChapterMarks(raw, ctx);
    expect(m.version).toBe(READING_MARKS_VERSION);
    expect(m.segments.map((s) => s.level)).toEqual(["skim", "deep", "light"]);
    expect(m.keyLines[0].verified).toBe(true);
    expect(isMarksValid(m, { docIndex: 4, text: TEXT })).toBe(true);
    expect(isMarksValid(m, { docIndex: 4, text: TEXT + "改" })).toBe(false);
  });
  it("throws on empty output", () => {
    expect(() => toChapterMarks({}, ctx)).toThrow();
  });
  it("computes level shares by characters", () => {
    const m = toChapterMarks(raw, ctx);
    const s = levelShares(m.segments, PARAS);
    expect(s.skim + s.light + s.deep).toBeCloseTo(1);
    expect(s.deep).toBeGreaterThan(s.skim);
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
