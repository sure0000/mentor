import type { BookSource } from "../../constants/bookSourceList";
import { supportedFormats } from "../common";
import { fetchWithPolicy } from "./http";
import { ACQUISITION_RELS, DOWNLOAD_TYPES, fetchOPDSFeed } from "./opds";
import type { OPDSEntry, OPDSFeed, OPDSLink } from "./opds";

export interface StoreBook {
  id: string;
  title: string;
  author: string;
  coverUrl: string;
  // 书籍详情 feed（Gutenberg 列表条目是导航链接）
  detailUrl: string;
  // 列表条目本身就带下载链接时直接使用
  entry: OPDSEntry | null;
}

export interface StoreBookDetail {
  title: string;
  authors: string[];
  summary: string;
  coverUrl: string;
  language: string;
  pubDate: string;
  rights: string;
  categories: string[];
  downloadLinks: OPDSLink[];
}

const getEntryFeedLink = (entry: OPDSEntry): string =>
  entry.links.find(
    (l) =>
      l.rel === "subsection" || l.type?.includes("application/atom+xml")
  )?.href || "";

export const getSupportedDownloadLinks = (entry: OPDSEntry): OPDSLink[] =>
  entry.links.filter((l) => {
    if (!ACQUISITION_RELS.includes(l.rel)) return false;
    const ext = DOWNLOAD_TYPES[l.type];
    return !!ext && supportedFormats.includes("." + ext);
  });

/**
 * 把 OPDS 列表条目转成书城卡片；分类/作者等纯导航条目返回 null。
 */
export const toStoreBook = (
  entry: OPDSEntry,
  source: BookSource
): StoreBook | null => {
  const hasDownload = getSupportedDownloadLinks(entry).length > 0;
  const detailUrl = getEntryFeedLink(entry);
  const isBookFeed = source.bookFeedPattern
    ? source.bookFeedPattern.test(detailUrl)
    : false;
  if (!hasDownload && !isBookFeed) return null;
  const author =
    entry.authors.join(", ") ||
    // Gutenberg 列表把作者放在 content 里
    (entry.summary.length < 120 ? entry.summary.trim() : "");
  const derivedCover =
    isBookFeed && source.coverFromBookFeed
      ? source.coverFromBookFeed(detailUrl)
      : "";
  return {
    id: entry.id || detailUrl,
    title: entry.title,
    author,
    coverUrl: derivedCover || entry.coverUrl || entry.thumbnailUrl,
    detailUrl: hasDownload ? "" : detailUrl,
    entry: hasDownload ? entry : null,
  };
};

// 下载按钮排序：EPUB 优先，带图版本优先（无图版本常缺插图，体验较差）
const linkPriority = (link: OPDSLink): number => {
  const isEpub = DOWNLOAD_TYPES[link.type] === "epub";
  const text = `${link.title || ""} ${link.href}`.toLowerCase();
  const isNoImages = text.includes("no images") || text.includes("noimages");
  const isEpub3 = text.includes("epub3");
  return (isEpub ? 0 : 10) + (isNoImages ? 5 : 0) + (isEpub3 ? 0 : 1);
};

/**
 * 合并一本书的详情：Gutenberg 的详情 feed 里同一本书有多个条目（有图/无图版本），
 * 下载链接需要合并去重，简介取第一个非空的。
 */
export const toStoreBookDetail = (
  entries: OPDSEntry[],
  fallback: StoreBook
): StoreBookDetail => {
  const bookEntries = entries.filter(
    (e) => getSupportedDownloadLinks(e).length > 0
  );
  const seen = new Set<string>();
  const downloadLinks: OPDSLink[] = [];
  for (const e of bookEntries) {
    for (const link of getSupportedDownloadLinks(e)) {
      if (seen.has(link.href)) continue;
      seen.add(link.href);
      downloadLinks.push(link);
    }
  }
  downloadLinks.sort((a, b) => linkPriority(a) - linkPriority(b));
  const first = bookEntries[0];
  const pick = (getter: (e: OPDSEntry) => string) =>
    bookEntries.map(getter).find(Boolean) || "";
  return {
    title: first?.title || fallback.title,
    authors: first?.authors.length
      ? first.authors
      : fallback.author
        ? [fallback.author]
        : [],
    summary: pick((e) => e.summary),
    coverUrl: pick((e) => e.coverUrl) || fallback.coverUrl,
    language: pick((e) => e.language),
    pubDate: pick((e) => e.pubDate),
    rights: pick((e) => e.rights),
    categories: first?.categories || [],
    downloadLinks,
  };
};

