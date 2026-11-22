import { ConfigService } from "../../assets/lib/kookit-extra-browser.min";
import { isElectron } from "react-device-detect";
import Book from "../../models/Book";
import { getIframeDoc, getIframeWin } from "./docUtil";
import {
  handleExitFullScreen,
  handleFullScreen,
  isReadingAidMode,
  isUndockedPopupBoxOpen,
  sleep,
} from "../common";
import { useAppStore } from "../../store/useAppStore";
import TTSUtil from "./ttsUtil";
import {
  getShortcutConfig,
  isNextPageKey,
  isPrevPageKey,
  matchShortcut,
  ShortcutAction,
} from "./shortcutUtil";
import { OVERLAY_TURN_DURATION } from "./overlayTurn";
declare var window: any;

// 翻页滑动动画固定时长（毫秒），需与 kookit 的 PAGE_TURN_DURATION 保持一致
const PAGE_TURN_DURATION = 200;

// 每次翻页时实时读取，避免修改动画设置后锁延迟不生效
const getThrottleTime = () => {
  const animation = ConfigService.getReaderConfig("animation") || "none";
  if (animation === "none") return 100;
  // 覆盖动画由应用层单独驱动，锁需覆盖整段动画，多留 60ms 保证 busy 先释放
  if (animation === "overlay") return OVERLAY_TURN_DURATION + 60;
  return PAGE_TURN_DURATION;
};

export const getSelection = (book: Book) => {
  let docs = getIframeDoc(book);
  let text = "";
  for (let i = 0; i < docs.length; i++) {
    let doc = docs[i];
    if (!doc) continue;
    let sel = doc.getSelection();
    if (!sel || sel.rangeCount === 0) continue;
    // In Electron/Chromium, Selection.toString() includes text inside
    // user-select:none elements (e.g. <rt>/<rp> ruby annotations), even though
    // they are not visually highlighted. Clone the selected ranges into a
    // fragment, strip the ruby annotations, and read back the text so it
    // matches the visual selection (consistent with the CSS rule on <rt>).
    let fragment = doc.createDocumentFragment();
    for (let r = 0; r < sel.rangeCount; r++) {
      fragment.appendChild(sel.getRangeAt(r).cloneContents());
    }
    fragment.querySelectorAll("rt, rp").forEach((el) => el.remove());
    text = (fragment.textContent || "").trim();
    if (text) {
      break;
    }
  }

  return text;
};

export const getSelectionSentence = (book: Book): string => {
  let docs = getIframeDoc(book);
  for (let i = 0; i < docs.length; i++) {
    let doc = docs[i];
    if (!doc) continue;
    let sel = doc.getSelection();
    if (!sel || !sel.toString().trim()) continue;
    try {
      let range = sel.getRangeAt(0);
      let container = range.commonAncestorContainer;
      // Walk up to a text-containing element
      let el: Node | null =
        container.nodeType === Node.TEXT_NODE
          ? container.parentElement
          : container;
      let fullText = (el as Element)?.textContent || "";
      let selectedText = sel.toString().trim();
      // Split on sentence-ending punctuation to find the sentence
      // Avoid lookbehind (?<=) which is unsupported on low-version iOS Safari
      const rawParts = fullText.split(/([.!?。！？])\s*/);
      const sentences: string[] = [];
      for (let i = 0; i < rawParts.length; i += 2) {
        sentences.push(rawParts[i] + (rawParts[i + 1] ?? ""));
      }
      for (let s of sentences) {
        if (s.includes(selectedText)) {
          return s.trim();
        }
      }
      // Fallback: return the whole text content of the container
      return fullText.trim();
    } catch {
      // ignore
    }
  }
  return "";
};

const clickEvent = () =>
  new MouseEvent("click", {
    view: window,
    bubbles: true,
    cancelable: true,
  });

export const searchInTheBook = (
  keyword: string,
  book: Book,
  isSearch: boolean
) => {
  let leftPanel = document.querySelector(".left-panel");
  if (!leftPanel) return;
  leftPanel.dispatchEvent(clickEvent());
  const focusEvent = new MouseEvent("focus", {
    view: window,
    bubbles: true,
    cancelable: true,
  });
  let searchBox: any = document.querySelector(".header-search-box");
  searchBox.dispatchEvent(focusEvent);
  let searchIcon = document.querySelector(".header-search-icon");
  searchIcon?.dispatchEvent(clickEvent());
  if (isSearch) {
    searchBox.value = getSelection(book) || keyword;
  }
  const keyEvent: any = new KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    keyCode: 13,
  } as any);
  searchBox.dispatchEvent(keyEvent);
};

