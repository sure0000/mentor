// AI 伴读：本章要点的生成与缓存（渲染进程）。
// 缓存：<数据目录>/ai-reading/<bookKey>/points/<docIndex>.json（FR-SUM-06）
import { ConfigService } from "../../assets/lib/kookit-extra-browser.min";
import { getStorageLocation } from "../common";
import { chatStream } from "../request/common";
import { useAppStore } from "../../store/useAppStore";
import {
  CLAUDE_CODE_PLUGIN_KEY,
  ClaudeCodeErrorCode,
  cancelClaudeCode,
  startClaudeCodeChat,
} from "./claudeCode";
import {
  CHAPTER_POINTS_SCHEMA,
  CHAPTER_POINTS_SYSTEM,
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

export class AiTaskError extends Error {
  code: ClaudeCodeErrorCode | "no-service" | "bad-output";
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

/** 当前选中的 AI 服务能否用于本章要点（Claude Code 或自定义 OpenAI 兼容服务） */
export const getPointsBackend = (): "claude-code" | "custom" | null => {
  const service = ConfigService.getReaderConfig("aiService");
  if (service === CLAUDE_CODE_PLUGIN_KEY) return "claude-code";
  if (service === "custom-ai-assistant-plugin") {
    const plugin = useAppStore
      .getState()
      .manager.plugins.find((p) => p.key === "custom-ai-assistant-plugin");
    if (plugin) return "custom";
  }
  return null;
};

export type RunningTask = { cancel: () => void };

/** 一次结构化 AI 调用：Claude Code 用 --json-schema，自定义服务把 Schema 写进提示词 */
export const runStructured = async (params: {
  system: string;
  prompt: string;
  schema: object;
  onRunning?: (task: RunningTask) => void;
}): Promise<{ raw: unknown; costUsd: number; durationMs: number }> => {
  const backend = getPointsBackend();
  if (!backend) throw new AiTaskError("no-service");
  if (backend === "claude-code") {
    const { requestId, promise } = startClaudeCodeChat({
      system: params.system,
      prompt: params.prompt,
      schema: params.schema,
      onText: () => {},
    });
    params.onRunning?.({ cancel: () => cancelClaudeCode(requestId) });
    const result = await promise;
    if (!result.ok) {
      throw new AiTaskError(result.code, result.message || "", result.costUsd);
    }
    return {
      raw: result.structured,
      costUsd: result.costUsd,
      durationMs: result.durationMs,
    };
  }
  const plugin = useAppStore
    .getState()
    .manager.plugins.find((p) => p.key === "custom-ai-assistant-plugin");
  if (!plugin) throw new AiTaskError("no-service");
  const config = (plugin.config || {}) as Record<string, string>;
  const started = Date.now();
  let text = "";
  let cancelled = false;
  params.onRunning?.({ cancel: () => (cancelled = true) });
  await chatStream(
    config.endpoint,
    config.providerId,
    config.apiKey,
    config.modelId,
    params.system +
      "\n\n只输出一个 JSON 对象，不要输出其他文字。JSON Schema：\n" +
      JSON.stringify(params.schema) +
      "\n\n" +
      params.prompt,
    [],
    (r: { text?: string }) => {
      if (r && r.text) text += r.text;
    }
  );
  if (cancelled) throw new AiTaskError("cancelled");
  let raw: unknown;
  try {
    raw = extractJson(text);
  } catch (e) {
    throw new AiTaskError("bad-output", text.slice(0, 200));
  }
  // 自定义服务拿不到花费，记为 -1（界面显示 $?）
  return { raw, costUsd: -1, durationMs: Date.now() - started };
};

/** 生成本章要点（只调用一次 AI，FR-SUM-02），成功后写缓存 */
export const generateChapterPoints = async (
  bookTitle: string,
  index: BookIndex,
  chapter: IndexChapter,
  onRunning: (task: RunningTask) => void = () => {}
): Promise<ChapterPoints> => {
  if (!getPointsBackend()) throw new AiTaskError("no-service");
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
    system: CHAPTER_POINTS_SYSTEM,
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
