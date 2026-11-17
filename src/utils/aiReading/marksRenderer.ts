// AI 伴读：在书页（阅读器 iframe）上渲染阅读分级与重点划线。
// 用 CSS Custom Highlight API：不改动书籍 DOM，不影响引擎分页、已有高亮笔记与选区。
import { normalizeForMatch } from "./chapterPoints";
import {
  ChapterMarks,
  ReadingLevel,
  locateParagraphs,
  locateQuote,
  segmentKey,
} from "./readingMarks";

const STYLE_ID = "koodo-ai-reading-marks";
const NAMES = {
  skim: "koodo-ai-skim",
  deep: "koodo-ai-deep",
  key: "koodo-ai-key",
} as const;

const STYLE = `
::highlight(${NAMES.skim}) { color: rgba(128, 128, 128, 0.75); }
::highlight(${NAMES.deep}) { background-color: rgba(255, 196, 0, 0.16); }
::highlight(${NAMES.key}) {
  text-decoration: underline;
  text-decoration-color: rgba(230, 80, 60, 0.9);
  text-decoration-thickness: 2px;
  text-underline-offset: 3px;
}`;

type HighlightCtor = new (...ranges: Range[]) => unknown;
type HighlightWindow = Window & {
  Highlight?: HighlightCtor;
  CSS?: { highlights?: Map<string, unknown> };
};

export const isMarksRenderSupported = (doc: Document | null) => {
  const win = doc?.defaultView as HighlightWindow | null;
  return !!(win && win.Highlight && win.CSS && win.CSS.highlights);
};

/** 页面文本的规范化串，以及每个规范化字符对应的 (文本节点, 偏移) */
type TextMap = { norm: string; nodes: Text[]; offsets: number[]; nodeIdx: number[] };

const buildTextMap = (doc: Document): TextMap => {
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

const makeRange = (doc: Document, map: TextMap, span: [number, number]) => {
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

export type RenderedSegment = { key: string; level: ReadingLevel; title: string; ranges: Range[] };

/** 某个文档上当前渲染的伴读标注（点击命中判断用） */
const rendered = new WeakMap<Document, { docIndex: number; stamp: string; segments: RenderedSegment[] }>();

export const clearMarks = (doc: Document | null) => {
  if (!doc) return;
  const win = doc.defaultView as HighlightWindow | null;
  Object.values(NAMES).forEach((n) => win?.CSS?.highlights?.delete(n));
  rendered.delete(doc);
};

const ensureStyle = (doc: Document) => {
  if (doc.getElementById(STYLE_ID)) return;
  const style = doc.createElement("style");
  style.id = STYLE_ID;
  style.textContent = STYLE;
  (doc.head || doc.documentElement).appendChild(style);
};

/**
 * 在文档上渲染一章的标注。paragraphs 为生成时的段落切分。
 * 同一文档、同一份标注已渲染过时直接跳过（翻页时不重复计算）。
 * 返回定位成功的段落数，便于界面提示。
 */
export const renderMarks = (
  doc: Document,
  marks: ChapterMarks,
  paragraphs: string[]
): { located: number; total: number } => {
  const total = paragraphs.length;
  const stamp = `${marks.docIndex}:${marks.createdAt}:${doc.body?.textContent?.length || 0}`;
  const prev = rendered.get(doc);
  if (prev && prev.stamp === stamp) return { located: -1, total };
  const win = doc.defaultView as HighlightWindow | null;
  if (!win || !win.Highlight || !win.CSS?.highlights) return { located: 0, total };
  ensureStyle(doc);
  const map = buildTextMap(doc);
  const spans = locateParagraphs(map.norm, paragraphs.map(normalizeForMatch));
  const byLevel: Record<"skim" | "deep", Range[]> = { skim: [], deep: [] };
  const segments: RenderedSegment[] = [];
  for (const seg of marks.segments) {
    const ranges: Range[] = [];
    for (let p = seg.from; p <= seg.to; p++) {
      const span = spans[p - 1];
      const r = span && makeRange(doc, map, span);
      if (r) ranges.push(r);
    }
    if (seg.level !== "light") byLevel[seg.level].push(...ranges);
    segments.push({ key: segmentKey(seg), level: seg.level, title: seg.title, ranges });
  }
  const keyRanges: Range[] = [];
  for (const line of marks.keyLines) {
    if (!line.verified) continue;
    const span = locateQuote(map.norm, normalizeForMatch(line.quote), spans[line.para - 1] || null);
    const r = span && makeRange(doc, map, span);
    if (r) keyRanges.push(r);
  }
  const H = win.Highlight;
  win.CSS.highlights.set(NAMES.skim, new H(...byLevel.skim));
  win.CSS.highlights.set(NAMES.deep, new H(...byLevel.deep));
  win.CSS.highlights.set(NAMES.key, new H(...keyRanges));
  rendered.set(doc, { docIndex: marks.docIndex, stamp, segments });
  return { located: spans.filter(Boolean).length, total };
};

/** 点击位置命中的已渲染区间（只用于精读段落的进一步功能） */
export const hitSegment = (
  doc: Document,
  x: number,
  y: number
): { docIndex: number; segment: RenderedSegment } | null => {
  const info = rendered.get(doc);
  if (!info) return null;
  const caret = (doc as Document & {
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  }).caretRangeFromPoint?.(x, y);
  if (!caret) return null;
  for (const segment of info.segments) {
    for (const r of segment.ranges) {
      try {
        if (r.isPointInRange(caret.startContainer, caret.startOffset)) {
          return { docIndex: info.docIndex, segment };
        }
      } catch (e) {
        // 节点已被引擎替换
      }
    }
  }
  return null;
};
