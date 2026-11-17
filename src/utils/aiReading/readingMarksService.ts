// AI 伴读：阅读分级与重点划线的生成、缓存、全书任务、精读进一步功能（渲染进程）。
// 缓存：<数据目录>/ai-reading/<bookKey>/marks/<docIndex>.json
import Book from "../../models/Book";
import { ConfigService } from "../../assets/lib/kookit-extra-browser.min";
import { getStorageLocation } from "../common";
import { chatStream } from "../request/common";
import { useAppStore } from "../../store/useAppStore";
import { cancelClaudeCode, formatUsage, startClaudeCodeChat } from "./claudeCode";
import {
  AiTaskError,
  RunningTask,
  getPointsBackend,
  runStructured,
} from "./chapterPointsService";
import { MAX_CHAPTER_CHARS } from "./chapterPoints";
import { GuideEstimate, analyzableChapters, estimateGuideCost } from "./bookGuide";
import { parseSources, stripRefMarkers, stripSources } from "./bookQa";
import { prepareQa } from "./bookQaService";
import {
  BookIndex,
  IndexChapter,
  detectBookLanguage,
  languageInstruction,
} from "./indexText";
import {
  ACTION_QUESTIONS,
  ActionResult,
  ChapterMarks,
  CompanionAction,
  MarkSegment,
  READING_MARKS_SCHEMA,
  READING_MARKS_SYSTEM,
  buildReadingMarksPrompt,
  isMarksValid,
  segmentKey,
  segmentText,
  splitParagraphs,
  toChapterMarks,
} from "./readingMarks";

const marksDir = (bookKey: string) =>
  window.electronAPI.path.join(getStorageLocation() || "", "ai-reading", bookKey, "marks");

const marksFile = (bookKey: string, docIndex: number) =>
  window.electronAPI.path.join(marksDir(bookKey), `${docIndex}.json`);

export const loadChapterMarks = (bookKey: string, chapter: IndexChapter): ChapterMarks | null => {
  try {
    const fs = window.electronAPI.fs;
    const file = marksFile(bookKey, chapter.docIndex);
    if (!fs.existsSync(file)) return null;
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    return isMarksValid(data, chapter) ? data : null;
  } catch (e) {
    console.warn("AI marks cache unreadable", e);
    return null;
  }
};

const saveChapterMarks = (bookKey: string, marks: ChapterMarks) => {
  const fs = window.electronAPI.fs;
  const dir = marksDir(bookKey);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(marksFile(bookKey, marks.docIndex), JSON.stringify(marks, null, 1));
  notifyMarksChanged(bookKey);
};

// ---- 变化通知：书页渲染与面板订阅（模块内，不持久化） ----

type ChangeListener = (bookKey: string) => void;
const changeListeners = new Set<ChangeListener>();

export const notifyMarksChanged = (bookKey: string) => {
  changeListeners.forEach((l) => l(bookKey));
};

export const subscribeMarksChanged = (listener: ChangeListener) => {
  changeListeners.add(listener);
  return () => {
    changeListeners.delete(listener);
  };
};

/** 本章段落切分（与生成时一致，渲染与界面用） */
export const chapterParagraphs = (chapter: IndexChapter) =>
  splitParagraphs(chapter.text, MAX_CHAPTER_CHARS).paragraphs;

/** 生成一章的阅读分级与重点划线（调用一次 AI），成功后写缓存 */
export const generateChapterMarks = async (
  bookTitle: string,
  index: BookIndex,
  chapter: IndexChapter,
  onRunning: (task: RunningTask) => void = () => {}
): Promise<ChapterMarks> => {
  if (!getPointsBackend()) throw new AiTaskError("no-service");
  const { paragraphs, truncated } = splitParagraphs(chapter.text, MAX_CHAPTER_CHARS);
  if (paragraphs.length === 0) throw new AiTaskError("bad-output");
  const pos = index.chapters.findIndex((c) => c.docIndex === chapter.docIndex);
  const previousTitles = index.chapters
    .slice(0, Math.max(0, pos))
    .filter((c) => c.inToc)
    .map((c) => c.title);
  const out = await runStructured({
    system: READING_MARKS_SYSTEM,
    prompt: buildReadingMarksPrompt({
      bookTitle,
      chapterTitle: chapter.title,
      paragraphs,
      truncated,
      previousTitles,
      languageLine: languageInstruction(detectBookLanguage(index.chapters)),
    }),
    schema: READING_MARKS_SCHEMA,
    onRunning,
  });
  let marks: ChapterMarks;
  try {
    marks = toChapterMarks(out.raw, {
      docIndex: chapter.docIndex,
      chapterTitle: chapter.title,
      chapterText: chapter.text,
      paragraphs,
      truncated,
      costUsd: out.costUsd,
      durationMs: out.durationMs,
    });
  } catch (e) {
    throw new AiTaskError("bad-output", "", out.costUsd);
  }
  // 重新生成时，保留区间未变的精读进一步结果
  const old = loadChapterMarks(index.bookKey, chapter);
  if (old?.extras) {
    const keys = new Set(marks.segments.filter((s) => s.level === "deep").map(segmentKey));
    const extras = Object.fromEntries(Object.entries(old.extras).filter(([k]) => keys.has(k)));
    if (Object.keys(extras).length) marks.extras = extras;
  }
  saveChapterMarks(index.bookKey, marks);
  return marks;
};

