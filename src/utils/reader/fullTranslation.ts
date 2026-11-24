// 全文翻译控制器：在阅读器 iframe 中按「小段」插入译文（见 segmentTranslation.ts），
// 支持三种范围：
// - 自动：翻到哪里译到哪里（当前页起往后一批）
// - 本章：把当前章节全部小段译完
// - 全书：后台逐章翻译并写入缓存，翻到对应章节时直接显示
import { ConfigService } from "../../assets/lib/kookit-extra-browser.min";
import { isElectron } from "react-device-detect";
import Book from "../../models/Book";
import { getBatchTrans } from "../request/reader";
import { isAiAvailable } from "../aiReading/aiGateway";
import { getFullTranslationTarget, isRateLimitedResult } from "../common";
import { getIframeDoc, getIframeWin } from "./docUtil";
import { useAppStore } from "../../store/useAppStore";
import {
  decorateDocument,
  fillMarkers,
  getLeafBlocks,
  getMarkers,
  getSegmentTexts,
  injectTranslationStyle,
  TranslationUnit,
} from "./segmentTranslation";

declare var window: any;

type TransCache = Record<string, Record<string, string>>;

export type TranslationJobScope = "chapter" | "book";
export interface TranslationJob {
  bookKey: string;
  scope: TranslationJobScope;
  done: number;
  total: number;
  status: "running" | "done" | "cancelled" | "error";
}

// 单次请求的上限：LLM 需要逐条对齐返回，批次过大容易长度不一致
const BATCH_MAX_ITEMS = 30;
const BATCH_MAX_CHARS = 3500;
// 自动模式每次翻页最多预翻的字符数（当前页往后）
const AUTO_LOOKAHEAD_CHARS = 4000;

export const getFullTranslationMode = (bookKey?: string): string => {
  if (!bookKey) return "no";
  if (!ConfigService.getAllListConfig("fullTranslationBooks").includes(bookKey)) {
    return "no";
  }
  const mode = ConfigService.getReaderConfig("fullTranslationMode") || "no";
  return mode === "both" || mode === "target" ? mode : "no";
};

export const getTranslationUnit = (): TranslationUnit =>
  ConfigService.getReaderConfig("fullTranslationUnit") === "sentence" ? "sentence" : "paragraph";

const isEnabled = (bookKey?: string) =>
  getFullTranslationMode(bookKey) !== "no" && isAiAvailable("translate");

/* ---------------- 缓存（与旧版同一目录与格式：trans/{bookKey}_{chapter}.json） ---------------- */

const cacheMap = new Map<string, TransCache>();

const getCachePath = (bookKey: string, chapter: string): string | null => {
  const electron = window.electronAPI;
  if (!isElectron || !electron?.fs) return null;
  const dirPath = electron.sendSync("user-data", "ping");
  const transDir = electron.path.join(dirPath, "trans");
  if (!electron.fs.existsSync(transDir)) {
    electron.fs.mkdirSync(transDir, { recursive: true });
  }
  return electron.path.join(transDir, bookKey + "_" + chapter + ".json");
};

const getCache = (bookKey: string, chapter: string): TransCache => {
  const key = bookKey + "_" + chapter;
  const hit = cacheMap.get(key);
  if (hit) return hit;
  let cache: TransCache = {};
  try {
    const cachePath = getCachePath(bookKey, chapter);
    if (cachePath && window.electronAPI.fs.existsSync(cachePath)) {
      cache = JSON.parse(window.electronAPI.fs.readFileSync(cachePath, "utf-8")) || {};
    }
  } catch (error) {
    console.error("Failed to load translation cache:", error);
  }
  cacheMap.set(key, cache);
  return cache;
};

const saveCache = (bookKey: string, chapter: string) => {
  try {
    const cachePath = getCachePath(bookKey, chapter);
    if (!cachePath) return;
    window.electronAPI.fs.writeFileSync(
      cachePath,
      JSON.stringify(getCache(bookKey, chapter)),
      "utf-8"
    );
  } catch (error) {
    console.error("Failed to save translation cache:", error);
  }
};

/* ---------------- 任务状态（供对话框订阅） ---------------- */

let currentJob: TranslationJob | null = null;
let jobToken = 0;
const listeners = new Set<(job: TranslationJob | null) => void>();

