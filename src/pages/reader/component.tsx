import { useLatest } from "../../utils/hooks/useLatest";
import { useTranslation } from "react-i18next";
import React, { useEffect, useRef, useState } from "react";
import SettingPanel from "../../containers/panels/settingPanel";
import NavigationPanel from "../../containers/panels/navigationPanel";
import { Toaster } from "react-hot-toast";
import {
  ConfigService,
  ReadingTimeUtil,
} from "../../assets/lib/kookit-extra-browser.min";
import Viewer from "../../containers/viewer";
import { Tooltip } from "react-tooltip";
import "./index.css";
import Book from "../../models/Book";
import DatabaseService from "../../utils/storage/databaseService";
import ConvertDialog from "../../components/dialogs/convertDialog";
import ScalePageDialog from "../../components/dialogs/scalePageDialog";
import PdfCropDialog from "../../components/dialogs/pdfCropDialog";
import StudyLangDialog from "../../components/dialogs/studyLangDialog";
import AssistReadDialog from "../../components/dialogs/assistReadDialog";
import { isElectron } from "react-device-detect";
import SettingDialog from "../../components/dialogs/settingDialog";
import SpeechDialog from "../../components/dialogs/speechDialog";
import KeepMounted from "../../components/keepMounted";
import AnnotationDialog from "../../components/dialogs/annotationDialog";
import PopupOptionDialog from "../../components/dialogs/popupOptionDialog";
import {
  updateDiscordPresence,
  clearDiscordPresence,
} from "../../utils/reader/discordRPC";
import ReaderTopToolbar from "../../components/readerTopToolbar";
import ChapterEndPrompt from "../../components/aiReading/chapterEndPrompt";
import ReadingMarksLayer from "../../components/aiReading/readingMarksLayer";
import CompanionPanel from "../../components/aiReading/companionPanel";
import { READING_PANEL_TOGGLE_EVENT } from "../../utils/reader/mouseEvent";
import {
  getRightPanelInset,
  isPaginatedBook,
  POPUP_BOX_MODES,
  scrollContents,
  throttle,
} from "../../utils/common";
import { getOuterDoc } from "../../utils/reader/docUtil";
import { useAppStore } from "../../store/useAppStore";

const QUICK_BUTTON_EDGE_DISTANCE = 40;
// 侧边工具栏宽约 52px、距右侧 20px，指针进入该区域即可唤出，无需先移到顶部
const SIDE_RAIL_EDGE_DISTANCE = 80;

export interface ReaderState {
  isOpenRightPanel: boolean;
  isOpenLeftPanel: boolean;
  isTouch: boolean;
  isPreventTrigger: boolean;
  hoverPanel: string;
  isNearEdge: boolean;
  // 仅右侧按钮栏可见（指针靠近右边缘时），不带出顶部工具栏
  isNearRightEdge: boolean;
  totalDuration: number;
  currentDuration: number;
}

declare var window: any;
let isMouseMoving = false;
const PANEL_POSITIONS = ["left", "right"] as const;
type PanelPosition = (typeof PANEL_POSITIONS)[number];
const PANEL_ENTER_DELAY = 500;
const PANEL_LEAVE_DELAY = 500;
const enterTimers: Record<string, NodeJS.Timeout | null> = {
  left: null,
  right: null,
};
const leaveTimers: Record<string, NodeJS.Timeout | null> = {
  left: null,
  right: null,
};
const isEdgeHovering: Record<string, boolean> = {
  left: false,
  right: false,
};
const PANEL_OPEN_STATE: Record<
  PanelPosition,
  "isOpenLeftPanel" | "isOpenRightPanel"