export const getNextPageUrl = (feed: OPDSFeed): string =>
  feed.links.find((l) => l.rel === "next")?.href || "";

export const buildSearchUrl = (source: BookSource, query: string): string =>
  source.searchTemplate.replace(
    "{searchTerms}",
    encodeURIComponent(query.trim())
  );

// 书名归一化：去掉标点、空白、大小写差异，便于跨书源比对
export const normalizeTitle = (title: string): string =>
  title
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[\s\p{P}\p{S}]+/gu, "");

// 副标题（冒号、分号、括号之后）在不同书源里写法差异很大，只取主标题
const mainTitle = (title: string): string =>
  title.split(/[:;：；(（[【,，—–-]/)[0] || title;

/**
 * 判断书源里的书名是否对应豆瓣上的书：任一候选书名的主标题与结果主标题互相包含即视为同一本。
 */
export const isTitleMatch = (resultTitle: string, queries: string[]): boolean => {
  const result = normalizeTitle(mainTitle(resultTitle));
  if (!result) return false;
  return queries.some((q) => {
    const query = normalizeTitle(mainTitle(q));
    // 过短的书名（如单字）容易误匹配
    if (query.length < 2) return false;
    return result === query || result.includes(query) || query.includes(result);
  });
};

export const buildWebSearchUrl = (source: BookSource, query: string): string =>
  source.webSearchTemplate.replace(
    "{searchTerms}",
    encodeURIComponent(query.trim())
  );

const MAX_MATCHES_PER_SOURCE = 3;

const OPENSTAX_API =
  "https://openstax.org/apps/cms/api/v2/pages/?type=books.Book&fields=title,authors,cover_url,high_resolution_pdf_url,book_state&limit=250";

interface OpenStaxBook {
  id?: number;
  title?: string;
  book_state?: string;
  cover_url?: string;
  high_resolution_pdf_url?: string;
  authors?: { value?: { name?: string; senior_author?: boolean } }[];
  meta?: { html_url?: string };
}

/** 把 OpenStax 书目条目转成带 PDF 下载链接的书城条目；没有 PDF 的返回 null */
export const toOpenStaxStoreBook = (book: OpenStaxBook): StoreBook | null => {
  if (!book.title || !book.high_resolution_pdf_url) return null;
  const authors = (book.authors || [])
    .filter((a) => a.value?.senior_author)
    .map((a) => a.value?.name || "")
    .filter(Boolean);
  const entry: OPDSEntry = {
    id: `openstax-${book.id}`,
    title: book.title,
    authors,
    summary: "",
    coverUrl: book.cover_url || "",
    thumbnailUrl: "",
    links: [
      {
        href: book.high_resolution_pdf_url,
        type: "application/pdf",
        rel: "http://opds-spec.org/acquisition/open-access",
        title: "PDF",
      },
    ],
    updated: "",
    isNavigation: false,
    publisher: "OpenStax",
    language: "en",
    pubDate: "",
    rights: "CC BY",
    categories: [],
  };
  return {
    id: entry.id,
    title: book.title,
    author: authors.join(", "),
    // 封面是 SVG 卡片，导入后作为书籍封面不合适，留给豆瓣封面
    coverUrl: "",
    detailUrl: "",
    entry,
  };
};

// 书目只有一百多本，整份拉取后缓存；失败时清掉缓存以便下次重试
let openStaxCatalog: Promise<OpenStaxBook[]> | null = null;
const getOpenStaxCatalog = () => {
  if (!openStaxCatalog) {
    openStaxCatalog = fetch(OPENSTAX_API, { signal: AbortSignal.timeout(30000) })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data: { items?: OpenStaxBook[] }) => data.items || [])
      .catch((err) => {
        openStaxCatalog = null;
        throw err;
      });
  }
  return openStaxCatalog;
};

/** 在 OpenStax 书目里按书名匹配，在售版本（live）排在已停更版本前面 */
export const matchOpenStax = (
  catalog: OpenStaxBook[],
  queries: string[]
): StoreBook[] =>
  catalog
    .filter((b) => b.title && isTitleMatch(b.title, queries))
    .sort((a, b) => Number(b.book_state === "live") - Number(a.book_state === "live"))
    .map(toOpenStaxStoreBook)
    .filter((b): b is StoreBook => b !== null)
    .slice(0, MAX_MATCHES_PER_SOURCE);

