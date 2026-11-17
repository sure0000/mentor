// AI 伴读：阅读分级（略读 / 浅读 / 精读）与重点划线的纯逻辑（提示词、Schema、结果整理、原文定位）。
// 无 DOM / 无 IPC，便于单测。
// 思路：把章节切成带编号的段落交给模型，模型只回答「段落区间 → 级别」与「重点原句」；
// 级别靠段落编号落到原文（不依赖模型复述原文），重点原句由程序在原文中核对。
import type { IndexChapter } from "./indexText";
import type { QaSource } from "./bookQa";
import { MAX_CHAPTER_CHARS, hashText, normalizeForMatch } from "./chapterPoints";

export const READING_MARKS_VERSION = 1;

export type ReadingLevel = "skim" | "light" | "deep";
export const READING_LEVELS: ReadingLevel[] = ["skim", "light", "deep"];

export interface MarkSegment {
  /** 段落编号，1 起，闭区间 */
  from: number;
  to: number;
  level: ReadingLevel;
  title: string;
  reason: string;
  /** 模型漏掉、由程序补齐为「浅读」的区间 */
  auto?: boolean;
}

export interface KeyLine {
  /** 所在段落编号（1 起）；未定位时为模型给出的值 */
  para: number;
  quote: string;
  note: string;
  verified: boolean;
}

/** 精读段落的进一步功能：辅助阅读 / 知识关联 / 拓展阅读 */
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
  /** 一句话：这一章怎么读 */
  overview: string;
  segments: MarkSegment[];
  keyLines: KeyLine[];
  truncated: boolean;
  costUsd: number;
  durationMs: number;
  createdAt: number;
  /** 精读段落的进一步结果，键为 segmentKey */
  extras?: Record<string, Partial<Record<CompanionAction, ActionResult>>>;
}

export const segmentKey = (s: Pick<MarkSegment, "from" | "to">) => `${s.from}-${s.to}`;

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
  required: ["overview", "segments", "keyLines"],
  properties: {
    overview: { type: "string", description: "一句话告诉读者这一章该怎么读" },
    segments: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["from", "to", "level", "title", "reason"],
        properties: {
          from: { type: "integer", description: "起始段落编号" },
          to: { type: "integer", description: "结束段落编号（含）" },
          level: { type: "string", enum: ["skim", "light", "deep"] },
          title: { type: "string", description: "这一段讲什么，不超过 20 字" },
          reason: { type: "string", description: "为什么这样分级，一句话" },
        },
      },
    },
    keyLines: {
      type: "array",
      maxItems: 12,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["para", "quote", "note"],
        properties: {
          para: { type: "integer", description: "原句所在段落编号" },
          quote: {
            type: "string",
            description: "从该段落中逐字复制的一句原文（10–60 字），不得改写、拼接或省略",
          },
          note: { type: "string", description: "为什么值得划线，一句话" },
        },
      },
    },
  },
} as const;

export const READING_MARKS_SYSTEM = [
  "你是一位阅读教练，帮读者决定一章里哪些内容略读、哪些浅读、哪些需要精读，并划出重点句。",
  "分级标准：",
  "- skim（略读）：过渡、铺垫、重复、枝节、过多的举例或背景，与主线关系弱，扫一眼即可。",
  "- light（浅读）：正常阅读、理解大意即可的内容。",
  "- deep（精读）：核心论点、关键定义、推理链条、方法步骤、反直觉的结论，需要放慢、反复琢磨。",
  "规则：",
  "1. 按段落编号把全章划分为若干连续区间：按顺序、不重叠、覆盖全部段落；相邻同级的段落合并成一个区间。",
  "2. 精读要克制，通常不超过全章篇幅的三分之一；不要整章都标精读或都标略读。",
  "3. 每个区间给一个不超过 20 字的小标题和一句分级理由，理由要具体，指出这一段在本章中的作用。",
  "4. 重点划线：挑出 3–12 句最值得记住的原句，从对应段落中逐字复制（10–60 字），不得改写、翻译、拼接或加省略号，并标明段落编号。",
  "5. 只根据给出的原文判断，不要引入书外观点。",
].join("\n");

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
    "请给出：overview（这章怎么读）、segments（覆盖全部段落的分级区间）、keyLines（重点原句，原句保持原文语言）。",
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
const isLevel = (v: unknown): v is ReadingLevel =>
  v === "skim" || v === "light" || v === "deep";

