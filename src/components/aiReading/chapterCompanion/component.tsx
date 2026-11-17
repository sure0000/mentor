import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import toast from "react-hot-toast";
import Parser from "html-react-parser";
import DOMPurify from "dompurify";
import { marked } from "marked";
import { useAppStore } from "../../../store/useAppStore";
import { BookIndex, IndexChapter } from "../../../utils/aiReading/indexText";
import {
  ActionResult,
  COMPANION_ACTIONS,
  ChapterMarks,
  CompanionAction,
  KeyLine,
  MarkSegment,
  READING_LEVELS,
  levelShares,
  segmentKey,
} from "../../../utils/aiReading/readingMarks";
import {
  chapterParagraphs,
  generateChapterMarks,
  loadChapterMarks,
  runCompanionAction,
  setFocusedDocIndex,
} from "../../../utils/aiReading/readingMarksService";
import {
  AiTaskError,
  RunningTask,
  getPointsBackend,
} from "../../../utils/aiReading/chapterPointsService";
import { CLAUDE_CODE_ERROR_KEYS } from "../../../utils/aiReading/claudeCode";
import { visibleWhileStreaming } from "../../../utils/aiReading/bookQa";
import { jumpToQuote } from "../../../utils/aiReading/readerAdapter";
import QaAnswer from "../qaAnswer";
import { ACTION_LABEL_KEYS, LEVEL_LABEL_KEYS } from "../readingCompanion/labels";
import "../bookGuide/bookGuide.css";
import "../chapterPoints/chapterPoints.css";
import "../readingCompanion/readingCompanion.css";

interface ChapterCompanionProps {
  index: BookIndex;
  chapter: IndexChapter;
  /** 从书页点击进入时要展开的精读区间与功能 */
  focus?: { segment: string; action?: CompanionAction } | null;
  onBack?: () => void;
}

const usage = (m: ChapterMarks) =>
  `${(m.durationMs / 1000).toFixed(1)}s · ` + (m.costUsd >= 0 ? `$${m.costUsd.toFixed(4)}` : "$?");

const renderMarkdown = (md: string) =>
  Parser(DOMPurify.sanitize(marked.parse(md) as string) || " ");

export const errorText = (t: (k: string) => string, e: unknown) => {
  if (e instanceof AiTaskError) {
    if (e.code === "no-service") return t("AI_GUIDE_NO_SERVICE");
    if (e.code === "bad-output") return t("AI_GUIDE_BAD_OUTPUT");
    return t(CLAUDE_CODE_ERROR_KEYS[e.code]);
  }
  return e instanceof Error ? e.message : String(e);
};

/** 篇幅占比条：略读 / 浅读 / 精读 */
export const LevelBar = ({ marks, paragraphs }: { marks: ChapterMarks; paragraphs: string[] }) => {
  const { t } = useTranslation();
  const shares = levelShares(marks.segments, paragraphs);
  return (
    <div className="ai-rc-bar" title={READING_LEVELS.map((l) => `${t(LEVEL_LABEL_KEYS[l])} ${Math.round(shares[l] * 100)}%`).join(" · ")}>
      {READING_LEVELS.map((l) =>
        shares[l] > 0 ? (
          <span key={l} className={"ai-rc-bar-" + l} style={{ flexGrow: shares[l] }}></span>
        ) : null
      )}
    </div>
  );
};

