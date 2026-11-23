// AI 伴读：全书导读的纯逻辑（花费预估、汇总提示词、Schema、结果整理）。无 DOM / 无 IPC。
import type { BookIndex, IndexChapter } from "./indexText";
import type { ChapterPoints } from "./chapterPoints";

export const BOOK_GUIDE_VERSION = 1;

/** 正文少于此字数的文档（封面、版权页、空白页）不参与全书分析 */
export const MIN_ANALYZE_CHARS = 200;

/** 参与全书分析的章节：有正文、提取无错误 */
export const analyzableChapters = (index: BookIndex): IndexChapter[] =>
  index.chapters.filter((c) => !c.error && c.text.length >= MIN_ANALYZE_CHARS);

/**
 * 每 1000 字的单章要点花费区间（美元）。
 * 依据 P3 实测：haiku 2.8k 字与 11.5k 字均约 $0.0024；默认模型（sonnet/opus 级）按 5–15 倍估。
 * 只用于给出「量级」，不作承诺。
 */
const COST_PER_CALL = { low: 0.002, high: 0.04 };
const COST_PER_1K_CHARS = { low: 0.0001, high: 0.004 };
const SUMMARY_CALL = { low: 0.005, high: 0.08 };

export interface GuideEstimate {
  chapters: number;
  /** 已有要点缓存、无需再调用的章节数 */
  cached: number;
  calls: number;
  chars: number;
  costLow: number;
  costHigh: number;
}

export const estimateGuideCost = (
  chapters: Pick<IndexChapter, "text">[],
  isCached: (i: number) => boolean,
  maxChars: number,
  /** 是否包含最后一次全书汇总调用（伴读分级没有汇总） */
  withSummary = true
): GuideEstimate => {
  let calls = 0;
  let chars = 0;
  let cached = 0;
  chapters.forEach((c, i) => {
    if (isCached(i)) {
      cached++;
      return;
    }
    calls++;
    chars += Math.min(c.text.length, maxChars);
  });
  const k = chars / 1000;
  const s = withSummary ? 1 : 0;
  return {
    chapters: chapters.length,
    cached,
    calls: calls + s,
    chars,
    costLow: calls * COST_PER_CALL.low + k * COST_PER_1K_CHARS.low + s * SUMMARY_CALL.low,
    costHigh: calls * COST_PER_CALL.high + k * COST_PER_1K_CHARS.high + s * SUMMARY_CALL.high,
  };
};

export interface GuideChapterEntry {
  docIndex: number;
  title: string;
  summary: string;
  /** 建议：必读 / 可略读；没有依据时为空 */
  advice: "" | "core" | "skim";
  reason: string;
}

export interface GuideConcept {
  term: string;
  explanation: string;
  /** 首次出现的章节（docIndex）；无法确定时为 -1 */
  firstDocIndex: number;
}

export interface BookGuide {
  version: number;
  bookKey: string;
  /** 生成时参与汇总的章节要点指纹，任一章节要点变化后提示可更新 */
  sourceHash: string;
  mainline: string;
  chapters: GuideChapterEntry[];
  concepts: GuideConcept[];
  readingOrder: string;
  costUsd: number;
  durationMs: number;
  createdAt: number;
}

export const BOOK_GUIDE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["mainline", "chapters", "concepts", "readingOrder"],
  properties: {
    mainline: { type: "string", description: "全书主线，一段话（3–6 句）" },
    chapters: {
      type: "array",
      description: "按给出的章节顺序，每章一项",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "summary", "advice", "reason"],
        properties: {
          id: { type: "integer", description: "章节编号，必须是输入中给出的 id" },
          summary: { type: "string", description: "这一章一句话讲了什么" },
          advice: {
            type: "string",
            enum: ["", "core", "skim"],
            description: "core=核心必读，skim=可略读，无明确依据时留空",
          },
          reason: { type: "string", description: "给出 core/skim 的依据；advice 为空时留空" },
        },
      },
    },
    concepts: {
      type: "array",
      maxItems: 20,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["term", "explanation", "firstId"],
        properties: {
          term: { type: "string" },
          explanation: { type: "string", description: "按本书的用法，一句话" },
          firstId: { type: "integer", description: "该概念首次出现的章节 id" },
        },
      },
    },
    readingOrder: {
      type: "string",
      description: "建议的阅读顺序或略读策略；没有充分依据就留空字符串",
    },
  },
} as const;


