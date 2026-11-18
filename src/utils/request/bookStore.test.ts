import { describe, expect, it, vi } from "vitest";

// utils/common 依赖浏览器环境的库，这里只需要 supportedFormats
vi.mock("../common", () => ({ supportedFormats: [".epub", ".mobi"] }));
import { bookSourceList } from "../../constants/bookSourceList";
import {
  buildSearchUrl,
  isTitleMatch,
  toStoreBook,
  toStoreBookDetail,
} from "./bookStore";
import type { OPDSEntry, OPDSLink } from "./opds";

const gutenberg = bookSourceList.find((s) => s.id === "gutenberg")!;

const entry = (links: OPDSLink[], extra: Partial<OPDSEntry> = {}): OPDSEntry => ({
  id: "id",
  title: "Frankenstein",
  authors: [],
  summary: "",
  coverUrl: "",
  thumbnailUrl: "",
  links,
  updated: "",
  isNavigation: false,
  publisher: "",
  language: "",
  pubDate: "",
  rights: "",
  categories: [],
  ...extra,
});

const epub = (href: string): OPDSLink => ({
  href,
  type: "application/epub+zip",
  rel: "http://opds-spec.org/acquisition",
});

describe("bookStore", () => {
  it("把 Gutenberg 列表条目转成书籍卡片并推导封面", () => {
    const book = toStoreBook(
      entry(
        [
          {
            href: "https://www.gutenberg.org/ebooks/84.opds",
            type: "application/atom+xml;profile=opds-catalog",
            rel: "subsection",
          },
        ],
        { summary: "Mary Wollstonecraft Shelley" }
      ),
      gutenberg
    );
    expect(book).toMatchObject({
      author: "Mary Wollstonecraft Shelley",
      detailUrl: "https://www.gutenberg.org/ebooks/84.opds",
      coverUrl:
        "https://www.gutenberg.org/cache/epub/84/pg84.cover.medium.jpg",
      entry: null,
    });
  });

  it("过滤掉作者/主题等导航条目", () => {
    expect(
      toStoreBook(
        entry([
          {
            href: "https://www.gutenberg.org/ebooks/authors/search.opds/?query=x",
            type: "application/atom+xml;profile=opds-catalog",
            rel: "subsection",
          },
        ]),
        gutenberg
      )
    ).toBeNull();
  });

  it("合并多个版本的下载链接并去重", () => {
    const fallback = toStoreBook(entry([epub("https://a/1.epub")]), gutenberg)!;
    const detail = toStoreBookDetail(
      [
        entry([epub("https://a/1.epub")], { summary: "<p>s</p>" }),
        entry([epub("https://a/1.epub"), epub("https://a/2.epub")]),
      ],
      fallback
    );
    expect(detail.downloadLinks.map((l) => l.href)).toEqual([
      "https://a/1.epub",
      "https://a/2.epub",
    ]);
    expect(detail.summary).toBe("<p>s</p>");
  });

  it("下载链接 EPUB 优先、带图版本优先", () => {
    const fallback = toStoreBook(entry([epub("https://a/x.epub")]), gutenberg)!;
    const mobi: OPDSLink = {
      href: "https://a/84.kindle.images",
      type: "application/x-mobipocket-ebook",
      rel: "http://opds-spec.org/acquisition",
    };
    const detail = toStoreBookDetail(
      [
        entry([
          { ...epub("https://a/84.epub.noimages"), title: "EPUB (no images)" },
          mobi,
          epub("https://a/84.epub.images"),
          epub("https://a/84.epub3.images"),
        ]),
      ],
      fallback
    );
    expect(detail.downloadLinks.map((l) => l.href)).toEqual([
      "https://a/84.epub3.images",
      "https://a/84.epub.images",
      "https://a/84.epub.noimages",
      "https://a/84.kindle.images",
    ]);
  });

  it("搜索关键词会被编码", () => {
    expect(buildSearchUrl(gutenberg, " 紅樓 ")).toBe(
      "https://www.gutenberg.org/ebooks/search.opds/?query=%E7%B4%85%E6%A8%93"
    );
  });

  it("Atom enclosure 下载链接视为可下载书籍", () => {
    const source = bookSourceList.find((s) => s.id === "standardebooks")!;
    const book = toStoreBook(
      entry([
        {
          href: "https://se/a.epub",
          type: "application/epub+zip",
          rel: "enclosure",
        },
      ]),
      source
    );
    expect(book?.entry).not.toBeNull();
    expect(book?.detailUrl).toBe("");
  });

  it("所有书源 id 唯一且至少有一个分类", () => {
    const ids = bookSourceList.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const s of bookSourceList) {
      expect(s.categories.length).toBeGreaterThan(0);
      expect(s.searchTemplate).toContain("{searchTerms}");
    }
  });

  it("书名匹配忽略大小写、标点和副标题", () => {
    expect(isTitleMatch("Frankenstein; Or, The Modern Prometheus", ["Frankenstein"])).toBe(true);
    expect(isTitleMatch("The Adventures of Sherlock Holmes", ["the adventures of sherlock holmes"])).toBe(true);
    expect(isTitleMatch("红楼梦（全二册）", ["红楼梦"])).toBe(true);
    expect(isTitleMatch("Pride and Prejudice", ["Frankenstein"])).toBe(false);
    // 单字书名容易误匹配，不参与比对
    expect(isTitleMatch("It", ["I"])).toBe(false);
  });

  it("每个书源都配置了网站搜索页", () => {
    for (const s of bookSourceList) {
      expect(s.webSearchTemplate).toMatch(/^https:\/\/.*\{searchTerms\}/);
    }
  });
});
