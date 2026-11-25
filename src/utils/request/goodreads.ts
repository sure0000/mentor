// Goodreads 已停止开放 API，榜单、搜索与详情都从公开网页解析。
// 返回结构与豆瓣模块一致，书城视图可以共用同一套渲染逻辑。
import type { DoubanBook, DoubanDetail, DoubanList } from "./douban";
import {
  DETAIL_TTL,
  LIST_TTL,
  readCache,
  readStaleCache,
  writeCache,
} from "./storeCache";
import { fetchWithPolicy } from "./http";

export const GOODREADS_HOST = "https://www.goodreads.com";

// Goodreads 评分为 5 分制
export const GOODREADS_RATING_MAX = 5;

export interface GoodreadsCategory {
  // i18n key
  title: string;
  url: string;
}

const listUrl = (slug: string) => `${GOODREADS_HOST}/list/show/${slug}`;

export const goodreadsCategories: GoodreadsCategory[] = [
  { title: "Best Books Ever", url: listUrl("1.Best_Books_Ever") },
  {
    title: "Best of the 21st Century",
    url: listUrl("7.Best_Books_of_the_21st_Century"),
  },
  {
    title: "Best of the 20th Century",
    url: listUrl("6.Best_Books_of_the_20th_Century"),
  },
  {
    title: "Must reads",
    url: listUrl("264.Books_That_Everyone_Should_Read_At_Least_Once"),
  },
  {
    title: "Time All-Time 100 Novels",
    url: listUrl("2681.Time_Magazine_s_All_Time_100_Novels"),
  },
  {
    title: "Science fiction & Fantasy",
    url: listUrl("3.Best_Science_Fiction_Fantasy_Books"),
  },
  { title: "Historical fiction", url: listUrl("15.Best_Historical_Fiction") },
  { title: "Mystery", url: listUrl("11.Best_Crime_Mystery_Books") },
  { title: "Non-fiction", url: listUrl("134.Best_Non_Fiction_no_biographies_") },
  {
    title: "Memoir & Biography",
    url: listUrl("281.Best_Science_Books_Non_Fiction_Only"),
  },
];

export const buildGoodreadsSearchUrl = (query: string) =>
  `${GOODREADS_HOST}/search?q=${encodeURIComponent(query.trim())}&search_type=books`;

// 列表里是 50px 宽的缩略图，去掉尺寸后缀即为原图
export const resizeGoodreadsCover = (url: string) =>
  url.replace(/\._S[XY]\d+_(?=\.\w+$)/, "");

