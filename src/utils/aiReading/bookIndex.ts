// AI 伴读：全书索引的构建、缓存与读取（渲染进程）。
// 提取在不可见的 extractor.html iframe 中完成，不触碰阅读器的 rendition（FR-IDX-02）。
// 缓存为用户数据目录下的 JSON 文件：<storage>/ai-reading/<bookKey>/index.json（FR-IDX-03 / FR-DATA-01）。
import Book from "../../models/Book";
import BookUtil from "../file/bookUtil";
import { ConfigService } from "../../assets/lib/kookit-extra-browser.min";
import {
  getParserRegex,
  getPdfPassword,
  getStorageLocation,
} from "../common";
import {
  BookIndex,
  INDEX_VERSION,
  buildChapters,
  isExtractableBook,
  isIndexValid,
  totalChars,
} from "./indexText";
import { EXTRACTOR_CHANNEL, FromExtractor, ToExtractor } from "./extractor/protocol";

export type IndexProgress = { done: number; total: number };

export class IndexCancelledError extends Error {
  constructor() {
    super("cancelled");
  }
}

const getBookDir = (bookKey: string) => {
  const path = window.electronAPI.path;
  return path.join(getStorageLocation() || "", "ai-reading", bookKey);
};

const getIndexPath = (bookKey: string) =>
  window.electronAPI.path.join(getBookDir(bookKey), "index.json");

export const loadCachedIndex = (book: Book): BookIndex | null => {
  try {
    const fs = window.electronAPI.fs;
    const file = getIndexPath(book.key);
    if (!fs.existsSync(file)) return null;
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    return isIndexValid(data, book) ? data : null;
  } catch (e) {
    console.warn("AI index cache unreadable", e);
    return null;
  }
};

const saveIndex = (index: BookIndex) => {
  const fs = window.electronAPI.fs;
  const dir = getBookDir(index.bookKey);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(getIndexPath(index.bookKey), JSON.stringify(index));
};

/** 删除本书的全部 AI 缓存（索引、后续阶段的要点 / 导读）（FR-DATA-02） */
export const clearBookAiCache = (bookKey: string) => {
  if (!bookKey) return;
  try {
    window.electronAPI.fs.rmSync(getBookDir(bookKey), {
      recursive: true,
      force: true,
    });
  } catch (e) {
    console.warn("AI cache clear failed", e);
  }
};

const extractorUrl = () => new URL("extractor.html", document.baseURI).href;

let active: { bookKey: string; cancel: () => void } | null = null;

export const cancelIndexing = () => {
  active?.cancel();
};

/** 运行一次提取：创建隐藏 iframe → 发送书籍字节 → 收集结果 → 销毁 iframe */
const runExtractor = (
  buffer: ArrayBuffer,
  book: Book,
  onProgress: (p: IndexProgress) => void
) =>
  new Promise<Extract<FromExtractor, { type: "result" }>>((resolve, reject) => {
    const frame = document.createElement("iframe");
    frame.setAttribute("aria-hidden", "true");
    frame.tabIndex = -1;
    frame.style.cssText =
      "position:fixed;left:-10000px;top:0;width:800px;height:1000px;visibility:hidden;border:0;pointer-events:none";
    let finished = false;
    const cleanup = () => {
      finished = true;
      window.removeEventListener("message", onMessage);
      frame.remove();
      active = null;
    };
    const onMessage = (event: MessageEvent) => {
      const msg = event.data as FromExtractor;
      if (
        finished ||
        event.source !== frame.contentWindow ||
        !msg ||
        msg.channel !== EXTRACTOR_CHANNEL
      ) {
        return;
      }
      if (msg.type === "ready") {
        const req: ToExtractor = {
          channel: EXTRACTOR_CHANNEL,
          type: "extract",
          buffer,
          options: {
            format: book.format,
            charset: book.charset,
            parserRegex: getParserRegex(book.format, book.key),
            password: getPdfPassword(book),
            convertChinese: ConfigService.getReaderConfig("convertChinese") || "",
            textRules: [],
          },
        };
        frame.contentWindow?.postMessage(req, "*", [buffer]);
      } else if (msg.type === "progress") {
        onProgress({ done: msg.done, total: msg.total });
      } else if (msg.type === "result") {
        cleanup();
        resolve(msg);
      } else if (msg.type === "error") {
        cleanup();
        reject(new Error(msg.message));
      }
    };
    active = {
      bookKey: book.key,
      cancel: () => {
        if (finished) return;
        cleanup();
        reject(new IndexCancelledError());
      },
    };
    window.addEventListener("message", onMessage);
    frame.src = extractorUrl();
    document.body.appendChild(frame);
  });

/**
 * 取得本书的全书索引：有有效缓存直接返回，否则在后台提取并写缓存。
 * 同一时间只运行一个提取任务。
 */
export const getBookIndex = async (
  book: Book,
  onProgress: (p: IndexProgress) => void = () => {},
  options: { force?: boolean } = {}
): Promise<BookIndex> => {
  if (!options.force) {
    const cached = loadCachedIndex(book);
    if (cached) return cached;
  }
  if (!isExtractableBook(book)) {
    throw new Error("unsupported-format");
  }
  if (active) {
    if (active.bookKey === book.key) throw new Error("already-running");
    active.cancel();
  }
  const data = await BookUtil.fetchBook(
    book.key,
    book.format.toLowerCase(),
    true,
    book.path
  );
  if (!data || !(data instanceof ArrayBuffer)) {
    throw new Error("book-file-missing");
  }
  const started = Date.now();
  const result = await runExtractor(data, book, onProgress);
  const chapters = buildChapters(result.chapters, result.toc);
  const index: BookIndex = {
    version: INDEX_VERSION,
    bookKey: book.key,
    bookMd5: book.md5,
    bookSize: book.size,
    format: book.format,
    createdAt: Date.now(),
    durationMs: Date.now() - started,
    totalChars: totalChars(chapters),
    chapters,
    toc: result.toc,
  };
  saveIndex(index);
  return index;
};

export const isIndexing = (bookKey: string) => active?.bookKey === bookKey;
