import { describe, expect, it } from "vitest";
import { groupLines, groupParagraphBlocks, groupParagraphs, TextBox } from "./pdfParagraphs";

const box = (text: string, left: number, top: number, width = 300, height = 12): TextBox => ({
  text,
  left,
  top,
  right: left + width,
  bottom: top + height,
});

describe("groupLines", () => {
  it("merges fragments on the same line", () => {
    const lines = groupLines([box("Hello", 0, 0, 40), box("world", 45, 0, 40)]);
    expect(lines.map((l) => l.text)).toEqual(["Hello world"]);
  });
});

describe("groupParagraphs", () => {
  it("joins wrapped lines and splits on paragraph gaps", () => {
    const paragraphs = groupParagraphs([
      box("The first paragraph starts here and", 0, 0),
      box("continues on the next line.", 0, 16, 180),
      box("A second paragraph begins after a gap", 0, 50),
      box("and ends here.", 0, 66, 90),
    ]);
    expect(paragraphs).toEqual([
      "The first paragraph starts here and continues on the next line.",
      "A second paragraph begins after a gap and ends here.",
    ]);
  });

  it("joins hyphenated words and drops page numbers", () => {
    const paragraphs = groupParagraphs([
      box("An exam-", 0, 0),
      box("ple sentence.", 0, 16, 80),
      box("12", 150, 60, 10),
    ]);
    expect(paragraphs).toEqual(["An example sentence."]);
  });

  it("joins CJK lines without spaces", () => {
    const paragraphs = groupParagraphs([box("这是第一行文字，", 0, 0), box("这是第二行。", 0, 16, 100)]);
    expect(paragraphs).toEqual(["这是第一行文字，这是第二行。"]);
  });
});

describe("groupParagraphBlocks", () => {
  it("returns the bounding box of each paragraph", () => {
    const [block] = groupParagraphBlocks([
      box("The first paragraph starts here and", 10, 0),
      box("continues on the next line.", 10, 16, 180),
    ]);
    expect(block).toMatchObject({ left: 10, top: 0, right: 310, bottom: 28, lineHeight: 12 });
  });
});
