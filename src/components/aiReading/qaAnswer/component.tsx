import { useTranslation } from "react-i18next";
import toast from "react-hot-toast";
import Parser from "html-react-parser";
import DOMPurify from "dompurify";
import { marked } from "marked";
import { useAppStore } from "../../../store/useAppStore";
import {
  QaSource,
  splitAnswerSegments,
} from "../../../utils/aiReading/bookQa";
import { jumpToQuote } from "../../../utils/aiReading/readerAdapter";
import { loadCachedIndex } from "../../../utils/aiReading/bookIndex";
import "./qaAnswer.css";

interface QaAnswerProps {
  content: string;
  sources: QaSource[];
}

const renderMarkdown = (md: string) =>
  Parser(DOMPurify.sanitize(marked.parse(md) as string) || " ");

/** AI 伴读：全书问答的回答（FR-QA-02/03）。区分书中内容与 AI 补充，列出可跳转的出处 */
const QaAnswer = ({ content, sources }: QaAnswerProps) => {
  const { t } = useTranslation();
  const htmlBook = useAppStore((s) => s.reader.htmlBook);
  const currentBook = useAppStore((s) => s.book.currentBook);

  const handleJump = async (s: QaSource) => {
    if (!htmlBook?.rendition || s.docIndex < 0) return;
    const chapter = currentBook
      ? loadCachedIndex(currentBook)?.chapters.find((c) => c.docIndex === s.docIndex)
      : undefined;
    try {
      const how = await jumpToQuote(
        htmlBook.rendition,
        { docIndex: s.docIndex, title: s.chapterTitle, href: chapter?.href },
        s.quote
      );
      if (how === "chapter") toast(t("Jumped to the chapter; exact paragraph not found"));
    } catch (e) {
      toast.error(t("Jump failed"));
    }
  };

  const segments = splitAnswerSegments(content);
  const unverified = sources.filter((s) => !s.verified).length;

  return (
    <div className="ai-qa-answer">
      {segments.map((seg, i) =>
        seg.kind === "book" ? (
          <div key={i}>{renderMarkdown(seg.text)}</div>
        ) : (
          <div key={i} className="ai-qa-extra">
            <div className="ai-qa-extra-label">{t("AI background (not from the book)")}</div>
            {renderMarkdown(seg.text)}
          </div>
        )
      )}
      {sources.length > 0 ? (
        <div className="ai-qa-sources">
          <div className="ai-qa-sources-label">
            {t("Sources")}
            {unverified > 0 && (
              <span className="ai-qa-sources-warn">
                {" "}
                · {unverified} {t("quotes not located")}
              </span>
            )}
          </div>
          {sources.map((s, i) => (
            <div
              key={i}
              className={"ai-qa-source" + (s.verified ? "" : " ai-qa-source-missing")}
              onClick={() => s.verified && handleJump(s)}
              title={
                s.verified
                  ? t("Jump to this passage")
                  : t("Not located in the original text")
              }
            >
              <span className="ai-qa-source-chapter">
                {s.verified ? "" : "⚠ "}
                {s.chapterTitle || t("Selected text")}
              </span>
              <span className="ai-qa-source-quote">“{s.quote}”</span>
            </div>
          ))}
        </div>
      ) : (
        <div className="ai-qa-sources-label ai-qa-sources-warn">
          {t("No source given; treat this answer with caution")}
        </div>
      )}
    </div>
  );
};

export default QaAnswer;