// ---- 精读段落：辅助阅读 / 知识关联 / 拓展阅读 ----

/**
 * 对一个精读区间运行进一步功能。复用全书问答的上下文（当前章 + 全书检索）与出处核对；
 * 流式返回，完成后存进该章的 marks 缓存。
 */
export const runCompanionAction = async (params: {
  book: Book;
  index: BookIndex;
  chapter: IndexChapter;
  segment: MarkSegment;
  action: CompanionAction;
  onText: (delta: string) => void;
  onRunning?: (task: RunningTask) => void;
}): Promise<ActionResult> => {
  const backend = getPointsBackend();
  if (!backend) throw new AiTaskError("no-service");
  const selection = segmentText(params.segment, chapterParagraphs(params.chapter)).slice(0, 3000);
  const qa = prepareQa({
    book: params.book,
    question: ACTION_QUESTIONS[params.action],
    selection,
    history: [],
    currentDocIndex: params.chapter.docIndex,
    fallbackChapterText: params.chapter.text,
  });
  let raw = "";
  const onText = (d: string) => {
    raw += d;
    params.onText(d);
  };
  let usage = "";
  if (backend === "claude-code") {
    const { requestId, promise } = startClaudeCodeChat({ system: qa.system, prompt: qa.prompt, onText });
    params.onRunning?.({ cancel: () => cancelClaudeCode(requestId) });
    const result = await promise;
    if (!result.ok) throw new AiTaskError(result.code, result.message || "", result.costUsd);
    if (!raw) raw = result.text;
    usage = formatUsage(result.costUsd, result.durationMs);
  } else {
    const plugin = useAppStore
      .getState()
      .manager.plugins.find((p) => p.key === "custom-ai-assistant-plugin");
    const config = (plugin?.config || {}) as Record<string, string>;
    let cancelled = false;
    params.onRunning?.({ cancel: () => (cancelled = true) });
    const started = Date.now();
    await chatStream(
      config.endpoint,
      config.providerId,
      config.apiKey,
      config.modelId,
      qa.system + "\n\n" + qa.prompt,
      [],
      (r: { text?: string }) => {
        if (!cancelled && r && r.text) onText(r.text);
      }
    );
    if (cancelled) throw new AiTaskError("cancelled");
    usage = `${((Date.now() - started) / 1000).toFixed(1)}s`;
  }
  const result: ActionResult = {
    content: stripRefMarkers(stripSources(raw)),
    sources: parseSources(raw, qa.context),
    usage,
    createdAt: Date.now(),
  };
  const marks = loadChapterMarks(params.index.bookKey, params.chapter);
  if (marks) {
    const key = segmentKey(params.segment);
    marks.extras = { ...(marks.extras || {}), [key]: { ...(marks.extras?.[key] || {}), [params.action]: result } };
    saveChapterMarks(params.index.bookKey, marks);
  }
  return result;
};

// ---- 全书任务：逐章生成（已有缓存的跳过），可暂停 / 继续 ----

export const markableChapters = analyzableChapters;

export const estimateBookMarks = (index: BookIndex): GuideEstimate => {
  const chapters = markableChapters(index);
  return estimateGuideCost(
    chapters,
    (i) => !!loadChapterMarks(index.bookKey, chapters[i]),
    MAX_CHAPTER_CHARS,
    false
  );
};

export type MarksJobState = {
  bookKey: string;
  phase: "running" | "paused" | "done" | "error";
  done: number;
  total: number;
  currentTitle: string;
  spentUsd: number;
  error?: Error;
};

