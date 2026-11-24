// PDF 覆盖翻译：在每页按段落原位置盖一块与页面同色的底，写上译文。
// PDF 是固定版式（canvas + 透明文字层），无法像 EPUB 那样插入译文行，
// 只能就地覆盖；译文过长时逐步缩小字号直到放得下。
// 覆盖层挂在每页子文档的根元素下，pointer-events: none，不影响文字层选区。
import { ConfigService } from "../../assets/lib/kookit-extra-browser.min";
import Book from "../../models/Book";
import { isAiAvailable } from "../aiReading/aiGateway";
import { throttle } from "../common";
import { useAppStore } from "../../store/useAppStore";
import { getIframeDoc } from "./docUtil";
import { getCachedTranslations, translateParagraphs } from "./fullTranslation";
import { groupParagraphBlocks, ParagraphBlock, TextBox } from "./pdfParagraphs";
import { collectBoxes } from "./pdfPageText";

/** PDF 译文缓存共用一个分组：缓存按原文文本索引，与页码无关 */
export const PDF_TRANS_CHAPTER = "pdf";

const LAYER_CLASS = "mentor-pdf-trans-layer";
const STYLE_ID = "mentor-pdf-trans-style";
const PDF_TRANS_BOOKS = "pdfTranslationBooks";
const MIN_FONT_PX = 6;

/** PDF 翻译的显示方式：overlay 覆盖在页面原文上；side 在右侧面板上下行对照 */
export type PdfTranslationView = "overlay" | "side";

export const getPdfTranslationView = (): PdfTranslationView =>
  ConfigService.getReaderConfig("pdfTranslationView") === "side" ? "side" : "overlay";

export const isPdfTranslationEnabled = (bookKey?: string) =>
  !!bookKey && ConfigService.getAllListConfig(PDF_TRANS_BOOKS).includes(bookKey);

export const isPdfOverlayEnabled = (bookKey?: string) =>
  isPdfTranslationEnabled(bookKey) && getPdfTranslationView() === "overlay";

interface OverlaySession {
  rendition: any;
  book: Book;
  failed: Set<string>;
  /** 每页上次绘制时的签名（文字 + 尺寸 + 译文数），未变化时不重绘 */
  drawn: WeakMap<Document, string>;
  busy: boolean;
  pending: boolean;
  detach: () => void;
}
let session: OverlaySession | null = null;

const injectStyle = (doc: Document) => {
  if (doc.getElementById(STYLE_ID)) return;
  const style = doc.createElement("style");
  style.id = STYLE_ID;
  style.textContent =
    `.${LAYER_CLASS}{position:absolute;left:0;top:0;width:0;height:0;pointer-events:none;z-index:1;}` +
    `.${LAYER_CLASS}>div{position:absolute;box-sizing:border-box;overflow:hidden;` +
    `line-height:1.3;word-break:break-word;white-space:normal;text-align:justify;` +
    `font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;}`;
  (doc.head || doc.documentElement).appendChild(style);
};

/** 取段落四周（文字之外）的页面像素作为底色；取不到时用白底 */
const sampleBackground = (doc: Document, block: TextBox): [number, number, number] => {
  const canvas = doc.querySelector("canvas");
  if (!canvas) return [255, 255, 255];
  try {
    const rect = canvas.getBoundingClientRect();
    const ctx = canvas.getContext("2d", { willReadFrequently: true } as CanvasRenderingContext2DSettings);
    if (!ctx || rect.width === 0) return [255, 255, 255];
    const sx = canvas.width / rect.width;
    const sy = canvas.height / rect.height;
    const points = [
      [block.left - 3, block.top - 3],
      [block.right + 3, block.top - 3],
      [block.left - 3, block.bottom + 3],
      [block.right + 3, block.bottom + 3],
      [(block.left + block.right) / 2, block.top - 3],
    ];
    const colors = points
      .map(([x, y]) => {
        const px = Math.round((x - rect.left) * sx);
        const py = Math.round((y - rect.top) * sy);
        if (px < 0 || py < 0 || px >= canvas.width || py >= canvas.height) return null;
        const d = ctx.getImageData(px, py, 1, 1).data;
        return [d[0], d[1], d[2]] as [number, number, number];
      })
      .filter((c): c is [number, number, number] => !!c);
    if (!colors.length) return [255, 255, 255];
    // 取最亮的采样点：边缘可能压到相邻文字或线条
    return colors.sort((a, b) => b[0] + b[1] + b[2] - (a[0] + a[1] + a[2]))[0];
  } catch (_) {
    return [255, 255, 255];
  }
};