/** 整理分级区间：排序、裁剪越界、去重叠，漏掉的段落补为「浅读」 */
export const normalizeSegments = (raw: unknown, paraCount: number): MarkSegment[] => {
  const list = (Array.isArray(raw) ? raw : [])
    .map((s) => (s && typeof s === "object" ? (s as Record<string, unknown>) : {}))
    .map((s) => ({
      from: Math.max(1, int(s.from)),
      to: Math.min(paraCount, int(s.to)),
      level: s.level,
      title: str(s.title),
      reason: str(s.reason),
    }))
    .filter((s): s is MarkSegment => isLevel(s.level) && s.from <= s.to)
    .sort((a, b) => a.from - b.from || a.to - b.to);
  const out: MarkSegment[] = [];
  const gap = (from: number, to: number): MarkSegment => ({
    from,
    to,
    level: "light",
    title: "",
    reason: "",
    auto: true,
  });
  let next = 1;
  for (const s of list) {
    const from = Math.max(s.from, next);
    if (from > s.to) continue;
    if (from > next) out.push(gap(next, from - 1));
    out.push({ ...s, from });
    next = s.to + 1;
    if (next > paraCount) break;
  }
  if (out.length && next <= paraCount) out.push(gap(next, paraCount));
  return out;
};

/** 核对重点原句：先在模型给的段落里找，找不到再在全章找（模型常把编号写错） */
export const verifyKeyLines = (raw: unknown, paragraphs: string[]): KeyLine[] => {
  const norm = paragraphs.map(normalizeForMatch);
  const seen = new Set<string>();
  const out: KeyLine[] = [];
  for (const item of Array.isArray(raw) ? raw : []) {
    const r = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
    const quote = str(r.quote).replace(/^[“"「]|[”"」]$/g, "");
    const nq = normalizeForMatch(quote);
    if (!quote || seen.has(nq)) continue;
    seen.add(nq);
    let para = int(r.para);
    let verified = false;
    if (nq.length >= 4) {
      if (para >= 1 && para <= norm.length && norm[para - 1].includes(nq)) {
        verified = true;
      } else {
        const i = norm.findIndex((p) => p.includes(nq));
        if (i >= 0) {
          para = i + 1;
          verified = true;
        }
      }
    }
    out.push({ para: Number.isFinite(para) ? para : 0, quote, note: str(r.note), verified });
  }
  return out;
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
  const segments = normalizeSegments(r.segments, ctx.paragraphs.length);
  if (segments.length === 0) throw new Error("empty-segments");
  return {
    version: READING_MARKS_VERSION,
    docIndex: ctx.docIndex,
    chapterTitle: ctx.chapterTitle,
    textHash: hashText(ctx.chapterText),
    paraCount: ctx.paragraphs.length,
    overview: str(r.overview),
    segments,
    keyLines: verifyKeyLines(r.keyLines, ctx.paragraphs),
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
  Array.isArray(m.segments);

/** 各级别占本章（已分析部分）篇幅的比例，按字数计 */
export const levelShares = (
  segments: MarkSegment[],
  paragraphs: string[]
): Record<ReadingLevel, number> => {
  const chars: Record<ReadingLevel, number> = { skim: 0, light: 0, deep: 0 };
  for (const s of segments) {
    for (let i = s.from; i <= s.to; i++) chars[s.level] += (paragraphs[i - 1] || "").length;
  }
  const total = chars.skim + chars.light + chars.deep;
  if (!total) return chars;
  return { skim: chars.skim / total, light: chars.light / total, deep: chars.deep / total };
};

export const segmentText = (s: Pick<MarkSegment, "from" | "to">, paragraphs: string[]) =>
  paragraphs.slice(s.from - 1, s.to).join("\n");

/** 精读段落进一步功能的提问（交给全书问答的上下文与出处核对） */
export const ACTION_QUESTIONS: Record<CompanionAction, string> = {
  assist:
    "请帮我读懂选中的这段精读内容：先用通俗的话概括它在说什么；再解释其中的关键术语和概念；梳理它的论证或推理步骤；必要时举一个简单的例子帮助理解。",
  relate:
    "选中的这段精读内容与本书其他部分有哪些关联？例如前文的铺垫或定义、后文的展开或应用、相互印证或形成对比之处。再补充它与哪些常见的学科知识或经典观点相关。",
  further:
    "围绕选中的这段精读内容，推荐值得拓展阅读的书籍、论文、文章或主题（3–6 项），说明每一项与这段内容的关系、适合在什么时候读。书中如果自己提到了相关文献，优先列出。",
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

/** 定位一句原文；优先在 [near.start, near.end) 范围内 */
export const locateQuote = (
  normDoc: string,
  normQuote: string,
  near: [number, number] | null
): [number, number] | null => {
  if (normQuote.length < 4) return null;
  if (near) {
    const at = normDoc.indexOf(normQuote, near[0]);
    if (at >= 0 && at < near[1]) return [at, at + normQuote.length];
  }
  const at = normDoc.indexOf(normQuote);
  return at >= 0 ? [at, at + normQuote.length] : null;
};
