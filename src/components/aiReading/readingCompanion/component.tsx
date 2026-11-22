import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import toast from "react-hot-toast";
import { useAppStore } from "../../../store/useAppStore";
import { vexComfirmAsync } from "../../../utils/common";
import {
  IndexCancelledError,
  IndexProgress,
  cancelIndexing,
  clearBookAiCache,
  getBookIndex,
  isIndexing,
  loadCachedIndex,
} from "../../../utils/aiReading/bookIndex";
import { BookIndex, isExtractableBook } from "../../../utils/aiReading/indexText";
import {
  getCurrentDocIndex,
  onReaderPositionChange,
} from "../../../utils/aiReading/readerAdapter";
import { hasAiBackend } from "../../../utils/aiReading/chapterPointsService";
import {
  FocusRequest,
  MarksJobState,
  MarksRenderScope,
  chapterParagraphs,
  estimateBookMarks,
  getMarksRenderScope,
  loadChapterMarks,
  markableChapters,
  pauseMarksJob,
  setMarksRenderScope,
  startMarksJob,
  subscribeFocusSegment,
  subscribeMarksChanged,
  subscribeMarksJob,
  takePendingFocus,
} from "../../../utils/aiReading/readingMarksService";
import {
  GuideJobState,
  loadBookGuide,
  subscribeGuideJob,
} from "../../../utils/aiReading/bookGuideService";
import {
  subscribeOpenChapter,
  takePendingChapter,
} from "../../../utils/aiReading/guideNav";
import ChapterCompanion, { LevelBar, errorText } from "../chapterCompanion/component";
import BookOverview from "../bookOverview";
import "../bookGuide/bookGuide.css";
import "../bookOverview/bookOverview.css";
import "../chapterPoints/chapterPoints.css";
import "./readingCompanion.css";

const SCOPES: { key: MarksRenderScope; label: string }[] = [
  { key: "chapter", label: "By chapter" },
  { key: "book", label: "Whole book" },
  { key: "off", label: "Off" },
];

const INDEX_ERROR_KEYS: Record<string, string> = {
  "unsupported-format": "This format does not support full-book text extraction",
  "book-file-missing": "Book file not found",
  "already-running": "Indexing is already running",
};

const formatChars = (n: number) => (n >= 10000 ? (n / 10000).toFixed(1) + "万" : String(n));

const usd = (n: number) => (n < 0 ? "$?" : `$${n.toFixed(n < 0.1 ? 3 : 2)}`);

/**
 * AI 伴读：全书索引、全书导读，以及阅读分级（略读 / 浅读 / 精读）+ 重点划线，
 * 按章节或全书渲染到书页
 */
