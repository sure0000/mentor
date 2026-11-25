import { describe, expect, it, vi } from "vitest";

// utils/common 依赖浏览器环境的库，这里只需要 supportedFormats
vi.mock("../common", () => ({ supportedFormats: [".epub", ".mobi"] }));
import { bookSourceList } from "../../constants/bookSourceList";
import {
  buildArchiveSearchUrl,
  buildSearchUrl,
  findInSource,
  isTitleMatch,
  matchOpenStax,
  parseArchiveFiles,
  parseArchiveSearch,
  parseWikisourceSearch,
  resolveDownloadLinks,
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

  it("OpenStax 按书名匹配，在售版本优先，没有 PDF 的跳过", () => {
    const catalog = [
      { id: 1, title: "Calculus Volume 1", book_state: "retired", high_resolution_pdf_url: "https://a/old.pdf" },
      { id: 2, title: "Calculus Volume 1", book_state: "live", high_resolution_pdf_url: "https://a/new.pdf",
        authors: [{ value: { name: "Gilbert Strang", senior_author: true } }, { value: { name: "X", senior_author: false } }] },
      { id: 3, title: "Calculus Volume 1", book_state: "live" },
      { id: 4, title: "Biology 2e", book_state: "live", high_resolution_pdf_url: "https://a/bio.pdf" },
    ];
    const found = matchOpenStax(catalog, ["Calculus Volume 1"]);
    expect(found.map((b) => b.id)).toEqual(["openstax-2", "openstax-1"]);
    expect(found[0].author).toBe("Gilbert Strang");
    expect(found[0].entry?.links[0]).toMatchObject({ href: "https://a/new.pdf", type: "application/pdf" });
  });

  it("维基文库用简体书名匹配繁体标题，跳过子页面和消歧义页", () => {
    const variants = { "zh-hans": "红楼梦", "zh-hant": "紅樓夢" };
    const data = {
      query: {
        pages: [
          { index: 3, title: "紅樓夢/第001回", varianttitles: variants },
          { index: 1, title: "紅樓夢 (消歧義)", varianttitles: variants, pageprops: { disambiguation: "" } },
          { index: 2, title: "紅樓夢", varianttitles: variants },
        ],
      },
    };
    const found = parseWikisourceSearch(data, "zh", ["红楼梦"]);
    expect(found.map((b) => b.title)).toEqual(["紅樓夢"]);
    const href = new URL(found[0].entry!.links[0].href);
    expect(href.searchParams.get("page")).toBe("紅樓夢");
    expect(parseWikisourceSearch({}, "zh", ["红楼梦"])).toEqual([]);
  });

  it("Internet Archive 只查公版馆藏并从文件清单取下载链接", () => {
    const q = new URL(buildArchiveSearchUrl('Dune: "Part" (1)')).searchParams.get("q");
    expect(q).toContain("title:(Dune Part 1) AND");
    expect(q).toContain("NOT collection:(inlibrary OR printdisabled)");
    const found = parseArchiveSearch(
      { response: { docs: [{ identifier: "a1", title: "Frankenstein", creator: ["Shelley"] }, { identifier: "b", title: "Other" }] } },
      ["Frankenstein"]
    );
    expect(found).toMatchObject([{ author: "Shelley", detailUrl: "https://archive.org/metadata/a1" }]);
    const files = [{ name: "a1_lcp.epub" }, { name: "x.pdf", private: "true" }, { name: "my book.epub" }];
    expect(parseArchiveFiles({ metadata: { identifier: "a1" }, files }).map((l) => l.href)).toEqual([
      "https://archive.org/download/a1/my%20book.epub",
    ]);
    expect(parseArchiveFiles({ metadata: { identifier: "a1", "access-restricted-item": "true" }, files })).toEqual([]);
  });

  it("维基文库接口不认识 varianttitles 时退回普通检索", async () => {
    const source = bookSourceList.find((s) => s.id === "wikisource-zh")!;
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      calls.push(url);
      return Response.json(
        calls.length === 1
          ? { error: { code: "unknown_inprop" } }
          : { query: { pages: [{ index: 1, title: "紅樓夢" }] } }
      );
    }));
    const found = await findInSource(source, ["紅樓夢"]);
    expect(calls).toHaveLength(2);
    expect(calls[0]).toContain("inprop=varianttitles");
    expect(calls[1]).not.toContain("inprop");
    expect(found.map((b) => b.title)).toEqual(["紅樓夢"]);
    vi.unstubAllGlobals();
  });

  it("按书源类型完成检索和下载链接解析", async () => {
    const source = bookSourceList.find((s) => s.id === "archive")!;
    vi.stubGlobal("fetch", vi.fn(async (url: string) =>
      Response.json(
        url.includes("/metadata/")
          ? { metadata: { identifier: "a1" }, files: [{ name: "a1.epub" }] }
          : { response: { docs: [{ identifier: "a1", title: "Frankenstein" }] } }
      )
    ));
    const [book] = await findInSource(source, ["Frankenstein"]);
    expect(await resolveDownloadLinks(book)).toHaveLength(1);
    vi.unstubAllGlobals();
  });
});
