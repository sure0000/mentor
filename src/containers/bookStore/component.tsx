import { useTranslation, Trans } from "react-i18next";
import { Link } from "react-router-dom";
import { ReactNode, useEffect, useMemo, useRef, useState } from "react";
import toast from "react-hot-toast";
import Parser from "html-react-parser";
import DOMPurify from "dompurify";
import "./bookStore.css";
import PaperStore from "./paperStore";
import { bookSourceList } from "../../constants/bookSourceList";
import type { BookSource } from "../../constants/bookSourceList";
import { useAppStore } from "../../store/useAppStore";
import { useLatest } from "../../utils/hooks/useLatest";
import { calculateFileMD5, openInBrowser, throttle } from "../../utils/common";
import BookUtil from "../../utils/file/bookUtil";
import CoverUtil from "../../utils/file/coverUtil";
import DatabaseService from "../../utils/storage/databaseService";
import BookModel from "../../models/Book";
import { DOWNLOAD_TYPES, downloadOPDSFile } from "../../utils/request/opds";
import type { OPDSLink } from "../../utils/request/opds";
import {
  buildWebSearchUrl,
  findInSource,
  resolveDownloadLinks,
} from "../../utils/request/bookStore";
import type { StoreBook } from "../../utils/request/bookStore";
import {
  buildDoubanSearchUrl,
  doubanCategories,
  fetchDoubanDetail,
  fetchDoubanList,
} from "../../utils/request/douban";
import type {
  DoubanBook,
  DoubanDetail,
  DoubanList,
} from "../../utils/request/douban";
import {
  GOODREADS_RATING_MAX,
  buildGoodreadsSearchUrl,
  fetchGoodreadsDetail,
  fetchGoodreadsList,
  goodreadsCategories,
  splitSummaryParagraphs,
} from "../../utils/request/goodreads";
import { ConfigService } from "../../assets/lib/kookit-extra-browser.min";
import { isAiAvailable } from "../../utils/aiReading/aiGateway";
import { useBatchTranslation } from "../../utils/hooks/useBatchTranslation";

import { linkStoreEdition, sameStoreBook, type StoreSourceId } from "../../utils/storage/wantToRead";

// 书单来源：豆瓣与 Goodreads 解析出的数据结构一致，只是地址和评分制不同
interface StoreSource {
  name: string;
  categories: { title: string; url: string }[];
  buildSearchUrl: (query: string) => string;
  fetchList: (url: string) => Promise<DoubanList>;
  fetchDetail: (book: DoubanBook) => Promise<DoubanDetail>;
  ratingMax: number;
  // 外文书单默认双语展示书名和简介
  isForeign: boolean;
}

const STORE_SOURCES: Record<StoreSourceId, StoreSource> = {
  douban: {
    name: "Douban",
    categories: doubanCategories,
    buildSearchUrl: (query) => buildDoubanSearchUrl(query),
    fetchList: fetchDoubanList,
    fetchDetail: fetchDoubanDetail,
    ratingMax: 10,
    isForeign: false,
  },
  goodreads: {
    name: "Goodreads",
    categories: goodreadsCategories,
    buildSearchUrl: buildGoodreadsSearchUrl,
    fetchList: fetchGoodreadsList,
    fetchDetail: fetchGoodreadsDetail,
    ratingMax: GOODREADS_RATING_MAX,
    isForeign: true,
  },
};

const STORE_SOURCE_CONFIG = "bookStoreSource";
// 默认开启，用户手动关闭后记为 "no"
const BILINGUAL_CONFIG = "isBookStoreBilingual";

const getHtmlText = (html: string) =>
  new DOMParser().parseFromString(html, "text/html").body.textContent?.trim() ||
  "";

interface BookStoreState {
  // 分类下标；-1 表示当前为搜索结果
  categoryIndex: number;
  searchQuery: string;
  books: DoubanBook[];
  nextUrl: string;
  isLoading: boolean;
  isLoadingMore: boolean;
  error: string;
}

// 某个书源里匹配到的一个版本
interface SourceEdition {
  book: StoreBook;
  // null 表示下载链接尚未解析完成
  links: OPDSLink[] | null;
}

interface SourceMatch {
  source: BookSource;
  status: "searching" | "found" | "notFound" | "error";
  editions: SourceEdition[];
}

