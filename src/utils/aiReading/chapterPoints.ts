// AI 伴读：本章要点的纯逻辑（提示词、Schema、引文核对、结果校验）。无 DOM / 无 IPC，便于单测。
import type { IndexChapter } from "./indexText";

export const CHAPTER_POINTS_VERSION = 1;

/** 单次请求中章节正文的最大字数，超出则截断（控制花费，需求 §7：单次约 $0.05 量级） */
export const MAX_CHAPTER_CHARS = 30000;

export interface Quote {
  /** 模型给出的原文短引 */
  text: string;
  /** 程序核对结果：在本章原文中能否找到（FR-SUM-05） */
  verified?: boolean;
}

export interface KeyPoint {
  point: string;
  quote: Quote;
}

export interface KeyConcept {
  term: string;
  explanation: string;
  quote: Quote;
}

export interface ChapterPoints {
  version: number;
  docIndex: number;
  chapterTitle: string;
  /** 生成时章节文本的指纹；章节文本变化后视为过期 */
  textHash: string;
  /** 这一章解决什么问题（一句话） */
  question: string;
  points: KeyPoint[];
  concepts: KeyConcept[];
  /** 与前文的关系；第一章或无明显关系时为空 */
  relation: string;
  truncated: boolean;
  costUsd: number;
  durationMs: number;
  createdAt: number;
}

const quoteSchema = {
  type: "string",
  description:
    "从本章原文中逐字复制的连续短句（10–40 字），不得改写、拼接或省略，用于程序核对出处",
};

export const CHAPTER_POINTS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["question", "points", "concepts", "relation"],
  properties: {
    question: {
      type: "string",
      description: "这一章要解决的核心问题，一句话",
    },
    points: {
      type: "array",
      minItems: 3,
      maxItems: 6,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["point", "quote"],
        properties: {
          point: { type: "string", description: "要点，一到两句话" },
          quote: quoteSchema,
        },
      },
    },
    concepts: {
      type: "array",
      maxItems: 6,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["term", "explanation", "quote"],
        properties: {
          term: { type: "string" },
          explanation: { type: "string", description: "按本书的用法解释，一句话" },
          quote: quoteSchema,
        },
      },
    },
    relation: {
      type: "string",
      description: "本章与前文的关系；看不出明确关系时留空字符串",
    },
  },
} as const;

export const CHAPTER_POINTS_SYSTEM = [
  "你是一位认真的读书助手，帮读者抓住一本书中某一章的重点。",
  "只根据给出的本章原文作答，不要引入书外的观点；原文没写的不要编。",
  "每条要点和概念都必须附一句原文短引：从本章原文中逐字复制一段连续文字（10–40 字），不得改写、翻译、拼接或加省略号。",
  "要点要具体，避免「本章介绍了……」这类空话。",
].join("\n");

export const buildChapterPointsPrompt = (params: {
  bookTitle: string;
  chapter: Pick<IndexChapter, "title" | "text">;
  previousTitles: string[];
  /** 作答语言指令，如「请用中文作答。」 */
  languageLine?: string;
}): { prompt: string; truncated: boolean } => {
  const text = params.chapter.text || "";
  const truncated = text.length > MAX_CHAPTER_CHARS;
  const body = truncated ? text.slice(0, MAX_CHAPTER_CHARS) : text;
  const prev = params.previousTitles.filter(Boolean).slice(-15);
  const prompt = [
    `书名：《${params.bookTitle}》`,
    `本章：${params.chapter.title}`,
    prev.length ? `前文章节（仅标题）：${prev.join(" / ")}` : "这是全书开头部分。",
    truncated ? `（本章较长，以下只给出前 ${MAX_CHAPTER_CHARS} 字）` : "",
    "",
    "<chapter>",
    body,
    "</chapter>",
    "",
    "请给出：这一章解决什么问题（一句话）；3–6 个要点；关键概念（没有可为空）；与前文的关系。每条都附原文短引（原文短引保持原文语言，不要翻译）。",
    params.languageLine || "",
  ]
    .filter((line) => line !== "")
    .join("\n");
  return { prompt, truncated };
};