/** 从最接近原文行高的字号开始缩小，直到译文放进段落框 */
const fitText = (el: HTMLElement, block: ParagraphBlock) => {
  let size = Math.max(MIN_FONT_PX, block.lineHeight * 0.82);
  el.style.fontSize = size + "px";
  while (el.scrollHeight > el.clientHeight + 1 && size > MIN_FONT_PX) {
    size = Math.max(MIN_FONT_PX, size * 0.92);
    el.style.fontSize = size + "px";
  }
  // 最小字号仍放不下：向下延伸，宁可压到下方空白也不截断译文
  if (el.scrollHeight > el.clientHeight + 1) el.style.height = el.scrollHeight + "px";
};

const drawDoc = (doc: Document, blocks: ParagraphBlock[], dict: Record<string, string>) => {
  injectStyle(doc);
  let layer = doc.documentElement.querySelector<HTMLElement>("." + LAYER_CLASS);
  if (!layer) {
    layer = doc.createElement("div");
    layer.className = LAYER_CLASS;
    doc.documentElement.appendChild(layer);
  }
  layer.textContent = "";
  const scrollX = doc.defaultView?.scrollX || 0;
  const scrollY = doc.defaultView?.scrollY || 0;
  for (const block of blocks) {
    const translated = dict[block.text];
    // 未译完的段落保留原文，不盖白底
    if (!translated) continue;
    const [r, g, b] = sampleBackground(doc, block);
    const dark = r * 0.299 + g * 0.587 + b * 0.114 < 128;
    const pad = 2;
    const el = doc.createElement("div");
    el.style.left = block.left - pad + scrollX + "px";
    el.style.top = block.top - pad + scrollY + "px";
    el.style.width = block.right - block.left + pad * 2 + "px";
    el.style.height = block.bottom - block.top + pad * 2 + "px";
    el.style.padding = pad + "px";
    el.style.backgroundColor = `rgb(${r},${g},${b})`;
    el.style.color = dark ? "#eee" : "#222";
    el.textContent = translated;
    layer.appendChild(el);
    fitText(el, block);
  }
};

const clearDoc = (doc: Document | null) => {
  doc?.documentElement?.querySelector("." + LAYER_CLASS)?.remove();
};

/** 当前可见页的子文档（PDF 每页一个子 iframe） */
const getPageDocs = (book: Book): Document[] => {
  const docs = getIframeDoc(book).filter((d): d is Document => !!d && !!d.body);
  const pages = docs.filter((d) => d.querySelector(".textLayer"));
  const viewH = window.innerHeight;
  const viewW = window.innerWidth;
  return pages.filter((d) => {
    const frame = d.defaultView?.frameElement as HTMLElement | null | undefined;
    if (!frame) return true;
    const outer = frame.ownerDocument.defaultView?.frameElement as HTMLElement | null | undefined;
    const r = frame.getBoundingClientRect();
    const o = outer?.getBoundingClientRect() || { left: 0, top: 0 };
    const left = r.left + o.left;
    const top = r.top + o.top;
    // 多渲染上下各一屏，翻页时少见到原文闪一下
    return r.width > 0 && left < viewW && left + r.width > 0 && top < viewH * 2 && top + r.height > -viewH;
  });
};