// 「Dune (Dune, #1)」→「Dune」，系列信息会干扰书源检索
export const stripSeries = (title: string) =>
  title.replace(/\s*\([^()]*#\d+(\.\d+)?\)\s*$/, "").trim();

const clean = (text: string | null | undefined) =>
  (text || "").replace(/\s+/g, " ").trim();

const getBookId = (url: string) => url.match(/\/book\/show\/(\d+)/)?.[1] || "";

const resolve = (href: string, base: string) => {
  try {
    return new URL(href, base).href;
  } catch {
    return "";
  }
};

const parseHtml = (html: string) =>
  new DOMParser().parseFromString(html, "text/html");

/**
 * 榜单页和搜索页的条目都是 tr[itemtype=schema.org/Book]，结构一致。
 */
export const parseGoodreadsList = (html: string, pageUrl: string): DoubanList => {
  const doc = parseHtml(html);
  const books: DoubanBook[] = [];
  doc.querySelectorAll("tr[itemtype='http://schema.org/Book']").forEach((item) => {
    const link = item.querySelector<HTMLAnchorElement>("a.bookTitle");
    const href = link?.getAttribute("href") || "";
    const id = getBookId(href);
    if (!id) return;
    // 「4.36 avg rating — 10,380,891 ratings」
    const mini = clean(item.querySelector(".minirating")?.textContent);
    const rating = parseFloat(mini.match(/([\d.]+)\s+avg rating/)?.[1] || "");
    const votes = parseInt(
      (mini.match(/([\d,]+)\s+ratings?/)?.[1] || "0").replace(/,/g, "")
    );
    const authors = Array.from(item.querySelectorAll(".authorName"))
      .map((a) => clean(a.textContent))
      .filter(Boolean);
    books.push({
      id,
      title: stripSeries(clean(link?.textContent)),
      abstract: authors.join(", "),
      coverUrl: resizeGoodreadsCover(
        item.querySelector("img.bookCover")?.getAttribute("src") || ""
      ),
      rating: isNaN(rating) || rating === 0 ? null : rating,
      votes,
      // 去掉搜索页附带的统计参数
      url: resolve(href, GOODREADS_HOST).split("?")[0],
    });
  });
  const next = doc.querySelector("a.next_page")?.getAttribute("href");
  return { books, nextUrl: next ? resolve(next, pageUrl) : "" };
};

interface GoodreadsLdJson {
  "@type"?: string;
  name?: string;
  image?: string;
  isbn?: string;
  author?: { name?: string }[] | { name?: string };
  aggregateRating?: { ratingValue?: number; ratingCount?: number };
}

const readLdJson = (doc: Document): GoodreadsLdJson => {
  for (const script of Array.from(
    doc.querySelectorAll("script[type='application/ld+json']")
  )) {
    try {
      const data = JSON.parse(script.textContent || "");
      if (data?.["@type"] === "Book") return data;
    } catch {
      // 忽略其它不合法的结构化数据
    }
  }
  return {};
};

/**
 * 详情页：基本信息取自 ld+json，书名、出版信息和简介取自页面。
 */
export const parseGoodreadsBook = (html: string): DoubanDetail => {
  const doc = parseHtml(html);
  const ld = readLdJson(doc);
  const ldAuthors = Array.isArray(ld.author) ? ld.author : ld.author ? [ld.author] : [];
  const authors = ldAuthors.map((a) => clean(a.name)).filter(Boolean);
  const pageAuthors = Array.from(
    doc.querySelectorAll(".ContributorLink__name")
  ).map((a) => clean(a.textContent));
  const description = doc.querySelector(
    "[data-testid='description'] .Formatted"
  );
  const rating = ld.aggregateRating?.ratingValue;
  return {
    title: clean(
      doc.querySelector("[data-testid='bookTitle']")?.textContent ||
        stripSeries(clean(ld.name))
    ),
    originalTitle: "",
    authors: authors.length ? authors : Array.from(new Set(pageAuthors)),
    publisher: "",
    // 「First published June 1, 1965」
    pubDate: clean(
      doc.querySelector("[data-testid='publicationInfo']")?.textContent
    ),
    isbn: ld.isbn || "",
    summary: description?.innerHTML.trim() || "",
    coverUrl: ld.image || "",
    rating: rating ? rating : null,
    votes: ld.aggregateRating?.ratingCount || 0,
  };
};

const fetchHtml = async (url: string): Promise<string> => {
  const response = await fetchWithPolicy(url, {
    headers: { Accept: "text/html,application/xhtml+xml" },
  });
  if (!response.ok)
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  return response.text();
};

export const fetchGoodreadsList = async (url: string): Promise<DoubanList> => {
  const cacheKey = "goodreads-list:" + url;
  const cached = readCache<DoubanList>(cacheKey, LIST_TTL);
  if (cached) return cached;
  try {
    const list = parseGoodreadsList(await fetchHtml(url), url);
    // 解析失败的空结果不缓存，避免下次打开还是空列表
    if (list.books.length) writeCache(cacheKey, list);
    return list;
  } catch (err) {
    const stale = readStaleCache<DoubanList>(cacheKey);
    if (stale) return stale;
    throw err;
  }
};

export const fetchGoodreadsDetail = async (
  book: DoubanBook
): Promise<DoubanDetail> => {
  const cacheKey = "goodreads-detail:" + book.id;
  const cached = readCache<DoubanDetail>(cacheKey, DETAIL_TTL);
  if (cached) return cached;
  try {
    const detail = parseGoodreadsBook(await fetchHtml(book.url));
    writeCache(cacheKey, detail);
    return detail;
  } catch (err) {
    const stale = readStaleCache<DoubanDetail>(cacheKey);
    if (stale) return stale;
    throw err;
  }
};

/**
 * 简介按 <br> 空行切成段落，便于逐段双语对照。
 */
export const splitSummaryParagraphs = (html: string): string[] =>
  html
    .split(/(?:\s*<br\s*\/?>\s*){2,}/i)
    .map((p) => p.trim())
    .filter((p) => clean(parseHtml(p).body.textContent));