type JobListener = (s: MarksJobState | null) => void;
let job: { state: MarksJobState; pauseRequested: boolean; running: RunningTask | null } | null = null;
const jobListeners = new Set<JobListener>();

const emitJob = () => {
  const snap = job ? { ...job.state } : null;
  jobListeners.forEach((l) => l(snap));
};

export const subscribeMarksJob = (listener: JobListener) => {
  jobListeners.add(listener);
  listener(job ? { ...job.state } : null);
  return () => {
    jobListeners.delete(listener);
  };
};

export const pauseMarksJob = () => {
  if (!job || job.state.phase !== "running") return;
  job.pauseRequested = true;
  job.running?.cancel();
};

export const startMarksJob = async (bookTitle: string, index: BookIndex) => {
  if (job?.state.phase === "running") {
    if (job.state.bookKey === index.bookKey) return;
    pauseMarksJob();
  }
  const chapters = markableChapters(index);
  if (chapters.length === 0) throw new Error("no-analyzable-chapters");
  const current = {
    state: {
      bookKey: index.bookKey,
      phase: "running",
      done: 0,
      total: chapters.length,
      currentTitle: "",
      spentUsd: 0,
    } as MarksJobState,
    pauseRequested: false,
    running: null as RunningTask | null,
  };
  job = current;
  const set = (patch: Partial<MarksJobState>) => {
    if (job !== current) return;
    current.state = { ...current.state, ...patch };
    emitJob();
  };
  emitJob();
  try {
    for (let i = 0; i < chapters.length; i++) {
      const chapter = chapters[i];
      if (!loadChapterMarks(index.bookKey, chapter)) {
        if (current.pauseRequested) return set({ phase: "paused" });
        set({ currentTitle: chapter.title });
        try {
          const marks = await generateChapterMarks(bookTitle, index, chapter, (t) => (current.running = t));
          if (marks.costUsd > 0) set({ spentUsd: current.state.spentUsd + marks.costUsd });
        } catch (e) {
          if (e instanceof AiTaskError && e.costUsd > 0) {
            set({ spentUsd: current.state.spentUsd + e.costUsd });
          }
          if (current.pauseRequested) return set({ phase: "paused" });
          throw e;
        } finally {
          current.running = null;
        }
      }
      set({ done: i + 1 });
    }
    set({ phase: "done", currentTitle: "" });
  } catch (e) {
    set({ phase: "error", error: e instanceof Error ? e : new Error(String(e)) });
  }
};

// ---- 书页渲染设置与面板导航 ----

/**
 * 书页上的伴读标注范围：
 * book（默认）= 所有已生成伴读的章节都在书页上标注；
 * chapter = 只标注面板里打开的那一章（没打开时为正在读的章节）；off = 不标注
 */
export type MarksRenderScope = "off" | "chapter" | "book";
export const MARKS_RENDER_KEY = "aiReadingMarksScope";

export const getMarksRenderScope = (): MarksRenderScope => {
  const v = ConfigService.getReaderConfig(MARKS_RENDER_KEY);
  return v === "off" || v === "chapter" ? v : "book";
};

export const setMarksRenderScope = (scope: MarksRenderScope) => {
  ConfigService.setReaderConfig(MARKS_RENDER_KEY, scope);
  notifyMarksChanged("");
};

/** 「只标注本章」时，面板里选中的章节（模块内状态） */
let focusedDocIndex = -1;
export const getFocusedDocIndex = () => focusedDocIndex;
export const setFocusedDocIndex = (docIndex: number) => {
  if (focusedDocIndex === docIndex) return;
  focusedDocIndex = docIndex;
  if (getMarksRenderScope() === "chapter") notifyMarksChanged("");
};

/** 从书页点击精读段落时，请求面板打开该段 */
export type FocusRequest = { docIndex: number; segment: string; action?: CompanionAction };
type FocusListener = (req: FocusRequest) => void;
let pendingFocus: FocusRequest | null = null;
const focusListeners = new Set<FocusListener>();

export const requestFocusSegment = (req: FocusRequest) => {
  pendingFocus = req;
  focusListeners.forEach((l) => l(req));
};
export const takePendingFocus = () => {
  const v = pendingFocus;
  pendingFocus = null;
  return v;
};
export const hasPendingFocus = () => pendingFocus !== null;
export const subscribeFocusSegment = (listener: FocusListener) => {
  focusListeners.add(listener);
  return () => {
    focusListeners.delete(listener);
  };
};
