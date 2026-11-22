import { useTranslation, Trans } from "react-i18next";
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
import type { DoubanBook, DoubanDetail } from "../../utils/request/douban";

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

// 豆瓣式五星：10 分制换算成 0~5 颗星，按半星取整
const RatingStars = ({ rating }: { rating: number }) => {
  const percent = Math.round(rating) * 10;
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
}: {
  rating: number | null;
  votes: number;
}) => {
  const { t } = useTranslation();
  if (rating === null) {
    return (
      <div className="book-store-rating is-empty">{t("Not enough ratings")}</div>
    );
  }
  return (
    <div className="book-store-rating">
      <RatingStars rating={rating} />
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
  const candidates = [detail.originalTitle, detail.title || book.title];
  return Array.from(
    new Set(candidates.map((c) => c.trim()).filter(Boolean))
  );
};

interface BookViewProps {
  modeSwitch: ReactNode;
}

const BookView = ({ modeSwitch }: BookViewProps) => {
  const importBookFunc = useAppStore((s) => s.book.importBookFunc);
  const handleFetchBooks = useAppStore((s) => s.handleFetchBooks);
  const handleRefreshBookCover = useAppStore((s) => s.handleRefreshBookCover);
  const { t } = useTranslation();
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
      const list = await fetchDoubanList(url);
      if (requestId !== requestIdRef.current) return;
      mergeState({ books: list.books, nextUrl: list.nextUrl, isLoading: false });
    } catch (err) {
      if (requestId !== requestIdRef.current) return;
      const msg = err instanceof Error ? err.message : String(err);
      mergeState({ isLoading: false, error: msg });
    }
  };

  const loadCategory = (categoryIndex: number) => {
    const category = doubanCategories[categoryIndex];
    if (!category) return;
    loadList(category.url, { categoryIndex, searchQuery: "" });
  };

  const handleSearch = () => {
    const query = stateRef.current.searchQuery.trim();
    if (!query) return;
    loadList(buildDoubanSearchUrl(query), { categoryIndex: -1 });
  };

  const loadMore = async () => {
    const { nextUrl, isLoading, isLoadingMore } = stateRef.current;
    if (!nextUrl || isLoading || isLoadingMore) return;
    const requestId = requestIdRef.current;
    mergeState({ isLoadingMore: true });
    try {
      const list = await fetchDoubanList(nextUrl);
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
      prev && prev.book.id === bookId ? { ...prev, ...patch(prev) } : prev
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
        links: null,
      }));
      patchMatch(bookId, source.id, { status: "found", editions });
      // 列表条目可能只有详情 feed 地址，逐个补齐下载链接
      await Promise.all(
        found.map(async (book, index) => {
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

  const openDetail = async (book: DoubanBook) => {
    setDetailState({
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
      detail = await fetchDoubanDetail(book);
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
      patchDetail(book.id, () => ({ error: msg }));
    }
    patchDetail(book.id, () => ({ detail, isLoading: false }));
    const queries = getSearchQueries(book, detail);
    bookSourceList.forEach((source) => searchSource(book.id, source, queries));
  };

  // 引擎没能从文件里解析出封面时（部分 EPUB 只用 <meta name="cover"> 声明），
  // 用书城展示的封面补上，逻辑与编辑对话框更换封面一致
  const applyStoreCover = async (file: File, coverUrl: string) => {
    if (!coverUrl) return;
    try {
      const md5 = await calculateFileMD5(file);
      if (!md5) return;
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
    const bookId = detailState.book.id;
    const title = edition.title;
    patchDetail(bookId, () => ({ downloadingHref: link.href }));
    toast.loading(t("Downloading") + ": " + title, {
      id: "book-store-download",
    });
    try {
      const file = await downloadOPDSFile(title, link);
      toast.dismiss("book-store-download");
      await importBookFunc(file);
      // 书源封面与文件内容对应；没有时再用豆瓣封面
      await applyStoreCover(
        file,
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

  useEffect(() => {
    loadCategory(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const renderEdition = (edition: SourceEdition) => {
    const { book, links } = edition;
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
          {links?.map((link) => (
            <span
              key={link.href}
              className={
                "book-store-download-button" +
                (downloadingHref === link.href ? " is-loading" : "")
              }
              title={link.title || ""}
              onClick={() => handleDownload(book, link)}
            >
              <Trans>Add to bookshelf</Trans>
              {" · "}
              {(DOWNLOAD_TYPES[link.type] || "").toUpperCase() || link.title}
            </span>
          ))}
          {links?.length === 0 && (
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
    const hasDownload = editions.some((e) => e.links && e.links.length > 0);
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
          {status !== "searching" && !hasDownload && (
            <span
              className="book-store-link-button"
              onClick={() => openInBrowser(webUrl)}
            >
              <Trans>Find on website</Trans>
            </span>
          )}
        </div>
        {editions.map(renderEdition)}
      </div>
    );
  };

  const renderDetail = () => {
    if (!detailState) return null;
    const { book, detail, isLoading, error, matches } = detailState;
    const queries = detail ? getSearchQueries(book, detail) : [book.title];
    const rating = detail?.rating ?? book.rating;
    const votes = detail?.votes || book.votes;
    // 有下载的书源排在前面
    const sortedMatches = [...matches].sort((a, b) => {
      const score = (m: SourceMatch) =>
        m.editions.some((e) => e.links && e.links.length > 0)
          ? 0
          : m.status === "searching"
            ? 1
            : 2;
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
              <RatingLine rating={rating} votes={votes} />
              <span
                className="book-store-link-button is-plain"
                onClick={() => openInBrowser(book.url)}
              >
                <Trans>View on Douban</Trans>
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
                  {Parser(
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

  const { books, isLoading, isLoadingMore, error, categoryIndex, searchQuery } =
    state;

  return (
    <div className="book-store-container">
      <div className="book-store-toolbar">
        {modeSwitch}
        <div className="book-store-tabs">
          {doubanCategories.map((c, i) => (
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
                key={book.id}
                className="book-store-card"
                onClick={() => openDetail(book)}
              >
                <div className="book-store-cover">
                  <StoreCover src={book.coverUrl} title={book.title} />
                </div>
                <div className="book-store-card-title" title={book.title}>
                  {book.title}
                </div>
                <div className="book-store-card-author" title={book.abstract}>
                  {book.abstract}
                </div>
                <div className="book-store-card-rating">
                  {book.rating !== null ? (
                    <>
                      <RatingStars rating={book.rating} />
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
