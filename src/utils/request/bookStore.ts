import type { BookSource } from "../../constants/bookSourceList";
import { supportedFormats } from "../common";
import { ACQUISITION_RELS, DOWNLOAD_TYPES } from "./opds";
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
