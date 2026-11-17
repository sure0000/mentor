import { describe, expect, it } from "vitest";
import {
  INDEX_VERSION,
  buildChapters,
  isExtractableBook,
  isIndexValid,
  normalizeText,
  pickChapterText,
  totalChars,
} from "./indexText";

describe("pickChapterText", () => {
  it("prefers DOM text when it keeps paragraphs and is complete", () => {
    expect(pickChapterText("标题第一段第二段", "标题\n\n第一段\n第二段")).toBe(
      "标题\n\n第一段\n第二段"
    );
  });
  it("falls back to engine text when DOM is empty (PDF)", () => {
    expect(pickChapterText("pdf text", "")).toBe("pdf text");
  });
  it("falls back to engine text when DOM text is clearly incomplete", () => {
    expect(pickChapterText("一二三四五六七八九十", "一二\n三")).toBe(
      "一二三四五六七八九十"
    );
  });
});

describe("normalizeText", () => {
  it("normalizes line endings and collapses blank lines and spaces", () => {
    expect(normalizeText("a\r\nb  　c\n\n\n\nd ")).toBe("a\nb c\n\nd");
  });
});

describe("buildChapters", () => {
  const toc = [
    { label: "第一部分", href: "p1", level: 1 },
    { label: "第1章", href: "c1", level: 2 },
  ];
  it("marks TOC chapters and titles non-TOC docs from their first line", () => {
    const chapters = buildChapters(
      [
        { docIndex: 0, href: "cover", label: "", positionTitle: "", text: "封面\n内容" },
        { docIndex: 1, href: "c1", label: "第1章", positionTitle: "第1章", text: "第1章\n正文" },
        { docIndex: 2, href: "n", label: "", positionTitle: "第1章", text: "注释\n正文" },
      ],
      toc
    );
    expect(chapters.map((c) => [c.title, c.inToc])).toEqual([
      ["封面", false],
      ["第1章", true],
      ["注释", false],
    ]);
  });
  it("keeps per-chapter errors and uses an index title when nothing else exists", () => {
    const [c] = buildChapters(
      [{ docIndex: 4, href: "", label: "", positionTitle: "", text: "", error: "timeout" }],
      []
    );
    expect(c.title).toBe("#5");
    expect(c.error).toBe("timeout");
  });
  it("totals characters", () => {
    const chapters = buildChapters(
      [{ docIndex: 0, href: "", label: "", positionTitle: "", text: "abc" }],
      []
    );
    expect(totalChars(chapters)).toBe(3);
  });
});

describe("isIndexValid", () => {
  const book = { key: "k", md5: "m", size: 10 };
  const base = { version: INDEX_VERSION, bookKey: "k", bookMd5: "m", bookSize: 10, chapters: [] };
  it("accepts a matching index", () => {
    expect(isIndexValid(base, book)).toBe(true);
  });
  it("rejects when the book file changed or the format version changed", () => {
    expect(isIndexValid({ ...base, bookMd5: "x" }, book)).toBe(false);
    expect(isIndexValid({ ...base, bookSize: 11 }, book)).toBe(false);
    expect(isIndexValid({ ...base, version: INDEX_VERSION + 1 }, book)).toBe(false);
    expect(isIndexValid(null, book)).toBe(false);
  });
});

describe("isExtractableBook", () => {
  it("skips comics and scanned PDFs", () => {
    expect(isExtractableBook({ format: "CBZ" })).toBe(false);
    expect(isExtractableBook({ format: "PDF", description: "scanned" })).toBe(false);
    expect(isExtractableBook({ format: "PDF", description: "" })).toBe(true);
    expect(isExtractableBook({ format: "EPUB" })).toBe(true);
  });
});

import { detectBookLanguage } from "./indexText";

describe("detectBookLanguage", () => {
  it("detects Chinese even with some Latin words", () => {
    expect(detectBookLanguage([{ text: "香农在 1948 年提出了 information theory 的基本框架。" }])).toBe("zh");
  });
  it("detects English", () => {
    expect(detectBookLanguage([{ text: "Alice was beginning to get very tired." }])).toBe("en");
  });
});
