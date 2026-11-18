import { useTranslation, Trans } from "react-i18next";
import { ReactNode, useEffect, useMemo, useRef, useState } from "react";
import toast from "react-hot-toast";
import { useAppStore } from "../../store/useAppStore";
import { useLatest } from "../../utils/hooks/useLatest";
import { openInBrowser, throttle } from "../../utils/common";
import {
  buildArxivKeywordUrl,
  buildArxivSearchUrl,
  buildEuropePmcSearchUrl,
  fetchCitationCounts,
  fetchPaperPage,
  paperCategories,
  paperFileName,
} from "../../utils/request/papers";
import type { Paper, PaperSourceId } from "../../utils/request/papers";

interface PaperStoreState {
  // 分类下标；-1 表示当前为搜索结果
  categoryIndex: number;
  searchSource: PaperSourceId;
  searchQuery: string;
  papers: Paper[];
  nextUrl: string;
  isLoading: boolean;
  isLoadingMore: boolean;
  error: string;
}

interface Props {
  // 书籍/论文切换控件，由外层书城传入，放在工具栏里
  modeSwitch: ReactNode;
  onBack: () => void;
}

const SOURCE_NAMES: Record<PaperSourceId, string> = {
  arxiv: "arXiv",
  europepmc: "Europe PMC",
};

const formatCount = (count: number) =>
  count >= 10000 ? (count / 1000).toFixed(0) + "k" : String(count);

// PDF 文件以 %PDF 开头；出版社或 Cloudflare 拦截时会返回 HTML 页面
const isPdf = (buffer: ArrayBuffer) =>
  new TextDecoder().decode(buffer.slice(0, 5)).startsWith("%PDF");