/**
 * 用于引文比对的规范化：去掉所有空白与常见标点，全角转半角，英文小写。
 * 模型常在引文中改动空格、引号或标点，这些不应判为「编造」。
 */
export const normalizeForMatch = (s: string) =>
  (s || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s 　]+/g, "")
    .replace(/[“”"'‘’「」『』《》〈〉()（）【】\[\]…·.,，。、;；:：!！?？\-—–~～]/g, "");

/** 引文太短时无法说明出处（任何文本都可能包含），视为未定位 */
const MIN_QUOTE_CHARS = 4;

export const verifyQuote = (quote: string, normalizedSource: string) => {
  const q = normalizeForMatch(quote);
  if (q.length < MIN_QUOTE_CHARS) return false;
  return normalizedSource.includes(q);
};

type RawPoints = {
  question?: unknown;
  points?: unknown;
  concepts?: unknown;
  relation?: unknown;
};

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/** 把模型输出整理成 ChapterPoints，并逐条核对引文 */
export const toChapterPoints = (
  raw: unknown,
  ctx: {
    docIndex: number;
    chapterTitle: string;
    chapterText: string;
    truncated: boolean;
    costUsd: number;
    durationMs: number;
  }
): ChapterPoints => {
  const r = (raw && typeof raw === "object" ? raw : {}) as RawPoints;
  const source = normalizeForMatch(ctx.chapterText);
  const mkQuote = (q: unknown): Quote => {
    const text = str(q);
    return { text, verified: verifyQuote(text, source) };
  };
  const points: KeyPoint[] = (Array.isArray(r.points) ? r.points : [])
    .map((p) => (p && typeof p === "object" ? (p as Record<string, unknown>) : {}))
    .map((p) => ({ point: str(p.point), quote: mkQuote(p.quote) }))
    .filter((p) => p.point);
  const concepts: KeyConcept[] = (Array.isArray(r.concepts) ? r.concepts : [])
    .map((c) => (c && typeof c === "object" ? (c as Record<string, unknown>) : {}))
    .map((c) => ({
      term: str(c.term),
      explanation: str(c.explanation),
      quote: mkQuote(c.quote),
    }))
    .filter((c) => c.term);
  if (points.length === 0) {
    throw new Error("empty-points");
  }
  return {
    version: CHAPTER_POINTS_VERSION,
    docIndex: ctx.docIndex,
    chapterTitle: ctx.chapterTitle,
    textHash: hashText(ctx.chapterText),
    question: str(r.question),
    points,
    concepts,
    relation: str(r.relation),
    truncated: ctx.truncated,
    costUsd: ctx.costUsd,
    durationMs: ctx.durationMs,
    createdAt: Date.now(),
  };
};

/** 轻量指纹（FNV-1a 32 位 + 长度），只用来判断章节文本是否变化 */
export const hashText = (text: string) => {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16) + ":" + text.length;
};

export const isPointsValid = (
  p: Partial<ChapterPoints> | null | undefined,
  chapter: Pick<IndexChapter, "docIndex" | "text">
): p is ChapterPoints =>
  !!p &&
  p.version === CHAPTER_POINTS_VERSION &&
  p.docIndex === chapter.docIndex &&
  p.textHash === hashText(chapter.text) &&
  Array.isArray(p.points);

/**
 * 从模型的纯文本回答里取出 JSON（自定义 OpenAI 兼容服务没有 --json-schema，
 * 只能要求它回 JSON；兼容 ```json 代码块和前后多余文字）
 */
export const extractJson = (text: string): unknown => {
  const t = (text || "").trim();
  const fenced = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : t;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("no-json");
  return JSON.parse(candidate.slice(start, end + 1));
};
