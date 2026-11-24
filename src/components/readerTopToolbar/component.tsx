import React, { useEffect, useRef, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import toast from "react-hot-toast";
import { isElectron } from "react-device-detect";
import { ConfigService } from "../../assets/lib/kookit-extra-browser.min";
import Bookmark from "../../models/Bookmark";
import BookLocation from "../../models/BookLocation";
import DatabaseService from "../../utils/storage/databaseService";
import TTSUtil from "../../utils/reader/ttsUtil";
import {
  handleExitFullScreen,
  handleFullScreen,
  isReadingRawPDF,
  getRightPanelInset,
  isPaperLayout,
} from "../../utils/common";
import { useAppStore } from "../../store/useAppStore";
import WindowControls from "../windowControls";
import "./readerTopToolbar.css";

export interface ReaderTopToolbarProps {
  isNearEdge: boolean;
  isSideRailShown: boolean;
  currentDuration: number;
  isMacOS: boolean;
  isSeparateElectronWindow: boolean;
  showQuickButtons: () => void;
  hideQuickButtons: () => void;
  showSideRail: () => void;
  hideSideRail: () => void;
  handleDialogButtonHover: (
    handleDialog: (isOpen: boolean) => void,
    dialogSelector: string
  ) => {
    onMouseEnter: (event: React.MouseEvent<HTMLDivElement>) => void;
    onMouseLeave: () => void;
  };
  handleAnnotationClick: () => void;
  handleEnterReader: (position: string) => void;
}

declare var window: any;

const DRAG_REGION_STYLE = { WebkitAppRegion: "drag" } as React.CSSProperties;
const NO_DRAG_REGION_STYLE = {
  WebkitAppRegion: "no-drag",
} as React.CSSProperties;

const ReaderTopToolbar = (props: ReaderTopToolbarProps) => {
  const currentBook = useAppStore((s) => s.book.currentBook);
  const htmlBook = useAppStore((s) => s.reader.htmlBook);
  const readerMode = useAppStore((s) => s.reader.readerMode);
  const isFitPage = useAppStore((s) => s.reader.isFitPage);
  const readerBackgroundColor = useAppStore((s) => s.reader.backgroundColor);
  const isSettingLocked = useAppStore((s) => s.reader.isSettingLocked);
  const isDockedRight = useAppStore((s) => s.reader.isDockedRight);
  const isAnnotationOpen = useAppStore((s) => s.reader.isAnnotationOpen);
  const handleStudyLangDialog = useAppStore((s) => s.handleStudyLangDialog);
  const handleAssistReadDialog = useAppStore((s) => s.handleAssistReadDialog);
  const handleScalePageDialog = useAppStore((s) => s.handleScalePageDialog);
  const handleSpeechDialog = useAppStore((s) => s.handleSpeechDialog);
  const handleMenuMode = useAppStore((s) => s.handleMenuMode);
  const handleOriginalText = useAppStore((s) => s.handleOriginalText);
  const handleOpenMenu = useAppStore((s) => s.handleOpenMenu);
  const isCompanionOpen = useAppStore((s) => s.reader.isCompanionOpen);
  const handleCompanionPanel = useAppStore((s) => s.handleCompanionPanel);
  const handlePdfTranslationPanel = useAppStore(
    (s) => s.handlePdfTranslationPanel
  );
  const handleReadingState = useAppStore((s) => s.handleReadingState);
  const handleFetchBookmarks = useAppStore((s) => s.handleFetchBookmarks);
  const handleShowBookmark = useAppStore((s) => s.handleShowBookmark);
  const handleSearch = useAppStore((s) => s.handleSearch);
  const handleHtmlBook = useAppStore((s) => s.handleHtmlBook);
  const { t } = useTranslation();
  const [timeLeft, setTimeLeft] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(
    ConfigService.getReaderConfig("isFullscreen") === "yes"
  );
  const timeStampRef = useRef(Date.now());
  const speedRef = useRef(30000);

  const handleFullscreenChange = () => {
    const isNowFullscreen = !!document.fullscreenElement;
    if (!isNowFullscreen) {
      ConfigService.setReaderConfig("isFullscreen", "no");
    }
    setIsFullscreen(isNowFullscreen);
  };

  const handleDisplayBookmark = async () => {
    const book = useAppStore.getState().book.currentBook;
    if (!book?.key) return;
    handleShowBookmark(false);
    let bookLocation: {
      text: string;
      count: string;
      chapterTitle: string;
      chapterDocIndex: string;
      chapterHref: string;
      percentage: string;
      cfi: string;
    } = ConfigService.getObjectConfig(book.key, "recordLocation", {});
    let bookmarks = await DatabaseService.getRecordsByBookKey(
      book.key,
      "bookmarks"
    );
    bookmarks.forEach((item) => {
      if (item.cfi === JSON.stringify(bookLocation)) {
        handleShowBookmark(true);
      }
    });
  };

  const handleScreen = () => {
    const entering = ConfigService.getReaderConfig("isFullscreen") !== "yes";
    entering ? handleFullScreen() : handleExitFullScreen();
    ConfigService.setReaderConfig("isFullscreen", entering ? "yes" : "no");
    setIsFullscreen(entering);
  };

  const handleExit = async () => {
    ConfigService.setReaderConfig("isFullscreen", "no");
    handleReadingState(false);
    handleSearch(false);
    window.speechSynthesis && window.speechSynthesis.cancel();
    TTSUtil.pauseAudio();
    handleExitFullScreen();
    if (useAppStore.getState().reader.htmlBook) {
      handleHtmlBook(null);
    }
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
  };

  const handleAddBookmark = async () => {
    const state = useAppStore.getState();
    const book = state.book.currentBook;
    const htmlBook = state.reader.htmlBook;
    if (!book?.key || !htmlBook) return;
    let bookKey = book.key;
    let bookLocation: BookLocation = ConfigService.getObjectConfig(
      bookKey,
      "recordLocation",
      {}
    );
    let text = bookLocation.text;
    let chapter = bookLocation.chapterTitle;
    let percentage = bookLocation.percentage;
    let isDuplicate = false;
    let bookmarks = await DatabaseService.getRecordsByBookKey(
      bookKey,
      "bookmarks"
    );
    for (let i = 0; i < bookmarks.length; i++) {
      if (
        bookmarks[i].percentage === bookLocation.percentage &&
        bookmarks[i].page === bookLocation.page
      ) {
        isDuplicate = true;
        break;
      }
    }
    if (isDuplicate) {
      toast.error(t("Bookmark already exists"));
      return;
    }

    let cfi = JSON.stringify(bookLocation);
    if (!text) {
      text = (await htmlBook.rendition.visibleText()).join(" ");
    }
    text = text
      .replace(/\s\s/g, "")
      .replace(/\r/g, "")
      .replace(/\n/g, "")
      .replace(/\t/g, "")
      .replace(/\f/g, "");

    let bookmark = new Bookmark(
      bookKey,
      cfi,
      text.substr(0, 200),
      percentage,
      chapter
    );
    await DatabaseService.saveRecord(bookmark, "bookmarks");
    handleFetchBookmarks();
    handleShowBookmark(true);
  };

  useEffect(() => {
    if (!htmlBook) return;
    const rendition = htmlBook.rendition;
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    const onPageChanged = async () => {
      speedRef.current = Date.now() - timeStampRef.current;
      timeStampRef.current = Date.now();
      let pageProgress = await rendition.getProgress();
      setTimeLeft(
        ((pageProgress.totalPage - pageProgress.currentPage) *
          speedRef.current) /
          1000
      );
      handleDisplayBookmark();
    };
    rendition.on("page-changed", onPageChanged);
    return () => {
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
      rendition.off?.("page-changed", onPageChanged);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [htmlBook]);

  const [isMoreOpen, setIsMoreOpen] = useState(false);

  /** 低频工具聚合进「更多」菜单；点击后在「更多」按钮下方打开原有的设置浮层 */
  const moreRef = useRef<HTMLDivElement | null>(null);
  const openDialog =
    (handleDialog: (isOpen: boolean) => void, selector: string) =>
    (event: React.MouseEvent<HTMLDivElement>) => {
      const hover = props.handleDialogButtonHover(handleDialog, selector);
      // 浮层定位到「更多」按钮下方
      hover.onMouseEnter({
        ...event,
        currentTarget: moreRef.current || event.currentTarget,
      } as React.MouseEvent<HTMLDivElement>);
      // 浮层自身在鼠标移出时收起；鼠标一直没移上去时稍后收起
      window.setTimeout(hover.onMouseLeave, 1500);
    };
  const isTextBook = !!currentBook && !isReadingRawPDF(currentBook);
  const moreItems: {
    key: string;
    icon: string;
    label: string;
    onClick: (event: React.MouseEvent<HTMLDivElement>) => void;
  }[] = [
    // 翻译：所有可读文字的书共用一个入口，PDF 的覆盖/侧边对照在同一个浮层里切换
    ...(currentBook
      ? [
          {
            key: "trans",
            icon: "icon-trans",
            label: "Translate",
            onClick: openDialog(
              handleStudyLangDialog,
              ".study-lang-dialog-container"
            ),
          },
        ]
      : []),
    ...(isTextBook
      ? [
          {
            key: "assist",
            icon: "icon-light-bulb",
            label: "Reading modes",
            onClick: openDialog(
              handleAssistReadDialog,
              ".assist-read-dialog-container"
            ),
          },
        ]
      : []),
    ...(readerMode === "scroll" || readerMode === "single"
      ? [
          {
            key: "scale",
            icon: "icon-zoom-in",
            label: "Page width",
            onClick: openDialog(
              handleScalePageDialog,
              ".scale-page-dialog-container"
            ),
          },
        ]
      : []),
    ...(currentBook &&
    isReadingRawPDF(currentBook) &&
    currentBook.description?.indexOf("scanned") > -1
      ? [
          {
            key: "annotation",
            icon: "icon-pen-line",
            label: "Annotation",
            onClick: () => props.handleAnnotationClick(),
          },
        ]
      : []),
    {
      key: "fullscreen",
      icon: "icon-fullscreen-line",
      label: isFullscreen ? "Exit full screen" : "Full screen",
      onClick: () => handleScreen(),
    },
  ];

  const isPaper = isPaperLayout(readerMode, currentBook, isFitPage);
  const showCustomWindowControls =
    props.isSeparateElectronWindow && !props.isMacOS;
  const showMacWindowControls =
    props.isSeparateElectronWindow && props.isMacOS;
  // 独立窗口已有窗口关闭按钮，「退出」与之重复；全屏时窗口按钮会隐藏，仍需保留退出入口
  const showExitButton = !props.isSeparateElectronWindow || isFullscreen;

  return (
    <>
      {showMacWindowControls && (
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 15,
            zIndex: 14,
            display: "flex",
            opacity: props.isNearEdge ? 1 : 0,
            visibility: props.isNearEdge ? "visible" : "hidden",
            transition: "opacity 0.3s ease, visibility 0.3s ease",
            color: ConfigService.getReaderConfig("textColor") || "",
          }}
        >
          <WindowControls t={t} isMacOS={props.isMacOS} />
        </div>
      )}
      {htmlBook && (
        <div
          style={{
            ...DRAG_REGION_STYLE,
            position: "absolute",
            top: 0,
            left:
              props.isMacOS && props.isSeparateElectronWindow ? 125 : 15,
            zIndex: 9,
            height: 28,
            display: "flex",
            alignItems: "flex-start",
            opacity: props.isNearEdge ? 1 : 0,
            visibility: props.isNearEdge ? "visible" : "hidden",
            transition: "opacity 0.3s ease, visibility 0.3s ease",
            color: ConfigService.getReaderConfig("textColor") || "",
          }}
        >
          {showExitButton && (
            <div
              className="reader-setting-icon-container"
              style={props.isNearEdge ? NO_DRAG_REGION_STYLE : undefined}
              aria-label={t("Exit")}
              data-tooltip-id="my-tooltip"
              data-tooltip-content={t("Exit")}
              onClick={() => {
                handleExit();
              }}
            >
              <span
                className="icon-exit reader-setting-icon"
                style={{ fontSize: 18 }}
              ></span>
            </div>
          )}
          <div
            className="reader-setting-icon-container reader-toolbar-bookmark"
            style={props.isNearEdge ? NO_DRAG_REGION_STYLE : undefined}
            aria-label={t("Bookmark")}
            data-tooltip-id="my-tooltip"
            data-tooltip-content={t("Bookmark")}
            onClick={() => {
              handleAddBookmark();
            }}
          >
            <span
              className="icon-bookmark-line reader-setting-icon"
              style={{ fontSize: 19 }}
            ></span>
          </div>
          <span
            className="reader-top-toolbar-time"
            style={{
              ...DRAG_REGION_STYLE,
              height: 28,
              display: "flex",
              alignItems: "center",
              fontSize: 13,
              lineHeight: "28px",
              whiteSpace: "nowrap",
              opacity: 0.9,
              marginTop: 12,
              marginLeft: 12,
            }}
          >
            <Trans
              i18nKey="Current reading time"
              count={Math.floor(
                Math.abs(Math.floor(props.currentDuration / 60))
              )}
            >
              Current reading time:
              {{
                count: Math.abs(Math.floor(props.currentDuration / 60)),
              }}
              min
            </Trans>
            &nbsp;&nbsp;
            <Trans
              i18nKey="Remaining reading time"
              count={Math.ceil(timeLeft / 60)}
            >
              Remaining reading time:
              {{
                count: `${Math.ceil(timeLeft / 60)}`,
              }}
              min
            </Trans>
          </span>
        </div>
      )}

      <div
        className={
          "reader-quick-buttons reader-side-rail" +
          (props.isNearEdge || props.isSideRailShown ? " is-active" : "") +
          (isPaper ? " is-paper" : "")
        }
        onMouseEnter={props.showSideRail}
        onMouseLeave={props.hideSideRail}
        style={{
          right:
            (isSettingLocked || isDockedRight
              ? getRightPanelInset(isSettingLocked, isDockedRight)
              : 0) + 20,
          color: ConfigService.getReaderConfig("textColor") || "",
          ["--rail-bg" as string]: readerBackgroundColor,
        }}
      >
        <div
          className="reader-setting-icon-container"
          aria-label={t("Content")}
          data-tooltip-id="my-tooltip"
          data-tooltip-content={t("Content")}
          data-tooltip-place="left"
          onClick={() => props.handleEnterReader("left")}
        >
          <span
            className="icon-list reader-setting-icon"
            style={{ fontSize: 18 }}
          ></span>
        </div>
        <div
          className="reader-setting-icon-container"
          aria-label={t("Setting")}
          data-tooltip-id="my-tooltip"
          data-tooltip-content={t("Setting")}
          data-tooltip-place="left"
          onClick={() => props.handleEnterReader("right")}
        >
          <span
            className="icon-font reader-setting-icon"
            style={{ fontSize: 18 }}
          ></span>
        </div>
        <div
          className="reader-setting-icon-container"
          {...props.handleDialogButtonHover(
            handleSpeechDialog,
            ".speech-dialog-container"
          )}
        >
          <span
            className={`icon-earphone-line reader-setting-icon`}
            style={{ fontSize: 19 }}
          ></span>
        </div>

        <div
          className="reader-setting-icon-container"
          aria-label={t("Reading Assistant")}
          data-tooltip-id="my-tooltip"
          data-tooltip-content={t("Reading Assistant")}
          data-tooltip-place="left"
          onClick={async () => {
            if (!htmlBook) return;
            handleMenuMode("assistant");
            handleOriginalText(await htmlBook.rendition.chapterText());
            handleOpenMenu(true);
          }}
        >
          <span
            className={`icon-star-line reader-setting-icon`}
            style={{ fontSize: 19 }}
          ></span>
        </div>
        {isElectron && (
          <div
            className="reader-setting-icon-container"
            aria-label={t("Reading Companion")}
            data-tooltip-id="my-tooltip"
            data-tooltip-content={t("Reading Companion")}
            data-tooltip-place="left"
            onClick={() => {
              handlePdfTranslationPanel(false);
              handleCompanionPanel(!isCompanionOpen);
            }}
          >
            <span
              className={`icon-highlight-line reader-setting-icon`}
              style={{ fontSize: 19 }}
            ></span>
          </div>
        )}
        <div
          ref={moreRef}
          className="reader-setting-icon-container reader-more-container"
          aria-label={t("More")}
          onMouseEnter={() => setIsMoreOpen(true)}
          onMouseLeave={() => setIsMoreOpen(false)}
        >
          <span
            className="icon-more reader-setting-icon"
            style={{ fontSize: 19 }}
          ></span>
          {isMoreOpen && (
            <div className="sort-dialog-container reader-more-menu">
              {moreItems.map((item) => (
                <div
                  key={item.key}
                  className="reader-more-item"
                  onClick={(event) => {
                    event.stopPropagation();
                    setIsMoreOpen(false);
                    item.onClick(event);
                  }}
                >
                  <span
                    className={item.icon + " reader-more-item-icon"}
                  ></span>
                  {t(item.label)}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      {showCustomWindowControls && (
        <div
          className="reader-quick-buttons"
          onMouseEnter={props.showQuickButtons}
          onMouseLeave={props.hideQuickButtons}
          style={{
            position: "absolute",
            top: 0,
            right:
              isSettingLocked || isDockedRight
                ? getRightPanelInset(isSettingLocked, isDockedRight)
                : 15,
            zIndex: 14,
            display: "flex",
            opacity: props.isNearEdge ? 1 : 0,
            transition: "opacity 0.3s ease, right 0.3s cubic-bezier(0.22, 1, 0.36, 1)",
            color: ConfigService.getReaderConfig("textColor") || "",
          }}
        >
          <WindowControls t={t} isMacOS={props.isMacOS} />
        </div>
      )}
    </>
  );
};

export default ReaderTopToolbar;
