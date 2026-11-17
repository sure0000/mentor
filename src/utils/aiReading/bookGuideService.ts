// AI 伴读：全书导读的后台任务（FR-SUM-04/07）。
// 先逐章生成要点（已有缓存的跳过），再汇总为全书导读。
// 每章要点完成即落盘，所以「暂停 / 关闭再开」后继续时自然从断点续上。
// 任务状态放在模块级，关闭面板不会中断任务；应用退出时主进程会结束子进程。
import { getStorageLocation } from "../common";
import {
  AiTaskError,
  RunningTask,
  generateChapterPoints,
  loadChapterPoints,
  runStructured,
} from "./chapterPointsService";
import { ChapterPoints, MAX_CHAPTER_CHARS } from "./chapterPoints";
import {
  BOOK_GUIDE_SCHEMA,
  BOOK_GUIDE_SYSTEM,
  BOOK_GUIDE_VERSION,
  BookGuide,
  GuideEstimate,
  analyzableChapters,
  buildBookGuidePrompt,
  estimateGuideCost,
  pointsFingerprint,
  toBookGuide,
} from "./bookGuide";
import {
  BookIndex,
  IndexChapter,
  detectBookLanguage,
  languageInstruction,
} from "./indexText";

export type GuideJobState = {
  bookKey: string;
  phase: "chapters" | "summary" | "paused" | "done" | "error";
  done: number;
  total: number;
  currentTitle: string;
  spentUsd: number;
  error?: AiTaskError | Error;
};

const guideFile = (bookKey: string) =>
  window.electronAPI.path.join(
    getStorageLocation() || "",
    "ai-reading",
    bookKey,
    "guide.json"
  );

export const loadBookGuide = (bookKey: string): BookGuide | null => {
  try {
    const fs = window.electronAPI.fs;
    const file = guideFile(bookKey);
    if (!fs.existsSync(file)) return null;
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    return data && data.version === BOOK_GUIDE_VERSION && data.bookKey === bookKey
      ? data
      : null;
  } catch (e) {
    console.warn("AI guide cache unreadable", e);
    return null;
  }
};

const saveBookGuide = (guide: BookGuide) => {
  window.electronAPI.fs.writeFileSync(
    guideFile(guide.bookKey),
    JSON.stringify(guide, null, 1)
  );
};

export const estimateBookGuide = (index: BookIndex): GuideEstimate => {
  const chapters = analyzableChapters(index);
  return estimateGuideCost(
    chapters,
    (i) => !!loadChapterPoints(index.bookKey, chapters[i]),
    MAX_CHAPTER_CHARS
  );
};

/** 章节要点全部齐备时，导读是否落后于这些要点（某章重新生成过） */
export const isGuideStale = (index: BookIndex, guide: BookGuide) => {
  const points = analyzableChapters(index)
    .map((c) => loadChapterPoints(index.bookKey, c))
    .filter((p): p is ChapterPoints => !!p);
  return pointsFingerprint(points) !== guide.sourceHash;
};

type Listener = (s: GuideJobState | null) => void;

let job: {
  state: GuideJobState;
  pauseRequested: boolean;
  running: RunningTask | null;
} | null = null;
const listeners = new Set<Listener>();

const emit = () => {
  const snapshot = job ? { ...job.state } : null;
  listeners.forEach((l) => l(snapshot));
};

export const subscribeGuideJob = (listener: Listener) => {
  listeners.add(listener);
  listener(job ? { ...job.state } : null);
  return () => {
    listeners.delete(listener);
  };
};

export const getGuideJob = (bookKey: string) =>
  job && job.state.bookKey === bookKey ? { ...job.state } : null;

/** 暂停：结束当前这一次 AI 调用，已完成的章节保留 */
export const pauseGuideJob = () => {
  if (!job || job.state.phase === "done" || job.state.phase === "error") return;
  job.pauseRequested = true;
  job.running?.cancel();
};

export const clearGuideJob = (bookKey: string) => {
  if (job && job.state.bookKey === bookKey && !isActive()) {
    job = null;
    emit();
  }
};

const isActive = () =>
  !!job && (job.state.phase === "chapters" || job.state.phase === "summary");

/**
 * 开始或继续全书导读。已在运行时直接返回。
 * 另一本书的任务在运行时会先暂停它（一次只跑一本，控制花费）。
 */
export const startGuideJob = async (bookTitle: string, index: BookIndex) => {
  if (isActive()) {
    if (job!.state.bookKey === index.bookKey) return;
    pauseGuideJob();
  }
  const chapters = analyzableChapters(index);
  if (chapters.length === 0) {
    throw new Error("no-analyzable-chapters");
  }
  job = {
    state: {
      bookKey: index.bookKey,
      phase: "chapters",
      done: 0,
      total: chapters.length,
      currentTitle: "",
      spentUsd: 0,
    },
    pauseRequested: false,
    running: null,
  };
  const current = job;
  const set = (patch: Partial<GuideJobState>) => {
    if (job !== current) return;
    current.state = { ...current.state, ...patch };
    emit();
  };
  const addCost = (c: number) => {
    if (c > 0) set({ spentUsd: current.state.spentUsd + c });
  };
  emit();

  const items: { chapter: IndexChapter; points: ChapterPoints }[] = [];
  try {
    for (let i = 0; i < chapters.length; i++) {
      const chapter = chapters[i];
      let points = loadChapterPoints(index.bookKey, chapter);
      if (!points) {
        if (current.pauseRequested) {
          set({ phase: "paused" });
          return;
        }
        set({ currentTitle: chapter.title });
        try {
          points = await generateChapterPoints(
            bookTitle,
            index,
            chapter,
            (t) => (current.running = t)
          );
          addCost(points.costUsd);
        } catch (e) {
          if (e instanceof AiTaskError) addCost(e.costUsd);
          if (current.pauseRequested) {
            set({ phase: "paused" });
            return;
          }
          throw e;
        } finally {
          current.running = null;
        }
      }
      items.push({ chapter, points });
      set({ done: i + 1 });
    }
    if (current.pauseRequested) {
      set({ phase: "paused" });
      return;
    }
    set({ phase: "summary", currentTitle: "" });
    const out = await runStructured({
      system: BOOK_GUIDE_SYSTEM,
      prompt: buildBookGuidePrompt(
        bookTitle,
        items,
        languageInstruction(detectBookLanguage(index.chapters))
      ),
      schema: BOOK_GUIDE_SCHEMA,
      onRunning: (t) => (current.running = t),
    }).catch((e) => {
      if (e instanceof AiTaskError) addCost(e.costUsd);
      throw e;
    });
    current.running = null;
    addCost(out.costUsd);
    let guide: BookGuide;
    try {
      guide = toBookGuide(out.raw, {
        bookKey: index.bookKey,
        items,
        costUsd: current.state.spentUsd,
        durationMs: out.durationMs,
      });
    } catch (e) {
      throw new AiTaskError("bad-output");
    }
    saveBookGuide(guide);
    set({ phase: "done" });
  } catch (e) {
    if (current.pauseRequested) {
      set({ phase: "paused" });
      return;
    }
    set({
      phase: "error",
      error: e instanceof Error ? e : new Error(String(e)),
    });
  }
};
