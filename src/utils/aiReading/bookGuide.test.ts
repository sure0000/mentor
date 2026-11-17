import { describe, expect, it } from "vitest";
import {
  BOOK_GUIDE_VERSION,
  MIN_ANALYZE_CHARS,
  analyzableChapters,
  buildBookGuidePrompt,
  estimateGuideCost,
  pointsFingerprint,
  toBookGuide,
} from "./bookGuide";
import type { BookIndex, IndexChapter } from "./indexText";
import type { ChapterPoints } from "./chapterPoints";

const ch = (docIndex: number, len: number, extra: Partial<IndexChapter> = {}): IndexChapter => ({
  docIndex,
  href: "",
  title: `第${docIndex}章`,
  inToc: true,
  text: "字".repeat(len),
  ...extra,
});

const pts = (docIndex: number): ChapterPoints => ({
  version: 1,
  docIndex,
  chapterTitle: `第${docIndex}章`,
  textHash: "h",
  question: `第${docIndex}章的问题`,
  points: [{ point: "要点", quote: { text: "q", verified: true } }],
  concepts: [{ term: "熵", explanation: "不确定性", quote: { text: "q", verified: true } }],
  relation: "",
  truncated: false,
  costUsd: 0.01,
  durationMs: 1,
  createdAt: docIndex * 10,
});

describe("analyzableChapters", () => {
  it("skips short and failed documents", () => {
    const index = {
      chapters: [ch(0, 50), ch(1, MIN_ANALYZE_CHARS), ch(2, 5000, { error: "timeout" })],
    } as BookIndex;
    expect(analyzableChapters(index).map((c) => c.docIndex)).toEqual([1]);
  });
});

describe("estimateGuideCost", () => {
  it("counts only uncached chapters plus one summary call", () => {
    const est = estimateGuideCost([ch(0, 1000), ch(1, 1000), ch(2, 1000)], (i) => i === 0, 30000);
    expect(est).toMatchObject({ chapters: 3, cached: 1, calls: 3, chars: 2000 });
    expect(est.costLow).toBeGreaterThan(0);
    expect(est.costHigh).toBeGreaterThan(est.costLow);
  });
  it("caps characters per chapter at the truncation limit", () => {
    expect(estimateGuideCost([ch(0, 50000)], () => false, 30000).chars).toBe(30000);
  });
  it("still needs one summary call when every chapter is cached", () => {
    expect(estimateGuideCost([ch(0, 10)], () => true, 30000).calls).toBe(1);
  });
});

describe("buildBookGuidePrompt", () => {
  it("labels chapters with their docIndex ids", () => {
    const prompt = buildBookGuidePrompt("书", [{ chapter: ch(3, 10), points: pts(3) }]);
    expect(prompt).toContain('<chapter id="3"');
    expect(prompt).toContain("第3章的问题");
    expect(prompt).toContain("熵（不确定性）");
  });
});

describe("toBookGuide", () => {
  const items = [1, 2, 3].map((i) => ({ chapter: ch(i, 10), points: pts(i) }));
  const ctx = { bookKey: "k", items, costUsd: 0.1, durationMs: 1 };

  it("keeps known chapter ids, fills missing chapters, and orders by docIndex", () => {
    const g = toBookGuide(
      {
        mainline: "主线",
        chapters: [
          { id: 3, summary: "三", advice: "skim", reason: "案例" },
          { id: 1, summary: "一", advice: "core", reason: "定义" },
          { id: 99, summary: "不存在", advice: "", reason: "" },
          { id: 1, summary: "重复", advice: "", reason: "" },
        ],
        concepts: [
          { term: "熵", explanation: "x", firstId: 2 },
          { term: "编造", explanation: "y", firstId: 42 },
        ],
        readingOrder: "",
      },
      ctx
    );
    expect(g.chapters.map((c) => [c.docIndex, c.summary, c.advice])).toEqual([
      [1, "一", "core"],
      [2, "第2章的问题", ""],
      [3, "三", "skim"],
    ]);
    expect(g.concepts.map((c) => c.firstDocIndex)).toEqual([2, -1]);
    expect(g.version).toBe(BOOK_GUIDE_VERSION);
    expect(g.sourceHash).toBe(pointsFingerprint(items.map((i) => i.points)));
  });

  it("drops a reason when no advice is given and rejects an empty mainline", () => {
    const g = toBookGuide(
      { mainline: "m", chapters: [{ id: 1, summary: "s", advice: "", reason: "胡说" }], concepts: [] },
      ctx
    );
    expect(g.chapters[0].reason).toBe("");
    expect(() => toBookGuide({ mainline: "" }, ctx)).toThrow();
  });
});