const PaperStore = ({ modeSwitch, onBack }: Props) => {
  const importBookFunc = useAppStore((s) => s.book.importBookFunc);
  const { t } = useTranslation();
  const [state, setState] = useState<PaperStoreState>({
    categoryIndex: 0,
    searchSource: "arxiv",
    searchQuery: "",
    papers: [],
    nextUrl: "",
    isLoading: false,
    isLoadingMore: false,
    error: "",
  });
  const [expandedId, setExpandedId] = useState("");
  const [downloadingId, setDownloadingId] = useState("");
  const stateRef = useLatest(state);
  const requestIdRef = useRef(0);

  const mergeState = (patch: Partial<PaperStoreState>) =>
    setState((prev) => ({ ...prev, ...patch }));

  const currentSource = (): PaperSourceId => {
    const { categoryIndex, searchSource } = stateRef.current;
    return categoryIndex >= 0
      ? paperCategories[categoryIndex].source
      : searchSource;
  };

  // arXiv 没有引用数据，补查 OpenAlex；Europe PMC 自带被引次数
  const fillCitations = async (papers: Paper[], requestId: number) => {
    const missing = papers.filter((p) => p.citations === null && p.doi);
    if (missing.length === 0) return;
    const counts = await fetchCitationCounts(missing.map((p) => p.doi));
    if (requestId !== requestIdRef.current || counts.size === 0) return;
    setState((prev) => ({
      ...prev,
      papers: prev.papers.map((p) =>
        p.citations === null && counts.has(p.doi)
          ? { ...p, citations: counts.get(p.doi)! }
          : p
      ),
    }));
  };

  const loadPage = async (
    source: PaperSourceId,
    url: string,
    patch: Partial<PaperStoreState>,
    // 第一个地址没有结果时依次尝试的备用地址（arXiv 标题短语 → 关键词）
    fallbackUrls: string[] = []
  ) => {
    const requestId = ++requestIdRef.current;
    setExpandedId("");
    mergeState({
      ...patch,
      papers: [],
      nextUrl: "",
      isLoading: true,
      isLoadingMore: false,
      error: "",
    });
    try {
      let page = await fetchPaperPage(source, url);
      for (const fallback of fallbackUrls) {
        if (page.papers.length > 0 || requestId !== requestIdRef.current) break;
        page = await fetchPaperPage(source, fallback);
      }
      if (requestId !== requestIdRef.current) return;
      mergeState({
        papers: page.papers,
        nextUrl: page.nextUrl,
        isLoading: false,
      });
      fillCitations(page.papers, requestId);
    } catch (err) {
      if (requestId !== requestIdRef.current) return;
      const msg = err instanceof Error ? err.message : String(err);
      mergeState({ isLoading: false, error: msg });
    }
  };

  const loadCategory = (categoryIndex: number) => {
    const category = paperCategories[categoryIndex];
    if (!category) return;
    loadPage(category.source, category.url, { categoryIndex, searchQuery: "" });
  };

  const handleSearch = () => {
    const { searchQuery, searchSource } = stateRef.current;
    const query = searchQuery.trim();
    if (!query) return;
    if (searchSource === "arxiv") {
      const keywordUrl = buildArxivKeywordUrl(query);
      const phraseUrl = buildArxivSearchUrl(query);
      loadPage(
        "arxiv",
        phraseUrl,
        { categoryIndex: -1 },
        keywordUrl !== phraseUrl ? [keywordUrl] : []
      );
    } else {
      loadPage("europepmc", buildEuropePmcSearchUrl(query), {
        categoryIndex: -1,
      });
    }
  };

  const loadMore = async () => {
    const { nextUrl, isLoading, isLoadingMore } = stateRef.current;
    if (!nextUrl || isLoading || isLoadingMore) return;
    const requestId = requestIdRef.current;
    mergeState({ isLoadingMore: true });
    try {
      const page = await fetchPaperPage(currentSource(), nextUrl);
      if (requestId !== requestIdRef.current) return;
      setState((prev) => {
        const seen = new Set(prev.papers.map((p) => p.id));
        return {
          ...prev,
          papers: prev.papers.concat(page.papers.filter((p) => !seen.has(p.id))),
          nextUrl: page.nextUrl,
          isLoadingMore: false,
        };
      });
      fillCitations(page.papers, requestId);
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

  // 能下载就直接加入书架；下载被拦截（非 PDF）时打开论文页面让用户自行下载
  const handleDownload = async (paper: Paper) => {
    if (downloadingId) return;
    if (!paper.pdfUrl) {
      openInBrowser(paper.landingUrl);
      return;
    }
    setDownloadingId(paper.id);
    toast.loading(t("Downloading") + ": " + paper.title, {
      id: "paper-download",
    });
    try {
      const response = await fetch(paper.pdfUrl);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const buffer = await response.arrayBuffer();
      if (!isPdf(buffer)) throw new Error("not-pdf");
      toast.dismiss("paper-download");
      await importBookFunc(
        new File([buffer], paperFileName(paper) + ".pdf", {
          type: "application/pdf",
        })
      );
    } catch (err) {
      console.error("download paper failed", err);
      toast.error(t("Unable to download directly, opening the paper page"), {
        id: "paper-download",
      });
      openInBrowser(paper.landingUrl);
    } finally {
      setDownloadingId("");
    }
  };

  useEffect(() => {
    loadCategory(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { papers, isLoading, isLoadingMore, error, categoryIndex, searchQuery } =
    state;

  const renderPaper = (paper: Paper) => {
    const isExpanded = expandedId === paper.id;
    const authors =
      paper.authors.length > 4
        ? paper.authors.slice(0, 4).join(", ") + " " + t("et al.")
        : paper.authors.join(", ");
    return (
      <div key={paper.id} className="paper-store-item">
        <div
          className="paper-store-title"
          onClick={() => setExpandedId(isExpanded ? "" : paper.id)}
        >
          {paper.title}
        </div>
        <div className="paper-store-meta">
          {authors && <span>{authors}</span>}
          {paper.venue && <span>{paper.venue}</span>}
          {paper.published && <span>{paper.published}</span>}
          {paper.citations !== null && (
            <span className="paper-store-citations">
              {t("Cited by {{num}}", { num: formatCount(paper.citations) })}
            </span>
          )}
        </div>
        {paper.summary && (
          <div
            className={
              "paper-store-summary" + (isExpanded ? " is-expanded" : "")
            }
            onClick={() => setExpandedId(isExpanded ? "" : paper.id)}
          >
            {paper.summary}
          </div>
        )}
        <div className="paper-store-actions">
          <span
            className={
              "book-store-download-button" +
              (downloadingId === paper.id ? " is-loading" : "")
            }
            onClick={() => handleDownload(paper)}
          >
            {paper.pdfUrl ? (
              <Trans>Add PDF to bookshelf</Trans>
            ) : (
              <Trans>Find on website</Trans>
            )}
          </span>
          <span
            className="book-store-link-button"
            onClick={() => openInBrowser(paper.landingUrl)}
          >
            {t("View on {{name}}", { name: SOURCE_NAMES[paper.source] })}
          </span>
        </div>
      </div>
    );
  };

  return (
    <div className="book-store-container">
      <div className="book-store-toolbar">
        <span className="book-store-back" onClick={onBack}>
          <span className="icon-dropdown book-store-back-icon"></span>
          <Trans>Back to bookshelf</Trans>
        </span>
        {modeSwitch}
        <div className="book-store-tabs">
          {paperCategories.map((c, i) => (
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
          <select
            className="paper-store-search-source"
            value={state.searchSource}
            onChange={(e) =>
              mergeState({ searchSource: e.target.value as PaperSourceId })
            }
          >
            {(Object.keys(SOURCE_NAMES) as PaperSourceId[]).map((id) => (
              <option key={id} value={id}>
                {SOURCE_NAMES[id]}
              </option>
            ))}
          </select>
          <input
            type="text"
            className="book-store-search-input"
            placeholder={t("Search papers")}
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
        {!isLoading && !error && papers.length === 0 && (
          <div className="book-store-tip">
            <Trans>Empty</Trans>
          </div>
        )}
        {!isLoading && !error && papers.length > 0 && (
          <div className="paper-store-list">{papers.map(renderPaper)}</div>
        )}
        {isLoadingMore && <div className="book-store-spinner is-mini"></div>}
      </div>
    </div>
  );
};

export default PaperStore;
