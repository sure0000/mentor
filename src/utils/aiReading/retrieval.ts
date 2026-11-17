// AI 伴读：全书问答的检索与上下文拼装（纯逻辑，FR-QA-01/04）。
// 不用向量库：章节切段 → 关键词/术语命中打分 + 章节要点加权 → 取若干段，控制总长度。
import type { BookIndex, IndexChapter } from "./indexText";
import type { ChapterPoints } from "./chapterPoints";

export interface Passage {
  docIndex: number;
  chapterTitle: string;
  /** 段在章内的序号（调试、去重用） */
  seq: number;
  text: string;
}

export interface ScoredPassage extends Passage {
  score: number;
}

const PASSAGE_TARGET = 600;
const PASSAGE_MAX = 1200;

/** 按段落切分章节，短段合并到约 600 字，过长的段按句切开 */
export const splitPassages = (chapter: Pick<IndexChapter, "docIndex" | "title" | "text">): Passage[] => {
  const paras = chapter.text.split(/\n+/).map((p) => p.trim()).filter(Boolean);
  const pieces: string[] = [];
  for (const p of paras) {
    if (p.length <= PASSAGE_MAX) {
      pieces.push(p);
      continue;
    }
    // 过长段落（PDF 整页无换行）按句号切
    const sentences = p.split(/(?<=[。！？!?.;；])\s*/);
    let buf = "";
    for (const s of sentences) {
      if (buf && buf.length + s.length > PASSAGE_TARGET) {
        pieces.push(buf);
        buf = "";
      }
      buf += (buf && !/[一-鿿]$/.test(buf) ? " " : "") + s;
      while (buf.length > PASSAGE_MAX) {
        pieces.push(buf.slice(0, PASSAGE_MAX));
        buf = buf.slice(PASSAGE_MAX);
      }
    }
    if (buf) pieces.push(buf);
  }
  const passages: Passage[] = [];
  let buf = "";
  const flush = () => {
    if (!buf) return;
    passages.push({ docIndex: chapter.docIndex, chapterTitle: chapter.title, seq: passages.length, text: buf });
    buf = "";
  };
  for (const piece of pieces) {
    if (buf && buf.length + piece.length > PASSAGE_TARGET) flush();
    buf = buf ? buf + "\n" + piece : piece;
  }
  flush();
  return passages;
};

const STOP_EN = new Set(
  "the a an and or of to in on at for with by from is are was were be been being this that these those it its as what which who whom whose how why when where does do did can could would should will about into than then there their they them he she his her you your we our i me my not no yes any some all more most other such only also just book chapter author".split(
    " "
  )
);
const STOP_ZH = [
  "什么", "怎么", "为什么", "如何", "哪些", "哪几", "哪里", "是否", "有没有", "是不是", "作者", "这本书", "本书", "书中", "书里",
  "这一章", "本章", "章节", "里面", "其中", "关于", "讨论", "提到", "说过", "认为", "观点", "一下", "请问", "告诉", "解释",
  "一个", "这个", "那个", "我们", "他们", "可以", "能够", "以及", "还有", "的", "了", "吗", "呢", "吧", "在", "和", "与", "是",
];

/**
 * 从问题里抽检索词：英文按词（去停用词），中文去掉疑问/虚词后取 2–4 字的连续片段，
 * 引号、书名号里的内容整体作为强检索词。
 */