export const triggerPopupOptionClick = (optionName: string) => {
  const option = document.querySelector(`.${optionName}-option`);
  if (!option) return;
  option.dispatchEvent(clickEvent());
};

const SELECTION_SHORTCUT_OPTIONS: Array<{
  shortcut: ShortcutAction;
  optionName: string;
}> = [
  { shortcut: "selectionTranslate", optionName: "translation" },
  { shortcut: "selectionDict", optionName: "dict" },
  { shortcut: "selectionNote", optionName: "note" },
  { shortcut: "selectionHighlight", optionName: "highlight" },
  { shortcut: "selectionSpeak", optionName: "speaker" },
  { shortcut: "selectionSearch", optionName: "search-book" },
];

export const READING_PANEL_TOGGLE_EVENT = "koodo-reading-panel-toggle";

export const openReadingPanel = (position: "left" | "right") => {
  const panel = document.querySelector(`.${position}-panel`);
  if (!panel) return;
  panel.dispatchEvent(clickEvent());
};

export const toggleReadingPanel = (position: "left" | "right") => {
  window.dispatchEvent(
    new CustomEvent(READING_PANEL_TOGGLE_EVENT, {
      detail: { position },
    })
  );
};

const READING_PANEL_SHORTCUTS: Array<{
  shortcut: ShortcutAction;
  position: "left" | "right";
}> = [
  { shortcut: "openLeftPanel", position: "left" },
  { shortcut: "openRightPanel", position: "right" },
];

export const NAV_TAB_TOGGLE_EVENT = "koodo-nav-tab-toggle";
export const toggleNavTab = (tab: string) => {
  window.dispatchEvent(
    new CustomEvent(NAV_TAB_TOGGLE_EVENT, {
      detail: { tab },
    })
  );
};

const NAV_TAB_SHORTCUTS: Array<{
  shortcut: ShortcutAction;
  tab: string;
}> = [
  { shortcut: "openBookmarkList", tab: "bookmarks" },
  { shortcut: "openNoteList", tab: "notes" },
  { shortcut: "openHighlightList", tab: "highlights" },
  { shortcut: "openToc", tab: "contents" },
];
let lock = false; //prevent from clicking too fasts

// 仿真翻页动画收敛后（kookit 派发 flipend 事件）立即解除锁，
// 不再等待满 PAGE_TURN_DURATION 的 throttleTime，滚轮/键盘可继续快速翻页
window.addEventListener("page-flipend", () => {
  lock = false;
});

const isRevertDirectionReading = (rendition: any) => {
  return (
    rendition?.revertDirection === "yes" &&
    !(rendition?.isVertical && rendition.isVertical())
  );
};

// 弹窗未固定到右侧时，ESC 只关闭弹窗；返回 true 表示按键已处理，
// 调用方必须直接 return，避免继续走到 exitReader 而退出阅读
const handlePopupBoxEscape = (event: any, book: Book) => {
  if (event.keyCode !== 27) return false;
  const state = useAppStore.getState();
  if (!isUndockedPopupBoxOpen(state.viewArea, state.reader)) return false;
  event.preventDefault();
  state.handleOpenMenu(false);
  state.handleNoteKey("");
  state.handleMenuMode("");
  getIframeDoc(book).forEach((doc) => doc?.getSelection()?.empty());
  return true;
};

const arrowKeys = async (
  rendition: any,
  event: any,
  readerMode: string,
  book: Book
) => {
  // 必须放在 textarea/input 提前返回之前：焦点在笔记或 AI 输入框内时，
  // ESC 同样需要关闭弹窗，且不能继续触发 exitReader 退出阅读
  if (handlePopupBoxEscape(event, book)) return;
  if (
    event.target.tagName.toLowerCase() === "textarea" ||
    event.target.tagName.toLowerCase() === "input"
  ) {
    return;
  }
  const isReadingAid = isReadingAidMode(book.format, book.key);
  const revertDirection =
    isRevertDirectionReading(rendition) &&
    (readerMode !== "scroll" || isReadingAid);
  if (revertDirection && (event.keyCode === 37 || event.keyCode === 39)) {
    // RTL 下左右方向键整体镜像：← 下一页，→ 上一页
    event.preventDefault();
    if (event.keyCode === 37) {
      await rendition.next();
    } else {
      await rendition.prev();
    }
    handleShortcut(event, book, rendition);
    return;
  }
  if (readerMode === "scroll" && isReadingAid) {
    // 段落模式下拦截滚动模式的原生滚动按键，改为逐段导航
    const shortcutConfig = getShortcutConfig();
    if (matchShortcut(event, shortcutConfig.prevPage)) {
      event.preventDefault();
      await rendition.prev();
      handleShortcut(event, book, rendition);
      return;
    }
    if (matchShortcut(event, shortcutConfig.nextPage)) {
      event.preventDefault();
      await rendition.next();
      handleShortcut(event, book, rendition);
      return;
    }
  }
  if (isPrevPageKey(event, readerMode)) {
    event.preventDefault();
    await rendition.prev();
  } else if (isNextPageKey(event, readerMode)) {
    event.preventDefault();
    await rendition.next();
  }
  handleShortcut(event, book, rendition);
};

