// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { bookSourceList } from "../../constants/bookSourceList";
import { findInSource, resolveDownloadLinks } from "./bookStore";

vi.mock("../common", () => ({ supportedFormats: [".epub"] }));
const source = bookSourceList.find((s) => s.type === "zlibrary")!;
afterEach(() => vi.unstubAllGlobals());

it("matches titles, keeps only same-site book pages and deduplicates editions", async () => {
  const card = (title: string, href: string) =>
    `<z-bookcard href="${href}"><span slot="title">${title}</span><span slot="author">Shelley</span></z-bookcard>`;
  const html = card("Frankenstein", "/book/42/abc/frankenstein.html") +
    card("Frankenstein", "https://example.org/book/42/abc") +
    card("Frankenstein Companion", "/book/43/def");
  vi.stubGlobal("fetch", vi.fn(async () => new Response(html)));
  const found = await findInSource(source, ["弗兰肯斯坦", "Frankenstein"]);
  expect(found).toMatchObject([{ id: "zlibrary-42", author: "Shelley",
    websiteUrl: "https://z-lib.fm/book/42/abc/frankenstein.html" }]);
  expect(await resolveDownloadLinks(found[0])).toEqual([]);
});

it("distinguishes an empty result list from an unrecognized page", async () => {
  vi.stubGlobal("fetch", vi.fn()
    .mockResolvedValueOnce(new Response('<div id="searchResultBox"></div>'))
    .mockResolvedValueOnce(new Response("<title>Sign in</title>")));
  expect(await findInSource(source, ["Frankenstein"])).toEqual([]);
  await expect(findInSource(source, ["Frankenstein"])).rejects.toThrow();
});
