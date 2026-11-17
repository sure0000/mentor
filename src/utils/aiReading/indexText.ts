// AI 伴读：全书索引的纯逻辑（无 DOM / 无引擎依赖，便于单测）

export const INDEX_VERSION = 1;

/** 提取器（iframe 内）逐章返回的原始结果 */
export interface RawChapter {
  docIndex: number;
  href: string;
  /** getChapterDoc()[i].label，非目录项为空 */
  label: string;
  /** getPosition().chapterTitle，非目录项会继承前一个目录项 */
  positionTitle: string;
  text: string;
  error?: string;
}

export interface TocItem {
  label: string;
  href: string;
  /** 目录层级（引擎 flatChapter 的 index 字段） */
  level: number;
}

export interface IndexChapter {
  /** 引擎的 chapterDocIndex，跳转用 */
  docIndex: number;
  href: string;
  title: string;
  /** 是否为目录中的条目（封面、版权页、注释等非目录文档为 false） */
  inToc: boolean;
  text: string;
  error?: string;
}

export interface BookIndex {
  version: number;
  bookKey: string;
  bookMd5: string;
  bookSize: number;
  format: string;
  createdAt: number;
  durationMs: number;
  totalChars: number;
  chapters: IndexChapter[];
  toc: TocItem[];
}

const countNonSpace = (s: string) => s.replace(/\s/g, "").length;

/**
 * 在引擎 chapterText() 与渲染后 DOM 的 innerText 之间选一个。
 * 引擎文本会丢掉段落换行（EPUB 实测），DOM 文本保留段落但 PDF 下为空。
 * DOM 文本字数接近引擎文本且含换行时用 DOM，否则用引擎。
 */
export const pickChapterText = (engineText: string, domText: string) => {
  const e = (engineText || "").trim();
  const d = (domText || "").trim();
  if (d && d.includes("\n") && countNonSpace(d) >= countNonSpace(e) * 0.9) {
    return d;
  }
  return e;
};

/** 统一换行与空白：去 \r，行内空白折叠，多个空行合并为一个 */
export const normalizeText = (text: string) =>
  (text || "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t 　]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

export const buildChapters = (
  rows: RawChapter[],
  toc: TocItem[]
): IndexChapter[] => {
  const tocLabels = new Set(toc.map((t) => t.label).filter(Boolean));
  return rows.map((row) => {
    const label = (row.label || "").trim();
    const text = normalizeText(row.text);
    // 非目录文档（封面、注释等）的 positionTitle 继承自前一个目录项，不能当标题；
    // 优先用正文首行（足够短时）
    const firstLine = text.split("\n", 1)[0].trim();
    const fallback =
      firstLine && firstLine.length <= 40
        ? firstLine
        : (row.positionTitle || "").trim();
    const chapter: IndexChapter = {
      docIndex: row.docIndex,
      href: row.href || "",
      title: label || fallback || `#${row.docIndex + 1}`,
      inToc: !!label && tocLabels.has(label),
      text,
    };
    if (row.error) chapter.error = row.error;
    return chapter;
  });
};

export const totalChars = (chapters: IndexChapter[]) =>
  chapters.reduce((sum, c) => sum + c.text.length, 0);

/** 缓存是否仍对应这本书的当前文件 */
export const isIndexValid = (
  index: Partial<BookIndex> | null | undefined,
  book: { key: string; md5: string; size: number }
): index is BookIndex =>
  !!index &&
  index.version === INDEX_VERSION &&
  index.bookKey === book.key &&
  index.bookMd5 === book.md5 &&
  index.bookSize === book.size &&
  Array.isArray(index.chapters);

/** 不适合文本提取的格式（漫画 / 扫描件） */
const IMAGE_FORMATS = new Set(["CBR", "CBZ", "CBT", "CB7", "DJVU", "DJV"]);

export const isExtractableBook = (book: {
  format: string;
  description?: string;
}) => {
  const format = (book.format || "").toUpperCase();
  if (IMAGE_FORMATS.has(format)) return false;
  if (format === "PDF" && (book.description || "").indexOf("scanned") > -1) {
    return false;
  }
  return true;
};

/** 粗判书的语言：取样正文中汉字占字母类字符的比例 */
export const detectBookLanguage = (
  chapters: Pick<IndexChapter, "text">[]
): "zh" | "en" => {
  const sample = chapters
    .map((c) => c.text.slice(0, 2000))
    .join("")
    .slice(0, 20000);
  const cjk = (sample.match(/[\u4e00-\u9fff]/g) || []).length;
  const latin = (sample.match(/[a-zA-Z]/g) || []).length;
  return cjk > 0 && cjk >= latin * 0.2 ? "zh" : "en";
};

export const languageInstruction = (lang: "zh" | "en") =>
  lang === "zh" ? "请用中文作答。" : "Answer in English.";