const mouseChrome = async (
  rendition: any,
  delta: number,
  revertDirection: boolean = false
) => {
  // RTL 下滚轮/触控板方向整体镜像：向上/向左为下一页
  const goNext = revertDirection ? delta < 0 : delta > 0;
  const goPrev = revertDirection ? delta > 0 : delta < 0;
  if (goPrev) {
    await rendition.prev();
  }
  if (goNext) {
    await rendition.next();
  }
};

const handleShortcut = (event: any, book: Book, rendition?: any) => {
  const shortcuts = getShortcutConfig();
  if (matchShortcut(event, shortcuts.exitReader)) {
    if (ConfigService.getReaderConfig("isFullscreen") === "yes") {
      ConfigService.setReaderConfig("isFullscreen", "no");
      handleExitFullScreen();
    } else {
      ConfigService.setReaderConfig("isFullscreen", "no");
      window.speechSynthesis && window.speechSynthesis.cancel();
      TTSUtil.pauseAudio();
      if (isElectron) {
        if (ConfigService.getReaderConfig("isOpenInMain") === "yes") {
          window.electronAPI.invoke("exit-tab", "ping");
        } else {
          window.electronAPI.invoke("exit-reader", "ping");
        }
      } else {
        ConfigService.setReaderConfig("isFinishWebReading", "yes");
        window.close();
      }
    }
  }
  if (matchShortcut(event, shortcuts.toggleFullscreen)) {
    event.preventDefault();
    const entering = ConfigService.getReaderConfig("isFullscreen") !== "yes";
    entering ? handleFullScreen() : handleExitFullScreen();
    ConfigService.setReaderConfig("isFullscreen", entering ? "yes" : "no");
  }
  if (matchShortcut(event, shortcuts.searchInBook)) {
    event.preventDefault();
    searchInTheBook("", book, false);
  }
  for (const { shortcut, position } of READING_PANEL_SHORTCUTS) {
    if (matchShortcut(event, shortcuts[shortcut])) {
      event.preventDefault();
      toggleReadingPanel(position);
      break;
    }
  }
  for (const { shortcut, tab } of NAV_TAB_SHORTCUTS) {
    if (matchShortcut(event, shortcuts[shortcut])) {
      event.preventDefault();
      toggleNavTab(tab);
      break;
    }
  }
  if (matchShortcut(event, shortcuts.createBookmark)) {
    event.preventDefault();
    const bookmarkBtn = document.querySelector(".reader-toolbar-bookmark");
    bookmarkBtn?.dispatchEvent(clickEvent());
  }
  if (rendition && matchShortcut(event, shortcuts.prevChapter)) {
    event.preventDefault();
    rendition.prevChapter();
  }
  if (rendition && matchShortcut(event, shortcuts.nextChapter)) {
    event.preventDefault();
    rendition.nextChapter();
  }
  for (const { shortcut, optionName } of SELECTION_SHORTCUT_OPTIONS) {
    if (matchShortcut(event, shortcuts[shortcut])) {
      if (getSelection(book)) {
        event.preventDefault();
        triggerPopupOptionClick(optionName);
      }
      break;
    }
  }
};

const handleLocation = (key: string, rendition: any) => {
  let position = rendition.getPosition();
  ConfigService.setObjectConfig(key, position, "recordLocation");
};
export const scrollChapter = async (
  element: any,
  rendition: any,
  deltaY: number
) => {
  if (deltaY < 0) {
    if (element.scrollTop === 0) {
      await rendition.prev();
    }
  }
  if (deltaY > 0) {
    var scrollHeight = element.scrollHeight;
    var scrollTop = element.scrollTop;
    var clientHeight = element.clientHeight;
    if (Math.abs(scrollTop + clientHeight - scrollHeight) < 10) {
      await rendition.next();
    }
  }
};
let lastScaleTime = 0;

