import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import toast from "react-hot-toast";
import Parser from "html-react-parser";
import DOMPurify from "dompurify";
import { marked } from "marked";
import { useAppStore } from "../../../store/useAppStore";
import { BookIndex, IndexChapter } from "../../../utils/aiReading/indexText";
import {
  ANNOTATION_KINDS,
  ActionResult,
  Annotation,
  COMPANION_ACTIONS,
  ChapterMarks,
  CompanionAction,
  annotationKey,
  countByKind,
} from "../../../utils/aiReading/readingMarks";
import {
  cancelChapterTask,
  chapterParagraphs,
  getChapterTask,
  loadChapterMarks,
  runCompanionAction,
  setFocusedDocIndex,
  startChapterTask,
  subscribeChapterTasks,
} from "../../../utils/aiReading/readingMarksService";
import {
  AiTaskError,
  RunningTask,
  AI_TASK_ERROR_KEYS,
  hasAiBackend,
} from "../../../utils/aiReading/chapterPointsService";
import { visibleWhileStreaming } from "../../../utils/aiReading/bookQa";
import { jumpToQuote } from "../../../utils/aiReading/readerAdapter";
import QaAnswer from "../qaAnswer";
import { ACTION_LABEL_KEYS, KIND_LABEL_KEYS } from "../readingCompanion/labels";
import "../bookGuide/bookGuide.css";
import "../chapterPoints/chapterPoints.css";
import "../readingCompanion/readingCompanion.css";

interface ChapterCompanionProps {
  index: BookIndex;
  chapter: IndexChapter;
  /** 从书页点击进入时要展开的标注（annotationKey）与功能 */
  focus?: { annotation: string; action?: CompanionAction } | null;
  onBack?: () => void;
}

const usage = (m: ChapterMarks) =>
  `${(m.durationMs / 1000).toFixed(1)}s · ` + (m.costUsd >= 0 ? `$${m.costUsd.toFixed(4)}` : "$?");

const renderMarkdown = (md: string) =>
  Parser(DOMPurify.sanitize(marked.parse(md) as string) || " ");

export const errorText = (t: (k: string) => string, e: unknown) => {
  if (e instanceof AiTaskError) {
    return t(AI_TASK_ERROR_KEYS[e.code]);
  }
  return e instanceof Error ? e.message : String(e);
};

/** 本章标注数量：核心观点 n · 术语 n */
export const KindCounts = ({ marks }: { marks: ChapterMarks }) => {
  const { t } = useTranslation();
  const counts = countByKind(marks.annotations);
  return (
    <span className="ai-rc-counts">
      {ANNOTATION_KINDS.map((k) => (
        <span key={k}>
          <span className={"ai-rc-dot ai-rc-dot-" + k}></span>
          {t(KIND_LABEL_KEYS[k])} {counts[k]}
        </span>
      ))}
    </span>
  );
};

