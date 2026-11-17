import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import toast from "react-hot-toast";
import { useAppStore } from "../../../store/useAppStore";
import { vexComfirmAsync } from "../../../utils/common";
import { BookIndex } from "../../../utils/aiReading/indexText";
import { BookGuide } from "../../../utils/aiReading/bookGuide";
import {
  GuideJobState,
  estimateBookGuide,
  isGuideStale,
  loadBookGuide,
  pauseGuideJob,
  startGuideJob,
  subscribeGuideJob,
} from "../../../utils/aiReading/bookGuideService";
import {
  AiTaskError,
  getPointsBackend,
} from "../../../utils/aiReading/chapterPointsService";
import { CLAUDE_CODE_ERROR_KEYS } from "../../../utils/aiReading/claudeCode";
import { jumpToChapter } from "../../../utils/aiReading/readerAdapter";
import "../chapterPoints/chapterPoints.css";
import "./bookOverview.css";

interface BookOverviewProps {
  index: BookIndex;
  onBack: () => void;
  onOpenChapter: (docIndex: number) => void;
}

const usd = (n: number) =>
  n < 0 ? "$?" : `$${n.toFixed(n === 0 ? 2 : n < 0.01 ? 4 : n < 0.1 ? 3 : 2)}`;

/** AI 伴读：全书导读（FR-SUM-04/07） */
const BookOverview = ({ index, onBack, onOpenChapter }: BookOverviewProps) => {
  const { t } = useTranslation();
  const currentBook = useAppStore((s) => s.book.currentBook);
  const htmlBook = useAppStore((s) => s.reader.htmlBook);
  const [guide, setGuide] = useState<BookGuide | null>(() =>
    loadBookGuide(index.bookKey)
  );
  const [jobState, setJobState] = useState<GuideJobState | null>(null);

  useEffect(
    () =>
      subscribeGuideJob((s) => {
        const mine = s && s.bookKey === index.bookKey ? s : null;
        setJobState(mine);
        if (mine?.phase === "done") setGuide(loadBookGuide(index.bookKey));
      }),
    [index.bookKey]
  );

  const isRunning =
    jobState?.phase === "chapters" || jobState?.phase === "summary";

  const handleStart = async () => {
    if (!getPointsBackend()) {
      toast.error(t("AI_GUIDE_NO_SERVICE"));
      return;
    }
    const est = estimateBookGuide(index);
    if (est.chapters === 0) {
      toast.error(t("No chapter has enough text to analyze"));
      return;
    }
    const message =
      `<b>${t("Generate book overview")}</b><br/><br/>` +
      `${t("Chapters to analyze")}: ${est.chapters}` +
      (est.cached ? `（${t("already done")} ${est.cached}）` : "") +
      `<br/>${t("AI calls")}: ${est.calls}` +
      `<br/>${t("Characters to send")}: ${Math.round(est.chars / 1000)}k` +
      `<br/>${t("Estimated cost")}: $${est.costLow.toFixed(2)} – $${est.costHigh.toFixed(2)}` +
      `<br/><br/><span style="opacity:.7;font-size:13px">${t(
        "AI_GUIDE_ESTIMATE_NOTE"
      )}</span>`;
    const ok = await vexComfirmAsync(message, "Start", "Cancel");
    if (!ok) return;
    startGuideJob(currentBook?.name || "", index).catch((e) =>
      toast.error(e instanceof Error ? e.message : String(e))
    );
  };

  const jump = async (docIndex: number) => {
    const chapter = index.chapters.find((c) => c.docIndex === docIndex);
    if (!chapter || !htmlBook?.rendition) return;
    try {
      await jumpToChapter(htmlBook.rendition, chapter);
    } catch (e) {
      toast.error(t("Jump failed"));
    }
  };

  const errorText = (e?: Error) => {
    if (!e) return "";
    if (e instanceof AiTaskError) {
      if (e.code === "no-service") return t("AI_GUIDE_NO_SERVICE");
      if (e.code === "bad-output") return t("AI_GUIDE_BAD_OUTPUT");
      return t(CLAUDE_CODE_ERROR_KEYS[e.code]);
    }
    return e.message;
  };

  const renderJob = () => {
    if (!jobState) return null;
    const { phase, done, total, currentTitle, spentUsd } = jobState;
    return (
      <div className="ai-overview-job">
        {isRunning && <span className="icon-loading ai-guide-spin"></span>}
        <span>
          {phase === "summary"
            ? t("Writing the book overview...")
            : phase === "paused"
              ? t("Paused")
              : phase === "error"
                ? errorText(jobState.error)
                : phase === "done"
                  ? t("Done")
                  : `${t("Reading chapters")} ${done}/${total}` +
                    (currentTitle ? ` · ${currentTitle}` : "")}
        </span>
        <span className="ai-guide-hint">
          {t("Spent")} {usd(spentUsd)}
        </span>
        {isRunning && (
          <span className="ai-guide-link" onClick={pauseGuideJob}>
            {t("Pause")}
          </span>
        )}
        {(phase === "paused" || phase === "error") && (
          <span
            className="ai-guide-link"
            onClick={() =>
              startGuideJob(currentBook?.name || "", index).catch((e) =>
                toast.error(e instanceof Error ? e.message : String(e))
              )
            }
          >
            {t("Continue")}
          </span>
        )}
      </div>
    );
  };

  const stale = guide && !isRunning ? isGuideStale(index, guide) : false;

  return (
    <div className="ai-overview-container">
      <div className="ai-points-header">
        <span className="ai-guide-link" onClick={onBack}>
          ← {t("Back to chapter list")}
        </span>
        <b>{t("Book overview")}</b>
      </div>

      {renderJob()}

      {!guide && !jobState && (
        <div className="ai-points-empty">
          <div className="ai-guide-hint" style={{ textAlign: "center" }}>
            {t("AI_GUIDE_OVERVIEW_INTRO")}
          </div>
          <div className="ai-points-button" onClick={handleStart}>
            {t("Generate book overview")}
          </div>
        </div>
      )}

      {guide && (
        <div className="ai-points-body">
          <div className="ai-points-section">
            <div className="ai-points-label">{t("Main thread of the book")}</div>
            <div>{guide.mainline}</div>
          </div>

          <div className="ai-points-section">
            <div className="ai-points-label">{t("Chapter map")}</div>
            {guide.chapters.map((c) => (
              <div key={c.docIndex} className="ai-overview-chapter">
                <div className="ai-overview-chapter-head">
                  <span
                    className="ai-overview-chapter-title"
                    onClick={() => jump(c.docIndex)}
                    title={t("Jump to this chapter")}
                  >
                    {c.title}
                  </span>
                  {c.advice && (
                    <span
                      className={"ai-overview-badge ai-overview-badge-" + c.advice}
                      title={c.reason}
                    >
                      {c.advice === "core" ? t("Core") : t("Skimmable")}
                    </span>
                  )}
                  <span
                    className="ai-guide-link"
                    onClick={() => onOpenChapter(c.docIndex)}
                  >
                    {t("Reading Companion")}
                  </span>
                </div>
                <div className="ai-overview-chapter-summary">{c.summary}</div>
                {c.advice && c.reason && (
                  <div className="ai-guide-hint">{c.reason}</div>
                )}
              </div>
            ))}
          </div>

          {guide.concepts.length > 0 && (
            <div className="ai-points-section">
              <div className="ai-points-label">{t("Core concepts")}</div>
              <table className="ai-overview-concepts">
                <tbody>
                  {guide.concepts.map((c, i) => {
                    const first = index.chapters.find(
                      (ch) => ch.docIndex === c.firstDocIndex
                    );
                    return (
                      <tr key={i}>
                        <td>
                          <b>{c.term}</b>
                        </td>
                        <td>{c.explanation}</td>
                        <td>
                          {first ? (
                            <span
                              className="ai-guide-link"
                              onClick={() => jump(first.docIndex)}
                              title={t("First appears in")}
                            >
                              {first.title}
                            </span>
                          ) : (
                            <span className="ai-guide-hint">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {guide.readingOrder && (
            <div className="ai-points-section">
              <div className="ai-points-label">{t("Reading suggestions")}</div>
              <div>{guide.readingOrder}</div>
            </div>
          )}

          <div className="ai-points-footer">
            <span className="ai-guide-hint">
              {t("Total cost")} {usd(guide.costUsd)}
              {stale ? " · " + t("Some chapter key points were regenerated") : ""}
            </span>
            {!isRunning && (
              <span className="ai-guide-link" onClick={handleStart}>
                {stale ? t("Update overview") : t("Regenerate overview")}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default BookOverview;
