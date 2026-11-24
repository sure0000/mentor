// AI 问书：划线引用的「自动标记与定位」。
// 选中文字点「问书」后侧边栏停靠、正文按新宽度重排，原选区随旧 DOM 一起消失，
// 被引用的文字可能被挤到别的页上。这里在点问书时记下引文及其前文，
// 重排后在新 DOM 中重新找到它：用 CSS Custom Highlight 标出来，不在当前页时跳过去。
import Book from "../../models/Book";
import { getIframeDoc, mergeSelectionRects } from "./docUtil";
import { normalizeForMatch } from "../aiReading/chapterPoints";
import {
  HighlightWindow,
  buildTextMap,
  makeRange,
} from "../aiReading/marksRenderer";

const STYLE_ID = "mentor-ai-quote-mark";
const HIGHLIGHT_NAME = "mentor-ai-quote";
const QUOTE_COLOR = "rgba(255, 196, 0, 0.38)";
// 只改底色不改文字颜色：PDF 透明文字层改 color 会显形重影
const STYLE = `
::highlight(${HIGHLIGHT_NAME}) {
  background-color: ${QUOTE_COLOR};
}
.mentor-pdf-quote-layer { position: absolute; left: 0; top: 0; width: 0; height: 0; pointer-events: none; z-index: 1; }
.mentor-pdf-quote-line { position: absolute; background: ${QUOTE_COLOR}; border-radius: 2px; }`;
const PDF_LAYER_CLASS = "mentor-pdf-quote-layer";
/** PDF 文字层在 rendered 之后才异步生成，找不到引文时按此间隔重试 */
const RETRY_INTERVAL = 300;
const RETRY_TIMES = 15;
/** 用于区分重复出现的引文：记录引文前这么多个规范化字符 */
const PREFIX_CHARS = 24;

type QuoteAnchor = { norm: string; prefix: string };

let anchor: QuoteAnchor | null = null;
/** 发生重排后置位，下一次恢复标记时若引文不在可视区就跳过去，只跳一次 */
let pendingLocate = false;
/** goToNode 会再次触发 rendered，定位期间不再重复定位 */
let locating = false;
const markedDocs = new Set<Document>();
let retryTimer: ReturnType<typeof setTimeout> | null = null;

const getDocs = (book: Book) =>
  getIframeDoc(book).filter((doc): doc is Document => !!doc && !!doc.body);

const ensureStyle = (doc: Document) => {
  if (doc.getElementById(STYLE_ID)) return;
  const style = doc.createElement("style");
  style.id = STYLE_ID;
  style.textContent = STYLE;
  (doc.head || doc.documentElement).appendChild(style);
};

const clearDocs = () => {
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
  markedDocs.forEach((doc) => {
    try {
      (doc.defaultView as HighlightWindow | null)?.CSS?.highlights?.delete(
        HIGHLIGHT_NAME
      );
      doc.documentElement.querySelector("." + PDF_LAYER_CLASS)?.remove();
    } catch (e) {
      // 文档已随重排销毁
    }
  });
  markedDocs.clear();
};

/** 在规范化全文中找引文：优先匹配前文一致的那一处，否则取第一处 */
const findSpan = (norm: string, a: QuoteAnchor): [number, number] | null => {
  let best = -1;
  let bestScore = -1;
  for (let i = norm.indexOf(a.norm); i >= 0; i = norm.indexOf(a.norm, i + 1)) {
    const before = norm.slice(Math.max(0, i - a.prefix.length), i);
    let score = 0;
    while (
      score < before.length &&
      before[before.length - 1 - score] === a.prefix[a.prefix.length - 1 - score]
    ) {
      score++;
    }
    if (score > bestScore) {
      best = i;
      bestScore = score;
      if (score === a.prefix.length) break;
    }
  }
  return best < 0 ? null : [best, best + a.norm.length];
};

/**
 * PDF 文字层是透明文字（引擎把原生选区底色也关掉了），::highlight 画不出来。
 * 与 docUtil 里自绘选区相同：取文字层内各文字块的屏幕矩形，按行合并后画一层底色
 */
const paintPdfQuote = (doc: Document, range: Range) => {
  const rects: { left: number; top: number; right: number; bottom: number }[] = [];
  const walker = doc.createTreeWalker(range.commonAncestorContainer, NodeFilter.SHOW_TEXT);
  let node: Node | null =
    walker.currentNode.nodeType === Node.TEXT_NODE ? walker.currentNode : walker.nextNode();
  for (; node; node = walker.nextNode()) {
    const parent = node.parentElement;
    if (!parent || !parent.closest(".textLayer") || parent.closest(".endOfContent")) continue;
    if (!range.intersectsNode(node)) continue;
    const text = node as Text;
    const r = doc.createRange();
    r.setStart(text, text === range.startContainer ? range.startOffset : 0);
    r.setEnd(text, text === range.endContainer ? range.endOffset : text.length);
    Array.from(r.getClientRects()).forEach((c) =>
      rects.push({ left: c.left, top: c.top, right: c.right, bottom: c.bottom })
    );
  }
  const lines = mergeSelectionRects(rects);
  if (!lines.length) return false;
  const layer = doc.createElement("div");
  layer.className = PDF_LAYER_CLASS;
  const sx = doc.defaultView?.scrollX || 0;
  const sy = doc.defaultView?.scrollY || 0;
  lines.forEach((l) => {
    const div = doc.createElement("div");
    div.className = "mentor-pdf-quote-line";
    div.style.left = l.left + sx + "px";
    div.style.top = l.top + sy + "px";
    div.style.width = l.right - l.left + "px";
    div.style.height = l.bottom - l.top + "px";
    layer.appendChild(div);
  });
  doc.documentElement.appendChild(layer);
  return true;
};

