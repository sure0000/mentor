import { useTranslation, Trans } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { useEffect, useMemo, useRef, useState } from "react";
import toast from "react-hot-toast";
import Parser from "html-react-parser";
import DOMPurify from "dompurify";
import "./bookStore.css";
import { bookSourceList } from "../../constants/bookSourceList";
import type { BookSource } from "../../constants/bookSourceList";
import { useAppStore } from "../../store/useAppStore";
import { useLatest } from "../../utils/hooks/useLatest";
import { calculateFileMD5, throttle } from "../../utils/common";
import BookUtil from "../../utils/file/bookUtil";
import CoverUtil from "../../utils/file/coverUtil";
import DatabaseService from "../../utils/storage/databaseService";
import BookModel from "../../models/Book";
import {
  DOWNLOAD_TYPES,
  downloadOPDSFile,
  fetchOPDSFeed,
} from "../../utils/request/opds";
import type { OPDSLink } from "../../utils/request/opds";
import {
  buildSearchUrl,
  getNextPageUrl,
  toStoreBook,
  toStoreBookDetail,
} from "../../utils/request/bookStore";
import type { StoreBook, StoreBookDetail } from "../../utils/request/bookStore";

interface BookStoreState {
  sourceId: string;
  // 分类下标；-1 表示当前为搜索结果
  categoryIndex: number;
  searchQuery: string;
  books: StoreBook[];
  nextUrl: string;
  isLoading: boolean;
  isLoadingMore: boolean;
  error: string;
}

