// AI 伴读：全书问答的提示词拼装与回答解析（纯逻辑，FR-QA-01/02/03/05）。
// 回答仍走流式纯文本（逐字出现），用约定的标记让模型：
//   - 把「书外补充」包在 [[补充]]…[[/补充]] 里（界面用不同样式）
//   - 末尾附 <sources> 块，每行「编号 | 片段号 | 原文短引」，程序逐条核对
import type { ScoredPassage } from "./retrieval";
import { normalizeForMatch } from "./chapterPoints";
import { DEFAULT_PROMPTS } from "./prompts";

export type ChatTurn = { role: "user" | "assistant"; content: string };

export const QA_EXTRA_OPEN = "[[补充]]";
export const QA_EXTRA_CLOSE = "[[/补充]]";
export const QA_SOURCES_OPEN = "<sources>";
export const QA_SOURCES_CLOSE = "</sources>";

/** 当前章节放入上下文的最大字数（其余靠检索） */
export const CURRENT_CHAPTER_MAX = 12000;
/** 检索片段总字数 */
export const RETRIEVAL_BUDGET = 6000;
/** 对话历史总字数（FR-QA-05：按字数而非条数截断） */
export const HISTORY_BUDGET = 8000;

/** 回答正文中的片段编号标记（[P1]、[CUR] 等）只对当次提问有效，展示与写入历史时去掉 */
export const stripRefMarkers = (text: string) =>
  text.replace(/\s?\[(?:P\d+|CUR|SEL)\](?:\s?\[(?:P\d+|CUR|SEL)\])*/gi, "");

/**
 * 全书问答的系统提示词 = 可编辑的基础说明 + 固定的格式规则。
 * 格式规则（补充标记、出处块）由程序解析，不允许用户修改。
 */
export const buildQaSystem = (base: string = DEFAULT_PROMPTS.bookQa) =>
  [
    base.trim(),
    "",
    "格式规则（必须遵守）：",
    "- 上下文中的全书检索片段带编号 [P1]、[P2]…；当前章节记为 CUR，选中文字记为 SEL。",
    `- 凡是原文里没有、来自你自己知识的背景补充或推断，必须整段包在 ${QA_EXTRA_OPEN} 和 ${QA_EXTRA_CLOSE} 之间，不得与书中内容混写在同一句里。`,
    "- 回答正文用 Markdown。正文里不要写 [P1] 这类编号，也不要重复出处块的内容。",
    "- 回答末尾必须附出处块，格式严格如下（每条一行，最多 6 条；没有可引用的出处时写一个空的块）：",
    QA_SOURCES_OPEN,
    "P2 | 从该片段中逐字复制的原文短引",
    "CUR | 从当前章节中逐字复制的原文短引",
    "SEL | 从选中文字中逐字复制的原文短引",
    QA_SOURCES_CLOSE,
    "- 短引中文 10–40 字、英文约 5–25 个词，必须逐字复制，不得改写、翻译、拼接或加省略号；短引保持原文语言。",
    "- 片段编号只对本次提问有效；之前对话里出现过的编号与本次无关，不要据此「更正」之前的回答。",
  ].join("\n");

const fmtHistory = (history: ChatTurn[], budget: number) => {
  // 保留最近的若干轮全文；更早的用户问题只保留问题本身（作为对话主题的摘要）
  const kept: ChatTurn[] = [];
  let used = 0;
  let i = history.length - 1;
  for (; i >= 0; i--) {
    const m = history[i];
    const content =
      m.role === "assistant" ? stripRefMarkers(stripSources(m.content)) : m.content;
    if (used + content.length > budget) break;
    kept.unshift({ role: m.role, content });
    used += content.length;
  }
  const earlier = history
    .slice(0, i + 1)
    .filter((m) => m.role === "user")
    .map((m) => "- " + m.content.replace(/\s+/g, " ").slice(0, 120));
  const parts: string[] = [];
  if (earlier.length) {
    parts.push("更早的提问（仅问题）：\n" + earlier.slice(-20).join("\n"));
  }
  if (kept.length) {
    parts.push(
      "最近的对话：\n" +
        kept.map((m) => (m.role === "user" ? "【读者】" : "【助手】") + "\n" + m.content).join("\n\n")
    );
  }
  return parts.join("\n\n");
};