interface DetailState {
  sourceId: StoreSourceId;
  book: DoubanBook;
  detail: DoubanDetail | null;
  isLoading: boolean;
  error: string;
  matches: SourceMatch[];
  downloadingHref: string;
}

const StoreCover = ({ src, title }: { src: string; title: string }) => {
  const [isFailed, setIsFailed] = useState(false);
  useEffect(() => setIsFailed(false), [src]);
  if (!src || isFailed) {
    return <div className="book-store-cover-placeholder">{title}</div>;
  }
  return (
    <img
      src={src}
      alt=""
      loading="lazy"
      className="book-store-cover-img"
      onError={() => setIsFailed(true)}
    />
  );
};

// 五星展示：按评分制换算成 0~5 颗星，按半星取整
const RatingStars = ({ rating, max }: { rating: number; max: number }) => {
  const percent = Math.round((rating * 10) / max) * 10;
  return (
    <span className="book-store-stars">
      <span className="book-store-stars-fill" style={{ width: percent + "%" }}>
        ★★★★★
      </span>
      ☆☆☆☆☆
    </span>
  );
};

const RatingLine = ({
  rating,
  votes,
  max,
}: {
  rating: number | null;
  votes: number;
  max: number;
}) => {
  const { t } = useTranslation();
  if (rating === null) {
    return (
      <div className="book-store-rating is-empty">{t("Not enough ratings")}</div>
    );
  }
  return (
    <div className="book-store-rating">
      <RatingStars rating={rating} max={max} />
      <span className="book-store-rating-value">{rating.toFixed(1)}</span>
      {votes > 0 && (
        <span className="book-store-rating-votes">
          {t("{{count}} ratings", { count: votes })}
        </span>
      )}
    </div>
  );
};

// 豆瓣书名常带中文副标题，书源多为外文原版；用原作名、主标题等多个候选去搜
const getSearchQueries = (book: DoubanBook, detail: DoubanDetail) => {
  const candidates = [detail.originalTitle, detail.title, book.title];
  return Array.from(
    new Set(candidates.map((c) => c.trim()).filter(Boolean))
  );
};

interface BookViewProps {
  modeSwitch?: ReactNode;
  wishlistOnly?: boolean;
}