const renderOnce = async (s: OverlaySession) => {
  const docs = getPageDocs(s.book);
  const pages = docs.map((doc) => ({ doc, blocks: groupParagraphBlocks(collectBoxes(doc)) }));
  const draw = () => {
    const dict = getCachedTranslations(s.book.key, PDF_TRANS_CHAPTER);
    for (const { doc, blocks } of pages) {
      const done = blocks.filter((b) => dict[b.text]).length;
      const signature =
        `${doc.documentElement.clientWidth}x${doc.documentElement.clientHeight}|${done}|` +
        blocks.map((b) => b.text.length).join(",");
      const hasLayer = !!doc.documentElement.querySelector("." + LAYER_CLASS);
      if (hasLayer && s.drawn.get(doc) === signature) continue;
      s.drawn.set(doc, signature);
      drawDoc(doc, blocks, dict);
    }
  };
  draw();
  if (!isAiAvailable("translate")) return;
  // 逐页翻译，先译屏幕上方的页
  for (const { blocks } of pages) {
    if (session !== s) return;
    const texts = blocks.map((b) => b.text);
    await translateParagraphs(s.book, PDF_TRANS_CHAPTER, texts, s.failed);
    if (session !== s) return;
    draw();
  }
};

/** 翻页 / 滚动 / 渲染后调用；正在翻译时合并为一次后续刷新 */
export const renderPdfOverlay = async () => {
  const s = session;
  if (!s || !isPdfOverlayEnabled(s.book.key)) return;
  if (s.busy) {
    s.pending = true;
    return;
  }
  s.busy = true;
  try {
    do {
      s.pending = false;
      // 文字层在页面绘制后异步生成，稍等再读取
      await new Promise((resolve) => setTimeout(resolve, 300));
      await renderOnce(s);
    } while (s.pending && session === s);
  } catch (error) {
    console.error("PDF overlay translation failed:", error);
  } finally {
    s.busy = false;
  }
};

export const attachPdfOverlay = (rendition: any, book: Book) => {
  session?.detach();
  const onChange = throttle(() => {
    renderPdfOverlay();
  }, 500);
  rendition.on("page-changed", onChange);
  rendition.on("rendered", onChange);
  const scroller = document.getElementById("page-area");
  scroller?.addEventListener("scroll", onChange, { passive: true });
  window.addEventListener("resize", onChange);
  const s: OverlaySession = {
    rendition,
    book,
    failed: new Set(),
    drawn: new WeakMap(),
    busy: false,
    pending: false,
    detach: () => {
      rendition.off?.("page-changed", onChange);
      rendition.off?.("rendered", onChange);
      scroller?.removeEventListener("scroll", onChange);
      window.removeEventListener("resize", onChange);
      if (session === s) session = null;
    },
  };
  session = s;
  applyPdfTranslation(book);
  return s.detach;
};

/** 按当前开关与显示方式同步覆盖层和侧边面板 */
export const applyPdfTranslation = (book: Book) => {
  const enabled = isPdfTranslationEnabled(book.key);
  const view = getPdfTranslationView();
  const store = useAppStore.getState();
  if (enabled && view === "side") {
    store.handleCompanionPanel(false);
    store.handlePdfTranslationPanel(true);
  } else {
    store.handlePdfTranslationPanel(false);
  }
  if (enabled && view === "overlay") {
    if (session) {
      session.failed.clear();
      session.drawn = new WeakMap();
    }
    renderPdfOverlay();
  } else {
    getIframeDoc(book).forEach(clearDoc);
  }
};

export const setPdfTranslation = (
  book: Book,
  patch: { enabled?: boolean; view?: PdfTranslationView }
) => {
  if (patch.enabled !== undefined) {
    if (patch.enabled) ConfigService.setListConfig(book.key, PDF_TRANS_BOOKS);
    else ConfigService.deleteListConfig(book.key, PDF_TRANS_BOOKS);
  }
  if (patch.view) ConfigService.setReaderConfig("pdfTranslationView", patch.view);
  applyPdfTranslation(book);
};

/* 目标语言变化：覆盖层重绘，侧边面板通过订阅刷新 */
const targetListeners = new Set<() => void>();
export const onTranslationTargetChange = (fn: () => void) => {
  targetListeners.add(fn);
  return () => {
    targetListeners.delete(fn);
  };
};
export const notifyTranslationTargetChange = () => {
  if (session) {
    session.failed.clear();
    session.drawn = new WeakMap();
    renderPdfOverlay();
  }
  targetListeners.forEach((fn) => fn());
};
