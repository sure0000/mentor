// AI 伴读：在书页（阅读器 iframe）上渲染术语与核心观点标注。
// 用 CSS Custom Highlight API：不改动书籍 DOM，不影响引擎分页、已有高亮笔记与选区。
// 注脚内容不写进书页，点击标注时由 readingMarksLayer 弹出。
import { normalizeForMatch } from "./chapterPoints";
import {
  Annotation,
  AnnotationKind,
  ChapterMarks,
  annotationKey,
  locateParagraphs,
  locateQuote,
} from "./readingMarks";

// 样式改动时升级 id，旧文档里的样式会被替换
const STYLE_ID = "koodo-ai-reading-marks-v3";
const OLD_STYLE_IDS = ["koodo-ai-reading-marks", "koodo-ai-reading-marks-v2"];
const NAMES: Record<AnnotationKind, string> = {
  term: "koodo-ai-term",
  idea: "koodo-ai-idea",
};

// 只画底部直线，不改文字颜色与底色：术语 = 蓝色，核心观点 = 橙色。
// PDF 等固定版式的透明文字层同样适用（不改 color 就不会显形重影）。
const STYLE = `
::highlight(${NAMES.term}) {
  text-decoration: underline solid rgb(40, 120, 220);
  text-decoration-thickness: 2px;
  text-underline-offset: 3px;
}
::highlight(${NAMES.idea}) {
  text-decoration: underline solid rgb(230, 120, 20);
  text-decoration-thickness: 2px;
  text-underline-offset: 3px;
}`;

type HighlightCtor = new (...ranges: Range[]) => unknown;
export type HighlightWindow = Window & {
  Highlight?: HighlightCtor;
  CSS?: { highlights?: Map<string, unknown> };
};

export const isMarksRenderSupported = (doc: Document | null) => {
  const win = doc?.defaultView as HighlightWindow | null;
  return !!(win && win.Highlight && win.CSS && win.CSS.highlights);
};

/** 页面文本的规范化串，以及每个规范化字符对应的 (文本节点, 偏移) */
export type TextMap = { norm: string; nodes: Text[]; offsets: number[]; nodeIdx: number[] };

export const buildTextMap = (doc: Document): TextMap => {
  const map: TextMap = { norm: "", nodes: [], offsets: [], nodeIdx: [] };
  if (!doc.body) return map;
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => {
      const tag = n.parentElement?.tagName;
      return tag === "SCRIPT" || tag === "STYLE" ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
    },
  });
  const parts: string[] = [];
  let node: Node | null;
  while ((node = walker.nextNode())) {
    const text = node as Text;
    const data = text.data;
    const ni = map.nodes.length;
    map.nodes.push(text);
    let offset = 0;
    for (const ch of data) {
      const n = normalizeForMatch(ch);
      for (let k = 0; k < n.length; k++) {
        parts.push(n[k]);
        map.offsets.push(offset);
        map.nodeIdx.push(ni);
      }
      offset += ch.length;
    }
  }
  map.norm = parts.join("");
  return map;
};

export const makeRange = (doc: Document, map: TextMap, span: [number, number]) => {
  const [s, e] = span;
  if (e <= s || e > map.norm.length) return null;
  const startNode = map.nodes[map.nodeIdx[s]];
  const endNode = map.nodes[map.nodeIdx[e - 1]];
  const endText = endNode.data;
  let endOffset = map.offsets[e - 1] + 1;
  // 末字符为代理对时包含完整字符
  if (endOffset < endText.length && /[\uDC00-\uDFFF]/.test(endText[endOffset])) endOffset++;
  const range = doc.createRange();
  try {
    range.setStart(startNode, map.offsets[s]);
    range.setEnd(endNode, Math.min(endOffset, endText.length));
  } catch (e) {
    return null;
  }
  return range;
};

/** index + 1 为注脚编号 */
export type RenderedAnnotation = { key: string; index: number; item: Annotation; ranges: Range[] };

