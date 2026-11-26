import { useLatest } from "../../utils/hooks/useLatest";
import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import BookUtil from "../../utils/file/bookUtil";
import PopupMenu from "../../components/popups/popupMenu";
import StyleUtil from "../../utils/reader/styleUtil";
import "./index.css";
import { htmlMouseEvent } from "../../utils/reader/mouseEvent";
import {
  setupOverlayTurn,
  teardownOverlayTurn,
} from "../../utils/reader/overlayTurn";
import ImageViewer from "../../components/imageViewer";
import {
  addPageShadow,
  enablePdfTextSelection,
  getIframeDoc,
} from "../../utils/reader/docUtil";
import {
  capturePageAreaSnapshot,
  dissolvePageAreaSnapshot,
  releasePageAreaSnapshot,
  takePageAreaSnapshot,
} from "../../utils/reader/pageSnapshot";
import PopupBox from "../../components/popups/popupBox";
import {
  clearQuoteMark,
  requestQuoteRelocate,
  restoreQuoteMark,
} from "../../utils/reader/quoteMark";
import Note from "../../models/Note";
import { isNightReaderBg } from "../../constants/themeList";
import PageWidget from "../pageWidget";
import {
  BRUSH_COLORS,
  BRUSH_WIDTHS,
  ERASER_WIDTH_DEFAULT,
  HIGHLIGHTER_COLORS,
  HIGHLIGHTER_WIDTHS,
  SHAPE_TYPES,
  TEXT_COLORS,
  clearComicTemp,
  getDefaultOcrEngine,
  getDefaultOcrLang,
  getOcrCache,
  getPageWidth,
  getParserRegex,
  getPdfPassword,
  getServerRegion,
  getTarBuffer,
  getTarEntries,
  getZipBuffer,
  getZipEntries,
  isFixedLayoutComic,
  isPaginatedBook,
  isReadingAidMode,
  isReadingRawPDF,
  saveOcrCache,
  throttle,
  getRightPanelInset,
  isPaperLayout,
} from "../../utils/common";
import _ from "underscore";
import {
  ConfigService,
  CollectionUtil,
} from "../../assets/lib/kookit-extra-browser.min";
import * as Kookit from "../../assets/lib/kookit.min";
import PopupRefer from "../../components/popups/popupRefer";
import DatabaseService from "../../utils/storage/databaseService";
import { BookHelper } from "../../assets/lib/kookit.min";
import { parseWithSystemOCR } from "../../utils/request/common";
import { isElectron } from "react-device-detect";
import axios from "axios";
import { getBuiltinOcr } from "../../utils/plugins/rendererRegistry";
import { getBuiltinEngineOcrWorker } from "../../utils/reader/builtinOcrUtil";
import { resolveStoredPlugin } from "../../utils/plugins/records";
import type { PluginConfig } from "../../utils/plugins/types";
import { useAppStore } from "../../store/useAppStore";

import BookModel from "../../models/Book";

export interface ViewerProps {
  book: BookModel;
  rendition: any;

  isShow: boolean;

  handleLeaveReader: (position: string) => void;
  handleEnterReader: (position: string) => void;
}

export interface ViewerState {
  isDisablePopup: boolean;
  chapter: string;
  pageOffset: string;
  pageWidth: string;
  chapterDocIndex: number;

  rect: any;
  rendition: any;
}

const collectionUtil = new CollectionUtil(ConfigService);
declare var window: any;
let lock = false; //prevent from clicking too fasts
// 章节渲染复用同一 iframe document，"rendered" 每触发一次都会走到这里，
// 用 WeakSet 保证同一 doc 的 click/pointerup/contextmenu 只绑定一次
const gestureBoundDocs = new WeakSet<Document>();

// 纸张栏在正文左右各留出的内边距，与单页背景框（±50px）保持一致
const PAPER_PADDING = 50;

