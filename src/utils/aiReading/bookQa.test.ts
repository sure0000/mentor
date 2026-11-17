import { describe, expect, it } from "vitest";
import { extractQueryTerms, retrievePassages, splitPassages } from "./retrieval";
import {
  QA_EXTRA_CLOSE,
  QA_EXTRA_OPEN,
  buildQaPrompt,
  parseSources,
  splitAnswerSegments,
  stripSources,
  visibleWhileStreaming,
} from "./bookQa";
import type { BookIndex, IndexChapter } from "./indexText";

const chapter = (docIndex: number, text: string): IndexChapter => ({
  docIndex,
  href: "",
  title: `第${docIndex}章`,
  inToc: true,
  text,
});

const filler = (n: number) =>
  Array.from({ length: n }, (_, i) => `这是普通的叙述段落${i}，讲的是天气和日常生活。`).join("\n");

const index = {
  bookKey: "k",
  chapters: [
    chapter(0, filler(10)),
    chapter(1, filler(5) + "\n香农把信道容量定义为单位时间内可靠传输的最大信息量。\n" + filler(5)),
    chapter(2, filler(10)),
    chapter(3, filler(3) + "\n第八章回顾：信道容量决定了编码速率的上限。\n" + filler(3)),
  ],
} as unknown as BookIndex;

describe("splitPassages", () => {
  it("merges short paragraphs to about 600 chars and keeps chapter info", () => {
    const ps = splitPassages(chapter(5, filler(80)));
    expect(ps.length).toBeGreaterThan(1);
    ps.forEach((p) => {
      expect(p.docIndex).toBe(5);
      expect(p.text.length).toBeLessThanOrEqual(1200);
    });
  });
  it("splits a page-long paragraph without newlines (PDF)", () => {
    const page = "This is a sentence about attention. ".repeat(100);
    const ps = splitPassages(chapter(0, page));
    expect(ps.length).toBeGreaterThan(2);
    expect(ps.every((p) => p.text.length <= 1200)).toBe(true);
  });
});

describe("extractQueryTerms", () => {
  it("drops question words and keeps content terms", () => {
    const { terms } = extractQueryTerms("作者在哪几处讨论过信道容量？");
    expect(terms).toContain("信道容量");
    expect(terms).not.toContain("作者");
  });
  it("treats quoted text as a strong term", () => {
    expect(extractQueryTerms("书里说的“最大信息量”是什么意思").strong).toEqual(["最大信息量"]);
  });
  it("handles English questions", () => {
    const { terms } = extractQueryTerms("Where does the author discuss the golden key?");
    expect(terms).toEqual(expect.arrayContaining(["golden", "key"]));
    expect(terms).not.toContain("the");
  });
});

describe("retrievePassages", () => {
  it("finds passages in other chapters", () => {
    const got = retrievePassages(index, "信道容量是什么？", () => null);
    expect(got.map((p) => p.docIndex)).toEqual([1, 3]);
    expect(got[0].text).toContain("信道容量");
  });
  it("respects the spoiler limit and the excluded chapter", () => {
    expect(retrievePassages(index, "信道容量", () => null, { maxDocIndex: 2 }).map((p) => p.docIndex)).toEqual([1]);
    expect(retrievePassages(index, "信道容量", () => null, { excludeDocIndex: 1 }).map((p) => p.docIndex)).toEqual([3]);
  });
  it("returns nothing when no term matches", () => {
    expect(retrievePassages(index, "量子纠缠", () => null)).toEqual([]);
  });
});

describe("parseSources", () => {
  const passages = [{ docIndex: 1, chapterTitle: "第1章", text: "香农把信道容量定义为单位时间内可靠传输的最大信息量。" }];
  const current = { docIndex: 3, chapterTitle: "第3章", text: "第八章回顾：信道容量决定了编码速率的上限。" };
  it("verifies quotes against the referenced context", () => {
    const answer =
      "正文\n<sources>\nP1 | 信道容量定义为单位时间内可靠传输\nCUR | 信道容量决定了编码速率的上限\nP1 | 这句是编造的不存在\n</sources>";
    const s = parseSources(answer, { passages, current, selection: null });
    expect(s.map((x) => [x.docIndex, x.verified])).toEqual([
      [1, true],
      [3, true],
      [1, false],
    ]);
  });
  it("finds a quote even if the model cites the wrong reference", () => {
    const s = parseSources("<sources>\nP1 | 信道容量决定了编码速率的上限\n</sources>", { passages, current, selection: null });
    expect(s[0]).toMatchObject({ docIndex: 3, verified: true });
  });
  it("returns nothing without a sources block", () => {
    expect(parseSources("只有正文", { passages, current, selection: null })).toEqual([]);
  });
});

describe("answer helpers", () => {
  it("strips and hides the sources block", () => {
    expect(stripSources("答案\n<sources>\nP1 | x\n</sources>")).toBe("答案");
    expect(visibleWhileStreaming("答案\n<sou")).toBe("答案\n");
  });
  it("splits book content from AI background", () => {
    expect(splitAnswerSegments(`书里说A。${QA_EXTRA_OPEN}背景B${QA_EXTRA_CLOSE}书里说C。`)).toEqual([
      { kind: "book", text: "书里说A。" },
      { kind: "extra", text: "背景B" },
      { kind: "book", text: "书里说C。" },
    ]);
  });
});

describe("buildQaPrompt", () => {
  it("keeps early questions as a summary when history is long", () => {
    const history = [
      { role: "user" as const, content: "最开始的问题：什么是熵？" },
      { role: "assistant" as const, content: "很长的回答".repeat(3000) },
      { role: "user" as const, content: "第二个问题" },
      { role: "assistant" as const, content: "短回答" },
    ];
    const prompt = buildQaPrompt({
      bookTitle: "书",
      question: "第三个问题",
      selection: "",
      currentChapter: null,
      passages: [],
      history,
      spoilerSafe: false,
    });
    expect(prompt).toContain("最开始的问题：什么是熵？");
    expect(prompt).toContain("第二个问题");
    expect(prompt).not.toContain("很长的回答很长的回答很长的回答");
  });
});

import { stripRefMarkers } from "./bookQa";

describe("stripRefMarkers", () => {
  it("removes per-question passage markers", () => {
    expect(stripRefMarkers("The label says DRINK ME [P1]. It tastes nice [P2][CUR].")).toBe(
      "The label says DRINK ME. It tastes nice."
    );
  });
  it("keeps markers out of history sent to the model", () => {
    const prompt = buildQaPrompt({
      bookTitle: "书",
      question: "q",
      selection: "",
      currentChapter: null,
      passages: [],
      history: [
        { role: "user", content: "a" },
        { role: "assistant", content: "答案 [P1]\n<sources>\nP1 | x\n</sources>" },
      ],
      spoilerSafe: false,
    });
    expect(prompt).not.toContain("[P1]");
    expect(prompt).not.toContain("<sources>");
  });
});