const BookView = ({ modeSwitch, wishlistOnly = false }: BookViewProps) => {
  const wantedBooks = useAppStore((s) => s.manager.wantedBooks);
  const toggleWantedBook = useAppStore((s) => s.handleToggleWantedBook);
  const importBookFunc = useAppStore((s) => s.book.importBookFunc);
  const handleFetchBooks = useAppStore((s) => s.handleFetchBooks);
  const handleRefreshBookCover = useAppStore((s) => s.handleRefreshBookCover);
  const handleReadingBook = useAppStore((s) => s.handleReadingBook);
  const { t } = useTranslation();
  // 下载链接 href -> 已导入的书，下载完成后在原位置显示“打开”按钮
  const [importedBooks, setImportedBooks] = useState<
    Record<string, BookModel>
  >({});
  const [state, setState] = useState<BookStoreState>({
    categoryIndex: 0,
    searchQuery: "",
    books: [],
    nextUrl: "",
    isLoading: false,
    isLoadingMore: false,
    error: "",
  });
  const [detailState, setDetailState] = useState<DetailState | null>(null);
  const [sourceId, setSourceId] = useState<StoreSourceId>(() =>
    ConfigService.getReaderConfig(STORE_SOURCE_CONFIG) === "goodreads"
      ? "goodreads"
      : "douban"
  );
  const [isBilingual, setIsBilingual] = useState(
    () => ConfigService.getReaderConfig(BILINGUAL_CONFIG) !== "no"
  );
  const source = STORE_SOURCES[sourceId];
  const sourceRef = useLatest(source);
  const stateRef = useLatest(state);
  // 切换分类/搜索时丢弃旧请求的结果
  const requestIdRef = useRef(0);

  const mergeState = (patch: Partial<BookStoreState>) =>
    setState((prev) => ({ ...prev, ...patch }));

  const loadList = async (url: string, patch: Partial<BookStoreState>) => {
    const requestId = ++requestIdRef.current;
    mergeState({
      ...patch,
      books: [],
      nextUrl: "",
      isLoading: true,
      isLoadingMore: false,
      error: "",
    });
    try {
      const list = await sourceRef.current.fetchList(url);
      if (requestId !== requestIdRef.current) return;
      mergeState({ books: list.books, nextUrl: list.nextUrl, isLoading: false });
    } catch (err) {
      if (requestId !== requestIdRef.current) return;
      const msg = err instanceof Error ? err.message : String(err);
      mergeState({ isLoading: false, error: msg });
    }
  };

  const loadCategory = (categoryIndex: number) => {
    const category = sourceRef.current.categories[categoryIndex];
    if (!category) return;
    loadList(category.url, { categoryIndex, searchQuery: "" });
  };

  const handleSearch = () => {
    const query = stateRef.current.searchQuery.trim();
    if (!query) return;
    loadList(sourceRef.current.buildSearchUrl(query), { categoryIndex: -1 });
  };

  const switchSource = (id: StoreSourceId) => {
    if (id === sourceId) return;
    ConfigService.setReaderConfig(STORE_SOURCE_CONFIG, id);
    setSourceId(id);
  };

  const toggleBilingual = () => {
    if (!isBilingual && !isAiAvailable("translate")) {
      toast(t("No AI service configured. Please add one in Settings > AI service"));
      return;
    }
    const next = !isBilingual;
    ConfigService.setReaderConfig(BILINGUAL_CONFIG, next ? "yes" : "no");
    setIsBilingual(next);
  };

  const loadMore = async () => {
    const { nextUrl, isLoading, isLoadingMore } = stateRef.current;
    if (!nextUrl || isLoading || isLoadingMore) return;
    const requestId = requestIdRef.current;
    mergeState({ isLoadingMore: true });
    try {
      const list = await sourceRef.current.fetchList(nextUrl);
      if (requestId !== requestIdRef.current) return;
      setState((prev) => {
        const seen = new Set(prev.books.map((b) => b.id));
        return {
          ...prev,
          books: prev.books.concat(list.books.filter((b) => !seen.has(b.id))),
          nextUrl: list.nextUrl,
          isLoadingMore: false,
        };
      });
    } catch (err) {
      if (requestId !== requestIdRef.current) return;
      const msg = err instanceof Error ? err.message : String(err);
      mergeState({ isLoadingMore: false });
      toast.error(t("Failed to load more") + ": " + msg);
    }
  };
  const loadMoreRef = useLatest(loadMore);

  const handleScroll = useMemo(
    () =>
      throttle((target: HTMLDivElement) => {
        const { scrollTop, clientHeight, scrollHeight } = target;
        if (scrollHeight - scrollTop - clientHeight < 300) {
          loadMoreRef.current();
        }
      }, 200),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  // 只更新仍在展示的那本书的详情，避免快速切换时串数据
  const patchDetail = (
    bookId: string,
    patch: (prev: DetailState) => Partial<DetailState>
  ) =>
    setDetailState((prev) =>
      prev && prev.book.url === bookId ? { ...prev, ...patch(prev) } : prev
    );

  const patchMatch = (
    bookId: string,
    sourceId: string,
    patch: Partial<SourceMatch>
  ) =>
    patchDetail(bookId, (prev) => ({
      matches: prev.matches.map((m) =>
        m.source.id === sourceId ? { ...m, ...patch } : m
      ),
    }));

  const searchSource = async (
    bookId: string,
    source: BookSource,
    queries: string[]
  ) => {
    try {
      const found = await findInSource(source, queries);
      if (found.length === 0) {
        patchMatch(bookId, source.id, { status: "notFound" });
        return;
      }
      const editions: SourceEdition[] = found.map((book) => ({
        book,
        links: book.websiteUrl ? [] : null,
      }));
      patchMatch(bookId, source.id, { status: "found", editions });
      // 列表条目可能只有详情 feed 地址，逐个补齐下载链接
      await Promise.all(
        found.map(async (book, index) => {
          if (book.websiteUrl) return;
          let links: OPDSLink[] = [];
          try {
            links = await resolveDownloadLinks(book);
          } catch (err) {
            console.error("resolve download links failed", err);
          }
          editions[index] = { book, links };
          patchMatch(bookId, source.id, { editions: [...editions] });
        })
      );
    } catch (err) {
      console.error(`search ${source.id} failed`, err);
      patchMatch(bookId, source.id, { status: "error" });
    }
  };

  const openDetail = async (book: DoubanBook, catalogId: StoreSourceId) => {
    setDetailState({
      sourceId: catalogId,
      book,
      detail: null,
      isLoading: true,
      error: "",
      matches: bookSourceList.map((source) => ({
        source,
        status: "searching",
        editions: [],
      })),
      downloadingHref: "",
    });
    let detail: DoubanDetail;
    try {
      detail = await STORE_SOURCES[catalogId].fetchDetail(book);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // 详情加载失败时仍用列表里的书名去书源查找
      detail = {
        title: book.title,
        originalTitle: "",
        authors: [],
        publisher: "",
        pubDate: "",
        isbn: "",
        summary: "",
        coverUrl: "",
        rating: book.rating,
        votes: book.votes,
      };
      patchDetail(book.url, () => ({ error: msg }));
    }
    patchDetail(book.url, () => ({ detail, isLoading: false }));
    const queries = getSearchQueries(book, detail);
    bookSourceList.forEach((source) => searchSource(book.url, source, queries));
  };

  // 引擎没能从文件里解析出封面时（部分 EPUB 只用 <meta name="cover"> 声明），
  // 用书城展示的封面补上，逻辑与编辑对话框更换封面一致
  const applyStoreCover = async (md5: string, coverUrl: string) => {
    if (!coverUrl || !md5) return;
    try {
      const found: BookModel | null = await BookUtil.getBookByMd5(md5);
      if (!found?.key) return;
      // 用标准查询拿到完整记录再更新，避免直接回写原始 SQL 行
      const book: BookModel | null = await DatabaseService.getRecord(
        found.key,
        "books"
      );
      if (!book || (await CoverUtil.isCoverExist(book))) return;
      const response = await fetch(coverUrl);
      if (!response.ok) return;
      const blob = await response.blob();
      if (!blob.type.startsWith("image/")) return;
      book.cover = await CoverUtil.blobToBase64(blob);
      await CoverUtil.addCover(book);
      await DatabaseService.updateRecord(book, "books");
      handleRefreshBookCover(book.key);
      handleFetchBooks();
    } catch (err) {
      // 封面只是锦上添花，失败不影响导入结果
      console.error("apply store cover failed", err);
    }
  };

  const handleDownload = async (edition: StoreBook, link: OPDSLink) => {
    if (!detailState || detailState.downloadingHref) return;
    const bookId = detailState.book.url;
    const title = edition.title;
    patchDetail(bookId, () => ({ downloadingHref: link.href }));
    toast.loading(t("Downloading") + ": " + title, {
      id: "book-store-download",
    });
    try {
      const file = await downloadOPDSFile(title, link);
      toast.dismiss("book-store-download");
      let md5 = "";
      try {
        md5 = await calculateFileMD5(file);
        linkStoreEdition(md5, { id: detailState.book.id, sourceId: detailState.sourceId });
      } catch {
        // 书目关联失败不应阻止文件导入。
        toast.error(t("Save failed"));
      }
      await importBookFunc(file, { stayOnPage: true });
      if (md5) {
        const imported: BookModel | null = await BookUtil.getBookByMd5(md5);
        if (imported?.key) {
          setImportedBooks((prev) => ({ ...prev, [link.href]: imported }));
        }
      }
      // 书源封面与文件内容对应；没有时再用书单封面
      await applyStoreCover(
        md5,
        edition.coverUrl ||
          detailState.detail?.coverUrl ||
          detailState.book.coverUrl
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(t("Import failed") + ": " + msg, {
        id: "book-store-download",
      });
    } finally {
      patchDetail(bookId, () => ({ downloadingHref: "" }));
    }
  };

  const openImportedBook = (book: BookModel) => {
    handleReadingBook(book);
    BookUtil.redirectBook(book);
  };

  // 首次进入和切换书单来源时加载第一个分类
  useEffect(() => {
    setDetailState(null);
    if (!wishlistOnly) loadCategory(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceId, wishlistOnly]);

  // 外文书单默认双语：翻译卡片书名，以及打开的详情里的书名和简介段落
  const isTranslating = !wishlistOnly && source.isForeign && isBilingual;
  const summaryParagraphs = useMemo(
    () =>
      detailState?.detail?.summary
        ? splitSummaryParagraphs(
            DOMPurify.sanitize(detailState.detail.summary, {
              FORBID_TAGS: ["a", "img", "style"],
            })
          )
        : [],
    [detailState?.detail?.summary]
  );
  const transTexts = useMemo(() => {
    const texts = state.books.map((b) => b.title);
    if (detailState?.detail?.title) texts.push(detailState.detail.title);
    return texts.concat(summaryParagraphs.map(getHtmlText));
  }, [state.books, detailState?.detail?.title, summaryParagraphs]);
  const {
    getTrans,
    retranslate,
    hasError: transError,
    isPending: isTransPending,
  } = useBatchTranslation(transTexts, isTranslating);
  const renderEdition = (edition: SourceEdition, source: BookSource) => {
    const { book, links } = edition;
    const { websiteUrl } = book;
    const downloadingHref = detailState?.downloadingHref;
    return (
      <div key={book.id} className="book-store-edition">
        <div className="book-store-edition-title" title={book.title}>
          {book.title}
          {book.author && (
            <span className="book-store-edition-author"> · {book.author}</span>
          )}
        </div>
        <div className="book-store-edition-actions">
          {links === null && <span className="book-store-spinner is-inline" />}
          {links?.map((link) => {
            const imported = importedBooks[link.href];
            return (
              <span
                key={link.href}
                className={
                  "book-store-download-button" +
                  (downloadingHref === link.href ? " is-loading" : "")
                }
                title={imported ? imported.name : link.title || ""}
                onClick={() =>
                  imported
                    ? openImportedBook(imported)
                    : handleDownload(book, link)
                }
              >
                {imported ? <Trans>Open</Trans> : <Trans>Add to bookshelf</Trans>}
                {" · "}
                {(DOWNLOAD_TYPES[link.type] || "").toUpperCase() || link.title}
              </span>
            );
          })}
          {websiteUrl && (
            <button type="button" className="book-store-link-button"
              onClick={() => openInBrowser(websiteUrl)}>
              {source.type === "zlibrary" ? t("Open book page") : t("Open free edition")}
            </button>
          )}
          {!websiteUrl && links?.length === 0 && (
            <span className="book-store-match-hint">
              <Trans>No downloadable format</Trans>
            </span>
          )}
        </div>
      </div>
    );
  };

  const renderMatch = (match: SourceMatch, queries: string[]) => {
    const { source, status, editions } = match;
    const hasEdition = editions.some((e) => e.book.websiteUrl || e.links?.length);
    const webUrl = buildWebSearchUrl(source, queries[0] || "");
    return (
      <div key={source.id} className="book-store-match">
        <div className="book-store-match-head">
          <span className="book-store-match-source">{source.name}</span>
          {status === "searching" && (
            <span className="book-store-match-hint">
              <span className="book-store-spinner is-inline" />
              <Trans>Searching</Trans>
            </span>
          )}
          {status === "notFound" && (
            <span className="book-store-match-hint">
              <Trans>Not found in this source</Trans>
            </span>
          )}
          {status === "error" && (
            <span className="book-store-match-hint">
              <Trans>Source unavailable</Trans>
            </span>
          )}
          {/* 没有可直接下载的版本时，引导用户去书源网站自行查找 */}
          {(source.type === "zlibrary" || status !== "searching") && !hasEdition && (
            <span
              className="book-store-link-button"
              onClick={() => openInBrowser(webUrl)}
            >
              <Trans>Find on website</Trans>
            </span>
          )}
        </div>
        {editions.map((edition) => renderEdition(edition, source))}
      </div>
    );
  };

  const renderDetail = () => {
    if (!detailState) return null;
    const { book, detail, isLoading, error, matches } = detailState;
    const catalog = STORE_SOURCES[detailState.sourceId];
    const wantedBook = { ...book, sourceId: detailState.sourceId, isbn: detail?.isbn };
    const isWanted = wantedBooks.some((item) => sameStoreBook(item, wantedBook));
    const queries = detail ? getSearchQueries(book, detail) : [book.title];
    const rating = detail?.rating ?? book.rating;
    const votes = detail?.votes || book.votes;
    // 有下载的书源排在前面
    const sortedMatches = [...matches].sort((a, b) => {
      const score = (m: SourceMatch) =>
        m.editions.some((e) => e.links && e.links.length > 0)
          ? 0
          : m.editions.some((e) => e.book.websiteUrl)
            ? 1
            : m.status === "searching" ? 2 : 3;
      return score(a) - score(b);
    });
    return (
      <div
        className="book-store-detail-mask"
        onClick={() => setDetailState(null)}
      >
        <div
          className="book-store-detail"
          onClick={(e) => e.stopPropagation()}
        >
          <span
            className="icon-close book-store-detail-close"
            onClick={() => setDetailState(null)}
          ></span>
          <div className="book-store-detail-head">
            <div className="book-store-detail-cover">
              <StoreCover
                src={detail?.coverUrl || book.coverUrl}
                title={book.title}
              />
            </div>
            <div className="book-store-detail-meta">
              <div className="book-store-detail-title">
                {detail?.title || book.title}
              </div>
              {getTrans(detail?.title || book.title) && (
                <div className="book-store-detail-sub">
                  {getTrans(detail?.title || book.title)}
                </div>
              )}
              {detail?.originalTitle && (
                <div className="book-store-detail-sub">
                  {detail.originalTitle}
                </div>
              )}
              <div className="book-store-detail-author">
                {detail?.authors.length
                  ? detail.authors.join(" / ")
                  : book.abstract}
              </div>
              {(detail?.publisher || detail?.pubDate) && (
                <div className="book-store-detail-sub">
                  {[detail.publisher, detail.pubDate].filter(Boolean).join(" / ")}
                </div>
              )}
              <RatingLine
                rating={rating}
                votes={votes}
                max={catalog.ratingMax}
              />
              <button type="button" className="book-store-link-button"
                aria-pressed={isWanted} onClick={() => toggleWantedBook(wantedBook)}>
                {isWanted ? t("Remove from want to read") : t("Want to read")}
              </button>
              <span
                className="book-store-link-button is-plain"
                onClick={() => openInBrowser(book.url)}
              >
                {detailState.sourceId === "douban"
                  ? t("View on Douban")
                  : t("View on {{name}}", { name: catalog.name })}
              </span>
            </div>
          </div>
          <div className="book-store-detail-body">
            <div className="book-store-section-title">
              <Trans>Get this book</Trans>
            </div>
            {isLoading ? (
              <div className="book-store-spinner is-mini"></div>
            ) : (
              <div className="book-store-matches">
                {sortedMatches.map((m) => renderMatch(m, queries))}
              </div>
            )}
            {error && <div className="book-store-tip is-compact">{error}</div>}
            {detail?.summary && (
              <>
                <div className="book-store-section-title">
                  <Trans>Introduction</Trans>
                </div>
                <div className="book-store-detail-summary">
                  {isTranslating
                    ? // 逐段双语对照，译文在原文下方
                      summaryParagraphs.map((html, i) => {
                        const translated = getTrans(getHtmlText(html));
                        return (
                          <div key={i} className="book-store-summary-para">
                            <div>{Parser(html)}</div>
                            {translated && (
                              <div className="book-store-summary-trans">
                                {translated}
                              </div>
                            )}
                          </div>
                        );
                      })
                    : Parser(
                        // 去掉链接，避免点击相对地址导致主窗口跳转
                        DOMPurify.sanitize(detail.summary, {
                          FORBID_TAGS: ["a", "img", "style"],
                        })
                      )}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    );
  };

  const { isLoading, isLoadingMore, error, categoryIndex, searchQuery } =
    state;
  const books = wishlistOnly ? wantedBooks : state.books.map((book) => ({ ...book, sourceId }));

  return (
    <div className="book-store-container">
      <div className="book-store-toolbar">
        {wishlistOnly ? <>
          <Link className="book-store-back" to="/manager/home">{t("Shelf")}</Link>
          <span>/</span>
          <span className="book-store-title">{t("Want to read")} ({books.length})</span>
        </> : <>
        {modeSwitch}
        <select
          className="book-store-source-select"
          value={sourceId}
          onChange={(e) => switchSource(e.target.value as StoreSourceId)}
        >
          {(Object.keys(STORE_SOURCES) as StoreSourceId[]).map((id) => (
            <option key={id} value={id}>
              {t(STORE_SOURCES[id].name)}
            </option>
          ))}
        </select>
        <div className="book-store-tabs">
          {source.categories.map((c, i) => (
            <span
              key={c.url}
              className={
                "book-store-tab" + (categoryIndex === i ? " is-active" : "")
              }
              onClick={() => loadCategory(i)}
            >
              <Trans>{c.title}</Trans>
            </span>
          ))}
        </div>
        {source.isForeign && (
          <span
            className={
              "paper-store-trans-toggle" + (isBilingual ? " is-active" : "")
            }
            title={transError ? t("Translation failed") : ""}
            onClick={toggleBilingual}
          >
            {isTransPending && <span className="book-store-trans-spinner" />}
            <Trans>Bilingual</Trans>
            {transError && (
              <span className="book-store-trans-error">
                {" · "}
                {t("Translation failed")}
              </span>
            )}
          </span>
        )}
        {source.isForeign && isBilingual && !isTransPending && (
          <span
            className="book-store-retranslate"
            title={t("Translate again from scratch")}
            onClick={retranslate}
          >
            {t("Retranslate")}
          </span>
        )}
        <div className="book-store-search">
          <input
            type="text"
            className="book-store-search-input"
            placeholder={t("Search books in store")}
            value={searchQuery}
            onChange={(e) => mergeState({ searchQuery: e.target.value })}
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
          />
          <span
            className="icon-search book-store-search-icon"
            onClick={handleSearch}
          ></span>
        </div>
        </>}
      </div>

      <div
        className="book-store-content"
        onScroll={(e) => handleScroll(e.currentTarget)}
      >
        {isLoading && <div className="book-store-spinner"></div>}
        {!isLoading && error && (
          <div className="book-store-tip">
            <div>
              <Trans>Failed to load catalog</Trans>: {error}
            </div>
            <span
              className="book-store-retry"
              onClick={() =>
                categoryIndex >= 0 ? loadCategory(categoryIndex) : handleSearch()
              }
            >
              <Trans>Retry</Trans>
            </span>
          </div>
        )}
        {!isLoading && !error && books.length === 0 && (
          <div className="book-store-tip">
            <Trans>Empty</Trans>
          </div>
        )}
        {!isLoading && !error && books.length > 0 && (
          <div className="book-store-grid">
            {books.map((book) => (
              <div
                key={book.sourceId + ":" + book.id}
                className="book-store-card"
                onClick={() => openDetail(book, book.sourceId)}
              >
                <div className="book-store-cover">
                  <StoreCover src={book.coverUrl} title={book.title} />
                </div>
                <div className="book-store-card-title" title={book.title}>
                  {book.title}
                </div>
                {getTrans(book.title) && (
                  <div
                    className="book-store-card-trans"
                    title={getTrans(book.title)}
                  >
                    {getTrans(book.title)}
                  </div>
                )}
                <div className="book-store-card-author" title={book.abstract}>
                  {book.abstract}
                </div>
                <div className="book-store-card-rating">
                  {book.rating !== null ? (
                    <>
                      <RatingStars
                        rating={book.rating}
                        max={STORE_SOURCES[book.sourceId].ratingMax}
                      />
                      <span className="book-store-rating-value">
                        {book.rating.toFixed(1)}
                      </span>
                    </>
                  ) : (
                    <span className="book-store-rating is-empty">
                      {t("Not enough ratings")}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
        {isLoadingMore && <div className="book-store-spinner is-mini"></div>}
      </div>
      {renderDetail()}
    </div>
  );
};

type StoreMode = "books" | "papers";

export const WantToReadShelf = () => <BookView wishlistOnly />;

const BookStore = () => {
  const [mode, setMode] = useState<StoreMode>("books");
  const modeSwitch = (
    <div className="book-store-mode-switch">
      {(["books", "papers"] as StoreMode[]).map((m) => (
        <span
          key={m}
          className={"book-store-mode" + (mode === m ? " is-active" : "")}
          onClick={() => setMode(m)}
        >
          <Trans>{m === "books" ? "Store books" : "Papers"}</Trans>
        </span>
      ))}
    </div>
  );
  // 两个视图各自维护列表状态，切换时卸载即可，不必常驻
  return mode === "books" ? (
    <BookView modeSwitch={modeSwitch} />
  ) : (
    <PaperStore modeSwitch={modeSwitch} />
  );
};

export default BookStore;
