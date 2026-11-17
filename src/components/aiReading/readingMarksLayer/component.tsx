import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import toast from "react-hot-toast";
import { isElectron } from "react-device-detect";
import { useAppStore } from "../../../store/useAppStore";
import { isPaginatedBook } from "../../../utils/common";
import { getIframeDoc } from "../../../utils/reader/docUtil";
import { loadCachedIndex } from "../../../utils/aiReading/bookIndex";
import {
  getCurrentDocIndex,
  onReaderPositionChange,
} from "../../../utils/aiReading/readerAdapter";
import {
  chapterParagraphs,
  getFocusedDocIndex,
  getMarksRenderScope,
  loadChapterMarks,
  requestFocusSegment,
  subscribeMarksChanged,
} from "../../../utils/aiReading/readingMarksService";
import { clearMarks, hitSegment, renderMarks } from "../../../utils/aiReading/marksRenderer";
import { COMPANION_ACTIONS, ChapterMarks, CompanionAction } from "../../../utils/aiReading/readingMarks";
import type { BookIndex, IndexChapter } from "../../../utils/aiReading/indexText";
import { ACTION_LABEL_KEYS } from "../readingCompanion/labels";

/**
 * AI 伴读：把已生成的阅读分级与重点划线渲染到书页上；点击精读段落时提示进一步功能。
 * 不渲染任何 React 内容。
 */
const ReadingMarksLayer = () => {
  const { t } = useTranslation();
  const htmlBook = useAppStore((s) => s.reader.htmlBook);
  const currentBook = useAppStore((s) => s.book.currentBook);
  const handleCompanionPanel = useAppStore((s) => s.handleCompanionPanel);

  useEffect(() => {
    const rendition = htmlBook?.rendition;
    if (!isElectron || !rendition || !currentBook?.key) return;
    const boundDocs = new WeakSet<Document>();

    /** 文档 → 它显示的章节（分页格式的子 iframe id 末尾为 chapterDocIndex） */
    const docsWithIndex = (): { doc: Document; docIndex: number }[] => {
      const docs = getIframeDoc(currentBook).filter((d): d is Document => !!d);
      if (isPaginatedBook(currentBook)) {
        return docs
          .map((doc) => {
            const id = doc.defaultView?.frameElement?.getAttribute("id") || "";
            const n = parseInt(id.split("-").reverse()[0]);
            return { doc, docIndex: Number.isFinite(n) ? n : -1 };
          })
          .filter((d) => d.docIndex >= 0);
      }
      return docs.slice(0, 1).map((doc) => ({ doc, docIndex: getCurrentDocIndex(rendition) }));
    };

    const openAction = (docIndex: number, segment: string, action?: CompanionAction) => {
      requestFocusSegment({ docIndex, segment, action });
      handleCompanionPanel(true);
    };

    const onClick = (event: MouseEvent) => {
      const doc = (event.target as Node | null)?.ownerDocument;
      if (!doc || doc.getSelection()?.toString().trim()) return;
      const hit = hitSegment(doc, event.clientX, event.clientY);
      if (!hit || hit.segment.level !== "deep") return;
      const { docIndex, segment } = hit;
      toast(
        (tt) => (
          <span>
            <b>{t("Deep reading")}</b>
            {segment.title ? ` · ${segment.title}` : ""}
            <br />
            {COMPANION_ACTIONS.map((a) => (
              <u
                key={a}
                style={{ cursor: "pointer", marginRight: 10 }}
                onClick={() => {
                  toast.dismiss(tt.id);
                  openAction(docIndex, segment.key, a);
                }}
              >
                {t(ACTION_LABEL_KEYS[a])}
              </u>
            ))}
          </span>
        ),
        { id: "ai-reading-deep", duration: 4000 }
      );
    };

    // 翻页时不重复读盘：索引与各章标注缓存在闭包里，标注变化时失效
    let index: BookIndex | null = null;
    const marksCache = new Map<number, ChapterMarks | null>();
    const getMarks = (chapter: IndexChapter) => {
      if (!marksCache.has(chapter.docIndex)) {
        marksCache.set(chapter.docIndex, loadChapterMarks(currentBook.key, chapter));
      }
      return marksCache.get(chapter.docIndex) || null;
    };

    const render = () => {
      const scope = getMarksRenderScope();
      if (scope !== "off" && !index) index = loadCachedIndex(currentBook);
      // 「仅本章」：面板里打开的章节；没打开时为正在读的章节
      const focused = getFocusedDocIndex();
      const target = focused >= 0 ? focused : getCurrentDocIndex(rendition);
      for (const { doc, docIndex } of docsWithIndex()) {
        const chapter = scope === "off" ? undefined : index?.chapters.find((c) => c.docIndex === docIndex);
        const marks =
          chapter && (scope === "book" || target === docIndex) ? getMarks(chapter) : null;
        if (!chapter || !marks) {
          clearMarks(doc);
          continue;
        }
        try {
          renderMarks(doc, marks, chapterParagraphs(chapter));
        } catch (e) {
          console.warn("AI reading marks render failed", e);
        }
        if (!boundDocs.has(doc)) {
          boundDocs.add(doc);
          doc.addEventListener("click", onClick);
        }
      }
    };

    // 引擎渲染完成后 DOM 才稳定，稍等再渲染
    let timer: ReturnType<typeof setTimeout> | null = null;
    const schedule = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(render, 150);
    };
    schedule();
    const offPos = onReaderPositionChange(rendition, schedule);
    const offMarks = subscribeMarksChanged((key) => {
      if (key && key !== currentBook.key) return;
      marksCache.clear();
      schedule();
    });
    return () => {
      if (timer) clearTimeout(timer);
      offPos();
      offMarks();
      for (const { doc } of docsWithIndex()) {
        clearMarks(doc);
        doc.removeEventListener("click", onClick);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [htmlBook, currentBook?.key]);

  return null;
};

export default ReadingMarksLayer;