// 滚轮翻页按「手势」计：触控板惯性滚动 / 快速拨动滚轮会在一两秒内连续产生大量
// wheel 事件，仅靠固定时长的锁会连翻多页。翻页后进入冷却，冷却期内每个新事件都会
// 顺延冷却时间，直到滚轮静止 WHEEL_GESTURE_GAP 毫秒才允许下一次翻页；
// 同时累计位移达到阈值才触发，过滤触控板的轻微误触。
const WHEEL_GESTURE_GAP = 250;
const WHEEL_TRIGGER_DELTA = 15;
let wheelCooldownUntil = 0;
let wheelAccum = 0;
let wheelLastTime = 0;
const takeWheelTurn = (delta: number): number => {
  const now = Date.now();
  if (now < wheelCooldownUntil) {
    wheelCooldownUntil = now + WHEEL_GESTURE_GAP;
    return 0;
  }
  if (now - wheelLastTime > WHEEL_GESTURE_GAP || Math.sign(delta) !== Math.sign(wheelAccum)) {
    wheelAccum = 0;
  }
  wheelLastTime = now;
  wheelAccum += delta;
  if (Math.abs(wheelAccum) < WHEEL_TRIGGER_DELTA) return 0;
  const result = wheelAccum;
  wheelAccum = 0;
  wheelCooldownUntil = now + WHEEL_GESTURE_GAP;
  return result;
};

// 点击翻页：分页模式下点击页面左/右两侧 30% 区域翻页，中间区域不处理
const CLICK_TURN_EDGE_RATIO = 0.3;
const CLICK_TURN_DELAY = 220; // 等待可能的双击选词，避免双击时先翻了页
const CLICK_MOVE_TOLERANCE = 5;
const CLICK_IGNORE_SELECTOR =
  "a,button,input,textarea,select,img,image,svg,video,audio,label,[role='button'],.kookit-note,.kookit-note-icon,.kookit-word-def";
const isClickTurnEnabled = () =>
  ConfigService.getReaderConfig("isDisableClickTurn") !== "yes";