export const buildQaPrompt = (params: {
  bookTitle: string;
  question: string;
  selection: string;
  currentChapter: { title: string; text: string } | null;
  passages: ScoredPassage[];
  history: ChatTurn[];
  spoilerSafe: boolean;
}) => {
  const parts: string[] = [`书名：《${params.bookTitle}》`];
  if (params.spoilerSafe) {
    parts.push("（读者开启了防剧透：只提供了当前位置之前的内容。不要透露后文情节或结论。）");
  }
  const history = fmtHistory(params.history, HISTORY_BUDGET);
  if (history) parts.push(history);
  if (params.selection) {
    parts.push(`<selection>\n${params.selection}\n</selection>`);
  }
  if (params.currentChapter) {
    const t = params.currentChapter.text;
    const body = t.length > CURRENT_CHAPTER_MAX ? t.slice(0, CURRENT_CHAPTER_MAX) + "\n…（本章后文略）" : t;
    parts.push(`<current_chapter title="${params.currentChapter.title.replace(/"/g, "'")}">\n${body}\n</current_chapter>`);
  }
  if (params.passages.length) {
    parts.push(
      "<passages>\n" +
        params.passages
          .map((p, i) => `[P${i + 1}] 《${p.chapterTitle}》\n${p.text}`)
          .join("\n\n") +
        "\n</passages>"
    );
  } else {
    parts.push("（全书检索没有找到与问题直接相关的其他片段。）");
  }
  parts.push(`读者的问题：${params.question}`);
  return parts.join("\n\n");
};

export interface QaSource {
  /** 引用的来源：片段编号（1 起）、当前章（CUR）、选中文字（SEL） */
  ref: string;
  docIndex: number;
  chapterTitle: string;
  quote: string;
  verified: boolean;
}

export interface QaContextRef {
  docIndex: number;
  chapterTitle: string;
  text: string;
}

/** 去掉回答中的出处块（用于展示正文、写入历史） */
export const stripSources = (text: string) => {
  const i = text.indexOf(QA_SOURCES_OPEN);
  return (i >= 0 ? text.slice(0, i) : text).trimEnd();
};

/** 流式过程中隐藏尚未结束的出处块 / 半个标记 */
export const visibleWhileStreaming = (text: string) => {
  const s = stripSources(text);
  // 末尾可能是半个 "<sources" 标记
  const partial = s.match(/<s?o?u?r?c?e?s?$/);
  return partial ? s.slice(0, partial.index) : s;
};

/**
 * 解析出处块，并在对应原文里核对短引。
 * 引用编号对不上任何上下文时，退而在所有上下文里找；都找不到则标为未定位。
 */
export const parseSources = (
  answer: string,
  ctx: { passages: QaContextRef[]; current: QaContextRef | null; selection: QaContextRef | null }
): QaSource[] => {
  const start = answer.indexOf(QA_SOURCES_OPEN);
  if (start < 0) return [];
  const end = answer.indexOf(QA_SOURCES_CLOSE, start);
  const block = answer.slice(start + QA_SOURCES_OPEN.length, end < 0 ? undefined : end);
  const all: QaContextRef[] = [
    ...ctx.passages,
    ...(ctx.current ? [ctx.current] : []),
    ...(ctx.selection ? [ctx.selection] : []),
  ];
  const norm = new Map(all.map((c) => [c, normalizeForMatch(c.text)]));
  const find = (q: string, preferred: QaContextRef | null) => {
    const nq = normalizeForMatch(q);
    if (nq.length < 4) return null;
    if (preferred && norm.get(preferred)!.includes(nq)) return preferred;
    return all.find((c) => norm.get(c)!.includes(nq)) || null;
  };
  const out: QaSource[] = [];
  const seen = new Set<string>();
  for (const raw of block.split("\n")) {
    const line = raw.trim().replace(/^[-*]\s*/, "");
    const m = line.match(/^\[?(P\d+|CUR|SEL)\]?\s*[|｜:：]\s*(.+)$/i);
    if (!m) continue;
    const ref = m[1].toUpperCase();
    const quote = m[2].trim().replace(/^[“"「]|[”"」]$/g, "");
    if (!quote || seen.has(quote)) continue;
    seen.add(quote);
    const preferred =
      ref === "CUR" ? ctx.current : ref === "SEL" ? ctx.selection : ctx.passages[parseInt(ref.slice(1)) - 1] || null;
    const hit = find(quote, preferred);
    const owner = hit || preferred;
    out.push({
      ref,
      docIndex: owner ? owner.docIndex : -1,
      chapterTitle: owner ? owner.chapterTitle : "",
      quote,
      verified: !!hit,
    });
    if (out.length >= 8) break;
  }
  return out;
};

export type AnswerSegment = { kind: "book" | "extra"; text: string };

/** 把回答正文切成「书里说的」与「AI 补充」两类（FR-QA-03） */
export const splitAnswerSegments = (body: string): AnswerSegment[] => {
  const segs: AnswerSegment[] = [];
  let rest = body;
  while (rest) {
    const i = rest.indexOf(QA_EXTRA_OPEN);
    if (i < 0) {
      segs.push({ kind: "book", text: rest });
      break;
    }
    if (i > 0) segs.push({ kind: "book", text: rest.slice(0, i) });
    rest = rest.slice(i + QA_EXTRA_OPEN.length);
    const j = rest.indexOf(QA_EXTRA_CLOSE);
    segs.push({ kind: "extra", text: j < 0 ? rest : rest.slice(0, j) });
    rest = j < 0 ? "" : rest.slice(j + QA_EXTRA_CLOSE.length);
  }
  return segs.filter((s) => s.text.trim());
};