const ReadingCompanion = () => {
  const { t } = useTranslation();
  const currentBook = useAppStore((s) => s.book.currentBook);
  const htmlBook = useAppStore((s) => s.reader.htmlBook);
  const [index, setIndex] = useState<BookIndex | null>(null);
  const [progress, setProgress] = useState<IndexProgress | null>(null);
  const [indexError, setIndexError] = useState("");
  const [scope, setScope] = useState<MarksRenderScope>(getMarksRenderScope);
  const [currentDocIndex, setCurrentDocIndex] = useState(-1);
  const [focus, setFocus] = useState<FocusRequest | null>(() => takePendingFocus());
  const [openDocIndex, setOpenDocIndex] = useState<number | null>(() => {
    const chapter = takePendingChapter();
    return focus?.docIndex ?? chapter;
  });
  const [isOverviewOpen, setIsOverviewOpen] = useState(false);
  const [jobState, setJobState] = useState<MarksJobState | null>(null);
  const [guideJob, setGuideJob] = useState<GuideJobState | null>(null);
  const [version, setVersion] = useState(0);
  const mounted = useRef(true);

  const buildIndex = (force = false) => {
    if (!currentBook?.key) return;
    setIndexError("");
    setProgress(null);
    // 提取不调用 AI、不花钱
    getBookIndex(currentBook, (p) => mounted.current && setProgress(p), { force })
      .then((r) => mounted.current && setIndex(r))
      .catch((e) => {
        if (!mounted.current || e instanceof IndexCancelledError) return;
        const message = e instanceof Error ? e.message : String(e);
        setIndexError(INDEX_ERROR_KEYS[message] ? t(INDEX_ERROR_KEYS[message]) : message);
      });
  };

  useEffect(() => {
    mounted.current = true;
    setIndex(null);
    setIndexError("");
    if (currentBook?.key && isExtractableBook(currentBook)) {
      const cached = loadCachedIndex(currentBook);
      if (cached) {
        setIndex(cached);
      } else if (!isIndexing(currentBook.key)) {
        buildIndex();
      }
    }
    return () => {
      mounted.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentBook?.key]);

  // 外部请求打开某一章（读完一章的提示）
  useEffect(
    () =>
      subscribeOpenChapter((docIndex) => {
        takePendingChapter();
        setFocus(null);
        setIsOverviewOpen(false);
        setOpenDocIndex(docIndex);
      }),
    []
  );

  // 全书导读后台任务的进度（关闭面板不会中断任务）
  useEffect(
    () => subscribeGuideJob((s) => setGuideJob(s && s.bookKey === currentBook?.key ? s : null)),
    [currentBook?.key]
  );

  useEffect(() => {
    const rendition = htmlBook?.rendition;
    if (!rendition) return;
    const update = () => {
      const next = getCurrentDocIndex(rendition);
      setCurrentDocIndex((prev) => (prev === next ? prev : next));
    };
    update();
    return onReaderPositionChange(rendition, update);
  }, [htmlBook]);

  useEffect(
    () =>
      subscribeFocusSegment((req) => {
        takePendingFocus();
        setFocus(req);
        setIsOverviewOpen(false);
        setOpenDocIndex(req.docIndex);
      }),
    []
  );

  useEffect(
    () => subscribeMarksJob((s) => setJobState(s && s.bookKey === currentBook?.key ? s : null)),
    [currentBook?.key]
  );

  // 章节伴读生成后刷新列表
  useEffect(
    () =>
      subscribeMarksChanged((key) => {
        if (key === currentBook?.key) setVersion((v) => v + 1);
      }),
    [currentBook?.key]
  );

  if (!currentBook?.key) return null;
  if (!isExtractableBook(currentBook)) {
    return (
      <div className="ai-guide-container">
        <div className="ai-guide-hint">{t("This format does not support full-book text extraction")}</div>
      </div>
    );
  }
  if (!index) {
    return (
      <div className="ai-guide-container">
        <div className="ai-guide-header">
          {indexError ? (
            <span className="ai-guide-error">{indexError}</span>
          ) : (
            <>
              <span className="icon-loading ai-guide-spin"></span>
              <span>
                {t("Indexing the whole book")}
                {progress ? ` ${progress.done}/${progress.total}` : "…"}
              </span>
              <span className="ai-guide-link" onClick={cancelIndexing}>
                {t("Cancel")}
              </span>
            </>
          )}
          {indexError && (
            <span className="ai-guide-link" onClick={() => buildIndex(true)}>
              {t("Retry")}
            </span>
          )}
        </div>
      </div>
    );
  }

  const handleScope = (s: MarksRenderScope) => {
    setScope(s);
    setMarksRenderScope(s);
  };

  const scopeBar = (
    <div className="ai-rc-scope">
      <span className="ai-guide-hint">{t("Show on page")}</span>
      {SCOPES.map((s) => (
        <span
          key={s.key}
          className={"ai-rc-scope-item" + (scope === s.key ? " ai-rc-scope-active" : "")}
          onClick={() => handleScope(s.key)}
        >
          {t(s.label)}
        </span>
      ))}
    </div>
  );

  if (isOverviewOpen) {
    return (
      <div className="ai-guide-container">
        <BookOverview
          index={index}
          onBack={() => setIsOverviewOpen(false)}
          onOpenChapter={(docIndex) => {
            setIsOverviewOpen(false);
            setFocus(null);
            setOpenDocIndex(docIndex);
          }}
        />
      </div>
    );
  }

  const openChapter = openDocIndex !== null ? index.chapters.find((c) => c.docIndex === openDocIndex) : null;
  if (openChapter) {
    return (
      <div className="ai-guide-container">
        {scopeBar}
        <ChapterCompanion
          index={index}
          chapter={openChapter}
          focus={focus && focus.docIndex === openChapter.docIndex ? focus : null}
          onBack={() => {
            setFocus(null);
            setOpenDocIndex(null);
          }}
        />
      </div>
    );
  }

  const chapters = markableChapters(index);
  const isRunning = jobState?.phase === "running";

  const handleStartBook = async () => {
    if (!hasAiBackend()) {
      toast.error(t("AI_GUIDE_NO_SERVICE"));
      return;
    }
    const est = estimateBookMarks(index);
    if (est.chapters === 0) {
      toast.error(t("No chapter has enough text to analyze"));
      return;
    }
    const message =
      `<b>${t("Generate reading companion for the whole book")}</b><br/><br/>` +
      `${t("Chapters to analyze")}: ${est.chapters}` +
      (est.cached ? `（${t("already done")} ${est.cached}）` : "") +
      `<br/>${t("AI calls")}: ${est.calls}` +
      `<br/>${t("Characters to send")}: ${Math.round(est.chars / 1000)}k` +
      `<br/>${t("Estimated cost")}: $${est.costLow.toFixed(2)} – $${est.costHigh.toFixed(2)}` +
      `<br/><br/><span style="opacity:.7;font-size:13px">${t("AI_GUIDE_ESTIMATE_NOTE")}</span>`;
    if (!(await vexComfirmAsync(message, "Start", "Cancel"))) return;
    if (scope === "off") handleScope("book");
    startMarksJob(currentBook.name || "", index).catch((e) =>
      toast.error(e instanceof Error ? e.message : String(e))
    );
  };

  const handleClearCache = () => {
    clearBookAiCache(currentBook.key);
    setIndex(null);
    setOpenDocIndex(null);
    toast.success(t("AI cache of this book cleared"));
    buildIndex();
  };

  const hasGuide = !!loadBookGuide(index.bookKey);
  const isGuideRunning = guideJob?.phase === "chapters" || guideJob?.phase === "summary";
  const failed = index.chapters.filter((c) => c.error).length;

  const doneCount = chapters.filter((c) => loadChapterMarks(index.bookKey, c)).length;
  const current = chapters.find((c) => c.docIndex === currentDocIndex);

  return (
    <div className="ai-guide-container" data-version={version}>
      <div className="ai-guide-header">
        <span>
          {t("Indexed")}: {index.chapters.length} {t("sections")} · {formatChars(index.totalChars)} {t("characters")}
          {failed > 0 ? ` · ${failed} ${t("failed")}` : ""}
        </span>
        <span className="ai-guide-link" onClick={() => buildIndex(true)}>
          {t("Rebuild")}
        </span>
        <span className="ai-guide-link" onClick={handleClearCache}>
          {t("Clear AI cache of this book")}
        </span>
      </div>

      <div className="ai-guide-current" onClick={() => setIsOverviewOpen(true)}>
        <span>
          <b>{t("Book overview")}</b>
          {isGuideRunning && guideJob
            ? ` · ${t("Generating")} ${guideJob.done}/${guideJob.total}`
            : guideJob?.phase === "paused"
              ? ` · ${t("Paused")} ${guideJob.done}/${guideJob.total}`
              : ""}
        </span>
        <span className="ai-guide-link">{hasGuide ? t("View") : t("Generate")}</span>
      </div>

      {scopeBar}

      <div className="ai-overview-job ai-rc-job">
        {isRunning && <span className="icon-loading ai-guide-spin"></span>}
        <span>
          {jobState
            ? jobState.phase === "running"
              ? `${t("Reading chapters")} ${jobState.done}/${jobState.total}` +
                (jobState.currentTitle ? ` · ${jobState.currentTitle}` : "")
              : jobState.phase === "paused"
                ? `${t("Paused")} ${jobState.done}/${jobState.total}`
                : jobState.phase === "error"
                  ? errorText(t, jobState.error)
                  : t("Done")
            : `${t("Whole book")}: ${doneCount}/${chapters.length}`}
        </span>
        {jobState && <span className="ai-guide-hint">{t("Spent")} {usd(jobState.spentUsd)}</span>}
        {isRunning ? (
          <span className="ai-guide-link" onClick={pauseMarksJob}>
            {t("Pause")}
          </span>
        ) : doneCount < chapters.length ? (
          <span className="ai-guide-link" onClick={handleStartBook}>
            {jobState?.phase === "paused" || jobState?.phase === "error" || doneCount > 0
              ? t("Continue")
              : t("Generate for the whole book")}
          </span>
        ) : null}
      </div>

      {current && (
        <div className="ai-guide-current" onClick={() => setOpenDocIndex(current.docIndex)}>
          <span>
            {t("Reading now")}：<b>{current.title}</b>
          </span>
          <span className="ai-guide-link">
            {loadChapterMarks(index.bookKey, current) ? t("View") : t("Generate for this chapter")}
          </span>
        </div>
      )}

      <div className="ai-guide-list">
        {chapters.map((c) => {
          const marks = loadChapterMarks(index.bookKey, c);
          return (
            <div
              key={c.docIndex}
              className={"ai-guide-item" + (c.docIndex === currentDocIndex ? " ai-guide-item-current" : "")}
              onClick={() => setOpenDocIndex(c.docIndex)}
            >
              <span className="ai-guide-item-title">{c.title}</span>
              <span className="ai-guide-item-meta ai-rc-item-meta">
                {marks ? <LevelBar marks={marks} paragraphs={chapterParagraphs(c)} /> : t("Not generated")}
              </span>
            </div>
          );
        })}
      </div>
      <div className="ai-guide-footer">
        <span className="ai-guide-hint">{t("AI_COMPANION_LIST_HINT")}</span>
      </div>
    </div>
  );
};

export default ReadingCompanion;
