// PDF 对照翻译：读取当前可见页的文字层并还原成段落（段落切分逻辑见 pdfParagraphs.ts）
import Book from "../../models/Book";
import { getIframeDoc, getIframeWin } from "./docUtil";
import { groupParagraphs, TextBox } from "./pdfParagraphs";

/** 读取一个文档中 PDF 文字层的碎片（屏幕坐标） */
export const collectBoxes = (doc: Document): TextBox[] => {
  const boxes: TextBox[] = [];
  doc.querySelectorAll(".textLayer").forEach((layer) => {
    layer.querySelectorAll("span").forEach((span) => {
      if (span.closest(".endOfContent") || span.querySelector("span")) return;
      const rect = span.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) return;
      boxes.push({
        text: span.textContent || "",
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
      });
    });
  });
  return boxes;
};

export interface PdfPageText {
  /** 页在文档中的序号（子 iframe 顺序），用作 React key */
  index: number;
  paragraphs: string[];
}

/** 当前屏幕上可见的 PDF 页及其段落 */
export const getVisiblePdfPages = (book: Book): PdfPageText[] => {
  const outer = getIframeWin();
  const docs = getIframeDoc(book);
  if (!outer || !docs.length) return [];
  const outerRect = outer.getBoundingClientRect();
  const outerDoc = docs[0];
  const frames = outerDoc ? Array.from(outerDoc.querySelectorAll("iframe")) : [];
  const viewW = window.innerWidth;
  const viewH = window.innerHeight;
  const pages: PdfPageText[] = [];
  frames.forEach((frame, index) => {
    const r = frame.getBoundingClientRect();
    const left = r.left + outerRect.left;
    const top = r.top + outerRect.top;
    if (r.width === 0 || left > viewW || left + r.width < 0 || top > viewH || top + r.height < 0) {
      return;
    }
    let doc: Document | null = null;
    try {
      doc = frame.contentDocument;
    } catch (_) {
      return;
    }
    if (!doc) return;
    const paragraphs = groupParagraphs(collectBoxes(doc));
    if (paragraphs.length) pages.push({ index, paragraphs });
  });
  // 没有子 iframe 的结构：直接读外层文档
  if (!frames.length && outerDoc) {
    const paragraphs = groupParagraphs(collectBoxes(outerDoc));
    if (paragraphs.length) pages.push({ index: 0, paragraphs });
  }
  return pages;
};