const setJob = (job: TranslationJob | null) => {
  currentJob = job;
  listeners.forEach((fn) => fn(job));
};

export const getTranslationJob = () => currentJob;
export const subscribeTranslationJob = (fn: (job: TranslationJob | null) => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};
export const cancelTranslationJob = () => {
  jobToken++;
  if (currentJob?.status === "running") setJob({ ...currentJob, status: "cancelled" });
};

/* ---------------- 阅读器绑定 ---------------- */

interface Session {
  rendition: any;
  book: Book;
  failed: Set<string>;
  queue: Promise<unknown>;
  // goToNode 会再次触发 rendered，重定位期间忽略，避免递归
  repositioning: boolean;
}
let session: Session | null = null;

const currentChapter = (rendition: any): string =>
  String(rendition?.getPosition?.()?.chapterDocIndex ?? rendition?.tempLocation?.chapterDocIndex ?? "0");

const chunk = (texts: string[]): string[][] => {
  const batches: string[][] = [];
  let batch: string[] = [];
  let size = 0;
  for (const text of texts) {
    if (batch.length && (batch.length >= BATCH_MAX_ITEMS || size + text.length > BATCH_MAX_CHARS)) {
      batches.push(batch);
      batch = [];
      size = 0;
    }
    batch.push(text);
    size += text.length;
  }
  if (batch.length) batches.push(batch);
  return batches;
};

/** 翻译一批文本并写入指定章节缓存；失败的文本记录到 failed */
const translateBatch = async (
  book: Book,
  chapter: string,
  texts: string[],
  failed: Set<string>
): Promise<boolean> => {
  const lang = getFullTranslationTarget();
  const context = [book.name, book.author].filter(Boolean).join(" / ");
  const res = await getBatchTrans(texts, "Automatic", lang, context);
  const results = res?.data?.texts;
  if (!results) {
    // LLM 偶尔合并/拆分条目导致数量对不上：拆成两半重试，避免整批失败
    if (res?.msg === "length-mismatch" && texts.length > 1) {
      const mid = Math.ceil(texts.length / 2);
      const a = await translateBatch(book, chapter, texts.slice(0, mid), failed);
      const b = await translateBatch(book, chapter, texts.slice(mid), failed);
      return a && b;
    }
    texts.forEach((t) => failed.add(t));
    return false;
  }
  const cache = getCache(book.key, chapter);
  if (!cache[lang]) cache[lang] = {};
  texts.forEach((text, i) => {
    const translated = results[i];
    if (!translated || isRateLimitedResult(translated)) {
      failed.add(text);
      return;
    }
    failed.delete(text);
    cache[lang][text] = translated;
  });
  saveCache(book.key, chapter);
  return true;
};

const pendingOf = (bookKey: string, chapter: string, texts: string[], failed?: Set<string>) => {
  const dict = getCache(bookKey, chapter)[getFullTranslationTarget()] || {};
  const seen = new Set<string>();
  return texts.filter((t) => {
    if (dict[t] !== undefined || seen.has(t) || failed?.has(t)) return false;
    seen.add(t);
    return true;
  });
};

const getDocs = (s: Session) =>
  getIframeDoc(s.book).filter((doc): doc is Document => !!doc && !!doc.body);

// 读取实时的阅读模式：切换单/双/滚动模式后 rendition 不一定重建
const readerModeOf = () => useAppStore.getState().reader.readerMode;
const isPaginated = () => readerModeOf() !== "scroll";

/** 当前页第一个可见的叶子块，作为插入译文后重新定位的锚点 */
const findAnchor = (doc: Document): Element | null => {
  const width = doc.documentElement.clientWidth || doc.defaultView?.innerWidth || 0;
  const height = doc.documentElement.clientHeight || doc.defaultView?.innerHeight || 0;
  for (const block of getLeafBlocks(doc.body)) {
    const rect = block.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) continue;
    if (rect.right > 0 && rect.left < width && rect.bottom > 0 && rect.top < height) {
      return block;
    }
  }
  return null;
};