/** AI 伴读：一章的术语 / 核心观点标注、注脚与核心观点的进一步功能 */
const ChapterCompanion = ({ index, chapter, focus, onBack }: ChapterCompanionProps) => {
  const { t } = useTranslation();
  const currentBook = useAppStore((s) => s.book.currentBook);
  const htmlBook = useAppStore((s) => s.reader.htmlBook);
  const [marks, setMarks] = useState<ChapterMarks | null>(null);
  // 生成在后台进行（readingMarksService 的单章任务），这里只订阅状态
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState("");
  const [openKey, setOpenKey] = useState<string>("");
  const [openAction, setOpenAction] = useState<CompanionAction | "">("");
  const [streaming, setStreaming] = useState<{ key: string; action: CompanionAction; text: string } | null>(null);
  const task = useRef<RunningTask | null>(null);
  const mounted = useRef(true);
  const paragraphs = chapterParagraphs(chapter);

  useEffect(() => {
    mounted.current = true;
    setMarks(loadChapterMarks(index.bookKey, chapter));
    const running = getChapterTask(index.bookKey, chapter.docIndex);
    setIsRunning(running?.phase === "running");
    setError(running?.phase === "error" ? errorText(t, running.error) : "");
    setFocusedDocIndex(chapter.docIndex);
    const off = subscribeChapterTasks((s) => {
      if (s.bookKey !== index.bookKey || s.docIndex !== chapter.docIndex) return;
      setIsRunning(s.phase === "running");
      if (s.phase === "running") setError("");
      else if (s.phase === "error") setError(errorText(t, s.error));
      else if (s.phase === "cancelled") setError(t("Stopped"));
      else setMarks(loadChapterMarks(index.bookKey, chapter));
    });
    return () => {
      mounted.current = false;
      off();
      setFocusedDocIndex(-1);
      // 只取消进一步功能的流式回答；本章生成在后台继续
      task.current?.cancel();
      task.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index.bookKey, chapter.docIndex]);

  // 从书页点击标注进入：展开该条，并按需运行对应功能
  useEffect(() => {
    if (!focus || !marks) return;
    setOpenKey(focus.annotation);
    setOpenAction(focus.action || "");
    if (focus.action && !marks.extras?.[focus.annotation]?.[focus.action]) {
      const item = marks.annotations.find((a) => annotationKey(a) === focus.annotation);
      if (item?.kind === "idea") handleAction(item, focus.action);
    }
    setTimeout(() => {
      document.getElementById("ai-rc-note-" + focus.annotation)?.scrollIntoView({ block: "start" });
    }, 50);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus, marks?.createdAt]);

  const handleGenerate = () => {
    if (isRunning) return;
    if (!hasAiBackend()) {
      setError(t("AI_GUIDE_NO_SERVICE"));
      return;
    }
    startChapterTask(currentBook?.name || "", index, chapter);
  };

  const handleAction = async (item: Annotation, action: CompanionAction) => {
    if (!currentBook || task.current) return;
    const key = annotationKey(item);
    setOpenKey(key);
    setOpenAction(action);
    setStreaming({ key, action, text: "" });
    try {
      await runCompanionAction({
        book: currentBook,
        index,
        chapter,
        annotation: item,
        action,
        onText: (d) => mounted.current && setStreaming((s) => (s ? { ...s, text: s.text + d } : s)),
        onRunning: (r) => (task.current = r),
      });
      if (mounted.current) setMarks(loadChapterMarks(index.bookKey, chapter));
    } catch (e) {
      if (mounted.current && !(e instanceof AiTaskError && e.code === "cancelled")) {
        toast.error(errorText(t, e));
      }
    } finally {
      task.current = null;
      if (mounted.current) setStreaming(null);
    }
  };

  const jump = async (quote: string) => {
    if (!htmlBook?.rendition) return;
    try {
      const how = await jumpToQuote(
        htmlBook.rendition,
        { docIndex: chapter.docIndex, title: chapter.title, href: chapter.href },
        quote
      );
      if (how === "chapter") toast(t("Jumped to the chapter; exact paragraph not found"));
    } catch (e) {
      toast.error(t("Jump failed"));
    }
  };

  const renderResult = (key: string, action: CompanionAction) => {
    if (streaming && streaming.key === key && streaming.action === action) {
      return (
        <div className="ai-rc-result">
          {streaming.text ? (
            renderMarkdown(visibleWhileStreaming(streaming.text))
          ) : (
            <span className="ai-guide-hint">
              <span className="icon-loading ai-guide-spin"></span> {t("Thinking...")}
            </span>
          )}
          <span className="ai-guide-link" onClick={() => task.current?.cancel()}>
            {t("Stop")}
          </span>
        </div>
      );
    }
    const r: ActionResult | undefined = marks?.extras?.[key]?.[action];
    if (!r) return null;
    const item = marks?.annotations.find((a) => annotationKey(a) === key);
    return (
      <div className="ai-rc-result">
        <QaAnswer content={r.content} sources={r.sources} />
        <div className="ai-points-footer">
          <span className="ai-guide-hint">{r.usage}</span>
          {item && !task.current && (
            <span className="ai-guide-link" onClick={() => handleAction(item, action)}>
              {t("Regenerate")}
            </span>
          )}
        </div>
      </div>
    );
  };

  const renderAnnotation = (item: Annotation, i: number) => {
    const key = annotationKey(item);
    const isOpen = openKey === key;
    return (
      <div
        key={key}
        id={"ai-rc-note-" + key}
        className={"ai-rc-note ai-rc-note-" + item.kind + (isOpen ? " ai-rc-note-focus" : "")}
      >
        <div
          className={"ai-rc-note-head" + (item.verified ? "" : " ai-points-quote-missing")}
          onClick={() => item.verified && jump(item.quote)}
          title={item.verified ? t("Jump to this passage") : t("Not located in the original text")}
        >
          <span className="ai-rc-note-num">[{i + 1}]</span>
          <span className={"ai-rc-badge ai-rc-badge-" + item.kind}>{t(KIND_LABEL_KEYS[item.kind])}</span>
          <span className="ai-rc-note-quote">
            {item.verified ? "" : "⚠ "}
            {item.quote}
          </span>
        </div>
        <div className="ai-rc-note-footnote">{item.footnote}</div>
        {item.kind === "idea" && (
          <div className="ai-rc-actions">
            {COMPANION_ACTIONS.map((a) => (
              <span
                key={a}
                className={
                  "ai-rc-action" +
                  (isOpen && openAction === a ? " ai-rc-action-active" : "") +
                  (marks?.extras?.[key]?.[a] ? " ai-rc-action-done" : "")
                }
                onClick={() => {
                  if (isOpen && openAction === a) {
                    setOpenAction("");
                    return;
                  }
                  setOpenKey(key);
                  setOpenAction(a);
                  if (!marks?.extras?.[key]?.[a]) handleAction(item, a);
                }}
              >
                {t(ACTION_LABEL_KEYS[a])}
              </span>
            ))}
          </div>
        )}
        {isOpen && item.kind === "idea" && openAction && renderResult(key, openAction)}
      </div>
    );
  };

  const unverified = marks ? marks.annotations.filter((a) => !a.verified).length : 0;

  return (
    <div className="ai-points-container">
      <div className="ai-points-header">
        {onBack && (
          <span className="ai-guide-link" onClick={onBack}>
            ← {t("Back to chapter list")}
          </span>
        )}
        <span className="ai-points-title" onClick={() => jump(paragraphs[0] || "")} title={t("Jump to this chapter")}>
          {chapter.title}
        </span>
      </div>

      {!marks && !isRunning && (
        <div className="ai-points-empty">
          <div className="ai-points-empty-meta">
            {chapter.text.length} {t("characters")} · {paragraphs.length} {t("paragraphs")}
          </div>
          <div className="ai-points-button" onClick={handleGenerate}>
            {t("Generate reading companion for this chapter")}
          </div>
          <div className="ai-guide-hint" style={{ textAlign: "center" }}>
            {t("AI_COMPANION_CHAPTER_INTRO")}
          </div>
        </div>
      )}

      {isRunning && (
        <div className="ai-points-empty">
          <div>
            <span className="icon-loading ai-guide-spin"></span> {t("Reading this chapter, please wait...")}
          </div>
          <div className="ai-guide-hint" style={{ textAlign: "center" }}>
            {t("AI_COMPANION_BACKGROUND_HINT")}
          </div>
          <div
            className="ai-points-button"
            onClick={() => cancelChapterTask(index.bookKey, chapter.docIndex)}
          >
            {t("Stop")}
          </div>
        </div>
      )}

      {error && !isRunning && <div className="ai-points-error">{error}</div>}

      {marks && !isRunning && (
        <div className="ai-points-body">
          {marks.overview && (
            <div className="ai-points-section">
              <div className="ai-points-label">{t("Core argument of this chapter")}</div>
              <div className="ai-points-question">{marks.overview}</div>
            </div>
          )}
          <div className="ai-points-section">
            <div className="ai-points-label">
              {t("Annotations and footnotes")} <KindCounts marks={marks} />
            </div>
            {marks.annotations.length > 0 ? (
              marks.annotations.map(renderAnnotation)
            ) : (
              <div className="ai-guide-hint">{t("No terms or core ideas marked in this chapter")}</div>
            )}
          </div>
          <div className="ai-points-footer">
            <span className="ai-guide-hint">
              {usage(marks)}
              {marks.truncated ? " · " + t("Chapter truncated") : ""}
              {unverified > 0 ? " · " + unverified + " " + t("quotes not located") : ""}
            </span>
            <span className="ai-guide-link" onClick={handleGenerate}>
              {t("Regenerate this chapter")}
            </span>
          </div>
        </div>
      )}
    </div>
  );
};

export default ChapterCompanion;
