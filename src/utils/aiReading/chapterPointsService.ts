// AI 伴读：本章要点的生成与缓存（渲染进程）。
// 缓存：<数据目录>/ai-reading/<bookKey>/points/<docIndex>.json（FR-SUM-06）
import { getStorageLocation } from "../common";
import { aiStreamText, getPrompt, isAiAvailable } from "./aiGateway";
import {
  CHAPTER_POINTS_SCHEMA,
  ChapterPoints,
  buildChapterPointsPrompt,
  extractJson,
  isPointsValid,
  toChapterPoints,
} from "./chapterPoints";
import {
  BookIndex,
  IndexChapter,
  detectBookLanguage,
  languageInstruction,
} from "./indexText";

export type AiTaskErrorCode =
  | "no-service"
  | "bad-output"
  | "cancelled"
  | "failed";

/** 错误码 → 用户可见提示的 i18n key */
export const AI_TASK_ERROR_KEYS: Record<AiTaskErrorCode, string> = {
  "no-service": "AI_GUIDE_NO_SERVICE",
  "bad-output": "AI_GUIDE_BAD_OUTPUT",
  cancelled: "Stopped",
  failed: "AI request failed",
};

export class AiTaskError extends Error {
  code: AiTaskErrorCode;
  costUsd: number;
  constructor(code: AiTaskError["code"], message = "", costUsd = 0) {
    super(message || code);
    this.code = code;
    this.costUsd = costUsd;
  }
}

const pointsDir = (bookKey: string) =>
  window.electronAPI.path.join(
    getStorageLocation() || "",
    "ai-reading",
    bookKey,
    "points"
  );

const pointsFile = (bookKey: string, docIndex: number) =>
  window.electronAPI.path.join(pointsDir(bookKey), `${docIndex}.json`);

export const loadChapterPoints = (
  bookKey: string,
  chapter: IndexChapter
): ChapterPoints | null => {
  try {
    const fs = window.electronAPI.fs;
    const file = pointsFile(bookKey, chapter.docIndex);
    if (!fs.existsSync(file)) return null;
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    return isPointsValid(data, chapter) ? data : null;
  } catch (e) {
    console.warn("AI points cache unreadable", e);
    return null;
  }
};

const saveChapterPoints = (bookKey: string, points: ChapterPoints) => {
  const fs = window.electronAPI.fs;
  const dir = pointsDir(bookKey);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    pointsFile(bookKey, points.docIndex),
    JSON.stringify(points, null, 1)
  );
};

/** 是否已在「设置 > AI」中配置可用的 LLM */
export const hasAiBackend = (): boolean => isAiAvailable("assistance");

export type RunningTask = { cancel: () => void };

/**
 * 流式调用 LLM，返回完整文本。取消时抛 cancelled，请求失败抛 failed。
 */
export const runText = async (params: {
  system: string;
  prompt: string;
  onText?: (delta: string) => void;
  onRunning?: (task: RunningTask) => void;
}): Promise<{ text: string; durationMs: number }> => {
  if (!hasAiBackend()) throw new AiTaskError("no-service");
  const started = Date.now();
  let text = "";
  let cancelled = false;
  const handle = aiStreamText({
    system: params.system,
    prompt: params.prompt,
    onText: (d) => {
      text += d;
      params.onText?.(d);
    },
  });
  params.onRunning?.({
    cancel: () => {
      cancelled = true;
      handle.cancel();
    },
  });
  try {
    await handle.done;
  } catch (e) {
    throw new AiTaskError(
      "failed",
      e instanceof Error ? e.message : String((e as { data?: unknown })?.data ?? "")
    );
  }
  if (cancelled) throw new AiTaskError("cancelled");
  return { text, durationMs: Date.now() - started };
};

/** 一次结构化 AI 调用：把 Schema 写进提示词，再从输出中解析 JSON */
export const runStructured = async (params: {
  system: string;
  prompt: string;
  schema: object;
  onRunning?: (task: RunningTask) => void;
}): Promise<{ raw: unknown; costUsd: number; durationMs: number }> => {
  const { text, durationMs } = await runText({
    system:
      params.system +
      "\n\n只输出一个 JSON 对象，不要输出其他文字。JSON Schema：\n" +
      JSON.stringify(params.schema),
    prompt: params.prompt,
    onRunning: params.onRunning,
  });
  let raw: unknown;
  try {
    raw = extractJson(text);
  } catch (e) {
    throw new AiTaskError("bad-output", text.slice(0, 200));
  }
  // 通用接口拿不到花费，记为 -1（界面显示 $?）
  return { raw, costUsd: -1, durationMs };
};

/** 生成本章要点（只调用一次 AI，FR-SUM-02），成功后写缓存 */
export const generateChapterPoints = async (
  bookTitle: string,
  index: BookIndex,
  chapter: IndexChapter,
  onRunning: (task: RunningTask) => void = () => {}
): Promise<ChapterPoints> => {
  if (!hasAiBackend()) throw new AiTaskError("no-service");
  const pos = index.chapters.findIndex((c) => c.docIndex === chapter.docIndex);
  const previousTitles = index.chapters
    .slice(0, Math.max(0, pos))
    .filter((c) => c.inToc)
    .map((c) => c.title);
  const { prompt, truncated } = buildChapterPointsPrompt({
    bookTitle,
    chapter,
    previousTitles,
    languageLine: languageInstruction(detectBookLanguage(index.chapters)),
  });
  const out = await runStructured({
    system: getPrompt("chapterPoints"),
    prompt,
    schema: CHAPTER_POINTS_SCHEMA,
    onRunning,
  });
  let points: ChapterPoints;
  try {
    points = toChapterPoints(out.raw, {
      docIndex: chapter.docIndex,
      chapterTitle: chapter.title,
      chapterText: chapter.text,
      truncated,
      costUsd: out.costUsd,
      durationMs: out.durationMs,
    });
  } catch (e) {
    throw new AiTaskError("bad-output", "", out.costUsd);
  }
  saveChapterPoints(index.bookKey, points);
  return points;
};
