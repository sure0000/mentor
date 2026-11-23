// AI 伴读：全书问答服务（渲染进程）。组装上下文 → 检索 → 交给 popupAssist 现有的流式调用。
import { ConfigService } from "../../assets/lib/kookit-extra-browser.min";
import Book from "../../models/Book";
import { loadCachedIndex } from "./bookIndex";
import { getPrompt } from "./aiGateway";
import { loadChapterPoints } from "./chapterPointsService";
import { retrievePassages, ScoredPassage } from "./retrieval";
import {
  QaContextRef,
  RETRIEVAL_BUDGET,
  buildQaPrompt,
  buildQaSystem,
} from "./bookQa";
import type { ChatTurn } from "./bookQa";

/** 设置项：防剧透（只检索当前位置之前的章节，FR-QA-04） */
export const SPOILER_SAFE_KEY = "isAiSpoilerSafe";

export const isSpoilerSafe = () =>
  ConfigService.getReaderConfig(SPOILER_SAFE_KEY) === "yes";

export interface QaRequest {
  system: string;
  prompt: string;
  /** 用于事后核对出处 */
  context: {
    passages: QaContextRef[];
    current: QaContextRef | null;
    selection: QaContextRef | null;
  };
  /** 是否用上了全书索引（没有索引时退化为「当前章节」） */
  usedIndex: boolean;
  spoilerSafe: boolean;
}

/**
 * 为一次提问准备上下文。
 * @param currentDocIndex 当前阅读位置（-1 表示未知）
 * @param fallbackChapterText 没有全书索引时使用的当前章节文本（rendition.chapterText()）
 */
export const prepareQa = (params: {
  book: Book;
  question: string;
  selection: string;
  history: ChatTurn[];
  currentDocIndex: number;
  fallbackChapterText: string;
}): QaRequest => {
  const index = loadCachedIndex(params.book);
  const spoilerSafe = isSpoilerSafe();
  const current = index?.chapters.find((c) => c.docIndex === params.currentDocIndex) || null;
  const currentRef: QaContextRef | null = current
    ? { docIndex: current.docIndex, chapterTitle: current.title, text: current.text }
    : params.fallbackChapterText
      ? { docIndex: params.currentDocIndex, chapterTitle: "", text: params.fallbackChapterText }
      : null;
  let passages: ScoredPassage[] = [];
  if (index) {
    // 检索词包含选中文字，让「这段话在别处还提到吗」类问题也能命中
    const query = params.question + " " + params.selection.slice(0, 200);
    passages = retrievePassages(
      index,
      query,
      (c) => loadChapterPoints(index.bookKey, c),
      {
        budgetChars: RETRIEVAL_BUDGET,
        excludeDocIndex: current?.docIndex,
        maxDocIndex: spoilerSafe && params.currentDocIndex >= 0 ? params.currentDocIndex : undefined,
      }
    );
  }
  const selectionRef: QaContextRef | null = params.selection
    ? { docIndex: currentRef?.docIndex ?? -1, chapterTitle: currentRef?.chapterTitle || "", text: params.selection }
    : null;
  return {
    system: buildQaSystem(getPrompt("bookQa")),
    prompt: buildQaPrompt({
      bookTitle: params.book.name,
      question: params.question,
      selection: params.selection,
      currentChapter: currentRef ? { title: currentRef.chapterTitle, text: currentRef.text } : null,
      passages,
      history: params.history,
      spoilerSafe,
    }),
    context: {
      passages: passages.map((p) => ({ docIndex: p.docIndex, chapterTitle: p.chapterTitle, text: p.text })),
      current: currentRef,
      selection: selectionRef,
    },
    usedIndex: !!index,
    spoilerSafe,
  };
};