export const extractQueryTerms = (question: string): { terms: string[]; strong: string[] } => {
  const q = (question || "").normalize("NFKC");
  const strong = [...q.matchAll(/[“"「『《]([^”"」』》]{2,30})[”"」』》]/g)].map((m) => m[1].trim());
  const terms = new Set<string>();
  (q.toLowerCase().match(/[a-z][a-z0-9'-]{2,}/g) || [])
    .filter((w) => !STOP_EN.has(w))
    .forEach((w) => terms.add(w));
  let zh = q.replace(/[^一-鿿]+/g, " ");
  for (const w of STOP_ZH) zh = zh.split(w).join(" ");
  for (const run of zh.split(/\s+/).filter((r) => r.length >= 2)) {
    if (run.length <= 4) {
      terms.add(run);
      continue;
    }
    // 长串取 2/3/4 字滑窗，覆盖未知的词边界
    for (let n = 2; n <= 4; n++) {
      for (let i = 0; i + n <= run.length; i++) terms.add(run.slice(i, i + n));
    }
  }
  strong.forEach((s) => terms.add(s.toLowerCase()));
  return { terms: [...terms], strong };
};

const countOccurrences = (hay: string, needle: string) => {
  if (!needle) return 0;
  let n = 0;
  let i = hay.indexOf(needle);
  while (i >= 0 && n < 20) {
    n++;
    i = hay.indexOf(needle, i + needle.length);
  }
  return n;
};

/** 章节要点文本（问题 + 要点 + 概念），用于章节级相关度 */
const pointsText = (p?: ChapterPoints | null) =>
  p
    ? [p.question, ...p.points.map((x) => x.point), ...p.concepts.map((c) => `${c.term} ${c.explanation}`)]
        .join(" ")
        .toLowerCase()
    : "";

export interface RetrieveOptions {
  /** 只检索这些 docIndex 之前（不含）的章节；用于防剧透（FR-QA-04） */
  maxDocIndex?: number;
  /** 排除的章节（如当前章，已经整章放进上下文） */
  excludeDocIndex?: number;
  /** 返回片段的总字数上限 */
  budgetChars?: number;
  maxPassages?: number;
}

/**
 * 全书检索：段落命中分 × 检索词稀有度（IDF 近似），叠加章节要点命中加权；
 * 每章最多取 3 段，避免一章刷屏。
 */
export const retrievePassages = (
  index: BookIndex,
  question: string,
  getPoints: (c: IndexChapter) => ChapterPoints | null,
  opts: RetrieveOptions = {}
): ScoredPassage[] => {
  const { terms, strong } = extractQueryTerms(question);
  if (terms.length === 0) return [];
  const budget = opts.budgetChars ?? 6000;
  const maxPassages = opts.maxPassages ?? 8;
  const chapters = index.chapters.filter(
    (c) =>
      !c.error &&
      c.text &&
      c.docIndex !== opts.excludeDocIndex &&
      (opts.maxDocIndex === undefined || c.docIndex < opts.maxDocIndex)
  );
  const passages = chapters.flatMap((c) => splitPassages(c));
  if (passages.length === 0) return [];
  const lower = passages.map((p) => p.text.toLowerCase());
  // 稀有词权重更高：在多少段里出现
  const df = new Map<string, number>();
  for (const t of terms) df.set(t, lower.filter((l) => l.includes(t)).length);
  const n = passages.length;
  const idf = (t: string) => Math.log(1 + n / (1 + (df.get(t) || 0)));
  const chapterBoost = new Map<number, number>();
  for (const c of chapters) {
    const pt = pointsText(getPoints(c));
    if (!pt) continue;
    const hit = terms.reduce((s, t) => s + (pt.includes(t) ? idf(t) : 0), 0);
    if (hit > 0) chapterBoost.set(c.docIndex, hit);
  }
  const strongLower = strong.map((s) => s.toLowerCase());
  const scored: ScoredPassage[] = passages.map((p, i) => {
    const l = lower[i];
    let score = 0;
    let distinct = 0;
    for (const t of terms) {
      const c = countOccurrences(l, t);
      if (c > 0) {
        distinct++;
        // 长词更具体；命中次数取对数，避免高频词刷分
        score += idf(t) * (1 + Math.log(c)) * Math.min(t.length, 6) / 2;
      }
    }
    for (const s of strongLower) if (l.includes(s)) score += 10;
    // 命中的不同检索词越多越相关
    score *= 1 + 0.3 * Math.max(0, distinct - 1);
    if (score > 0) score += (chapterBoost.get(p.docIndex) || 0) * 0.5;
    return { ...p, score };
  });
  const picked: ScoredPassage[] = [];
  const perChapter = new Map<number, number>();
  let used = 0;
  for (const p of scored.filter((x) => x.score > 0).sort((a, b) => b.score - a.score)) {
    if (picked.length >= maxPassages) break;
    if ((perChapter.get(p.docIndex) || 0) >= 3) continue;
    if (used + p.text.length > budget && picked.length > 0) continue;
    picked.push(p);
    perChapter.set(p.docIndex, (perChapter.get(p.docIndex) || 0) + 1);
    used += p.text.length;
  }
  // 按书中顺序呈现，便于模型理解前后关系
  return picked.sort((a, b) => a.docIndex - b.docIndex || a.seq - b.seq);
};
