// AI 伴读：术语与核心观点标注 + 注脚的纯逻辑（提示词、Schema、结果整理、原文定位）。
// 无 DOM / 无 IPC，便于单测。
// 思路：把章节切成带编号的段落交给模型，模型只回答「段落编号 + 逐字原文 + 注脚」；
// 原文由程序在段落中核对，按出现顺序编号为注脚 [1] [2] …
import type { IndexChapter } from "./indexText";
import type { QaSource } from "./bookQa";
import { MAX_CHAPTER_CHARS, hashText, normalizeForMatch } from "./chapterPoints";

export const READING_MARKS_VERSION = 2;

/** term = 术语；idea = 核心观点 */
export type AnnotationKind = "term" | "idea";
export const ANNOTATION_KINDS: AnnotationKind[] = ["idea", "term"];

/** 每章最多保留的条数（模型偶尔会标太多） */
const MAX_PER_KIND: Record<AnnotationKind, number> = { term: 15, idea: 8 };

export interface Annotation {
  kind: AnnotationKind;
  /** 所在段落编号（1 起）；未定位时为模型给出的值 */
  para: number;
  /** 原文：术语本身，或表达核心观点的一句原文 */
  quote: string;
  /** 注脚：帮助理解的解释 */
  footnote: string;
  verified: boolean;
}

/** 核心观点的进一步功能：辅助阅读 / 知识关联 / 拓展阅读 */
export type CompanionAction = "assist" | "relate" | "further";
export const COMPANION_ACTIONS: CompanionAction[] = ["assist", "relate", "further"];

export interface ActionResult {
  content: string;
  sources: QaSource[];
  usage: string;
  createdAt: number;
}

export interface ChapterMarks {
  version: number;
  docIndex: number;
  chapterTitle: string;
  textHash: string;
  paraCount: number;
  /** 一句话：本章的核心主张 */
  overview: string;
  /** 按原文出现顺序排列（未定位的在最后），下标 + 1 即注脚编号 */
  annotations: Annotation[];
  truncated: boolean;
  costUsd: number;
  durationMs: number;
  createdAt: number;
  /** 核心观点的进一步结果，键为 annotationKey */
  extras?: Record<string, Partial<Record<CompanionAction, ActionResult>>>;
}

export const annotationKey = (a: Pick<Annotation, "kind" | "quote">) =>
  `${a.kind}-${hashText(normalizeForMatch(a.quote))}`;

const PARA_MAX = 800;
const PARA_TARGET = 400;

/**
 * 把章节正文切成段落：按换行切；过长的段（PDF 整页无换行）按句子切成约 400 字。
 * 超过 maxChars 的部分不发送（truncated）。切分结果决定段落编号，改动时须升级版本号。
 */
export const splitParagraphs = (
  text: string,
  maxChars = MAX_CHAPTER_CHARS
): { paragraphs: string[]; truncated: boolean } => {
  const all: string[] = [];
  for (const line of (text || "").split(/\n+/)) {
    const p = line.trim();
    if (!p) continue;
    if (p.length <= PARA_MAX) {
      all.push(p);
      continue;
    }
    let buf = "";
    for (const s of p.split(/(?<=[。！？!?.;；])\s*/)) {
      if (buf && buf.length + s.length > PARA_TARGET) {
        all.push(buf);
        buf = "";
      }
      buf += (buf && /[A-Za-z0-9,.;:!?]$/.test(buf) ? " " : "") + s;
      while (buf.length > PARA_MAX) {
        all.push(buf.slice(0, PARA_MAX));
        buf = buf.slice(PARA_MAX);
      }
    }
    if (buf) all.push(buf);
  }
  const kept: string[] = [];
  let used = 0;
  for (const p of all) {
    if (kept.length && used + p.length > maxChars) break;
    kept.push(p);
    used += p.length;
  }
  return { paragraphs: kept, truncated: kept.length < all.length };
};

