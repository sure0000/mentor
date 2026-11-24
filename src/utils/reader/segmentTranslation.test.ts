import { describe, expect, it } from "vitest";
import { getSegmentTexts, minWeightOf, splitSegments } from "./segmentTranslation";

describe("splitSegments", () => {
  it("keeps a short paragraph as one segment", () => {
    expect(splitSegments("Hello world.").map((s) => s.text)).toEqual(["Hello world."]);
  });

  it("splits a long English paragraph into sentence groups", () => {
    const sentence = "This is a fairly ordinary sentence that has some words in it. ";
    const text = sentence.repeat(6).trim();
    const segments = splitSegments(text);
    expect(segments.length).toBeGreaterThan(1);
    expect(segments.length).toBeLessThan(6);
    // 小段首尾相接，覆盖原文
    expect(segments.map((s) => s.text).join(" ")).toBe(text);
    expect(segments[segments.length - 1].end).toBe(text.length);
  });

  it("splits Chinese text on full stops", () => {
    const text = "这是一个用于测试的中文句子，长度适中而且有标点。".repeat(5);
    const segments = splitSegments(text);
    expect(segments.length).toBeGreaterThan(1);
    expect(segments.map((s) => s.text).join("")).toBe(text);
  });

  it("merges a tiny trailing sentence into the previous segment", () => {
    const text = "A".repeat(90) + ". Ok.";
    expect(splitSegments(text)).toHaveLength(1);
  });

  it("keeps a long paragraph whole in paragraph mode", () => {
    const text = "This is a fairly ordinary sentence that has some words in it. ".repeat(6).trim();
    expect(splitSegments(text, minWeightOf("paragraph")).map((s) => s.text)).toEqual([text]);
  });

  it("returns nothing for blank text", () => {
    expect(splitSegments("   ")).toEqual([]);
  });
});

describe("getSegmentTexts", () => {
  it("skips image placeholders and empty blocks", () => {
    expect(getSegmentTexts(["img", "", "Hi."])).toEqual(["Hi."]);
  });

  it("returns one text per block in paragraph mode", () => {
    const long = "Some sentence with enough words to pass the threshold. ".repeat(4).trim();
    expect(getSegmentTexts([long, "Hi."], "paragraph")).toEqual([long, "Hi."]);
  });
});