interface DetailState {
  book: StoreBook;
  detail: StoreBookDetail | null;
  isLoading: boolean;
  error: string;
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

const BookStore = () => {
  const importBookFunc = useAppStore((s) => s.book.importBookFunc);
  const handleFetchBooks = useAppStore((s) => s.handleFetchBooks);
  const handleRefreshBookCover = useAppStore((s) => s.handleRefreshBookCover);
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [state, setState] = useState<BookStoreState>({
    sourceId: bookSourceList[0].id,
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

  const source: BookSource =
    bookSourceList.find((s) => s.id === state.sourceId) || bookSourceList[0];

  const mergeState = (patch: Partial<BookStoreState>) =>
    setState((prev) => ({ ...prev, ...patch }));

  const loadFeed = async (
    url: string,
    patch: Partial<BookStoreState>,
    feedSource: BookSource
  ) => {
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
      const feed = await fetchOPDSFeed(url);
      if (requestId !== requestIdRef.current) return;
      mergeState({
        books: feed.entries
          .map((e) => toStoreBook(e, feedSource))
          .filter((b): b is StoreBook => !!b),
        nextUrl: getNextPageUrl(feed),
        isLoading: false,
      });
    } catch (err) {
      if (requestId !== requestIdRef.current) return;
      const msg = err instanceof Error ? err.message : String(err);
      mergeState({ isLoading: false, error: msg });
    }
  };

  const loadCategory = (feedSource: BookSource, categoryIndex: number) => {
    const category = feedSource.categories[categoryIndex];
    if (!category) return;
    loadFeed(
      category.url,
      { sourceId: feedSource.id, categoryIndex, searchQuery: "" },
      feedSource
    );
  };

  const handleSearch = () => {
    const query = stateRef.current.searchQuery.trim();
    if (!query) return;
    loadFeed(
      buildSearchUrl(source, query),
      { categoryIndex: -1 },
      source
    );
  };

  const loadMore = async () => {
    const { nextUrl, isLoading, isLoadingMore } = stateRef.current;
    if (!nextUrl || isLoading || isLoadingMore) return;
    const requestId = requestIdRef.current;
    mergeState({ isLoadingMore: true });
    try {
      const feed = await fetchOPDSFeed(nextUrl);
      if (requestId !== requestIdRef.current) return;
      const more = feed.entries
        .map((e) => toStoreBook(e, source))
        .filter((b): b is StoreBook => !!b);
      setState((prev) => {
        const seen = new Set(prev.books.map((b) => b.id));
        return {
          ...prev,
          books: prev.books.concat(more.filter((b) => !seen.has(b.id))),
          nextUrl: getNextPageUrl(feed),
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

  const openDetail = async (book: StoreBook) => {
    if (book.entry) {
      setDetailState({
        book,
        detail: toStoreBookDetail([book.entry], book),
        isLoading: false,
        error: "",
        downloadingHref: "",
      });
      return;
    }
    setDetailState({
      book,
      detail: null,
      isLoading: true,
      error: "",
      downloadingHref: "",
    });
    try {
      const feed = await fetchOPDSFeed(book.detailUrl);
      const detail = toStoreBookDetail(feed.entries, book);
      setDetailState((prev) =>
        prev && prev.book.id === book.id
          ? { ...prev, detail, isLoading: false }
          : prev
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setDetailState((prev) =>
        prev && prev.book.id === book.id
          ? { ...prev, isLoading: false, error: msg }
          : prev
      );
    }
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

  const handleDownload = async (link: OPDSLink) => {
    if (!detailState?.detail || detailState.downloadingHref) return;
    const title = detailState.detail.title;
    setDetailState((prev) =>
      prev ? { ...prev, downloadingHref: link.href } : prev
    );
    toast.loading(t("Downloading") + ": " + title, {
      id: "book-store-download",
    });
    try {
      const file = await downloadOPDSFile(title, link);
      toast.dismiss("book-store-download");
      await importBookFunc(file);
      await applyStoreCover(
        file,
        detailState.detail.coverUrl || detailState.book.coverUrl
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(t("Import failed") + ": " + msg, {
        id: "book-store-download",
      });
    } finally {
      setDetailState((prev) => (prev ? { ...prev, downloadingHref: "" } : prev));
    }
  };

  useEffect(() => {
    loadCategory(source, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const renderDetail = () => {
    if (!detailState) return null;
    const { book, detail, isLoading, error, downloadingHref } = detailState;
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
              <div className="book-store-detail-author">
                {detail?.authors.join(", ") || book.author}
              </div>
              {detail?.language && (
                <div className="book-store-detail-sub">
                  <Trans>Language</Trans>: {detail.language}
                </div>
              )}
              <div className="book-store-detail-sub">
                <Trans>Source</Trans>: {source.name}
              </div>
              <div className="book-store-detail-actions">
                {detail?.downloadLinks.map((link) => (
                  <span
                    key={link.href}
                    className={
                      "book-store-download-button" +
                      (downloadingHref === link.href ? " is-loading" : "")
                    }
                    title={link.title || ""}
                    onClick={() => handleDownload(link)}
                  >
                    <Trans>Add to bookshelf</Trans>
                    {" · "}
                    {link.title ||
                      (DOWNLOAD_TYPES[link.type] || "").toUpperCase()}
                  </span>
                ))}
              </div>
            </div>
          </div>
          <div className="book-store-detail-body">
            {isLoading && <div className="book-store-spinner"></div>}
            {error && <div className="book-store-tip">{error}</div>}
            {detail && !isLoading && detail.downloadLinks.length === 0 && (
              <div className="book-store-tip">
                <Trans>No downloadable format</Trans>
              </div>
            )}
            {detail?.categories.length ? (
              <div className="book-store-detail-tags">
                {detail.categories.slice(0, 8).map((c) => (
                  <span key={c} className="book-store-detail-tag">
                    {c}
                  </span>
                ))}
              </div>
            ) : null}
            {detail?.summary && (
              <div className="book-store-detail-summary">
                {Parser(
                  // 去掉链接，避免点击相对地址导致主窗口跳转
                  DOMPurify.sanitize(detail.summary, {
                    FORBID_TAGS: ["a", "img"],
                  })
                )}
              </div>
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
        <span
          className="book-store-back"
          onClick={() => navigate("/manager/home")}
        >
          <span className="icon-dropdown book-store-back-icon"></span>
          <Trans>Back to bookshelf</Trans>
        </span>
        <span className="book-store-title">
          <Trans>Open Source Book Store</Trans>
        </span>
        <select
          className="book-store-source-select"
          value={source.id}
          onChange={(e) => {
            const next = bookSourceList.find((s) => s.id === e.target.value);
            if (next) loadCategory(next, 0);
          }}
        >
          {bookSourceList.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
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
              onClick={() => loadCategory(source, i)}
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
                categoryIndex >= 0
                  ? loadCategory(source, categoryIndex)
                  : handleSearch()
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
                <div className="book-store-card-author" title={book.author}>
                  {book.author}
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

export default BookStore;
