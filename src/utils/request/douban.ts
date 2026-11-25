// 豆瓣读书没有开放 API，书单与评分从公开网页解析。
// 页面结构变化会导致解析失败，解析函数都尽量容错并在缺字段时返回空值。
import {
  DETAIL_TTL,
  LIST_TTL,
  readCache,
  readStaleCache,
  writeCache,
} from "./storeCache";
import { fetchWithPolicy } from "./http";

export const DOUBAN_BOOK_HOST = "https://book.douban.com";

export interface DoubanBook {
  id: string;
  title: string;
  // 列表页的「作者 / 出版社 / 出版年 / 定价」一行
  abstract: string;
  coverUrl: string;
  // 评价人数不足时豆瓣不显示评分
  rating: number | null;
  votes: number;
  url: string;
}

export interface DoubanList {
  books: DoubanBook[];
  nextUrl: string;
}

export interface DoubanDetail {
  title: string;
  originalTitle: string;
  authors: string[];
  publisher: string;
  pubDate: string;
  isbn: string;
  // 已经过豆瓣转义的 HTML 片段，渲染前仍需 DOMPurify
  summary: string;
  coverUrl: string;
  rating: number | null;
  votes: number;
}

export interface DoubanCategory {
  // i18n key
  title: string;
  url: string;
}

const tagUrl = (tag: string) =>
  `${DOUBAN_BOOK_HOST}/tag/${encodeURIComponent(tag)}?start=0&type=T`;

export const doubanCategories: DoubanCategory[] = [
  { title: "Douban Top 250", url: `${DOUBAN_BOOK_HOST}/top250` },
  { title: "Fiction", url: tagUrl("小说") },
  { title: "Literature", url: tagUrl("外国文学") },
  { title: "Classics", url: tagUrl("经典") },
  { title: "History", url: tagUrl("历史") },
  { title: "Philosophy", url: tagUrl("哲学") },
  { title: "Science fiction", url: tagUrl("科幻") },
  { title: "Mystery", url: tagUrl("推理") },
  { title: "Math", url: tagUrl("数学") },
  { title: "Computer science", url: tagUrl("计算机") },
  { title: "Programming", url: tagUrl("编程") },
  { title: "Algorithms", url: tagUrl("算法") },
];

export const buildDoubanSearchUrl = (query: string, start = 0) =>
  `https://search.douban.com/book/subject_search?search_text=${encodeURIComponent(
    query.trim()
  )}&cat=1001&start=${start}`;

