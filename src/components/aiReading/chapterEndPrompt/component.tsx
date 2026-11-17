import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import toast from "react-hot-toast";
import { isElectron } from "react-device-detect";
import { ConfigService } from "../../../assets/lib/kookit-extra-browser.min";
import { useAppStore } from "../../../store/useAppStore";
import {
  getCurrentDocIndex,
  onReaderPositionChange,
} from "../../../utils/aiReading/readerAdapter";
import { loadCachedIndex } from "../../../utils/aiReading/bookIndex";
import { MIN_ANALYZE_CHARS } from "../../../utils/aiReading/bookGuide";
import {
  CHAPTER_END_PROMPT_KEY,
  requestOpenChapterPoints,
} from "../../../utils/aiReading/guideNav";

/**
 * AI 伴读：读完一章（翻到后一章）时提示查看本章伴读（FR-SUM-08）。
 * 默认关闭，在「设置 > AI」中开启。不渲染任何内容。
 */
const ChapterEndPrompt = () => {
  const { t } = useTranslation();
  const htmlBook = useAppStore((s) => s.reader.htmlBook);
  const currentBook = useAppStore((s) => s.book.currentBook);
  const handleCompanionPanel = useAppStore((s) => s.handleCompanionPanel);
  const lastDoc = useRef(-1);

  useEffect(() => {
    const rendition = htmlBook?.rendition;
    if (!isElectron || !rendition || !currentBook?.key) return;
    lastDoc.current = getCurrentDocIndex(rendition);
    const onChange = () => {
      const now = getCurrentDocIndex(rendition);
      const prev = lastDoc.current;
      if (now === prev) return;
      lastDoc.current = now;
      // 只在向后翻到紧邻的下一章时提示；跳转、回翻不提示
      if (now !== prev + 1 || prev < 0) return;
      if (ConfigService.getReaderConfig(CHAPTER_END_PROMPT_KEY) !== "yes") return;
      const index = loadCachedIndex(currentBook);
      const finished = index?.chapters.find((c) => c.docIndex === prev);
      if (!finished || finished.text.length < MIN_ANALYZE_CHARS) return;
      toast(
        (tt) => (
          <span
            style={{ cursor: "pointer" }}
            onClick={() => {
              toast.dismiss(tt.id);
              requestOpenChapterPoints(prev);
              handleCompanionPanel(true);
            }}
          >
            {t("Finished")} {finished.title} · <u>{t("Open its reading companion?")}</u>
          </span>
        ),
        { id: "ai-chapter-end", duration: 6000 }
      );
    };
    return onReaderPositionChange(rendition, onChange);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [htmlBook, currentBook?.key]);

  return null;
};

export default ChapterEndPrompt;