export const READING_MARKS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["overview", "annotations"],
  properties: {
    overview: { type: "string", description: "一句话概括本章的核心主张" },
    annotations: {
      type: "array",
      maxItems: 24,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["kind", "para", "quote", "footnote"],
        properties: {
          kind: { type: "string", enum: ["term", "idea"], description: "term = 术语，idea = 核心观点" },
          para: { type: "integer", description: "原文所在段落编号" },
          quote: {
            type: "string",
            description:
              "从该段落中逐字复制：术语只写术语本身；核心观点写表达该观点的一句原文（10–80 字）。不得改写、拼接或省略",
          },
          footnote: { type: "string", description: "注脚：帮助读者理解的通俗解释" },
        },
      },
    },
  },
} as const;

export const buildReadingMarksPrompt = (params: {
  bookTitle: string;
  chapterTitle: string;
  paragraphs: string[];
  truncated: boolean;
  previousTitles: string[];
  languageLine?: string;
}) => {
  const prev = params.previousTitles.filter(Boolean).slice(-15);
  return [
    `书名：《${params.bookTitle}》`,
    `本章：${params.chapterTitle}`,
    prev.length ? `前文章节（仅标题）：${prev.join(" / ")}` : "这是全书开头部分。",
    params.truncated ? `（本章较长，以下只给出前 ${params.paragraphs.length} 段）` : "",
    `本章共 ${params.paragraphs.length} 段，段落编号 1–${params.paragraphs.length}。`,
    "",
    "<paragraphs>",
    params.paragraphs.map((p, i) => `[${i + 1}] ${p}`).join("\n"),
    "</paragraphs>",
    "",
    "请给出：overview（本章核心主张）、annotations（术语与核心观点的标注及注脚；quote 保持原文语言）。",
    params.languageLine || "",
  ]
    .filter((line) => line !== "")
    .join("\n");
};

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const int = (v: unknown) => {
  const n = typeof v === "number" ? v : parseInt(String(v));
  return Number.isFinite(n) ? Math.round(n) : NaN;
};
const isKind = (v: unknown): v is AnnotationKind => v === "term" || v === "idea";

/**
 * 整理并核对标注：先在模型给的段落里找原文，找不到再在全章找（模型常把编号写错）；
 * 去重、按类型限量，按原文位置排序（未定位的排最后）。
 * 术语可能很短（如「熵」），只在指定段落内核对；全章回退要求至少 2 个字符。
 */
export const normalizeAnnotations = (raw: unknown, paragraphs: string[]): Annotation[] => {
  const norm = paragraphs.map(normalizeForMatch);
  const seen = new Set<string>();
  const count: Record<AnnotationKind, number> = { term: 0, idea: 0 };
  const items: { a: Annotation; pos: number }[] = [];
  for (const item of Array.isArray(raw) ? raw : []) {
    const r = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
    if (!isKind(r.kind)) continue;
    const kind = r.kind;
    const quote = str(r.quote).replace(/^[“"「『]|[”"」』]$/g, "");
    const nq = normalizeForMatch(quote);
    const footnote = str(r.footnote);
    if (!nq || !footnote || seen.has(kind + nq) || count[kind] >= MAX_PER_KIND[kind]) continue;
    seen.add(kind + nq);
    count[kind]++;
    let para = int(r.para);
    let pos = Infinity;
    const minGlobal = kind === "term" ? 2 : 4;
    if (para >= 1 && para <= norm.length && norm[para - 1].includes(nq)) {
      pos = (para - 1) * 1e6 + norm[para - 1].indexOf(nq);
    } else if (nq.length >= minGlobal) {
      const i = norm.findIndex((p) => p.includes(nq));
      if (i >= 0) {
        para = i + 1;
        pos = i * 1e6 + norm[i].indexOf(nq);
      }
    }
    const verified = Number.isFinite(pos) && (kind === "term" || nq.length >= 4);
    items.push({
      a: { kind, para: Number.isFinite(para) ? para : 0, quote, footnote, verified },
      pos: verified ? pos : Infinity,
    });
  }
  // 稳定排序：同一位置（或都未定位）保持模型给出的顺序
  return items
    .map((x, i) => ({ ...x, i }))
    .sort((x, y) => (x.pos === y.pos ? x.i - y.i : x.pos < y.pos ? -1 : 1))
    .map((x) => x.a);
};