const fetchJson = async (url: string): Promise<unknown> => {
  const response = await fetchWithPolicy(url);
  if (!response.ok)
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  return response.json();
};

/** 依次用候选书名搜索，凑够结果即停；全部失败才抛错，以区分「没找到」和「访问失败」 */
const searchByQueries = async (
  queries: string[],
  search: (query: string) => Promise<StoreBook[]>
): Promise<StoreBook[]> => {
  const matches = new Map<string, StoreBook>();
  let lastError: unknown = null;
  let isAnySucceeded = false;
  for (const query of queries) {
    try {
      for (const book of await search(query)) {
        if (!matches.has(book.id)) matches.set(book.id, book);
      }
      isAnySucceeded = true;
    } catch (err) {
      lastError = err;
    }
    if (matches.size >= MAX_MATCHES_PER_SOURCE) break;
  }
  if (!isAnySucceeded && lastError) throw lastError;
  return Array.from(matches.values()).slice(0, MAX_MATCHES_PER_SOURCE);
};

const SEARCH_LIMIT = 20;

// 维基文库没有 OPDS，用 MediaWiki 接口找篇目，再由 ws-export 导出整本 EPUB
interface WikisourcePage {
  index?: number;
  title?: string;
  // 中文站标题多为繁体，这里有各变体写法，用于匹配简体书名
  varianttitles?: Record<string, string>;
  pageprops?: { disambiguation?: string };
}

// 繁体标题的简繁变体由 MediaWiki 的 varianttitles 提供；老版本不支持时不带该参数
export const buildWikisourceSearchUrl = (
  lang: string,
  query: string,
  withVariants = true
): string => {
  const params = new URLSearchParams({
    action: "query",
    generator: "search",
    gsrsearch: query.trim(),
    gsrnamespace: "0",
    gsrlimit: String(SEARCH_LIMIT),
    prop: withVariants ? "info|pageprops" : "info",
    format: "json",
    formatversion: "2",
    origin: "*",
  });
  if (withVariants) {
    params.set("inprop", "varianttitles");
    params.set("ppprop", "disambiguation");
  }
  return `https://${lang}.wikisource.org/w/api.php?${params}`;
};

const isMediaWikiError = (data: unknown) =>
  typeof (data as { error?: unknown })?.error === "object" &&
  (data as { error?: unknown }).error !== null;

/** 从 MediaWiki 响应里取出书名匹配的篇目；跳过章节子页面和消歧义页 */
export const parseWikisourceSearch = (
  data: unknown,
  lang: string,
  queries: string[]
): StoreBook[] => {
  const pages =
    (data as { query?: { pages?: WikisourcePage[] } })?.query?.pages || [];
  return [...pages]
    .sort((a, b) => (a.index || 0) - (b.index || 0))
    .flatMap((page) => {
      const title = page.title || "";
      if (!title || title.includes("/")) return [];
      if (page.pageprops?.disambiguation !== undefined) return [];
      const titles = [title, ...Object.values(page.varianttitles || {})];
      if (!titles.some((item) => isTitleMatch(item, queries))) return [];
      const params = new URLSearchParams({
        lang,
        page: title,
        format: "epub-3",
      });
      const entry: OPDSEntry = {
        id: `wikisource-${lang}-${title}`,
        title,
        authors: [],
        summary: "",
        coverUrl: "",
        thumbnailUrl: "",
        links: [
          {
            href: `https://ws-export.wmcloud.org/?${params}`,
            type: "application/epub+zip",
            rel: "http://opds-spec.org/acquisition/open-access",
            title: "EPUB",
          },
        ],
        updated: "",
        isNavigation: false,
        publisher: "Wikisource",
        language: lang,
        pubDate: "",
        rights: "",
        categories: [],
      };
      return [
        { id: entry.id, title, author: "", coverUrl: "", detailUrl: "", entry },
      ];
    })
    .slice(0, MAX_MATCHES_PER_SOURCE);
};

const ARCHIVE_METADATA = "https://archive.org/metadata/";

// 只查图书馆扫描和 Gutenberg 馆藏，排除仅供借阅的在版书与用户自行上传的内容
const ARCHIVE_FILTER =
  "mediatype:texts AND collection:(gutenberg OR americana OR europeanlibraries OR toronto)" +
  " AND NOT collection:(inlibrary OR printdisabled)";

