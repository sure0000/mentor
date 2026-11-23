import { describe, expect, it, vi } from "vitest";

vi.mock("../common", () => ({ isPaginatedBook: () => true, throttle: (f: unknown) => f }));

import { mergeSelectionRects } from "./docUtil";

const r = (left: number, top: number, right: number, bottom: number) => ({ left, top, right, bottom });

describe("mergeSelectionRects", () => {
  it("merges fragments on the same line", () => {
    const lines = mergeSelectionRects([r(10, 100, 50, 120), r(48, 101, 200, 121)]);
    expect(lines).toEqual([r(10, 100, 200, 121)]);
  });

  it("splits overlapping neighbouring lines at the midpoint so they never overlap", () => {
    // 放大后相邻行的文字块上下重叠 6px
    const lines = mergeSelectionRects([r(10, 100, 300, 130), r(10, 124, 280, 154)]);
    expect(lines).toHaveLength(2);
    expect(lines[0].bottom).toBe(127);
    expect(lines[1].top).toBe(127);
    expect(lines[0].bottom).toBeLessThanOrEqual(lines[1].top);
  });

  it("keeps a gap between lines that do not overlap", () => {
    const lines = mergeSelectionRects([r(0, 0, 10, 10), r(0, 20, 10, 30)]);
    expect(lines.map((l) => [l.top, l.bottom])).toEqual([
      [0, 10],
      [20, 30],
    ]);
  });

  it("accepts rect-like objects whose fields are prototype getters (DOMRect)", () => {
    class GetterRect {
      constructor(private v: number[]) {}
      get left() { return this.v[0]; }
      get top() { return this.v[1]; }
      get right() { return this.v[2]; }
      get bottom() { return this.v[3]; }
    }
    const lines = mergeSelectionRects([new GetterRect([10, 100, 50, 120])]);
    expect(lines).toEqual([r(10, 100, 50, 120)]);
  });

  it("drops empty rects", () => {
    expect(mergeSelectionRects([r(5, 5, 5, 20), r(0, 0, 10, 0)])).toEqual([]);
  });
});
