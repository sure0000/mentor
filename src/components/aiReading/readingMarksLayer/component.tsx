import { useEffect, useRef, useState } from "react";
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
  requestFocusAnnotation,
  setMarksRenderScope,
  subscribeChapterTasks,
  subscribeMarksChanged,
} from "../../../utils/aiReading/readingMarksService";
import { clearMarks, hitAnnotation, renderMarks } from "../../../utils/aiReading/marksRenderer";
import {
  Annotation,
  COMPANION_ACTIONS,
  ChapterMarks,
  CompanionAction,
} from "../../../utils/aiReading/readingMarks";
import type { BookIndex, IndexChapter } from "../../../utils/aiReading/indexText";
import { ACTION_LABEL_KEYS, KIND_LABEL_KEYS } from "../readingCompanion/labels";
import { errorText } from "../chapterCompanion/component";
import "./readingMarksLayer.css";

/** 书页上点开的注脚卡片 */
type OpenNote = {
  docIndex: number;
  key: string;
  num: number;
  item: Annotation;
  /** 标注在主窗口中的位置（px） */
  rect: { left: number; top: number; bottom: number };
};

const CARD_WIDTH = 340;
const CARD_GAP = 8;

/**
 * AI 伴读：把已生成的术语与核心观点标注渲染到书页上；点击标注时在旁边弹出注脚卡片，
 * 核心观点还可进入进一步功能。卡片可用 ×、Esc、点击别处或翻页关闭；也可一键隐藏书页标注。
 */