> = {
  left: "isOpenLeftPanel",
  right: "isOpenRightPanel",
};
const Reader = () => {
  const currentBook = useAppStore((s) => s.book.currentBook);
  const htmlBook = useAppStore((s) => s.reader.htmlBook);
  const readerBackgroundColor = useAppStore((s) => s.reader.backgroundColor);
  const readerMode = useAppStore((s) => s.reader.readerMode);
  const isNavLocked = useAppStore((s) => s.reader.isNavLocked);
  const isConvertOpen = useAppStore((s) => s.reader.isConvertOpen);
  const isScaleOpen = useAppStore((s) => s.reader.isScaleOpen);
  const isPdfCropOpen = useAppStore((s) => s.reader.isPdfCropOpen);
  const isStudyLangOpen = useAppStore((s) => s.reader.isStudyLangOpen);
  const isAssistReadOpen = useAppStore((s) => s.reader.isAssistReadOpen);
  const isSpeechOpen = useAppStore((s) => s.reader.isSpeechOpen);
  const isAnnotationOpen = useAppStore((s) => s.reader.isAnnotationOpen);
  const isOpenPopupOptionDialog = useAppStore(
    (s) => s.backupPage.isOpenPopupOptionDialog
  );
  const isSettingLocked = useAppStore((s) => s.reader.isSettingLocked);
  const isDockedRight = useAppStore((s) => s.reader.isDockedRight);
  const isSettingOpen = useAppStore((s) => s.manager.isSettingOpen);
  const isOpenMenu = useAppStore((s) => s.viewArea.isOpenMenu);
  const menuMode = useAppStore((s) => s.viewArea.menuMode);
  const handleFetchBooks = useAppStore((s) => s.handleFetchBooks);
  const handleReadingBook = useAppStore((s) => s.handleReadingBook);
  const handleFetchPercentage = useAppStore((s) => s.handleFetchPercentage);
  const handleReaderMode = useAppStore((s) => s.handleReaderMode);
  const handleMenuMode = useAppStore((s) => s.handleMenuMode);
  const handleOriginalText = useAppStore((s) => s.handleOriginalText);
  const handleOpenMenu = useAppStore((s) => s.handleOpenMenu);
  const handleConvertDialog = useAppStore((s) => s.handleConvertDialog);
  const handleScalePageDialog = useAppStore((s) => s.handleScalePageDialog);
  const handlePdfCropDialog = useAppStore((s) => s.handlePdfCropDialog);
  const handleStudyLangDialog = useAppStore((s) => s.handleStudyLangDialog);
  const handleAssistReadDialog = useAppStore((s) => s.handleAssistReadDialog);
  const handleSpeechDialog = useAppStore((s) => s.handleSpeechDialog);
  const handleAnnotationDialog = useAppStore((s) => s.handleAnnotationDialog);
  const handleBackgroundColor = useAppStore((s) => s.handleBackgroundColor);
  const handleCurrentChapter = useAppStore((s) => s.handleCurrentChapter);
  const { t } = useTranslation();
  const currentProps = {
    t,
    currentBook,
    htmlBook,
    readerMode,
    isNavLocked,
    isConvertOpen,
    isScaleOpen,
    isPdfCropOpen,
    isStudyLangOpen,
    isAssistReadOpen,
    isSpeechOpen,
    isAnnotationOpen,
    isOpenPopupOptionDialog,
    isSettingLocked,
    isDockedRight,
    isSettingOpen,
    handleFetchBooks,
    handleReadingBook,
    handleFetchPercentage,
    handleReaderMode,
    handleMenuMode,
    handleOriginalText,
    handleOpenMenu,
    handleConvertDialog,
    handleScalePageDialog,
    handlePdfCropDialog,
    handleStudyLangDialog,
    handleAssistReadDialog,
    handleSpeechDialog,
    handleAnnotationDialog,
    handleBackgroundColor,
  };
  const propsRef = useLatest(currentProps);
  const [state, setState] = useState<ReaderState>({
    hoverPanel: "",
    isOpenLeftPanel: isNavLocked,
    isOpenRightPanel: isSettingLocked,
    totalDuration: 0,
    currentDuration: 0,
    isTouch: ConfigService.getReaderConfig("isTouch") === "yes",
    isPreventTrigger:
      ConfigService.getReaderConfig("isPreventTrigger") === "yes",
    isNearEdge: false,
    isNearRightEdge: false,
  });
  const stateRef = useLatest(state);
  const updateState = (patch: Partial<ReaderState>) =>
    setState((prev) => ({ ...prev, ...patch }));
  const messageTimerRef = useRef<NodeJS.Timeout | undefined>(undefined);
  const tickTimerRef = useRef<NodeJS.Timeout | undefined>(undefined);
  const autoShowTimerRef = useRef<NodeJS.Timeout | null>(null);
  const hideQuickButtonsTimerRef = useRef<NodeJS.Timeout | null>(null);
  const hideSideRailTimerRef = useRef<NodeJS.Timeout | null>(null);
  const dialogAnchorIconRef = useRef<HTMLElement | null>(null);
  const didMountRef = useRef(false);
  useEffect(() => {
    const rendition = htmlBook?.rendition;
    if (typeof rendition?.applyAnnotationConfig !== "function") return;
    rendition.applyAnnotationConfig({
      isDrawing: isAnnotationOpen ? "yes" : "no",
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAnnotationOpen, htmlBook]);
  const readingTimeUtilRef = useRef<InstanceType<
    typeof ReadingTimeUtil
  > | null>(null);
  if (!readingTimeUtilRef.current) {
    readingTimeUtilRef.current = new ReadingTimeUtil(
      ConfigService,
      isElectron
        ? {
            registerUnloadHandler(callback: () => void): () => void {
              const ipcRenderer = window.electronAPI;
              // Separate reader window close
              ipcRenderer.on("before-reader-close", callback);
              // In-app tab (WebContentsView) close
              ipcRenderer.on("before-tab-close", callback);
              return () => {
                ipcRenderer.removeListener("before-reader-close", callback);
                ipcRenderer.removeListener("before-tab-close", callback);
              };
            },
            onBeforeClose(): void {
              const ipcRenderer = window.electronAPI;
              // Reply to whichever close signal is active
              ipcRenderer.send("reader-close-ready");
              ipcRenderer.send("tab-close-ready");
            },
          }
        : {
            registerUnloadHandler(callback: () => void): () => void {
              window.addEventListener("beforeunload", callback);
              return () => window.removeEventListener("beforeunload", callback);
            },
          }
    );
  }

  const cancelEnterReader = (position: string) => {
    isEdgeHovering[position] = false;
    if (enterTimers[position]) {
      clearTimeout(enterTimers[position]!);
      enterTimers[position] = null;
    }
  };

  const scheduleEnterReader = (position: string) => {
    cancelEnterReader(position);
    isEdgeHovering[position] = true;
    const delay = stateRef.current.isPreventTrigger ? 0 : PANEL_ENTER_DELAY;
    enterTimers[position] = setTimeout(() => {
      enterTimers[position] = null;
      if (!isEdgeHovering[position] || isMouseMoving) return;
      // 右侧按钮栏与右边缘热区重叠，按钮栏已显示时由它的「Aa」打开设置，
      // 避免用户移向按钮栏时设置面板被意外弹出
      if (position === "right" && stateRef.current.isNearRightEdge) return;
      handleEnterReader(position);
    }, delay);
  };

  const cancelLeaveReader = (position: string) => {
    if (leaveTimers[position]) {
      clearTimeout(leaveTimers[position]!);
      leaveTimers[position] = null;
    }
  };

  const scheduleLeaveReader = (position: string) => {
    cancelLeaveReader(position);
    leaveTimers[position] = setTimeout(() => {
      leaveTimers[position] = null;
      handleLeaveReader(position);
    }, PANEL_LEAVE_DELAY);
  };

  const handleEdgeMouseEnter = (position: PanelPosition) => {
    if (
      stateRef.current.isTouch ||
      stateRef.current[PANEL_OPEN_STATE[position]] ||
      stateRef.current.isPreventTrigger
    ) {
      cancelLeaveReader(position);
      updateState({ hoverPanel: position });
      return;
    }
    scheduleEnterReader(position);
  };

  const handleEdgeMouseLeave = (position: PanelPosition) => {
    cancelEnterReader(position);
    updateState({ hoverPanel: "" });
  };

  const handleEnterReader = (position: string) => {
    cancelEnterReader(position);
    cancelLeaveReader(position);
    switch (position) {
      case "right":
        updateState({
          isOpenRightPanel: true,
        });
        break;
      case "left":
        updateState({
          isOpenLeftPanel: true,
        });
        break;
      default:
        break;
    }
  };
  const handleLeaveReader = (position: string) => {
    cancelLeaveReader(position);
    switch (position) {
      case "right":
        if (propsRef.current.isSettingLocked) {
          break;
        } else {
          updateState({ isOpenRightPanel: false });
          break;
        }

      case "left":
        if (
          propsRef.current.isNavLocked ||
          ConfigService.getReaderConfig("isTempLocked") === "yes"
        ) {
          break;
        } else {
          updateState({ isOpenLeftPanel: false });
          break;
        }
      default:
        break;
    }
  };
  const handleReadingPanelToggle = (event: Event) => {
    const position = (event as CustomEvent<{ position: string }>).detail
      ?.position;
    if (!PANEL_POSITIONS.includes(position as PanelPosition)) return;
    const stateKey = PANEL_OPEN_STATE[position as PanelPosition];
    if (stateRef.current[stateKey]) {
      handleLeaveReader(position);
    } else {
      handleEnterReader(position);
    }
  };
  const closeSettingDialogs = () => {
    propsRef.current.handleScalePageDialog(false);
    propsRef.current.handleConvertDialog(false);
    propsRef.current.handlePdfCropDialog(false);
    propsRef.current.handleStudyLangDialog(false);
    propsRef.current.handleAssistReadDialog(false);
    propsRef.current.handleSpeechDialog(false);
  };
  const handleAnnotationClick = () => {
    if (isAnnotationOpen) {
      propsRef.current.handleAnnotationDialog(false);
      return;
    }
    dialogAnchorIconRef.current = null;
    closeSettingDialogs();
    propsRef.current.handleAnnotationDialog(true);
  };
  const updateSettingDialogPosition = () => {
    const anchor = document.querySelector<HTMLElement>(
      ".reader-setting-dialog-anchor"
    );
    const dialog = Array.from(
      anchor?.querySelectorAll<HTMLElement>(".sort-dialog-container") || []
    ).find((item) => item.offsetParent !== null && item.offsetWidth > 0);
    if (!anchor || !dialog) return;
    const icon = dialogAnchorIconRef.current;
    if (!icon || !icon.isConnected) return;
    const iconRect = icon.getBoundingClientRect();
    const iconCenter = iconRect.left + iconRect.width / 2;
    const viewportWidth =
      document.documentElement.clientWidth || window.innerWidth;
    const reservedRight = getRightPanelInset(
      propsRef.current.isSettingLocked,
      propsRef.current.isDockedRight
    );
    const dialogWidth = dialog.offsetWidth;
    if (!dialogWidth) return;
    const minLeft = 8;
    const maxLeft = Math.max(
      minLeft,
      viewportWidth - reservedRight - dialogWidth - 8
    );
    // 右侧竖排工具栏：浮层出现在按钮左侧并与按钮垂直对齐
    const isRailIcon = !!icon.closest(".reader-side-rail");
    const left = isRailIcon
      ? Math.max(minLeft, iconRect.left - dialogWidth - 16)
      : Math.min(maxLeft, Math.max(minLeft, iconCenter - dialogWidth / 2));
    if (isRailIcon) {
      const viewportHeight =
        document.documentElement.clientHeight || window.innerHeight;
      const top = Math.min(
        Math.max(8, iconRect.top + iconRect.height / 2 - dialog.offsetHeight / 2),
        Math.max(8, viewportHeight - dialog.offsetHeight - 8)
      );
      anchor.style.top = `${top}px`;
    } else {
      anchor.style.top = "";
    }
    document.documentElement.style.setProperty(
      "--reader-dialog-anchor-x",
      `${iconCenter}px`
    );
    if (!anchor.dataset.positioned) {
      anchor.style.transition = "none";
      anchor.style.left = `${left}px`;
      void anchor.offsetWidth;
      anchor.style.transition = "";
      anchor.dataset.positioned = "true";
    } else {
      anchor.style.left = `${left}px`;
    }
  };
  const handleDialogButtonHover = (
    handleDialog: (isOpen: boolean) => void,
    dialogSelector: string
  ) => ({
    onMouseEnter: (event: React.MouseEvent<HTMLDivElement>) => {
      dialogAnchorIconRef.current = event.currentTarget;
      closeSettingDialogs();
      handleDialog(true);
      updateSettingDialogPosition();
      window.requestAnimationFrame(updateSettingDialogPosition);
    },
    onMouseLeave: () => {
      window.setTimeout(() => {
        if (!document.querySelector(`${dialogSelector}:hover`)) {
          handleDialog(false);
        }
      }, 200);
    },
  });
  const showQuickButtons = () => {
    if (autoShowTimerRef.current) {
      clearTimeout(autoShowTimerRef.current);
      autoShowTimerRef.current = null;
    }
    if (hideQuickButtonsTimerRef.current) {
      clearTimeout(hideQuickButtonsTimerRef.current);
      hideQuickButtonsTimerRef.current = null;
    }
    if (!stateRef.current.isNearEdge) {
      updateState({ isNearEdge: true });
    }
  };
  const hideQuickButtons = () => {
    if (hideQuickButtonsTimerRef.current) {
      clearTimeout(hideQuickButtonsTimerRef.current);
    }
    hideQuickButtonsTimerRef.current = setTimeout(() => {
      hideQuickButtonsTimerRef.current = null;
      if (stateRef.current.isNearEdge) {
        updateState({ isNearEdge: false });
      }
    }, 200);
  };
  const showSideRail = () => {
    if (hideSideRailTimerRef.current) {
      clearTimeout(hideSideRailTimerRef.current);
      hideSideRailTimerRef.current = null;
    }
    if (!stateRef.current.isNearRightEdge) {
      updateState({ isNearRightEdge: true });
    }
  };
  const hideSideRail = () => {
    if (hideSideRailTimerRef.current) {
      clearTimeout(hideSideRailTimerRef.current);
    }
    hideSideRailTimerRef.current = setTimeout(() => {
      hideSideRailTimerRef.current = null;
      if (stateRef.current.isNearRightEdge) {
        updateState({ isNearRightEdge: false });
      }
    }, 200);
  };
  // 顶部区域唤出完整工具栏；右边缘区域只唤出右侧按钮栏
  const updateEdgeVisibility = (
    x: number,
    y: number,
    isPointerOverRail: boolean
  ) => {
    if (isWithinEdgeZone(y)) {
      showQuickButtons();
    } else if (isPointerOverRail && stateRef.current.isNearEdge) {
      // 从顶部唤出后移到按钮栏上，保持整套工具栏可见
      showQuickButtons();
    } else {
      hideQuickButtons();
    }
    if (isPointerOverRail || isWithinRightEdgeZone(x)) {
      showSideRail();
    } else {
      hideSideRail();
    }
  };
  // 底部工具栏已移除，仅靠近顶部时唤出工具栏
  const isWithinEdgeZone = (pageY: number) =>
    pageY <= QUICK_BUTTON_EDGE_DISTANCE;
  // 侧边工具栏随右侧固定面板左移，热区也以面板左边缘为准
  const isWithinRightEdgeZone = (pageX: number) => {
    const railRight =
      window.innerWidth -
      getRightPanelInset(
        propsRef.current.isSettingLocked,
        propsRef.current.isDockedRight
      );
    return pageX <= railRight && pageX >= railRight - SIDE_RAIL_EDGE_DISTANCE;
  };

  useEffect(() => {
    const run = async () => {
      let url = document.location.href;
      let firstIndexOfQuestion = url.indexOf("?");
      let lastIndexOfSlash = url.lastIndexOf("/", firstIndexOfQuestion);
      let key = url.substring(lastIndexOfSlash + 1, firstIndexOfQuestion);
      if (ConfigService.getAllListConfig("seperateStyleBooks").includes(key)) {
        window.currentBookKey = key;
        propsRef.current.handleBackgroundColor(
          ConfigService.getReaderConfig("backgroundColor") || ""
        );
      } else {
        window.currentBookKey = "";
      }
      propsRef.current.handleFetchBooks();
      DatabaseService.getRecord(key, "books").then((book: Book | null) => {
        book = book || JSON.parse(ConfigService.getItem("tempBook") || "{}");
        if (!book) return;

        propsRef.current.handleFetchPercentage(book);
        let readerMode = isPaginatedBook(book)
          ? ConfigService.getReaderConfig("pdfReaderMode") || "scroll"
          : ConfigService.getReaderConfig("readerMode") || "double";
        propsRef.current.handleReaderMode(readerMode);
        propsRef.current.handleReadingBook(book);
        // Start event-driven reading-time tracking
        readingTimeUtilRef.current!.start(book.key);
        // Initialise UI duration from persisted total
        const savedTotal = readingTimeUtilRef.current!.getTotalSeconds(
          book.key
        );
        updateState({ totalDuration: savedTotal, currentDuration: 0 });
        if (isElectron) {
          updateDiscordPresence(book);
        }
      });
    };
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (ConfigService.getReaderConfig("isMergeWord") === "yes") {
      document.documentElement.style.backgroundColor = "transparent";
      document
        .querySelector("body")
        ?.setAttribute("style", "background-color: rgba(0,0,0,0)");
    }

    // Update UI counters every second so the navigation panel still shows
    // live reading-time values, but actual storage writes only happen when
    // a reading session ends (visibility hidden / blur / unmount).
    tickTimerRef.current = setInterval(() => {
      if (!propsRef.current.currentBook.key) return;
      setState((prev) => ({
        ...prev,
        totalDuration: prev.totalDuration + 60,
        currentDuration: prev.currentDuration + 60,
      }));
    }, 60000);

    window.addEventListener("beforeunload", function () {
      if (!isElectron) {
        ConfigService.setReaderConfig("isFinishWebReading", "yes");
      }
    });
    let latestPointerX: number | null = null;
    let latestPointerY: number | null = null;
    // 侧边工具栏垂直居中，不在上下边缘区域内；指针停在工具栏或其「更多」菜单上时
    // 不能因为离开边缘区域而收起，否则菜单子项来不及点击就消失了
    let isPointerOverRail = false;
    const updateQuickButtons = () => {
      if (latestPointerX === null || latestPointerY === null) return;
      updateEdgeVisibility(latestPointerX, latestPointerY, isPointerOverRail);
    };
    const throttledMouseMove = throttle(updateQuickButtons, 100);
    const handleMouseMove = (e: MouseEvent) => {
      isMouseMoving = true;
      setTimeout(() => {
        isMouseMoving = false;
      }, 100);
      latestPointerX = e.clientX;
      latestPointerY = e.clientY;
      isPointerOverRail = !!(e.target as Element | null)?.closest?.(
        ".reader-quick-buttons"
      );
      throttledMouseMove();
    };
    const handlePointerLeftWindow = () => {
      latestPointerX = null;
      latestPointerY = null;
      isPointerOverRail = false;
      hideQuickButtons();
      hideSideRail();
    };
    const handleWindowMouseLeave = (e: MouseEvent) => {
      // Entering an Electron draggable region (e.g. the toolbar) also fires
      // mouseleave even though the pointer is still inside the window.
      if (
        e.clientX > 1 &&
        e.clientY > 1 &&
        e.clientX < window.innerWidth - 1 &&
        e.clientY < window.innerHeight - 1
      ) {
        return;
      }
      handlePointerLeftWindow();
    };
    window.addEventListener("mousemove", handleMouseMove);
    document.documentElement.addEventListener(
      "mouseleave",
      handleWindowMouseLeave
    );
    // 无边框 Electron 窗口不会派发 DOM mouseleave，由主进程轮询兜底
    const removeMouseLeaveListener = isElectron
      ? window.electronAPI?.on?.("reader-mouse-leave", handlePointerLeftWindow)
      : undefined;
    window.addEventListener(
      READING_PANEL_TOGGLE_EVENT,
      handleReadingPanelToggle
    );
    window.addEventListener("resize", updateSettingDialogPosition);

    // Show quick buttons briefly after entering the reader
    updateState({ isNearEdge: true });
    autoShowTimerRef.current = setTimeout(() => {
      autoShowTimerRef.current = null;
      updateState({ isNearEdge: false });
    }, 1500);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      document.documentElement.removeEventListener(
        "mouseleave",
        handleWindowMouseLeave
      );
      removeMouseLeaveListener?.();
      window.removeEventListener(
        READING_PANEL_TOGGLE_EVENT,
        handleReadingPanelToggle
      );
      window.removeEventListener("resize", updateSettingDialogPosition);
      if (hideQuickButtonsTimerRef.current) {
        clearTimeout(hideQuickButtonsTimerRef.current);
        hideQuickButtonsTimerRef.current = null;
      }
      if (hideSideRailTimerRef.current) {
        clearTimeout(hideSideRailTimerRef.current);
        hideSideRailTimerRef.current = null;
      }
      if (isElectron) {
        clearDiscordPresence();
      }
      if (tickTimerRef.current) {
        clearInterval(tickTimerRef.current);
      }
      if (autoShowTimerRef.current) {
        clearTimeout(autoShowTimerRef.current);
        autoShowTimerRef.current = null;
      }
      PANEL_POSITIONS.forEach((position) => {
        cancelEnterReader(position);
        cancelLeaveReader(position);
      });
      // Flush any in-flight session time before the component tears down
      readingTimeUtilRef.current!.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!isElectron) return;
    window.electronAPI?.send?.(
      "reader-mouse-watch",
      state.isNearEdge || state.isNearRightEdge
    );
    return () => {
      window.electronAPI?.send?.("reader-mouse-watch", false);
    };
  }, [state.isNearEdge, state.isNearRightEdge]);

  // 翻页后记录阅读位置、同步当前章节与进度（原由底部工具栏承担）
  useEffect(() => {
    if (!htmlBook) return;
    const rendition = htmlBook.rendition;
    let scrollTimer: NodeJS.Timeout | undefined;
    const onPageChanged = () => {
      const book = propsRef.current.currentBook;
      if (!book?.key) return;
      const position = rendition.getPosition();
      ConfigService.setObjectConfig(book.key, position, "recordLocation");
      handleCurrentChapter(position.chapterTitle);
      propsRef.current.handleFetchPercentage(book);
      if (scrollTimer) clearTimeout(scrollTimer);
      scrollTimer = setTimeout(() => {
        scrollContents(position.chapterTitle, position.chapterHref);
      }, 1000);
    };
    rendition.on("page-changed", onPageChanged);
    return () => {
      if (scrollTimer) clearTimeout(scrollTimer);
      rendition.off?.("page-changed", onPageChanged);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [htmlBook]);

  useEffect(() => {
    if (!htmlBook) return;
    const attachedDocs = new WeakSet<Document>();
    // 把 iframe 内的坐标换算成顶层窗口坐标
    const getPageClientPoint = (
      doc: Document,
      clientX: number,
      clientY: number
    ) => {
      let x = clientX;
      let y = clientY;
      let win: Window | null = doc.defaultView;
      while (win && win.frameElement) {
        const rect = win.frameElement.getBoundingClientRect();
        x += rect.left;
        y += rect.top;
        win = win.parent;
      }
      return { x, y };
    };
    const attachEdgeHandlers = (doc: Document) => {
      let latestPointer: { x: number; y: number } | null = null;
      const updateQuickButtons = throttle(() => {
        if (latestPointer === null) return;
        const { x, y } = getPageClientPoint(
          doc,
          latestPointer.x,
          latestPointer.y
        );
        updateEdgeVisibility(x, y, false);
      }, 100);
      doc.addEventListener("mousemove", (e: MouseEvent) => {
        latestPointer = { x: e.clientX, y: e.clientY };
        updateQuickButtons();
      });
      doc.documentElement.addEventListener("mouseleave", () => {
        // Leaving the iframe is not the same as leaving the window; the outer
        // document's mousemove handler updates the button visibility.
        latestPointer = null;
      });
    };
    const attachToDoc = (doc: Document | null) => {
      if (!doc || attachedDocs.has(doc)) return;
      attachedDocs.add(doc);
      attachEdgeHandlers(doc);
    };
    const collectDocs = () => {
      const outerDoc = getOuterDoc();
      attachToDoc(outerDoc);
      if (!outerDoc) return;
      outerDoc.querySelectorAll("iframe").forEach((iframe) => {
        attachToDoc((iframe as HTMLIFrameElement).contentDocument);
      });
    };
    collectDocs();
    const attachTimer = setInterval(collectDocs, 800);
    return () => {
      clearInterval(attachTimer);
    };
  }, [htmlBook]);

  useEffect(() => {
    if (!didMountRef.current) {
      didMountRef.current = true;
      return;
    }
    if (document.querySelector(".reader-setting-dialog-anchor")) {
      updateSettingDialogPosition();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  });

  const isSeparateElectronWindow =
    isElectron && ConfigService.getReaderConfig("isOpenInMain") !== "yes";
  const isMacOS =
    isElectron && window.electronAPI?.runtime?.platform === "darwin";
  const isMergeWord = ConfigService.getReaderConfig("isMergeWord") === "yes";
  const isUndockedPopupBoxOpen =
    !isDockedRight && isOpenMenu && POPUP_BOX_MODES.includes(menuMode);
  const renditionProps = {
    handleLeaveReader: handleLeaveReader,
    handleEnterReader: handleEnterReader,
    isShow: state.isOpenLeftPanel || state.isOpenRightPanel,
  };
  return (
    <div
      className={"viewer" + (state.isNearEdge ? " quick-buttons-shown" : "")}
    >
      <Tooltip id="my-tooltip" style={{ zIndex: 25 }} />
      {isSeparateElectronWindow && (
        <div className="reader-window-drag-region" />
      )}

      <div
        className={
          "reader-toolbar-backdrop reader-toolbar-backdrop-top" +
          (state.isNearEdge && !isUndockedPopupBoxOpen ? " visible" : "")
        }
        style={{ backgroundColor: readerBackgroundColor }}
      />
      <ReaderTopToolbar
        isNearEdge={state.isNearEdge && !isUndockedPopupBoxOpen}
        currentDuration={state.currentDuration}
        isMacOS={isMacOS}
        isMergeWord={isMergeWord}
        isSeparateElectronWindow={isSeparateElectronWindow}
        isSideRailShown={state.isNearRightEdge && !isUndockedPopupBoxOpen}
        showQuickButtons={showQuickButtons}
        hideQuickButtons={hideQuickButtons}
        showSideRail={showSideRail}
        hideSideRail={hideSideRail}
        handleDialogButtonHover={handleDialogButtonHover}
        handleAnnotationClick={handleAnnotationClick}
        handleEnterReader={handleEnterReader}
      />

      {isSettingOpen && (
        <>
          <SettingDialog />
          <div className="drag-background"></div>
        </>
      )}
      <Toaster
        toastOptions={{
          style: {
            padding: "8px 10px",
            wordWrap: "break-word",
            wordBreak: "break-word",
            whiteSpace: "normal",
            overflowWrap: "break-word",
          },
        }}
      />

      <div
        className="left-panel"
        onMouseEnter={() => handleEdgeMouseEnter("left")}
        onMouseLeave={() => handleEdgeMouseLeave("left")}
        style={state.hoverPanel === "left" ? { opacity: 0.5 } : {}}
        onClick={() => {
          handleEnterReader("left");
        }}
      >
        <span className="icon-grid panel-icon"></span>
      </div>
      <div
        className="right-panel"
        onMouseEnter={() => handleEdgeMouseEnter("right")}
        onMouseLeave={() => handleEdgeMouseLeave("right")}
        style={
          state.hoverPanel === "right"
            ? {
                opacity: 0.5,
                right: isDockedRight ? "299px" : "0px",
              }
            : { right: isDockedRight ? "299px" : "0px" }
        }
        onClick={() => {
          handleEnterReader("right");
        }}
      >
        <span className="icon-grid panel-icon"></span>
      </div>

      <div
        className="setting-panel-container"
        onMouseEnter={() => {
          cancelLeaveReader("right");
        }}
        onMouseLeave={() => {
          scheduleLeaveReader("right");
        }}
        style={
          state.isOpenRightPanel
            ? {}
            : {
                transform: "translateX(309px)",
              }
        }
      >
        <SettingPanel />
      </div>
      <div
        className="navigation-panel-container"
        onMouseEnter={() => {
          cancelLeaveReader("left");
        }}
        onMouseLeave={() => {
          scheduleLeaveReader("left");
        }}
        style={
          state.isOpenLeftPanel
            ? {}
            : {
                transform: "translateX(-309px)",
              }
        }
      >
        <NavigationPanel
          {...({
            totalDuration: state.totalDuration,
          } as any)}
        />
      </div>

      {currentBook.key && <Viewer {...(renditionProps as any)} />}
      <div className="reader-setting-dialog-anchor">
        {(readerMode === "scroll" || readerMode === "single") && (
          <KeepMounted open={isScaleOpen}>
            <ScalePageDialog />
          </KeepMounted>
        )}
        <KeepMounted open={isConvertOpen}>
          <ConvertDialog />
        </KeepMounted>
        <KeepMounted open={isPdfCropOpen}>
          <PdfCropDialog />
        </KeepMounted>
        <KeepMounted open={isStudyLangOpen}>
          <StudyLangDialog />
        </KeepMounted>
        <KeepMounted open={isAssistReadOpen}>
          <AssistReadDialog />
        </KeepMounted>
        <KeepMounted open={isSpeechOpen}>
          <SpeechDialog />
        </KeepMounted>
      </div>
      {isAnnotationOpen && <AnnotationDialog />}
      <ChapterEndPrompt />
      <ReadingMarksLayer />
      {isElectron && <CompanionPanel />}
      {isOpenPopupOptionDialog && (
        <>
          <PopupOptionDialog />
          <div className="drag-background"></div>
        </>
      )}
    </div>
  );
};

export default Reader;