/** 修改 DOM（插入标记/填充译文）并保持当前阅读位置不跳动 */
const mutateKeepingPosition = async (s: Session, doc: Document, mutate: () => boolean) => {
  if (readerModeOf() === "scroll") {
    const scroller = document.getElementById("page-area");
    const anchor = findAnchorInScroll(doc, scroller);
    const before = anchor?.getBoundingClientRect().top ?? 0;
    const changed = mutate();
    if (!changed) return;
    const iframe = getIframeWin();
    if (iframe) iframe.height = doc.body.scrollHeight + 300 + "px";
    if (anchor && scroller) {
      scroller.scrollTop += anchor.getBoundingClientRect().top - before;
    }
    return;
  }
  const anchor = findAnchor(doc);
  const changed = mutate();
  if (changed && anchor && typeof s.rendition.goToNode === "function") {
    s.repositioning = true;
    try {
      await s.rendition.goToNode(anchor);
    } finally {
      s.repositioning = false;
    }
  }
};

const findAnchorInScroll = (doc: Document, scroller: HTMLElement | null): Element | null => {
  if (!scroller) return null;
  const frame = getIframeWin();
  const frameTop = frame?.getBoundingClientRect().top ?? 0;
  const viewTop = scroller.getBoundingClientRect().top;
  for (const block of getLeafBlocks(doc.body)) {
    const rect = block.getBoundingClientRect();
    if (rect.bottom + frameTop > viewTop) return block;
  }
  return null;
};

const fillDoc = (s: Session, doc: Document) => {
  const chapter = currentChapter(s.rendition);
  const dict = getCache(s.book.key, chapter)[getFullTranslationTarget()] || {};
  return mutateKeepingPosition(s, doc, () =>
    fillMarkers(doc, (t) => dict[t], (t) => s.failed.has(t))
  );
};

const enqueue = <T,>(s: Session, task: () => Promise<T>): Promise<T | undefined> => {
  const next = s.queue.then(task, task);
  s.queue = next.catch(() => undefined);
  return next.catch((e) => {
    console.error("Full translation failed:", e);
    return undefined;
  });
};

/** 自动模式：从当前页第一个未翻译的小段开始，往后译一批 */
const translateAhead = async (s: Session, doc: Document) => {
  const chapter = currentChapter(s.rendition);
  const markers = getMarkers(doc);
  const anchor = isPaginated() ? findAnchor(doc) : findAnchorInScroll(doc, document.getElementById("page-area"));
  let startIndex = 0;
  if (anchor) {
    const i = markers.findIndex((m) => anchor.contains(m) || !!(anchor.compareDocumentPosition(m) & Node.DOCUMENT_POSITION_FOLLOWING));
    if (i >= 0) startIndex = i;
  }
  const texts: string[] = [];
  let size = 0;
  for (const m of markers.slice(startIndex)) {
    const src = m.getAttribute("data-src") || "";
    if (size > AUTO_LOOKAHEAD_CHARS) break;
    texts.push(src);
    size += src.length;
  }
  const pending = pendingOf(s.book.key, chapter, texts, s.failed);
  for (const batch of chunk(pending)) {
    if (session !== s || currentChapter(s.rendition) !== chapter) return;
    await translateBatch(s.book, chapter, batch, s.failed);
    await fillDoc(s, doc);
  }
};

/** 阅读器每次渲染/翻页后调用 */
export const handleTranslationRender = async () => {
  const s = session;
  if (!s || s.repositioning || !isEnabled(s.book.key)) return;
  const mode = getFullTranslationMode(s.book.key);
  const fontSize = parseFloat(ConfigService.getReaderConfig("fontSize") || "18");
  for (const doc of getDocs(s)) {
    const unit = getTranslationUnit();
    injectTranslationStyle(doc, mode, fontSize, unit);
    await mutateKeepingPosition(s, doc, () => decorateDocument(doc, unit) > 0);
    await fillDoc(s, doc);
    await enqueue(s, () => translateAhead(s, doc));
  }
};

export const attachFullTranslation = (rendition: any, book: Book) => {
  session = { rendition, book, failed: new Set(), queue: Promise.resolve(), repositioning: false };
  return () => {
    if (session?.rendition === rendition) session = null;
  };
};

/* ---------------- 版式书（PDF）对照翻译面板 ---------------- */