const isRangeVisible = (doc: Document, range: Range) => {
  const rect = range.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return false;
  const width = doc.documentElement.clientWidth || doc.defaultView?.innerWidth || 0;
  const height = doc.documentElement.clientHeight || doc.defaultView?.innerHeight || 0;
  // 滚动模式下 iframe 被整体撑高，以外层阅读区为准
  const frame = doc.defaultView?.frameElement as HTMLElement | null;
  const pageArea = document.getElementById("page-area");
  if (frame && pageArea && frame.ownerDocument === document) {
    const frameRect = frame.getBoundingClientRect();
    const viewRect = pageArea.getBoundingClientRect();
    const top = rect.top + frameRect.top;
    const bottom = rect.bottom + frameRect.top;
    const left = rect.left + frameRect.left;
    const right = rect.right + frameRect.left;
    return (
      bottom > viewRect.top &&
      top < viewRect.bottom &&
      right > viewRect.left &&
      left < viewRect.right
    );
  }
  return rect.right > 0 && rect.left < width && rect.bottom > 0 && rect.top < height;
};

/**
 * 点问书时调用：记下当前选区的引文，并立即标记（输入框获得焦点后原选区会变灰/消失）。
 */
export const captureQuoteAnchor = (book: Book) => {
  clearDocs();
  anchor = null;
  pendingLocate = false;
  for (const doc of getDocs(book)) {
    const sel = doc.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) continue;
    const range = sel.getRangeAt(0);
    const norm = normalizeForMatch(range.toString());
    if (!norm) continue;
    const before = doc.createRange();
    try {
      before.setStart(doc.body, 0);
      before.setEnd(range.startContainer, range.startOffset);
    } catch (e) {
      continue;
    }
    anchor = { norm, prefix: normalizeForMatch(before.toString()).slice(-PREFIX_CHARS) };
    break;
  }
  if (anchor) restoreQuoteMark(book, null);
};

/** 正文即将按新宽度重排时调用，重排完成后会把引文定位回可视区 */
export const requestQuoteRelocate = () => {
  if (anchor) pendingLocate = true;
};

export const hasQuoteRelocatePending = () => !!anchor && pendingLocate;

export const clearQuoteMark = () => {
  clearDocs();
  anchor = null;
  pendingLocate = false;
};

/**
 * 在当前渲染的文档中重新标出引文。rendition 不为空且有待定位请求时，
 * 引文不在可视区就用 goToNode 跳过去。
 */
export const restoreQuoteMark = async (
  book: Book,
  rendition: any,
  retries = RETRY_TIMES
) => {
  if (!anchor) return;
  const a = anchor;
  clearDocs();
  let found: { doc: Document; range: Range } | null = null;
  for (const doc of getDocs(book)) {
    const map = buildTextMap(doc);
    const span = findSpan(map.norm, a);
    const range = span && makeRange(doc, map, span);
    if (!range) continue;
    ensureStyle(doc);
    const isPdfText = !!range.startContainer.parentElement?.closest(".textLayer");
    if (isPdfText) {
      // 文字层还没排好（矩形全为空）时当作没找到，等重试
      if (!paintPdfQuote(doc, range)) continue;
    } else {
      const win = doc.defaultView as HighlightWindow | null;
      if (!win?.Highlight || !win.CSS?.highlights) continue;
      win.CSS.highlights.set(HIGHLIGHT_NAME, new win.Highlight(range));
    }
    markedDocs.add(doc);
    found = { doc, range };
    break;
  }
  if (!found) {
    // PDF 等分页书籍的文字层在 rendered 之后才生成，稍后再找
    if (retries > 0) {
      retryTimer = setTimeout(() => {
        retryTimer = null;
        if (anchor === a) restoreQuoteMark(book, rendition, retries - 1);
      }, RETRY_INTERVAL);
    }
    return;
  }
  if (!rendition || !pendingLocate || locating) return;
  pendingLocate = false;
  // PDF 等分页文档的引文在子 iframe 里，重排不会换页，无需跳转
  if (found.doc.defaultView?.frameElement?.ownerDocument !== document) return;
  if (isRangeVisible(found.doc, found.range)) return;
  if (typeof rendition.goToNode !== "function") return;
  const node = found.range.startContainer;
  const target = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
  if (!target) return;
  locating = true;
  try {
    await rendition.goToNode(target);
  } catch (e) {
    console.error("Locate quote failed:", e);
  } finally {
    locating = false;
  }
  // 跳转可能触发重新渲染（换章），在新文档上补一次标记
  if (anchor === a) await restoreQuoteMark(book, null);
};