// 列表里是小图，卡片用中图、详情用大图
export const resizeDoubanCover = (url: string, size: "m" | "l") =>
  url.replace(/\/view\/subject\/[sml]\/public\//, `/view/subject/${size}/public/`);

const clean = (text: string | null | undefined) =>
  (text || "").replace(/\s+/g, " ").trim();

const parseRating = (text: string | null | undefined): number | null => {
  const value = parseFloat(clean(text));
  return isNaN(value) ? null : value;
};

const parseVotes = (text: string | null | undefined): number => {
  const match = clean(text).match(/\d+/);
  return match ? parseInt(match[0]) : 0;
};

const getSubjectId = (url: string) =>
  url.match(/\/subject\/(\d+)/)?.[1] || "";

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
 * 解析 Top 250（tr.item）和标签页（li.subject-item）两种书单。
 */
export const parseDoubanList = (html: string, pageUrl: string): DoubanList => {
  const doc = parseHtml(html);
  const books: DoubanBook[] = [];
  doc.querySelectorAll("tr.item, li.subject-item").forEach((item) => {
    const link =
      item.querySelector<HTMLAnchorElement>(".pl2 a, h2 a") ||
      item.querySelector<HTMLAnchorElement>("a[href*='/subject/']");
    const url = link?.getAttribute("href") || "";
    const id = getSubjectId(url);
    if (!id) return;
    books.push({
      id,
      title: clean(link?.getAttribute("title") || link?.textContent),
      abstract: clean(item.querySelector("p.pl, .pub")?.textContent),
      coverUrl: resizeDoubanCover(
        item.querySelector("img")?.getAttribute("src") || "",
        "m"
      ),
      rating: parseRating(item.querySelector(".rating_nums")?.textContent),
      votes: parseVotes(item.querySelector(".star .pl")?.textContent),
      url,
    });
  });
  const next = doc
    .querySelector(".paginator .next a, .paginator .next link")
    ?.getAttribute("href");
  return { books, nextUrl: next ? resolve(next, pageUrl) : "" };
};

interface DoubanSearchItem {
  id?: number;
  title?: string;
  abstract?: string;
  cover_url?: string;
  url?: string;
  tpl_name?: string;
  rating?: { value?: number; count?: number };
}

const SEARCH_PAGE_SIZE = 15;

/**
 * 搜索页由前端渲染，数据在 window.__DATA__ 里。
 */
export const parseDoubanSearch = (html: string, pageUrl: string): DoubanList => {
  const match = html.match(/window\.__DATA__\s*=\s*(\{[\s\S]*?\});\s*\n/);
  if (!match) return { books: [], nextUrl: "" };
  let data: { items?: DoubanSearchItem[]; total?: number; start?: number };
  try {
    data = JSON.parse(match[1]);
  } catch {
    return { books: [], nextUrl: "" };
  }
  const books: DoubanBook[] = (data.items || [])
    // 丛书、「搜索更多」等条目不是单本书
    .filter((it) => it.tpl_name === "search_subject" && it.url?.includes("/subject/"))
    .map((it) => ({
      id: String(it.id),
      title: clean(it.title),
      abstract: clean(it.abstract),
      coverUrl: it.cover_url || "",
      rating: it.rating?.value ? it.rating.value : null,
      votes: it.rating?.count || 0,
      url: it.url || "",
    }));
  const start = data.start || 0;
  const hasMore = start + SEARCH_PAGE_SIZE < (data.total || 0);
  let nextUrl = "";
  if (hasMore) {
    const url = new URL(pageUrl);
    url.searchParams.set("start", String(start + SEARCH_PAGE_SIZE));
    nextUrl = url.href;
  }
  return { books, nextUrl };
};

/**
 * 解析书籍详情页的 #info 区块、评分和简介。
 */
export const parseDoubanSubject = (html: string): DoubanDetail => {
  const doc = parseHtml(html);
  const info = doc.querySelector("#info");
  // #info 是「<span class="pl">字段:</span> 值<br>」的平铺结构，按行切分
  const fields: Record<string, string> = {};
  info?.innerHTML.split(/<br\s*\/?>/i).forEach((part) => {
    const line = clean(parseHtml(part).body.textContent);
    const match = line.match(/^([^:：]+)[:：]\s*(.+)$/);
    if (match) fields[match[1].trim()] = match[2].trim();
  });
  const authors = (fields["作者"] || "")
    .split("/")
    .map((a) => clean(a))
    .filter(Boolean);
  // 简介有截断版（.short）和完整版（.all），优先完整版
  const intro =
    doc.querySelector("#link-report .all .intro") ||
    doc.querySelector("#link-report .intro");
  intro?.querySelectorAll("style, a.a_show_full").forEach((el) => el.remove());
  return {
    title: clean(doc.querySelector("[property='v:itemreviewed']")?.textContent),
    originalTitle: fields["原作名"] || "",
    authors,
    publisher: fields["出版社"] || "",
    pubDate: fields["出版年"] || fields["出版时间"] || "",
    isbn: fields["ISBN"] || "",
    summary: intro?.innerHTML.trim() || "",
    coverUrl:
      doc.querySelector("#mainpic a.nbg")?.getAttribute("href") ||
      resizeDoubanCover(doc.querySelector("#mainpic img")?.getAttribute("src") || "", "l"),
    rating: parseRating(doc.querySelector("[property='v:average']")?.textContent),
    votes: parseVotes(doc.querySelector("[property='v:votes']")?.textContent),
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

export const fetchDoubanList = async (url: string): Promise<DoubanList> => {
  const cacheKey = "douban-list:" + url;
  const cached = readCache<DoubanList>(cacheKey, LIST_TTL);
  if (cached) return cached;
  try {
    const html = await fetchHtml(url);
    const list = url.includes("search.douban.com")
      ? parseDoubanSearch(html, url)
      : parseDoubanList(html, url);
    // 解析失败的空结果不缓存，避免下次打开还是空列表
    if (list.books.length) writeCache(cacheKey, list);
    return list;
  } catch (err) {
    const stale = readStaleCache<DoubanList>(cacheKey);
    if (stale) return stale;
    throw err;
  }
};

// 同一本书反复打开详情时不重复请求，降低触发豆瓣反爬的概率
export const fetchDoubanDetail = async (book: DoubanBook): Promise<DoubanDetail> => {
  const cacheKey = "douban-detail:" + book.id;
  const cached = readCache<DoubanDetail>(cacheKey, DETAIL_TTL);
  if (cached) return cached;
  try {
    const detail = parseDoubanSubject(await fetchHtml(book.url));
    writeCache(cacheKey, detail);
    return detail;
  } catch (err) {
    const stale = readStaleCache<DoubanDetail>(cacheKey);
    if (stale) return stale;
    throw err;
  }
};
