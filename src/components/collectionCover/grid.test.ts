import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { CollectionCoverGrid } from "./component";

vi.mock("../../utils/storage/databaseService", () => ({ default: {} }));
vi.mock("../../utils/file/coverUtil", () => ({ default: {} }));
vi.mock("../emptyCover", () => ({ default: () => null }));

describe("category thumbnail grid", () => {
  it.each([1, 2, 3, 4, 5])("keeps four slots for %i books", (count) => {
    const cells = Array.from({ length: count }, (_, i) => ({
      key: String(i),
      item: { cover: `/covers/${i}.jpg`, title: String(i), format: "" },
    }));
    const html = renderToStaticMarkup(createElement(CollectionCoverGrid, {
      cells, width: 98, height: 125,
    }));
    expect(html.match(/<img /g)).toHaveLength(Math.min(count, 4));
    expect(html.match(/collection-cover-cell-blank/g) || []).toHaveLength(Math.max(4 - count, 0));
  });
});