const ReadingMarksLayer = () => {
  const { t } = useTranslation();
  const htmlBook = useAppStore((s) => s.reader.htmlBook);
  const currentBook = useAppStore((s) => s.book.currentBook);
  const handleCompanionPanel = useAppStore((s) => s.handleCompanionPanel);
  const [note, setNote] = useState<OpenNote | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  // 卡片打开时：Esc 或点击主窗口其他位置关闭
  useEffect(() => {
    if (!note) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setNote(null);
    const onDown = (e: MouseEvent) => {
      if (!cardRef.current?.contains(e.target as Node)) setNote(null);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onDown);
    };
  }, [note]);

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

    const onClick = (event: MouseEvent) => {
      const doc = (event.target as Node | null)?.ownerDocument;
      if (!doc || doc.getSelection()?.toString().trim()) return;
      const hit = hitAnnotation(doc, event.clientX, event.clientY);
      if (!hit) {
        setNote(null);
        return;
      }
      // 阻止点击翻页（mouseEvent.ts 会跳过 defaultPrevented 的点击）：
      // 双栏排版下大部分正文落在左右 30% 的翻页区内，不拦截时一点标注就翻页
      event.preventDefault();
      const { docIndex, annotation } = hit;
      // iframe 内坐标 → 主窗口坐标：章节 iframe 可能嵌在引擎的外层 iframe 里，逐层累加偏移
      const box = annotation.ranges[0]?.getClientRects()[0] || annotation.ranges[0]?.getBoundingClientRect();
      let offX = 0;
      let offY = 0;
      for (let w: Window | null = doc.defaultView; w && w !== window; w = w.parent === w ? null : w.parent) {
        const frame = w.frameElement?.getBoundingClientRect();
        if (!frame) break;
        offX += frame.left;
        offY += frame.top;
      }
      setNote({
        docIndex,
        key: annotation.key,
        num: annotation.index + 1,
        item: annotation.item,
        rect: box
          ? { left: box.left + offX, top: box.top + offY, bottom: box.bottom + offY }
          : { left: event.clientX, top: event.clientY, bottom: event.clientY },
      });
    };

    const onKeyInBook = (e: KeyboardEvent) => e.key === "Escape" && setNote(null);

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
          // 捕获阶段：先于引擎在 document 上冒泡阶段注册的翻页监听执行
          doc.addEventListener("click", onClick, true);
          doc.addEventListener("keydown", onKeyInBook);
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
    const closeNote = () => setNote(null);
    rendition.on("page-changed", closeNote);
    const offTasks = subscribeChapterTasks((task) => {
      if (task.bookKey !== currentBook.key) return;
      if (task.phase === "done") {
        toast.success(t("Reading companion ready") + `：${task.chapterTitle}`, { id: "ai-rc-task-" + task.docIndex });
      } else if (task.phase === "error") {
        toast.error(`${task.chapterTitle}：${errorText(t, task.error)}`, { id: "ai-rc-task-" + task.docIndex });
      }
    });
    const offMarks = subscribeMarksChanged((key) => {
      if (key && key !== currentBook.key) return;
      marksCache.clear();
      schedule();
    });
    return () => {
      if (timer) clearTimeout(timer);
      offPos();
      rendition.off?.("page-changed", closeNote);
      offMarks();
      offTasks();
      for (const { doc } of docsWithIndex()) {
        clearMarks(doc);
        doc.removeEventListener("click", onClick, true);
        doc.removeEventListener("keydown", onKeyInBook);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [htmlBook, currentBook?.key]);
  if (!note) return null;

  const openInPanel = (action?: CompanionAction) => {
    requestFocusAnnotation({ docIndex: note.docIndex, annotation: note.key, action });
    handleCompanionPanel(true);
    setNote(null);
  };

  // 默认放在标注下方，下方放不下时放上方；水平方向不超出窗口
  // 坐标换算异常（例如引擎嵌套 iframe 的偏移取不到）时，兜底放在窗口内，保证卡片可见
  const vh = window.innerHeight;
  const anchorTop = Math.min(Math.max(note.rect.top, 12), vh - 12);
  const anchorBottom = Math.min(Math.max(note.rect.bottom, anchorTop), vh - 12);
  const below = anchorBottom + CARD_GAP;
  const placeAbove = below + 220 > vh && anchorTop > 240;
  const left = Math.max(12, Math.min(note.rect.left, window.innerWidth - CARD_WIDTH - 12));
  const style: React.CSSProperties = placeAbove
    ? { left, bottom: vh - anchorTop + CARD_GAP, width: CARD_WIDTH }
    : { left, top: Math.min(below, vh - 160), width: CARD_WIDTH };
  const { item } = note;

  return (
    <div
      ref={cardRef}
      className={"ai-note-card ai-note-card-" + item.kind}
      style={style}
      role="dialog"
      aria-label={t(KIND_LABEL_KEYS[item.kind])}
    >
      <div className="ai-note-card-head">
        <span className={"ai-note-card-badge ai-note-card-badge-" + item.kind}>
          {t(KIND_LABEL_KEYS[item.kind])}
        </span>
        <span className="ai-note-card-num">[{note.num}]</span>
        <span className="ai-note-card-spacer"></span>
        <span
          className="icon-close ai-note-card-close"
          title={t("Close") + " (Esc)"}
          aria-label={t("Close")}
          onClick={() => setNote(null)}
        ></span>
      </div>
      {item.kind === "term" && <div className="ai-note-card-word">{item.quote}</div>}
      <div className="ai-note-card-body">{item.footnote}</div>
      <div className="ai-note-card-foot">
        {item.kind === "idea" &&
          COMPANION_ACTIONS.map((a) => (
            <span key={a} className="ai-note-card-action" onClick={() => openInPanel(a)}>
              {t(ACTION_LABEL_KEYS[a])}
            </span>
          ))}
        <span className="ai-note-card-spacer"></span>
        <span className="ai-note-card-link" onClick={() => openInPanel()}>
          {t("View in panel")}
        </span>
        <span
          className="ai-note-card-link"
          title={t("AI_COMPANION_HIDE_HINT")}
          onClick={() => {
            setMarksRenderScope("off");
            setNote(null);
          }}
        >
          {t("Hide marks")}
        </span>
      </div>
    </div>
  );
};

export default ReadingMarksLayer;