/** 某个文档上当前渲染的伴读标注（点击命中判断用） */
const rendered = new WeakMap<Document, { docIndex: number; stamp: string; annotations: RenderedAnnotation[] }>();

export const clearMarks = (doc: Document | null) => {
  if (!doc) return;
  const win = doc.defaultView as HighlightWindow | null;
  Object.values(NAMES).forEach((n) => win?.CSS?.highlights?.delete(n));
  rendered.delete(doc);
};

const ensureStyle = (doc: Document) => {
  if (doc.getElementById(STYLE_ID)) return;
  OLD_STYLE_IDS.forEach((id) => doc.getElementById(id)?.remove());
  const style = doc.createElement("style");
  style.id = STYLE_ID;
  style.textContent = STYLE;
  (doc.head || doc.documentElement).appendChild(style);
};

/**
 * 在文档上渲染一章的标注。paragraphs 为生成时的段落切分。
 * 同一文档、同一份标注已渲染过时直接跳过（翻页时不重复计算）。
 * 返回定位成功的标注数，便于界面提示。
 */
export const renderMarks = (
  doc: Document,
  marks: ChapterMarks,
  paragraphs: string[]
): { located: number; total: number } => {
  const total = marks.annotations.length;
  const stamp = `${marks.docIndex}:${marks.createdAt}:${doc.body?.textContent?.length || 0}`;
  const prev = rendered.get(doc);
  if (prev && prev.stamp === stamp) return { located: -1, total };
  const win = doc.defaultView as HighlightWindow | null;
  if (!win || !win.Highlight || !win.CSS?.highlights) return { located: 0, total };
  ensureStyle(doc);
  const map = buildTextMap(doc);
  const spans = locateParagraphs(map.norm, paragraphs.map(normalizeForMatch));
  const byKind: Record<AnnotationKind, Range[]> = { term: [], idea: [] };
  const annotations: RenderedAnnotation[] = [];
  marks.annotations.forEach((a, index) => {
    if (!a.verified) return;
    const span = locateQuote(map.norm, normalizeForMatch(a.quote), spans[a.para - 1] || null);
    const r = span && makeRange(doc, map, span);
    if (!r) return;
    byKind[a.kind].push(r);
    annotations.push({ key: annotationKey(a), index, item: a, ranges: [r] });
  });
  const H = win.Highlight;
  win.CSS.highlights.set(NAMES.idea, new H(...byKind.idea));
  const termHighlight = new H(...byKind.term) as { priority?: number };
  // 术语常落在核心观点句内，画在其上
  termHighlight.priority = 1;
  win.CSS.highlights.set(NAMES.term, termHighlight);
  rendered.set(doc, { docIndex: marks.docIndex, stamp, annotations });
  return { located: annotations.length, total: marks.annotations.length };
};

/** 点到划线的容差（px）：下划线画在文字下方几像素处 */
const HIT_SLOP = 4;

const rectHit = (r: Range, x: number, y: number) => {
  try {
    for (const rect of Array.from(r.getClientRects())) {
      if (
        x >= rect.left - HIT_SLOP &&
        x <= rect.right + HIT_SLOP &&
        y >= rect.top - HIT_SLOP &&
        y <= rect.bottom + HIT_SLOP
      ) {
        return true;
      }
    }
  } catch (e) {
    // 节点已被引擎替换
  }
  return false;
};

/**
 * 点击位置命中的标注；术语优先（术语常嵌在核心观点句中）。
 * 按划线在屏幕上的矩形判断，不用 caretRangeFromPoint：后者在行尾、行间、
 * 行内元素边界处常返回父元素，导致点在划线上也判为未命中。
 */
export const hitAnnotation = (
  doc: Document,
  x: number,
  y: number
): { docIndex: number; annotation: RenderedAnnotation } | null => {
  const info = rendered.get(doc);
  if (!info) return null;
  const hits = info.annotations.filter((a) => a.ranges.some((r) => rectHit(r, x, y)));
  const hit = hits.find((a) => a.item.kind === "term") || hits[0];
  return hit ? { docIndex: info.docIndex, annotation: hit } : null;
};