/** AI 伴读：一章的阅读分级、重点划线与精读进一步功能 */
const ChapterCompanion = ({ index, chapter, focus, onBack }: ChapterCompanionProps) => {
  const { t } = useTranslation();
  const currentBook = useAppStore((s) => s.book.currentBook);
  const htmlBook = useAppStore((s) => s.reader.htmlBook);
  const [marks, setMarks] = useState<ChapterMarks | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState("");
  const [openSeg, setOpenSeg] = useState<string>("");
  const [openAction, setOpenAction] = useState<CompanionAction | "">("");
  const [streaming, setStreaming] = useState<{ key: string; action: CompanionAction; text: string } | null>(null);
  const task = useRef<RunningTask | null>(null);
  const mounted = useRef(true);
  const paragraphs = chapterParagraphs(chapter);

  useEffect(() => {
    mounted.current = true;
    setMarks(loadChapterMarks(index.bookKey, chapter));
    setError("");
    setFocusedDocIndex(chapter.docIndex);
    return () => {
      mounted.current = false;
      setFocusedDocIndex(-1);
      task.current?.cancel();
      task.current = null;
    };
  }, [index.bookKey, chapter]);

  // 从书页点击精读段落进入：展开该段，并按需运行对应功能
  useEffect(() => {
    if (!focus || !marks) return;
    setOpenSeg(focus.segment);
    if (focus.action) {
      setOpenAction(focus.action);
      if (!marks.extras?.[focus.segment]?.[focus.action]) {
        const seg = marks.segments.find((s) => segmentKey(s) === focus.segment);
        if (seg) handleAction(seg, focus.action);
      }
    }
    setTimeout(() => {
      document.getElementById("ai-rc-seg-" + focus.segment)?.scrollIntoView({ block: "start" });
    }, 50);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus, marks?.createdAt]);

  const handleGenerate = async () => {
    if (isRunning) return;
    if (!getPointsBackend()) {
      setError(t("AI_GUIDE_NO_SERVICE"));
      return;
    }
    setIsRunning(true);
    setError("");
    try {
      const result = await generateChapterMarks(currentBook?.name || "", index, chapter, (r) => (task.current = r));
      if (mounted.current) setMarks(result);
    } catch (e) {
      if (mounted.current) setError(e instanceof AiTaskError && e.code === "cancelled" ? t("Stopped") : errorText(t, e));
    } finally {
      task.current = null;
      if (mounted.current) setIsRunning(false);
    }
  };

  const handleAction = async (seg: MarkSegment, action: CompanionAction) => {
    if (!currentBook || task.current) return;
    const key = segmentKey(seg);
    setOpenSeg(key);
    setOpenAction(action);
    setStreaming({ key, action, text: "" });
    try {
      await runCompanionAction({
        book: currentBook,
        index,
        chapter,
        segment: seg,
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
    const seg = marks?.segments.find((s) => segmentKey(s) === key);
    return (
      <div className="ai-rc-result">
        <QaAnswer content={r.content} sources={r.sources} />
        <div className="ai-points-footer">
          <span className="ai-guide-hint">{r.usage}</span>
          {seg && !task.current && (
            <span className="ai-guide-link" onClick={() => handleAction(seg, action)}>
              {t("Regenerate")}
            </span>
          )}
        </div>
      </div>
    );
  };

  const renderSegment = (seg: MarkSegment) => {
    const key = segmentKey(seg);
    const isOpen = openSeg === key;
    const first = paragraphs[seg.from - 1] || "";
    return (
      <div key={key} id={"ai-rc-seg-" + key} className={"ai-rc-seg ai-rc-seg-" + seg.level}>
        <div className="ai-rc-seg-head" onClick={() => setOpenSeg(isOpen ? "" : key)}>
          <span className={"ai-rc-badge ai-rc-badge-" + seg.level}>{t(LEVEL_LABEL_KEYS[seg.level])}</span>
          <span className="ai-rc-seg-title">{seg.title || first.slice(0, 24)}</span>
          <span className="ai-guide-hint">
            ¶{seg.from}
            {seg.to > seg.from ? `–${seg.to}` : ""}
          </span>
          <span
            className="icon-share ai-guide-item-jump"
            title={t("Jump to this passage")}
            onClick={(e) => {
              e.stopPropagation();
              jump(first);
            }}
          ></span>
        </div>
        {seg.reason && <div className="ai-rc-seg-reason">{seg.reason}</div>}
        {seg.level === "deep" && (
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
                  setOpenSeg(key);
                  setOpenAction(a);
                  if (!marks?.extras?.[key]?.[a]) handleAction(seg, a);
                }}
              >
                {t(ACTION_LABEL_KEYS[a])}
              </span>
            ))}
          </div>
        )}
        {isOpen && seg.level === "deep" && openAction && renderResult(key, openAction)}
      </div>
    );
  };

  const renderKeyLine = (k: KeyLine, i: number) => (
    <div
      key={i}
      className={"ai-rc-keyline" + (k.verified ? "" : " ai-points-quote-missing")}
      onClick={() => k.verified && jump(k.quote)}
      title={k.verified ? t("Jump to this passage") : t("Not located in the original text")}
    >
      <div className="ai-rc-keyline-quote">
        {k.verified ? "“" : "⚠ "}
        {k.quote}
        {k.verified ? "”" : ""}
      </div>
      {k.note && <div className="ai-guide-hint">{k.note}</div>}
    </div>
  );

  const unverified = marks ? marks.keyLines.filter((k) => !k.verified).length : 0;

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
          <div className="ai-points-button" onClick={() => task.current?.cancel()}>
            {t("Stop")}
          </div>
        </div>
      )}

      {error && !isRunning && <div className="ai-points-error">{error}</div>}

      {marks && !isRunning && (
        <div className="ai-points-body">
          {marks.overview && (
            <div className="ai-points-section">
              <div className="ai-points-label">{t("How to read this chapter")}</div>
              <div className="ai-points-question">{marks.overview}</div>
            </div>
          )}
          <div className="ai-points-section">
            <LevelBar marks={marks} paragraphs={paragraphs} />
            <div className="ai-rc-legend">
              {READING_LEVELS.map((l) => (
                <span key={l}>
                  <span className={"ai-rc-dot ai-rc-dot-" + l}></span>
                  {t(LEVEL_LABEL_KEYS[l])}
                </span>
              ))}
              <span>
                <span className="ai-rc-dot ai-rc-dot-key"></span>
                {t("Key line")}
              </span>
            </div>
          </div>
          <div className="ai-points-section">
            <div className="ai-points-label">{t("Reading levels")}</div>
            {marks.segments.map(renderSegment)}
          </div>
          {marks.keyLines.length > 0 && (
            <div className="ai-points-section">
              <div className="ai-points-label">{t("Key lines")}</div>
              {marks.keyLines.map(renderKeyLine)}
            </div>
          )}
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