const bindClickTurn = (
  rendition: any,
  doc: any,
  book: Book,
  readerMode: string
) => {
  let downX = 0;
  let downY = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  doc.addEventListener("mousedown", (event: MouseEvent) => {
    downX = event.clientX;
    downY = event.clientY;
  });
  doc.addEventListener("click", (event: MouseEvent) => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (
      readerMode === "scroll" ||
      !isClickTurnEnabled() ||
      event.button !== 0 ||
      event.detail > 1 ||
      event.defaultPrevented ||
      Math.abs(event.clientX - downX) > CLICK_MOVE_TOLERANCE ||
      Math.abs(event.clientY - downY) > CLICK_MOVE_TOLERANCE
    ) {
      return;
    }
    const target = event.target as Element | null;
    if (target?.closest?.(CLICK_IGNORE_SELECTOR)) return;
    if (doc.getSelection()?.toString().trim()) return;
    const state = useAppStore.getState();
    if (state.viewArea.isOpenMenu) return;
    // 点击位置换算到阅读区（#page-area）坐标：iframe 内 clientX 是相对 iframe 视口的
    const pageArea = document.getElementById("page-area");
    const frame = (doc.defaultView?.frameElement as HTMLElement | null) || null;
    if (!pageArea || !frame) return;
    const areaRect = pageArea.getBoundingClientRect();
    const frameRect = frame.getBoundingClientRect();
    const x = frameRect.left + event.clientX - areaRect.left;
    const ratio = x / areaRect.width;
    let direction = 0;
    if (ratio < CLICK_TURN_EDGE_RATIO) direction = -1;
    else if (ratio > 1 - CLICK_TURN_EDGE_RATIO) direction = 1;
    if (!direction) return;
    if (isRevertDirectionReading(rendition)) direction = -direction;
    timer = setTimeout(async () => {
      timer = null;
      if (doc.getSelection()?.toString().trim()) return;
      if (lock) return;
      lock = true;
      if (direction > 0) await rendition.next();
      else await rendition.prev();
      handleLocation(book.key, rendition);
      setTimeout(() => (lock = false), getThrottleTime());
    }, CLICK_TURN_DELAY);
  });
};
// kookit 渲染章节时复用同一个 iframe document，"rendered" 每触发一次就会
// 走到这里重绑一遍，用 WeakSet 保证同一 doc 只绑定一次
const boundDocs = new WeakSet<Document>();
export const bindHtmlEvent = (
  rendition: any,
  doc: any,
  book: Book,
  readerMode: string = "",
  handleScale: (scale: string) => void,
  renderBookFunc: () => void
) => {
  if (boundDocs.has(doc)) return;
  boundDocs.add(doc);
  const key = book.key;
  const format = book.format;
  doc.addEventListener(
    "keydown",
    async (event) => {
      if (lock) return;
      lock = true;
      await arrowKeys(rendition, event, readerMode, book);
      handleLocation(key, rendition);
      setTimeout(() => (lock = false), getThrottleTime());
    },
    { passive: false }
  );

  doc.addEventListener(
    "wheel",
    async (event) => {
      if (event.ctrlKey && readerMode !== "double") {
        const currentTime = Date.now();
        if (currentTime - lastScaleTime < 1500) {
          return;
        }
        lastScaleTime = currentTime;
        event.preventDefault();
        let scale = parseFloat(ConfigService.getReaderConfig("scale") || "1");
        if (event.deltaY < 0) {
          ConfigService.setReaderConfig("scale", scale + 0.1 + "");
        } else {
          ConfigService.setReaderConfig("scale", scale - 0.1 + "");
        }
        handleScale(ConfigService.getReaderConfig("scale") || "1");
        renderBookFunc();
        return;
      }
      // 阅读尺等辅助模式下滚轮完全接管为逐段导航，preventDefault 必须在
      // lock 检查之前执行：锁定期内到达的连续滚轮事件若不拦截默认行为，
      // 会触发原生滚动与遮罩过渡动画叠加，造成动画掉帧（键盘事件无默认
      // 滚动行为，所以键盘快捷键不存在此问题）
      if (
        readerMode === "scroll" &&
        Math.abs(event.deltaX) === 0 &&
        isReadingAidMode(format, key)
      ) {
        event.preventDefault();
      }
      // 分页模式（以及滚动模式下的阅读辅助）按手势翻页，一次手势只翻一页
      const isPagedWheel =
        readerMode !== "scroll" ||
        (Math.abs(event.deltaX) === 0 && isReadingAidMode(format, key));
      let wheelDelta = 0;
      if (isPagedWheel) {
        // 取主方向：触控板竖向轻扫常带微小 deltaX，不应因此忽略
        const isHorizontal = Math.abs(event.deltaX) > Math.abs(event.deltaY);
        const raw = !isHorizontal
          ? event.deltaY
          : readerMode !== "scroll" && isRevertDirectionReading(rendition)
            ? event.deltaX // RTL 下触控板水平滚动：向左滚动（deltaX<0）为下一页
            : 0;
        if (!raw) return;
        wheelDelta = takeWheelTurn(raw);
        if (!wheelDelta) return;
      }
      if (lock) return;
      lock = true;
      if (readerMode === "scroll") {
        if (Math.abs(event.deltaX) === 0 && isReadingAidMode(format, key)) {
          // 段落/阅读尺/速读模式内部实际按单页渲染，同样遵循 RTL
          await mouseChrome(
            rendition,
            wheelDelta,
            isRevertDirectionReading(rendition)
          );
        } else {
          await sleep(200);
          await rendition.record();
          if (
            Math.abs(event.deltaX) === 0 &&
            ConfigService.getReaderConfig("isDisableAutoScroll") !== "yes"
          ) {
            let srollElement = document.getElementById("page-area");
            await scrollChapter(srollElement, rendition, event.deltaY);
          }
        }
      } else {
        await mouseChrome(
          rendition,
          wheelDelta,
          isRevertDirectionReading(rendition)
        );
      }
      handleLocation(key, rendition);
      setTimeout(() => (lock = false), getThrottleTime());
    },
    { passive: false }
  );

  window.addEventListener(
    "keydown",
    async (event) => {
      if (lock) return;
      lock = true;
      await arrowKeys(rendition, event, readerMode, book);
      handleLocation(key, rendition);
      setTimeout(() => (lock = false), getThrottleTime());
    },
    { passive: false }
  );

  bindClickTurn(rendition, doc, book, readerMode);

  doc.addEventListener(
    "touchend",
    async () => {
      if (lock) return;
      lock = true;
      if (readerMode === "scroll") {
        await sleep(200);
        await rendition.record();
      }
      handleLocation(key, rendition);
      setTimeout(() => (lock = false), getThrottleTime());
    },
    { passive: false }
  );
};
export const htmlMouseEvent = (
  rendition: any,
  book: Book,
  readerMode: string,
  handleScale: (scale: string) => void,
  renderBookFunc: () => void
) => {
  rendition.on("rendered", () => {
    let iframe = getIframeWin();
    if (!iframe) return;
    iframe?.focus();
    let docs = getIframeDoc(book);
    for (let i = 0; i < docs.length; i++) {
      let doc = docs[i];
      if (!doc) continue;
      bindHtmlEvent(
        rendition,
        doc,
        book,
        readerMode,
        handleScale,
        renderBookFunc
      );
    }
    lock = false;
  });
};