/** 翻译一组段落（复用同一缓存目录），返回 原文 → 译文；chapter 为页码等稳定标识 */
export const translateParagraphs = async (
  book: Book,
  chapter: string,
  texts: string[],
  failed: Set<string>
): Promise<Record<string, string>> => {
  for (const batch of chunk(pendingOf(book.key, chapter, texts, failed))) {
    await translateBatch(book, chapter, batch, failed);
  }
  return getCachedTranslations(book.key, chapter);
};

export const getCachedTranslations = (bookKey: string, chapter: string) =>
  getCache(bookKey, chapter)[getFullTranslationTarget()] || {};

/* ---------------- 本章 / 全书 ---------------- */

/** 读取某章的块文本：getRestAudioText 从 tempLocation 的下一章开始取，临时改写起点（同步读取，立刻恢复） */
const getChapterBlockTexts = async (rendition: any, chapterIndex: number): Promise<string[]> => {
  if (typeof rendition.getRestAudioText !== "function" || !rendition.tempLocation) return [];
  const saved = rendition.tempLocation.chapterDocIndex;
  rendition.tempLocation.chapterDocIndex = String(chapterIndex - 1);
  let task: Promise<{ chapterDocIndex: number; audioText: string[] }[]>;
  try {
    task = rendition.getRestAudioText(1);
  } finally {
    rendition.tempLocation.chapterDocIndex = saved;
  }
  const result = await task;
  return result?.[0]?.audioText || [];
};

const getChapterCount = (rendition: any): number => {
  const docs = typeof rendition.getChapterDoc === "function" ? rendition.getChapterDoc() : [];
  return Array.isArray(docs) ? docs.length : 0;
};

const runJob = async (
  s: Session,
  scope: TranslationJobScope,
  chapters: { chapter: string; texts: string[] }[],
  token: number
) => {
  const plan = chapters.map((c) => ({ ...c, pending: pendingOf(s.book.key, c.chapter, c.texts) }));
  const total = plan.reduce((n, c) => n + c.pending.length, 0);
  let done = 0;
  setJob({ bookKey: s.book.key, scope, done, total, status: "running" });
  for (const c of plan) {
    for (const batch of chunk(c.pending)) {
      if (token !== jobToken || session !== s) return;
      batch.forEach((t) => s.failed.delete(t));
      await enqueue(s, () => translateBatch(s.book, c.chapter, batch, s.failed));
      done += batch.length;
      if (token !== jobToken) return;
      setJob({ bookKey: s.book.key, scope, done, total, status: "running" });
      if (c.chapter === currentChapter(s.rendition)) {
        for (const doc of getDocs(s)) await fillDoc(s, doc);
      }
    }
  }
  if (token === jobToken) {
    setJob({ bookKey: s.book.key, scope, done: total, total, status: "done" });
  }
};

const startJob = async (scope: TranslationJobScope) => {
  const s = session;
  if (!s || !isEnabled(s.book.key)) return false;
  cancelTranslationJob();
  const token = ++jobToken;
  try {
    let chapters: { chapter: string; texts: string[] }[] = [];
    if (scope === "chapter") {
      const chapter = currentChapter(s.rendition);
      const texts = getDocs(s).flatMap((doc) =>
        getMarkers(doc).map((m) => m.getAttribute("data-src") || "")
      );
      chapters = [{ chapter, texts }];
    } else {
      setJob({ bookKey: s.book.key, scope, done: 0, total: 0, status: "running" });
      const count = getChapterCount(s.rendition);
      for (let i = 0; i < count; i++) {
        if (token !== jobToken) return true;
        const texts = getSegmentTexts(
          await getChapterBlockTexts(s.rendition, i),
          getTranslationUnit()
        );
        if (texts.length) chapters.push({ chapter: String(i), texts });
      }
      // 从当前章开始译，读者最先看到的内容最先完成
      const cur = currentChapter(s.rendition);
      const at = chapters.findIndex((c) => c.chapter === cur);
      if (at > 0) chapters = [...chapters.slice(at), ...chapters.slice(0, at)];
    }
    await runJob(s, scope, chapters, token);
  } catch (error) {
    console.error("Translation job failed:", error);
    if (token === jobToken && currentJob) setJob({ ...currentJob, status: "error" });
  }
  return true;
};

export const translateCurrentChapter = () => startJob("chapter");
export const translateWholeBook = () => startJob("book");