const fmtPoints = (p: ChapterPoints) => {
  const lines = [p.question ? `问题：${p.question}` : ""];
  p.points.forEach((x) => lines.push(`- ${x.point}`));
  if (p.concepts.length) {
    lines.push("概念：" + p.concepts.map((c) => `${c.term}（${c.explanation}）`).join("；"));
  }
  if (p.relation) lines.push(`与前文：${p.relation}`);
  return lines.filter(Boolean).join("\n");
};

export const buildBookGuidePrompt = (
  bookTitle: string,
  items: { chapter: IndexChapter; points: ChapterPoints }[],
  languageLine = ""
) =>
  [
    `书名：《${bookTitle}》，共 ${items.length} 章。`,
    "",
    ...items.map(
      ({ chapter, points }) =>
        `<chapter id="${chapter.docIndex}" title="${chapter.title.replace(/"/g, "'")}">\n${fmtPoints(points)}\n</chapter>`
    ),
    "",
    "请按 Schema 输出全书导读。所有字段（包括 reason）使用同一种语言，以下面的语言要求为准。",
    languageLine,
  ].join("\n");

export const pointsFingerprint = (points: ChapterPoints[]) =>
  points.map((p) => `${p.docIndex}:${p.createdAt}`).join(",");

const s = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/** 整理模型输出：只保留输入中存在的章节 id，未知 id 的概念首次出现记为 -1 */
export const toBookGuide = (
  raw: unknown,
  ctx: {
    bookKey: string;
    items: { chapter: IndexChapter; points: ChapterPoints }[];
    costUsd: number;
    durationMs: number;
  }
): BookGuide => {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const byId = new Map(ctx.items.map((it) => [it.chapter.docIndex, it.chapter]));
  const rawChapters = Array.isArray(r.chapters) ? r.chapters : [];
  const seen = new Set<number>();
  const chapters: GuideChapterEntry[] = [];
  for (const item of rawChapters) {
    const o = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
    const id = Number(o.id);
    const chapter = byId.get(id);
    if (!chapter || seen.has(id)) continue;
    seen.add(id);
    const advice = o.advice === "core" || o.advice === "skim" ? o.advice : "";
    chapters.push({
      docIndex: id,
      title: chapter.title,
      summary: s(o.summary),
      advice,
      reason: advice ? s(o.reason) : "",
    });
  }
  // 模型漏掉的章节补上（用章节要点里的问题作一句话）
  ctx.items.forEach(({ chapter, points }) => {
    if (!seen.has(chapter.docIndex)) {
      chapters.push({
        docIndex: chapter.docIndex,
        title: chapter.title,
        summary: points.question,
        advice: "",
        reason: "",
      });
    }
  });
  chapters.sort((a, b) => a.docIndex - b.docIndex);
  const concepts: GuideConcept[] = (Array.isArray(r.concepts) ? r.concepts : [])
    .map((c) => (c && typeof c === "object" ? c : {}) as Record<string, unknown>)
    .map((c) => {
      const id = Number(c.firstId);
      return {
        term: s(c.term),
        explanation: s(c.explanation),
        firstDocIndex: byId.has(id) ? id : -1,
      };
    })
    .filter((c) => c.term);
  const mainline = s(r.mainline);
  if (!mainline) throw new Error("empty-guide");
  return {
    version: BOOK_GUIDE_VERSION,
    bookKey: ctx.bookKey,
    sourceHash: pointsFingerprint(ctx.items.map((it) => it.points)),
    mainline,
    chapters,
    concepts,
    readingOrder: s(r.readingOrder),
    costUsd: ctx.costUsd,
    durationMs: ctx.durationMs,
    createdAt: Date.now(),
  };
};