const Viewer = (props: ViewerProps) => {
  const currentBook = useAppStore((s) => s.book.currentBook);
  const htmlBook = useAppStore((s) => s.reader.htmlBook);
  const isNavLocked = useAppStore((s) => s.reader.isNavLocked);
  const isSettingLocked = useAppStore((s) => s.reader.isSettingLocked);
  const isDockedRight = useAppStore((s) => s.reader.isDockedRight);
  const isOpenMenu = useAppStore((s) => s.viewArea.isOpenMenu);
  const readerMode = useAppStore((s) => s.reader.readerMode);
  const menuMode = useAppStore((s) => s.viewArea.menuMode);
  const scale = useAppStore((s) => s.reader.scale);
  const isFitPage = useAppStore((s) => s.reader.isFitPage);
  const margin = useAppStore((s) => s.reader.margin);
  const isParagraphMode = useAppStore((s) => s.reader.isParagraphMode);
  const isReadingRuler = useAppStore((s) => s.reader.isReadingRuler);
  const isSpeedReading = useAppStore((s) => s.reader.isSpeedReading);
  const backgroundColor = useAppStore((s) => s.reader.backgroundColor);
  const textOrientation = useAppStore((s) => s.reader.textOrientation);
  const renderBookFunc = useAppStore((s) => s.book.renderBookFunc);
  const handleReadingState = useAppStore((s) => s.handleReadingState);
  const handleHtmlBook = useAppStore((s) => s.handleHtmlBook);
  const handleRenderBookFunc = useAppStore((s) => s.handleRenderBookFunc);
  const handleFetchBooks = useAppStore((s) => s.handleFetchBooks);
  const handleOpenMenu = useAppStore((s) => s.handleOpenMenu);
  const handleCurrentChapter = useAppStore((s) => s.handleCurrentChapter);
  const handleNoteKey = useAppStore((s) => s.handleNoteKey);
  const handleCurrentChapterIndex = useAppStore(
    (s) => s.handleCurrentChapterIndex
  );
  const handleFetchNotes = useAppStore((s) => s.handleFetchNotes);
  const handleFetchBookmarks = useAppStore((s) => s.handleFetchBookmarks);
  const handleMenuMode = useAppStore((s) => s.handleMenuMode);
  const handleFetchPlugins = useAppStore((s) => s.handleFetchPlugins);
  const handleScale = useAppStore((s) => s.handleScale);
  const handleBackgroundColor = useAppStore((s) => s.handleBackgroundColor);

  const connected = {
    currentBook,
    htmlBook,
    isNavLocked,
    isSettingLocked,
    isDockedRight,
    isOpenMenu,
    readerMode,
    menuMode,
    scale,
    isFitPage,
    margin,
    isParagraphMode,
    isReadingRuler,
    isSpeedReading,
    textOrientation,
    renderBookFunc,
    handleReadingState,
    handleHtmlBook,
    handleRenderBookFunc,
    handleFetchBooks,
    handleOpenMenu,
    handleCurrentChapter,
    handleNoteKey,
    handleCurrentChapterIndex,
    handleFetchNotes,
    handleFetchBookmarks,
    handleMenuMode,
    handleFetchPlugins,
    handleScale,
    handleBackgroundColor,
    handleLeaveReader: props.handleLeaveReader,
  };
  const propsRef = useLatest(connected);
  const [state, setState] = useState<ViewerState>({
    rect: null,
    isDisablePopup: ConfigService.getReaderConfig("isDisablePopup") === "yes",
    chapterDocIndex: parseInt(
      ConfigService.getObjectConfig(currentBook.key, "recordLocation", {})
        .chapterDocIndex || 0
    ),
    pageOffset: "",
    pageWidth: "",
    chapter: "",
    rendition: null,
  });
  const stateRef = useLatest(state);
  const updateState = (patch: Partial<ViewerState>) =>
    setState((prev) => ({ ...prev, ...patch }));
  const resizeHandlerRef = useRef<(() => void) | null>(null);
  const pendingRerenderRef = useRef(false);
  // AI 问书侧边栏停靠/取消停靠后正文会按新宽度重排，重排完成时做一次淡入，
  // 过渡掉新旧排版的直接切换。只做淡入、不预先隐藏正文，任何情况下都不会白屏
  const pageAreaRef = useRef<HTMLDivElement>(null);
  const relayoutFadeRef = useRef(false);
  // 重排前留存旧页面的静态快照，等新排版绘制完成再淡出，消除中间的空窗
  const pageSnapshotRef = useRef<HTMLElement | null>(null);
  const snapshotTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const settlePageSnapshot = () => {
    if (snapshotTimerRef.current) {
      clearTimeout(snapshotTimerRef.current);
      snapshotTimerRef.current = null;
    }
    const overlay = pageSnapshotRef.current;
    pageSnapshotRef.current = null;
    if (!overlay) return;
    // 固定版式不做任何缩放/位移，也不与新版交叉淡出：新旧排版宽高不同，
    // 旧页文字一挪动就会被看成残影。只等两帧让新页 canvas 真正上屏后整块撤掉
    const isCapture = overlay.dataset.kind === "capture";
    requestAnimationFrame(() =>
      requestAnimationFrame(() =>
        isCapture
          ? dissolvePageAreaSnapshot(overlay, pageAreaRef.current)
          : releasePageAreaSnapshot(overlay, false)
      )
    );
  };
  /**
   * 可重排书籍的快照要等正文彻底定型再撤：renderTo 之后还有 handleRest 里的
   * 默认 CSS / 阅读字体 / 跳回阅读位置，以及 rendered 回调里的样式与高亮，
   * 字体文件加载完还会再排一次。这里等字体就绪，再等正文 DOM 连续 150ms 无变化
   * （样式注入、高亮包裹、翻页滚动都会触发变化），最多等 1200ms
   */
  const waitReflowSettled = async () => {
    const docs = getIframeDoc(propsRef.current.currentBook).filter(
      (doc): doc is Document => !!doc
    );
    await Promise.race([
      Promise.all(docs.map((doc) => doc.fonts?.ready)),
      new Promise((resolve) => setTimeout(resolve, 600)),
    ]);
    await new Promise<void>((resolve) => {
      let quietTimer: ReturnType<typeof setTimeout>;
      const observers: MutationObserver[] = [];
      const finish = () => {
        clearTimeout(quietTimer);
        clearTimeout(maxTimer);
        observers.forEach((observer) => observer.disconnect());
        docs.forEach((doc) => doc.removeEventListener("scroll", bump, true));
        resolve();
      };
      const bump = () => {
        clearTimeout(quietTimer);
        quietTimer = setTimeout(finish, 150);
      };
      const maxTimer = setTimeout(finish, 1200);
      docs.forEach((doc) => {
        const observer = new MutationObserver(bump);
        observer.observe(doc.documentElement, {
          subtree: true,
          childList: true,
          attributes: true,
          characterData: true,
        });
        observers.push(observer);
        doc.addEventListener("scroll", bump, true);
      });
      bump();
    });
  };
  /**
   * 固定版式书籍在停靠变化的同一帧拍快照，原地盖住阅读区；
   * 真实重排在快照下面完成，新页绘制好后再整块替换（不做缩放滑动，避免旧页文字拖影）
   */
  const takeDockSnapshot = () => {
    const pageArea = pageAreaRef.current;
    if (!pageArea || !isPaginatedBook(propsRef.current.currentBook)) return;
    if (snapshotTimerRef.current) {
      clearTimeout(snapshotTimerRef.current);
      snapshotTimerRef.current = null;
    }
    releasePageAreaSnapshot(pageSnapshotRef.current, false);
    pageSnapshotRef.current = takePageAreaSnapshot();
    if (!pageSnapshotRef.current) return;
    // 兜底：若之后没有触发重排（如拖出侧边栏后迟迟不松手），到点收掉快照
    snapshotTimerRef.current = setTimeout(settlePageSnapshot, 3000);
  };
  const fadeInPageArea = () => {
    const el = pageAreaRef.current;
    if (!el || typeof el.animate !== "function") return;
    el.animate([{ opacity: 0 }, { opacity: 1 }], {
      duration: 280,
      easing: "ease-out",
    });
  };
  const prevWidthPropsRef = useRef({
    margin,
    scale,
    readerMode,
    isNavLocked,
    isSettingLocked,
    isFitPage,
    isDockedRight,
  });

  const handleHighlight = async (rendition: any) => {
    if (!rendition) return;
    let highlighters: any = await DatabaseService.getRecordsByBookKey(
      propsRef.current.currentBook.key,
      "notes"
    );
    if (!highlighters) return;
    let highlightersByChapter = highlighters.filter((item: Note) => {
      let cfi = JSON.parse(item.cfi);
      if (cfi.cfi) {
        // epub from 1.5.2 or older
        return (
          item.chapter ===
          rendition.getChapterDoc()[stateRef.current.chapterDocIndex].label
        );
      } else if (cfi.fingerprint) {
        // pdf from 1.7.4 or older
        return cfi.page - 1 === stateRef.current.chapterDocIndex;
      } else {
        return item.chapterIndex === stateRef.current.chapterDocIndex;
      }
    });
    if (propsRef.current.currentBook.format === "PDF") {
      highlightersByChapter = highlightersByChapter.map((item: Note) => {
        let cfi = JSON.parse(item.cfi);
        if (cfi.fingerprint) {
          item.chapterIndex = cfi.page - 1;
          cfi.chapterDocIndex = cfi.page - 1 + "";
          cfi.chapterHref = "title" + (cfi.page - 1);
          item.cfi = JSON.stringify(cfi);
        }

        return item;
      });
    }
    await rendition.renderHighlighters(highlightersByChapter, handleNoteClick);
    if (
      isReadingRawPDF(propsRef.current.currentBook) &&
      (propsRef.current.readerMode === "double" ||
        propsRef.current.readerMode === "scroll")
    ) {
      let highlightersByChapter = highlighters.filter((item: Note) => {
        let cfi = JSON.parse(item.cfi);
        if (cfi.fingerprint) {
          // pdf from 1.7.4 or older
          return cfi.page === stateRef.current.chapterDocIndex;
        } else {
          return item.chapterIndex === stateRef.current.chapterDocIndex + 1;
        }
      });
      if (propsRef.current.currentBook.format === "PDF") {
        highlightersByChapter = highlightersByChapter.map((item: Note) => {
          let cfi = JSON.parse(item.cfi);
          if (cfi.fingerprint) {
            item.chapterIndex = cfi.page - 1;
            cfi.chapterDocIndex = cfi.page - 1 + "";
            cfi.chapterHref = "title" + (cfi.page - 1);
            item.cfi = JSON.stringify(cfi);
          }

          return item;
        });
      }
      await rendition.renderHighlighters(
        highlightersByChapter,
        handleNoteClick
      );
    }
  };
  const handleNoteClick = (event: Event) => {
    propsRef.current.handleNoteKey((event.target as any).dataset.key);
    propsRef.current.handleMenuMode("note");
    propsRef.current.handleOpenMenu(true);
  };
  const startedBookRef = useRef("");
  const handleRenderBook = async () => {
    // 刚渲染完的 1 秒内处于锁定期，此时的重排请求（如 AI 侧边栏停靠 / 取消停靠）
    // 不能直接丢弃，否则 PDF 等固定版式不会按新的可用宽度重新排版；解锁后补一次
    if (lock) {
      pendingRerenderRef.current = true;
      return;
    }
    teardownOverlayTurn();
    let { key, path, format, name, md5, isbn } = propsRef.current.currentBook;
    if (ConfigService.getAllListConfig("seperateStyleBooks").includes(key)) {
      window.currentBookKey = key;
      propsRef.current.handleBackgroundColor(
        ConfigService.getReaderConfig("backgroundColor") || ""
      );
    } else {
      window.currentBookKey = "";
    }
    if (stateRef.current.rendition) {
      // 停止旧渲染实例的自动滚动定时器，避免重渲染后旧循环继续占用滚动容器
      stateRef.current.rendition.autoScroll?.(0, "no");
      stateRef.current.rendition.autoScrollPDF?.("no");
    }
    let result;
    let isCacheExsit = await BookUtil.isBookExist("cache-" + key, "zip", path);
    if (isFixedLayoutComic(propsRef.current.currentBook)) {
      isCacheExsit = false;
    }
    if (
      isElectron &&
      (propsRef.current.currentBook.format === "CBZ" ||
        propsRef.current.currentBook.format === "CBT")
    ) {
      result = new ArrayBuffer(0);
      clearComicTemp();
    } else {
      result = await BookUtil.fetchBook(
        isCacheExsit ? "cache-" + key : key,
        isCacheExsit ? "zip" : format.toLowerCase(),
        true,
        path
      );
    }

    const isScannedBook =
      propsRef.current.currentBook.description.indexOf("scanned") > -1;
    const rawOcrEngine = getDefaultOcrEngine(propsRef.current.currentBook);
    let ocrEngine = rawOcrEngine;
    // 缓存 key 需要区分不同 OCR 插件，而渲染引擎统一用 "plugin-ocr"，两者分开维护
    let ocrCacheEngine = rawOcrEngine;
    let ocrLang = getDefaultOcrLang(rawOcrEngine, propsRef.current.currentBook);
    const serverRegion = getServerRegion() === "china" ? "china" : "global";
    let externalWorker: {
      recognize: (input: string) => Promise<unknown>;
    } = {
      recognize:
        rawOcrEngine === "system-ocr"
          ? parseWithSystemOCR
          : rawOcrEngine === "tesseract" || rawOcrEngine === "paddle"
            ? getBuiltinEngineOcrWorker(
                rawOcrEngine,
                ocrLang,
                serverRegion,
                isElectron
              ).recognize
            : parseWithSystemOCR,
    };

    const builtinOcr = getBuiltinOcr(rawOcrEngine);
    if (builtinOcr) {
      const record = await DatabaseService.getRecord(rawOcrEngine, "plugins");
      const plugin = record ? await resolveStoredPlugin(record) : undefined;
      if (plugin) {
        const pluginConfig = {
          ...(plugin.config as PluginConfig),
        } as PluginConfig;
        if (ocrLang) {
          pluginConfig.language = ocrLang;
        }
        externalWorker = {
          recognize: (imageBase64: string) =>
            builtinOcr(imageBase64, axios, pluginConfig),
        };
        ocrEngine = "plugin-ocr";
      } else {
        ocrEngine = isScannedBook ? "paddle" : "system-ocr";
        ocrCacheEngine = ocrEngine;
        ocrLang = ocrEngine === "paddle" ? "standard_v5_mobile" : "auto";
        externalWorker = {
          recognize:
            ocrEngine === "system-ocr"
              ? parseWithSystemOCR
              : ocrEngine === "tesseract" || ocrEngine === "paddle"
                ? getBuiltinEngineOcrWorker(
                    ocrEngine,
                    ocrLang,
                    serverRegion,
                    isElectron
                  ).recognize
                : parseWithSystemOCR,
        };
      }
    }
    // kookit 侧在 OCR 缓存命中间跳时无法保证 externalWorker 串行调用，
    // 而引擎（onnx worker / tesseract worker / 系统进程）均非并发安全，
    // 统一在宿主侧排队，确保任意时刻只有一个识别任务在执行
    let ocrQueue: Promise<unknown> = Promise.resolve();
    const rawOcrRecognize = externalWorker.recognize;
    externalWorker.recognize = (imageBase64: string) => {
      const task = ocrQueue.then(() => rawOcrRecognize(imageBase64));
      ocrQueue = task.catch(() => undefined);
      return task;
    };
    let rendition = BookHelper.getRendition(
      result,
      {
        format: isCacheExsit ? "CACHE" : format,
        isFixedLayout: isFixedLayoutComic(propsRef.current.currentBook)
          ? "yes"
          : "no",
        readerMode: propsRef.current.readerMode,
        charset: propsRef.current.currentBook.charset,
        animation: ConfigService.getReaderConfig("animation") || "none",
        convertChinese: ConfigService.getReaderConfig("convertChinese"),
        bookLayout: ConfigService.getReaderConfig("bookLayout") || "",
        textRules: [],
        contentColor: {
          enabled: ConfigService.getReaderConfig("isTextColor") === "yes",
        },
        codeHighlight: ConfigService.getReaderConfig("codeHighlight") || "",
        revertDirection:
          ConfigService.getReaderConfig("revertDirection") || "no",
        parserRegex: getParserRegex(
          propsRef.current.currentBook.format,
          propsRef.current.currentBook.key
        ),
        // 全文翻译改由应用层按小段插入（utils/reader/fullTranslation.ts），引擎内置的整段翻译关闭
        fullTranslationMode: "no",
        textOrientation: ConfigService.getReaderConfig("textOrientation"),
        isDarkMode: isNightReaderBg(
          ConfigService.getReaderConfig("backgroundColor")
        )
          ? "yes"
          : "no",
        backgroundColor: ConfigService.getReaderConfig("backgroundColor"),
        isMobile: "no",
        isIndent: ConfigService.getReaderConfig("isIndent"),
        isHyphenation: ConfigService.getReaderConfig("isHyphenation"),
        isStartFromEven: ConfigService.getReaderConfig("isStartFromEven"),
        isShowTotalPage: ConfigService.getReaderConfig("isShowTotalPage"),
        isAllowScript: ConfigService.getReaderConfig("isAllowScript"),
        isBionic: ConfigService.getReaderConfig("isBionic"),
        isParagraphMode: ConfigService.getReaderConfig("isParagraphMode"),
        isReadingRuler: ConfigService.getReaderConfig("isReadingRuler"),
        isSpeedReading: ConfigService.getReaderConfig("isSpeedReading"),
        speedReadingSpeed: parseFloat(
          ConfigService.getReaderConfig("speedReadingSpeed") || "300"
        ),
        readingRulerLineHeight: parseFloat(
          ConfigService.getReaderConfig("readingRulerLineHeight") || "3"
        ),
        readingRulerBackgroundOpacity: parseFloat(
          ConfigService.getReaderConfig("readingRulerBackgroundOpacity") ||
            "0.6"
        ),
        pageGap: ConfigService.getReaderConfig("pageGap"),
        password: getPdfPassword(propsRef.current.currentBook),
        scale: parseFloat(propsRef.current.scale),
        ocrLang,
        externalWorker,
        ocrEngine,
        serverRegion,
        paraSpacingValue:
          ConfigService.getReaderConfig("paraSpacingValue") || "1.5",
        titleSizeValue:
          ConfigService.getReaderConfig("titleSizeValue") || "1.2",
        isScannedPDF:
          propsRef.current.currentBook.description.indexOf("scanned") > -1
            ? "yes"
            : "no",
        brushColor:
          ConfigService.getReaderConfig("annotationBrushColor") ||
          BRUSH_COLORS[0],
        brushWidth: parseFloat(
          ConfigService.getReaderConfig("annotationBrushWidth") ||
            BRUSH_WIDTHS[1] + ""
        ),
        annotationStyle:
          ConfigService.getReaderConfig("annotationStyle") || "brush",
        highlighterColor:
          ConfigService.getReaderConfig("annotationHighlighterColor") ||
          HIGHLIGHTER_COLORS[0],
        highlighterWidth: parseFloat(
          ConfigService.getReaderConfig("annotationHighlighterWidth") ||
            HIGHLIGHTER_WIDTHS[1] + ""
        ),
        highlighterOpacity: parseFloat(
          ConfigService.getReaderConfig("annotationHighlighterOpacity") || "0.4"
        ),
        shapeType:
          ConfigService.getReaderConfig("annotationShapeType") ||
          SHAPE_TYPES[0],
        shapeColor:
          ConfigService.getReaderConfig("annotationShapeColor") ||
          BRUSH_COLORS[0],
        shapeWidth: parseFloat(
          ConfigService.getReaderConfig("annotationShapeWidth") ||
            BRUSH_WIDTHS[1] + ""
        ),
        lineStyle:
          ConfigService.getReaderConfig("annotationLineStyle") || "solid",
        eraserWidth: parseFloat(
          ConfigService.getReaderConfig("annotationEraserWidth") ||
            ERASER_WIDTH_DEFAULT + ""
        ),
        quickErase:
          ConfigService.getReaderConfig("annotationQuickErase") || "no",
        textSize: parseFloat(
          ConfigService.getReaderConfig("annotationTextSize") || "24"
        ),
        textFont:
          ConfigService.getReaderConfig("annotationTextFont") || "sans-serif",
        textColor:
          ConfigService.getReaderConfig("annotationTextColor") ||
          TEXT_COLORS[0],
        isKeepPDFBackground: ConfigService.getReaderConfig(
          "isKeepPDFBackground"
        ),
        getTarBuffer: getTarBuffer,
        getZipBuffer: getZipBuffer,
        getTarEntries: getTarEntries,
        getZipEntries: getZipEntries,
        filePath: BookUtil.getBookPath(propsRef.current.currentBook),
        bookKey: propsRef.current.currentBook.key,
        getOcrCache: (bookKey: string, chapterDocIndex: string) =>
          getOcrCache(bookKey, chapterDocIndex, {
            ocrEngine: ocrCacheEngine,
            ocrLang,
          }),
        saveOcrCache: (
          bookKey: string,
          chapterDocIndex: string,
          cache: { src?: string; text?: string }
        ) =>
          saveOcrCache(bookKey, chapterDocIndex, cache, {
            ocrEngine: ocrCacheEngine,
            ocrLang,
          }),
      },
      Kookit
    );
    // 停靠变化引起的重排：先按旧尺寸拍一张快照盖在阅读区上，新排版绘制完成后再淡出。
    // 必须在页宽变化和内容清除之前拍，否则拿到的是被挤压/已清空的画面
    if (
      relayoutFadeRef.current &&
      isPaginatedBook(propsRef.current.currentBook)
    ) {
      // 仅固定版式（正文是 canvas/img）适合快照；可重排书籍拍下来只有零散图片，反而更怪。
      // 停靠那一刻已拍好并正在随侧边栏滑动的快照直接沿用，不要重拍
      if (snapshotTimerRef.current) {
        clearTimeout(snapshotTimerRef.current);
        snapshotTimerRef.current = null;
      }
      if (!pageSnapshotRef.current) {
        pageSnapshotRef.current = takePageAreaSnapshot();
      }
    } else if (relayoutFadeRef.current && !pageSnapshotRef.current) {
      // EPUB / TXT 等可重排书籍：正文是 DOM 文字，借主进程截图拿到旧画面盖住阅读区，
      // 避免「旧正文被挤进新宽度 → 清空 → 新排版」这几帧的闪烁
      const overlay = await capturePageAreaSnapshot();
      if (overlay) {
        // 截图只保留新版心可见范围内的部分，不能盖住正在滑入的侧边栏 / 目录面板
        const props = propsRef.current;
        const leftInset = props.isNavLocked ? 300 : 0;
        const rightInset = getRightPanelInset(
          props.isSettingLocked,
          props.isDockedRight
        );
        const left = parseFloat(overlay.style.left);
        const right = left + parseFloat(overlay.style.width);
        const clipLeft = Math.max(left, leftInset);
        const clipRight = Math.min(right, window.innerWidth - rightInset);
        if (clipRight - clipLeft > 4) {
          const content = overlay.firstElementChild as HTMLElement | null;
          if (content) content.style.left = `${left - clipLeft}px`;
          overlay.style.left = `${clipLeft}px`;
          overlay.style.width = `${clipRight - clipLeft}px`;
          pageSnapshotRef.current = overlay;
        } else {
          overlay.remove();
        }
      }
    }
    // 页宽（受 AI 侧边栏 / 设置面板停靠影响）在这里才落地，且必须早于 renderTo，
    // 引擎按 #page-area 的当前宽度排版；旧内容在下一行才清除，尽量缩短空白时间
    flushSync(() => {
      updateState(
        getPageWidth(
          propsRef.current.readerMode,
          propsRef.current.scale,
          parseInt(propsRef.current.margin),
          propsRef.current.isNavLocked,
          getRightPanelInset(
            propsRef.current.isSettingLocked,
            propsRef.current.isDockedRight
          ),
          propsRef.current.isFitPage
        )
      );
    });
    propsRef.current.handleHtmlBook(null);
    stateRef.current.rendition?.removeContent();
    if (propsRef.current.currentBook.format === "TXT") {
      let bookLocation = ConfigService.getObjectConfig(
        propsRef.current.currentBook.key,
        "recordLocation",
        {}
      );
      await rendition.renderTo(
        document.getElementById("page-area"),
        bookLocation
      );
    } else {
      await rendition.renderTo(document.getElementById("page-area"));
    }

    if (pageSnapshotRef.current && !snapshotTimerRef.current) {
      // 兜底：某些固定版式绘完不一定触发 rendered，到点也把快照收掉
      snapshotTimerRef.current = setTimeout(settlePageSnapshot, 3000);
    }
    await handleRest(rendition);
    // 问书引用的文字在重排后可能被挤到别的页：重新标记，不在可视区就跳过去
    await restoreQuoteMark(propsRef.current.currentBook, rendition);
    const reflowSnapshot = pageSnapshotRef.current;
    if (
      reflowSnapshot &&
      reflowSnapshot.dataset.kind === "capture" &&
      !isPaginatedBook(propsRef.current.currentBook)
    ) {
      waitReflowSettled().then(() => {
        // 期间又触发了新一轮重排（快照已被替换）就交给新一轮处理
        if (pageSnapshotRef.current === reflowSnapshot) settlePageSnapshot();
      });
    }
    if (
      ConfigService.getReaderConfig("isAutoReading") === "yes" &&
      propsRef.current.readerMode === "scroll"
    ) {
      // 自动阅读开启：每次重渲染后以保存的速率重新启动自动滚动
      const rate = parseFloat(
        ConfigService.getReaderConfig("autoScrollRate") || "0.5"
      );
      rendition.autoScroll?.(rate, "yes");
      rendition.autoScrollPDF?.("yes");
    }
    propsRef.current.handleReadingState(true);
    if (
      propsRef.current.currentBook.key === key &&
      startedBookRef.current !== key
    ) {
      startedBookRef.current = key;
      useAppStore.getState().handleStartedWantedBook(md5, isbn);
    }

    ConfigService.setListConfig(
      collectionUtil.getRecentBookKey(propsRef.current.currentBook.key),
      "recentBooks"
    );
    document.title = name + " - Mentor";
  };

  const handleRest = async (rendition: any) => {
    htmlMouseEvent(
      rendition,
      propsRef.current.currentBook,
      propsRef.current.readerMode,
      (scale: string) => {
        flushSync(() => {
          propsRef.current.handleScale(scale);
        });
      },
      propsRef.current.renderBookFunc
    );
    let chapters = rendition.getChapter();
    let chapterDocs = rendition.getChapterDoc();
    let flattenChapters = rendition.flatChapter(chapters);
    propsRef.current.handleHtmlBook({
      key: propsRef.current.currentBook.key,
      chapters,
      flattenChapters,
      rendition: rendition,
    });
    updateState({ rendition });
    if (isPaginatedBook(propsRef.current.currentBook)) addPageShadow();
    setupOverlayTurn(
      rendition,
      propsRef.current.currentBook,
      propsRef.current.readerMode
    );
    if (isReadingRawPDF(propsRef.current.currentBook)) {
      //ignore
    } else {
      StyleUtil.addDefaultCss(propsRef.current.currentBook.key);
      await StyleUtil.applyReaderFonts(rendition);
    }

    let bookLocation: {
      text: string;
      count: string;
      chapterTitle: string;
      chapterDocIndex: string;
      chapterHref: string;
      percentage: string;
      cfi: string;
      page: string;
      xpath: string;
    } = ConfigService.getObjectConfig(
      propsRef.current.currentBook.key,
      "recordLocation",
      {}
    );
    if (chapterDocs.length > 0) {
      await rendition.goToPosition(
        JSON.stringify({
          text: bookLocation.text || "",
          chapterTitle: bookLocation.chapterTitle || "",
          page: bookLocation.page || "",
          chapterDocIndex: bookLocation.chapterDocIndex || 0,
          chapterHref: bookLocation.chapterHref || "",
          count: bookLocation.hasOwnProperty("cfi")
            ? "ignore"
            : bookLocation.count || 0,
          percentage: bookLocation.percentage,
          cfi: bookLocation.cfi,
          isFirst: true,
        })
      );
    }
    rendition.on("rendered", async () => {
      if (relayoutFadeRef.current) {
        relayoutFadeRef.current = false;
        // 有旧页快照时由快照完成过渡，正文本身不再做淡入，避免两段淡变叠加。
        // 可重排书籍的快照在 handleRenderBook 末尾等正文定型后再撤
        if (!pageSnapshotRef.current) fadeInPageArea();
        else if (isPaginatedBook(propsRef.current.currentBook))
          settlePageSnapshot();
      }
      handleLocation();
      let bookLocation: {
        text: string;
        count: string;
        chapterTitle: string;
        chapterDocIndex: string;
        chapterHref: string;
      } = ConfigService.getObjectConfig(
        propsRef.current.currentBook.key,
        "recordLocation",
        {}
      );

      let chapter =
        bookLocation.chapterTitle ||
        (propsRef.current.htmlBook &&
        propsRef.current.htmlBook.flattenChapters[0]
          ? ""
          : "Unknown chapter");
      let chapterDocIndex = 0;
      if (bookLocation.chapterDocIndex) {
        chapterDocIndex = parseInt(bookLocation.chapterDocIndex);
      } else {
        chapterDocIndex =
          bookLocation.chapterTitle && propsRef.current.htmlBook
            ? _.findLastIndex(
                propsRef.current.htmlBook.flattenChapters.map((item) => {
                  item.label = item.label.trim();
                  return item;
                }),
                {
                  label: bookLocation.chapterTitle.trim(),
                }
              )
            : 0;
      }
      propsRef.current.handleCurrentChapter(chapter);
      propsRef.current.handleCurrentChapterIndex(chapterDocIndex);

      updateState({
        chapter,
        chapterDocIndex,
      });
      if (isReadingRawPDF(propsRef.current.currentBook)) {
        //ignore
      } else {
        StyleUtil.addDefaultCss(propsRef.current.currentBook.key);
        await StyleUtil.applyReaderFonts(rendition);
      }
      // rendition.tranformText();
      handleBindGesture();
      await handleHighlight(rendition);
      // 翻页 / 换章后新文档里补上问书引用的标记（定位只在重排结束时做）
      restoreQuoteMark(propsRef.current.currentBook, null);
      lock = true;
      setTimeout(() => {
        lock = false;
        if (pendingRerenderRef.current) {
          pendingRerenderRef.current = false;
          handleRenderBook();
        }
      }, 1000);
      return false;
    });
    if (
      propsRef.current.currentBook.format === "TXT" &&
      rendition.format !== "CACHE"
    ) {
      if (
        flattenChapters.length > 0 &&
        flattenChapters[0].label === "Chapter 0"
      ) {
        return;
      }
      setTimeout(async () => {
        await rendition.refreshContent();
        let chapters = rendition.getChapter();
        let flattenChapters = rendition.flatChapter(chapters);
        propsRef.current.handleHtmlBook({
          key: propsRef.current.currentBook.key,
          chapters,
          flattenChapters,
          rendition: rendition,
        });
      }, 1000);
    }
  };

  const handleLocation = () => {
    if (!propsRef.current.htmlBook) {
      return;
    }
    let position = propsRef.current.htmlBook.rendition.getPosition();
    ConfigService.setObjectConfig(
      propsRef.current.currentBook.key,
      position,
      "recordLocation"
    );
  };
  const handleBindGesture = () => {
    let docs = getIframeDoc(propsRef.current.currentBook);
    for (let i = 0; i < docs.length; i++) {
      let doc = docs[i];
      if (!doc || gestureBoundDocs.has(doc)) continue;
      gestureBoundDocs.add(doc);
      if (isPaginatedBook(propsRef.current.currentBook)) {
        enablePdfTextSelection(doc);
      }
      doc.addEventListener("click", () => {
        propsRef.current.handleLeaveReader("left");
        propsRef.current.handleLeaveReader("right");
        propsRef.current.handleLeaveReader("top");
        propsRef.current.handleLeaveReader("bottom");
      });
      doc.addEventListener("pointerup", (event) => {
        if (isPaginatedBook(propsRef.current.currentBook)) {
          let ownerDoc = (event.target as HTMLElement).ownerDocument;
          let targetIframe = ownerDoc?.defaultView?.frameElement;
          let id = targetIframe?.getAttribute("id") || "";
          let chapterDocIndex = id ? parseInt(id.split("-").reverse()[0]) : 0;
          updateState({ chapterDocIndex });
        }

        if (stateRef.current.isDisablePopup) {
          if (doc!.getSelection()!.toString().trim().length === 0) {
            let rect = doc!
              .getSelection()!
              .getRangeAt(0)
              .getBoundingClientRect();
            updateState({ rect });
          }
        }
        if (stateRef.current.isDisablePopup) return;
        let selection = doc!.getSelection();
        if (!selection || selection.rangeCount === 0) return;

        var rect = selection.getRangeAt(0).getBoundingClientRect();
        updateState({ rect });
      });
      doc.addEventListener("contextmenu", (event) => {
        if (isPaginatedBook(propsRef.current.currentBook)) {
          let ownerDoc = (event.target as HTMLElement).ownerDocument;
          let targetIframe = ownerDoc?.defaultView?.frameElement;
          let id = targetIframe?.getAttribute("id") || "";
          let chapterDocIndex = id ? parseInt(id.split("-").reverse()[0]) : 0;
          updateState({ chapterDocIndex });
        }
        if (
          document.location.href.indexOf("localhost") === -1 &&
          document.location.href.indexOf("file://") === -1 &&
          document.location.href.indexOf("127.0.0.1") === -1
        ) {
          event.preventDefault();
        }

        if (!stateRef.current.isDisablePopup) return;

        if (
          !doc!.getSelection() ||
          doc!.getSelection()!.toString().trim().length === 0
        ) {
          return;
        }
        let selection = doc!.getSelection();

        if (!selection || selection.rangeCount === 0) return;
        var rect = selection.getRangeAt(0).getBoundingClientRect();
        updateState({ rect });
      });
    }
  };

  useEffect(() => {
    propsRef.current.handleFetchBookmarks();
    propsRef.current.handleFetchNotes();
    propsRef.current.handleFetchBooks();
    propsRef.current.handleFetchPlugins();

    handleRenderBook();
    //make sure page width is always 12 times, section = Math.floor(element.clientWidth / 12), or text will be blocked
    updateState(
      getPageWidth(
        propsRef.current.readerMode,
        propsRef.current.scale,
        parseInt(propsRef.current.margin),
        propsRef.current.isNavLocked,
        getRightPanelInset(
          propsRef.current.isSettingLocked,
          propsRef.current.isDockedRight
        ),
        propsRef.current.isFitPage
      )
    );
    // 刷新页面后，若 popupBox 处于固定右侧状态，自动恢复显示 popupAssist
    if (propsRef.current.isDockedRight) {
      propsRef.current.handleMenuMode("assistant");
      propsRef.current.handleOpenMenu(true);
    }
    propsRef.current.handleRenderBookFunc(handleRenderBook);
    const resizeHandler = throttle(() => {
      flushSync(() => {
        updateState(
          getPageWidth(
            propsRef.current.readerMode,
            propsRef.current.scale,
            parseInt(propsRef.current.margin),
            propsRef.current.isNavLocked,
            getRightPanelInset(
              propsRef.current.isSettingLocked,
              propsRef.current.isDockedRight
            ),
            propsRef.current.isFitPage
          )
        );
      });
      if (lock) {
        pendingRerenderRef.current = true;
      } else {
        handleRenderBook();
      }
    });
    resizeHandlerRef.current = resizeHandler;
    window.addEventListener("resize", resizeHandler);
    // 窗口在不同 DPI 的显示器间拖动时 devicePixelRatio 会变，但不会触发 resize。
    // PDF 等固定版式书籍的 canvas 按渲染时的 DPR 绘制，不重绘就会在高分屏上发虚
    let dprQuery: MediaQueryList | null = null;
    const watchDpr = () => {
      dprQuery?.removeEventListener("change", onDprChange);
      const query = window.matchMedia(
        `(resolution: ${window.devicePixelRatio}dppx)`
      );
      query.addEventListener("change", onDprChange);
      dprQuery = query;
    };
    function onDprChange() {
      watchDpr();
      if (isPaginatedBook(propsRef.current.currentBook)) {
        resizeHandler();
      }
    }
    watchDpr();
    return () => {
      if (snapshotTimerRef.current) clearTimeout(snapshotTimerRef.current);
      releasePageAreaSnapshot(pageSnapshotRef.current, false);
      pageSnapshotRef.current = null;
      dprQuery?.removeEventListener("change", onDprChange);
      teardownOverlayTurn();
      if (resizeHandlerRef.current) {
        window.removeEventListener("resize", resizeHandlerRef.current);
        resizeHandlerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // 关闭问书 / 切到其他弹窗后撤掉引用标记
    if (menuMode !== "assistant") clearQuoteMark();
  }, [menuMode]);
  useEffect(() => {
    const nextProps = {
      margin,
      scale,
      readerMode,
      isNavLocked,
      isSettingLocked,
      isFitPage,
      isDockedRight,
    };
    const prevProps = prevWidthPropsRef.current;
    prevWidthPropsRef.current = nextProps;
    const isDockedChange = nextProps.isDockedRight !== prevProps.isDockedRight;
    const isPanelChange =
      isDockedChange ||
      nextProps.isNavLocked !== prevProps.isNavLocked ||
      nextProps.isSettingLocked !== prevProps.isSettingLocked;
    const isOnlyPanelChange =
      isPanelChange &&
      nextProps.margin === prevProps.margin &&
      nextProps.scale === prevProps.scale &&
      nextProps.readerMode === prevProps.readerMode &&
      nextProps.isFitPage === prevProps.isFitPage;
    if (isPanelChange) requestQuoteRelocate();
    if (isOnlyPanelChange) {
      // AI 侧边栏停靠/取消停靠、目录 / 设置面板固定：页宽等重排真正开始时再改（见 handleRenderBook），
      // 否则旧正文会先被挤进新宽度、再被新排版替换，看起来就是闪一下
      relayoutFadeRef.current = true;
      takeDockSnapshot();
      // 不再等侧边栏动画结束才重排：快照盖着阅读区，重排与滑动动画并行，
      // 新页通常在动画结束前后就已画好
      handleRenderBook();
      return;
    }
    if (
      nextProps.margin !== prevProps.margin ||
      nextProps.scale !== prevProps.scale ||
      nextProps.readerMode !== prevProps.readerMode ||
      nextProps.isNavLocked !== prevProps.isNavLocked ||
      nextProps.isSettingLocked !== prevProps.isSettingLocked ||
      nextProps.isFitPage !== prevProps.isFitPage ||
      isDockedChange
    ) {
      if (isDockedChange) {
        relayoutFadeRef.current = true;
        // 停靠变化的重排统一由这里触发（popupBox 不再延时调用 renderBookFunc）
        setTimeout(() => handleRenderBook(), 0);
      }
      updateState(
        getPageWidth(
          nextProps.readerMode,
          nextProps.scale,
          parseInt(nextProps.margin),
          nextProps.isNavLocked,
          getRightPanelInset(
            nextProps.isSettingLocked,
            nextProps.isDockedRight
          ),
          nextProps.isFitPage
        )
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  });

  let isReadingAid =
    !isReadingRawPDF(currentBook) && (isParagraphMode || isSpeedReading);
  return (
    <>
      {htmlBook && !isReadingAid ? (
        <PopupMenu
          {...({
            rendition: htmlBook.rendition,
            rect: state.rect,
            chapterDocIndex: state.chapterDocIndex,
            chapter: state.chapter,
          } as any)}
        />
      ) : null}
      {htmlBook ? (
        <PopupRefer
          {...({
            rendition: htmlBook.rendition,
            chapterDocIndex: state.chapterDocIndex,
          } as any)}
        />
      ) : null}
      {(htmlBook ||
        (menuMode === "assistant" && (isDockedRight || isOpenMenu))) &&
      (isDockedRight ||
        (isOpenMenu &&
          (menuMode === "dict" ||
            menuMode === "trans" ||
            menuMode === "assistant" ||
            menuMode === "note"))) ? (
        <PopupBox
          {...({
            rendition: htmlBook?.rendition,
            rect: state.rect,
            chapterDocIndex: state.chapterDocIndex,
            chapter: state.chapter,
          } as any)}
        />
      ) : null}
      {htmlBook && currentBook.format !== "PDF" && (
        <ImageViewer
          {...({
            isShow: props.isShow,
            rendition: htmlBook.rendition,
            handleEnterReader: props.handleEnterReader,
            handleLeaveReader: props.handleLeaveReader,
          } as any)}
        />
      )}
      <div
        className={
          readerMode === "scroll" &&
          !isReadingAidMode(currentBook.format, currentBook.key)
            ? "html-viewer-page scrolling-html-viewer-page"
            : "html-viewer-page"
        }
        id="page-area"
        ref={pageAreaRef}
        style={
          readerMode === "scroll" && document.body.clientWidth >= 570
            ? {
                // marginLeft: this.state.pageOffset,
                // marginRight: this.state.pageOffset,
                paddingLeft: "0px",
                paddingRight: "0px",
                left: state.pageOffset,
                width: state.pageWidth,
              }
            : {
                left: state.pageOffset,
                width: state.pageWidth,
              }
        }
      ></div>
      {isPaperLayout(readerMode, currentBook, isFitPage) && state.pageWidth && (
        <>
          <div
            className="reader-desk"
            style={{
              left: isNavLocked ? 300 : 0,
              right: getRightPanelInset(isSettingLocked, isDockedRight),
              // 微信读书：日间为浅灰桌面衬白纸，夜间桌面比纸张更深
              backgroundColor: isNightReaderBg(backgroundColor)
                ? `color-mix(in srgb, ${backgroundColor} 55%, #000)`
                : `color-mix(in srgb, ${backgroundColor} 90%, #000)`,
            }}
          ></div>
          <div
            className="reader-paper"
            style={{
              left: `calc(${state.pageOffset} - ${PAPER_PADDING}px)`,
              width: `calc(${state.pageWidth} + ${PAPER_PADDING * 2}px)`,
              backgroundColor,
              filter: `brightness(${
                ConfigService.getReaderConfig("brightness") || 1
              }) invert(${
                ConfigService.getReaderConfig("isInvert") === "yes" ? 1 : 0
              })`,
            }}
          ></div>
        </>
      )}
      <PageWidget />
    </>
  );
};
export default Viewer;
