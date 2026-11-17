/** 设置项：读完一章时提示「看看本章要点？」（FR-SUM-08，默认关闭） */
export const CHAPTER_END_PROMPT_KEY = "isAiChapterEndPrompt";

// AI 伴读：从面板外部（如读完一章的提示）请求在伴读面板中打开某一章。
// 伴读面板在挂载/更新时消费该请求；模块内状态，不持久化。
type Listener = (docIndex: number) => void;

let pending: number | null = null;
const listeners = new Set<Listener>();

export const requestOpenChapterPoints = (docIndex: number) => {
  pending = docIndex;
  listeners.forEach((l) => l(docIndex));
};

/** 取走待处理的请求（只消费一次） */
export const takePendingChapter = () => {
  const v = pending;
  pending = null;
  return v;
};

export const subscribeOpenChapter = (listener: Listener) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const hasPendingChapter = () => pending !== null;