export const buildArchiveSearchUrl = (query: string): string => {
  // 去掉会破坏检索语法的标点，只保留文字
  const words = query.replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  const params = new URLSearchParams({
    q: `title:(${words}) AND ${ARCHIVE_FILTER}`,
    rows: String(SEARCH_LIMIT),
    output: "json",
  });
  for (const field of ["identifier", "title", "creator"])
    params.append("fl[]", field);
  params.append("sort[]", "downloads desc");
  return `https://archive.org/advancedsearch.php?${params}`;
};

interface ArchiveDoc {
  identifier?: string;
  title?: string;
  creator?: string | string[];
}

export const parseArchiveSearch = (
  data: unknown,
  queries: string[]
): StoreBook[] => {
  const docs =
    (data as { response?: { docs?: ArchiveDoc[] } })?.response?.docs || [];
  return docs
    .flatMap((doc) => {
      if (!doc.identifier || !doc.title || !isTitleMatch(doc.title, queries))
        return [];
      return [
        {
          id: `archive-${doc.identifier}`,
          title: doc.title,
          author: [doc.creator || []].flat().join(", "),
          coverUrl: "",
          detailUrl: ARCHIVE_METADATA + encodeURIComponent(doc.identifier),
          entry: null,
        },
      ];
    })
    .slice(0, MAX_MATCHES_PER_SOURCE);
};

interface ArchiveFile {
  name?: string;
  private?: string;
}

/** 文件名不固定，需从元数据的文件清单里取；加密或受限文件不可下载 */
export const parseArchiveFiles = (data: unknown): OPDSLink[] => {
  const { metadata, files } = (data || {}) as {
    metadata?: { identifier?: string; "access-restricted-item"?: string };
    files?: ArchiveFile[];
  };
  const id = metadata?.identifier;
  if (!id || metadata?.["access-restricted-item"] === "true") return [];
  const pick = (ext: string, type: string): OPDSLink[] => {
    const file = files?.find(
      (f) =>
        f.name?.toLowerCase().endsWith("." + ext) &&
        f.private !== "true" &&
        !/_(lcp|encrypted|text)\.\w+$/i.test(f.name)
    );
    if (!file?.name) return [];
    const path = file.name.split("/").map(encodeURIComponent).join("/");
    return [
      {
        href: `https://archive.org/download/${encodeURIComponent(id)}/${path}`,
        type,
        rel: "http://opds-spec.org/acquisition/open-access",
        title: ext.toUpperCase(),
      },
    ];
  };
  return [
    ...pick("epub", "application/epub+zip"),
    ...pick("pdf", "application/pdf"),
  ];
};

/**
 * 在单个书源里按候选书名搜索，返回书名匹配的条目。
 */
export const findInSource = async (
  source: BookSource,
  queries: string[]
): Promise<StoreBook[]> => {
  if (source.type === "openstax") {
    return matchOpenStax(await getOpenStaxCatalog(), queries);
  }
  return searchByQueries(queries, async (query) => {
    if (source.type === "wikisource") {
      const lang = source.lang || "en";
      let data = await fetchJson(buildWikisourceSearchUrl(lang, query));
      // 接口不认识 varianttitles 时整次检索会失败，退回只用标题匹配
      if (isMediaWikiError(data)) {
        data = await fetchJson(buildWikisourceSearchUrl(lang, query, false));
      }
      return parseWikisourceSearch(data, lang, queries);
    }
    if (source.type === "archive") {
      const url = buildArchiveSearchUrl(query);
      return parseArchiveSearch(await fetchJson(url), queries);
    }
    const feed = await fetchOPDSFeed(buildSearchUrl(source, query));
    return feed.entries
      .map((entry) => toStoreBook(entry, source))
      .filter(
        (b): b is StoreBook => b !== null && isTitleMatch(b.title, queries)
      );
  });
};

/**
 * 取一本书源条目的可下载链接；Gutenberg 等列表条目需要再请求详情 feed。
 */
export const resolveDownloadLinks = async (
  book: StoreBook
): Promise<OPDSLink[]> => {
  if (book.entry) return toStoreBookDetail([book.entry], book).downloadLinks;
  if (!book.detailUrl) return [];
  if (book.detailUrl.startsWith(ARCHIVE_METADATA)) {
    return parseArchiveFiles(await fetchJson(book.detailUrl));
  }
  const feed = await fetchOPDSFeed(book.detailUrl);
  return toStoreBookDetail(feed.entries, book).downloadLinks;
};