export const toChapterMarks = (
  raw: unknown,
  ctx: {
    docIndex: number;
    chapterTitle: string;
    chapterText: string;
    paragraphs: string[];
    truncated: boolean;
    costUsd: number;
    durationMs: number;
  }
): ChapterMarks => {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  if (!Array.isArray(r.annotations)) throw new Error("missing-annotations");
  return {
    version: READING_MARKS_VERSION,
    docIndex: ctx.docIndex,
    chapterTitle: ctx.chapterTitle,
    textHash: hashText(ctx.chapterText),
    paraCount: ctx.paragraphs.length,
    overview: str(r.overview),
    annotations: normalizeAnnotations(r.annotations, ctx.paragraphs),
    truncated: ctx.truncated,
    costUsd: ctx.costUsd,
    durationMs: ctx.durationMs,
    createdAt: Date.now(),
  };
};

export const isMarksValid = (
  m: Partial<ChapterMarks> | null | undefined,
  chapter: Pick<IndexChapter, "docIndex" | "text">
): m is ChapterMarks =>
  !!m &&
  m.version === READING_MARKS_VERSION &&
  m.docIndex === chapter.docIndex &&
  m.textHash === hashText(chapter.text) &&
  Array.isArray(m.annotations);

export const countByKind = (annotations: Annotation[]): Record<AnnotationKind, number> => {
  const out: Record<AnnotationKind, number> = { term: 0, idea: 0 };
  annotations.forEach((a) => out[a.kind]++);
  return out;
};

// ---- 原文定位（书页渲染用；纯逻辑部分） ----

const HEAD_TAIL = 24;

/**
 * 在规范化后的页面文本中按顺序定位各段落，返回 [start, end)（规范化坐标）；找不到为 null。
 * 先整段匹配；不行就用开头与结尾各 24 字分别定位（页面文本与提取文本可能有细微差异）。
 */
export const locateParagraphs = (
  normDoc: string,
  normParas: string[]
): ([number, number] | null)[] => {
  let cursor = 0;
  return normParas.map((p) => {
    if (p.length < 2) return null;
    let at = normDoc.indexOf(p, cursor);
    if (at < 0) at = normDoc.indexOf(p);
    if (at >= 0) {
      cursor = at + p.length;
      return [at, at + p.length];
    }
    if (p.length < HEAD_TAIL * 2) return null;
    const head = normDoc.indexOf(p.slice(0, HEAD_TAIL), cursor);
    if (head < 0) return null;
    const tailProbe = p.slice(-HEAD_TAIL);
    // 段尾取窗口内最后一次出现（段内有重复文字时，第一次出现会截短）
    const limit = head + Math.ceil(p.length * 1.5) - HEAD_TAIL;
    const tail = normDoc.lastIndexOf(tailProbe, limit);
    if (tail < head + HEAD_TAIL) return null;
    cursor = tail + HEAD_TAIL;
    return [head, tail + HEAD_TAIL];
  });
};

/** 定位一段原文；优先在 [near.start, near.end) 范围内。短于 4 字的（术语）只在 near 内找 */
export const locateQuote = (
  normDoc: string,
  normQuote: string,
  near: [number, number] | null
): [number, number] | null => {
  if (!normQuote) return null;
  if (near) {
    const at = normDoc.indexOf(normQuote, near[0]);
    if (at >= 0 && at + normQuote.length <= near[1]) return [at, at + normQuote.length];
  }
  if (normQuote.length < 4) return null;
  const at = normDoc.indexOf(normQuote);
  return at >= 0 ? [at, at + normQuote.length] : null;
};
