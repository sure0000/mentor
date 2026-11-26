import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router-dom";
import { useEffect, useRef, useState } from "react";
import "./header.css";
import SearchBox from "../../components/searchBox";
import ImportLocal from "../../components/importLocal";
import AccountButton from "../../components/accountButton";
import {
  ConfigService,
  KookitConfig,
  CollectionUtil,
} from "../../assets/lib/kookit-extra-browser.min";
import { generateSnapshot } from "../../utils/file/backup";
import { isElectron } from "react-device-detect";
import {
  getCloudConfig,
  upgradeConfig,
  upgradeStorage,
} from "../../utils/file/common";
import toast from "react-hot-toast";
import { Trans } from "react-i18next";
import { SyncHelper } from "../../assets/lib/kookit-extra-browser.min";
import ConfigUtil from "../../utils/file/configUtil";
import DatabaseService from "../../utils/storage/databaseService";
import CoverUtil from "../../utils/file/coverUtil";
import BookUtil from "../../utils/file/bookUtil";
import {
  checkBrokenDatabase,
  checkMissingBook,
  getTaskStats,
  showTaskProgress,
} from "../../utils/common";
import { driveList } from "../../constants/driveList";
import TokenService from "../../utils/storage/tokenService";
import { removeUnsupportedSyncSources } from "../../utils/request/thirdparty";
import { useAppStore } from "../../store/useAppStore";
import mentorMarkDark from "../../assets/images/mentor-mark-dark.png";
import mentorMarkLight from "../../assets/images/mentor-mark-light.png";

export interface HeaderProps {
  handleDrag: (isDrag: boolean) => void;
}

export interface HeaderState {
  isSync: boolean;
}

const collectionUtil = new CollectionUtil(ConfigService);
declare var window: any;

const Header = (props: HeaderProps) => {
  const currentBook = useAppStore((s) => s.book.currentBook);
  const handleSetting = useAppStore((s) => s.handleSetting);
  const handleShelf = useAppStore((s) => s.handleShelf);
  const handleLoginDialog = useAppStore((s) => s.handleLoginDialog);
  const handleSettingMode = useAppStore((s) => s.handleSettingMode);
  const handleAbout = useAppStore((s) => s.handleAbout);
  const handleFetchBooks = useAppStore((s) => s.handleFetchBooks);
  const handleFetchNotes = useAppStore((s) => s.handleFetchNotes);
  const handleFetchBookmarks = useAppStore((s) => s.handleFetchBookmarks);
  const handleFetchDefaultSyncOption = useAppStore(
    (s) => s.handleFetchDefaultSyncOption
  );
  const handleFetchDataSourceList = useAppStore(
    (s) => s.handleFetchDataSourceList
  );
  const handleCloudSyncFunc = useAppStore((s) => s.handleCloudSyncFunc);
  const handleReadingBook = useAppStore((s) => s.handleReadingBook);
  const handleCollectionDetailDialog = useAppStore(
    (s) => s.handleCollectionDetailDialog
  );
  const handleCurrentCollectionKey = useAppStore(
    (s) => s.handleCurrentCollectionKey
  );
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const isStore = location.pathname.startsWith("/manager/store");
  const [state, setState] = useState<HeaderState>({
    isSync: false,
  });

  const timerRef = useRef<any>(null);
  const scheduledSyncTimerRef = useRef<any>(null);
  const isSyncingRef = useRef<boolean>(false);
  const isSyncRef = useRef<boolean>(false);
  const readingFinishedHandlerRef = useRef<((config?: any) => void) | null>(
    null
  );
  const handleCloudSyncRef = useRef<() => Promise<false | undefined>>(
    async () => undefined
  );
  const handleFinishReadingRef = useRef<() => Promise<void>>(
    async () => undefined
  );
  const setIsSync = (value: boolean) => {
    isSyncRef.current = value;
    setState((prevState) => ({ ...prevState, isSync: value }));
  };

  const startScheduledSync = () => {
    if (scheduledSyncTimerRef.current) {
      clearInterval(scheduledSyncTimerRef.current);
      scheduledSyncTimerRef.current = null;
    }
    const intervalMinutes = parseInt(
      ConfigService.getReaderConfig("scheduledSyncInterval") || "0"
    );
    if (!intervalMinutes || intervalMinutes <= 0) {
      return;
    }
    const intervalMs = intervalMinutes * 60 * 1000;
    scheduledSyncTimerRef.current = setInterval(async () => {
      const currentInterval = parseInt(
        ConfigService.getReaderConfig("scheduledSyncInterval") || "0"
      );
      if (!currentInterval || currentInterval <= 0) {
        clearInterval(scheduledSyncTimerRef.current);
        scheduledSyncTimerRef.current = null;
        return;
      }
      const defaultSyncOption = ConfigService.getItem("defaultSyncOption");
      if (
        !defaultSyncOption ||
        ConfigService.getReaderConfig("isDisableAutoSync") === "yes"
      ) {
        return;
      }
      if (!isSyncRef.current && !isSyncingRef.current) {
        await handleCloudSyncRef.current();
      }
    }, intervalMs);
  };

  const handleOpenLastReadBook = async () => {
    let filePath = "";
    //open book when app start
    if (isElectron) {
      const ipcRenderer = window.electronAPI;
      filePath = ipcRenderer.sendSync("check-file-data");
    }
    if (
      ConfigService.getReaderConfig("isOpenBook") === "yes" &&
      !currentBook.key &&
      !filePath
    ) {
      let lastReadBookKey = ConfigService.getAllListConfig("recentBooks")[0];
      if (lastReadBookKey) {
        let collectionKey = collectionUtil.isCollection(lastReadBookKey)
          ? lastReadBookKey
          : collectionUtil.getActiveCollectionByBook(lastReadBookKey)?.key;
        if (collectionKey) {
          let collection = collectionUtil.getCollection(collectionKey);
          if (collection) {
            handleReadingBook(
              collectionUtil.getCollectionAsBook(collection)
            );
            handleCurrentCollectionKey(collectionKey);
            handleCollectionDetailDialog(true);
            return;
          }
        }
        let fullBook = await DatabaseService.getRecord(
          lastReadBookKey,
          "books"
        );
        if (fullBook) {
          handleReadingBook(fullBook);
          BookUtil.redirectBook(fullBook);
        }
      }
    }
  };

  const handleFinishReading = async () => {
    if (
      ConfigService.getReaderConfig("isDisableAutoSync") !== "yes" &&
      ConfigService.getItem("defaultSyncOption") &&
      !isSyncRef.current
    ) {
      ConfigService.setItem("isFinshReading", "yes");
      setIsSync(true);
      await handleCloudSync();
      ConfigService.setItem("isFinshReading", "no");
    }
  };

  const handleFinishUpgrade = () => {
    handleFetchBooks();
    setTimeout(() => {
      if (useAppStore.getState().sidebar.mode === "home") {
        navigate("/manager/home");
      }
    }, 2000);
  };

  const beforeSync = async () => {
    if (!ConfigService.getItem("defaultSyncOption")) {
      toast(t("Sign in to sync your library"));
      handleLoginDialog(true);
      return false;
    }
    let config = await getCloudConfig(
      ConfigService.getItem("defaultSyncOption") || ""
    );
    if (Object.keys(config).length === 0) {
      toast.error(t("Cannot get sync config"));
      return false;
    }
    await checkMissingBook();
    let checkResult = await checkBrokenDatabase();
    if (checkResult) {
      toast.error(
        t(
          "Broken data detected, please click the setting button to reset the sync records"
        )
      );
      return false;
    }
    {
      if (ConfigService.getReaderConfig("hideSyncProgress") !== "yes") {
        toast.loading(
          t("Start syncing") +
            " (" +
            t(
              driveList.find(
                (item) =>
                  item.value === ConfigService.getItem("defaultSyncOption")
              )?.label || ""
            ) +
            ")",
          { id: "syncing", position: "bottom-center" }
        );
      }
    }

    return true;
  };

  const getCompareResult = async () => {
    let localSyncRecords = ConfigService.getAllSyncRecord();
    let cloudSyncRecords = await ConfigUtil.getCloudConfig("sync");
    return await SyncHelper.compareAll(
      localSyncRecords,
      cloudSyncRecords,
      ConfigService,
      TokenService,
      ConfigUtil
    );
  };

  const handleSyncStateChange = (isSyncing: boolean) => {
    setIsSync(isSyncing);
  };

  const handleCloudSync = async (): Promise<false | undefined> => {
    if (isSyncingRef.current) {
      console.info("Sync already in progress, skipping...");
      return false;
    }
    isSyncingRef.current = true;

    try {
      timerRef.current = await showTaskProgress(handleSyncStateChange);
      if (!timerRef.current) {
        setIsSync(false);
        return false;
      }

      let res = await beforeSync();
      if (!res) {
        clearInterval(timerRef.current);
        setIsSync(false);
        return false;
      }
      let compareResult = await getCompareResult();
      await handleSync(compareResult);
      clearInterval(timerRef.current);
      setIsSync(false);
    } catch (error) {
      console.error(error);
      toast.error(
        t("Sync failed") +
          ": " +
          (error instanceof Error ? error.message : String(error))
      );
      clearInterval(timerRef.current);
      setIsSync(false);
      return false;
    } finally {
      isSyncingRef.current = false;
    }
    setTimeout(() => {
      toast.dismiss("syncing");
    }, 3000);
    return;
  };

  const handleSuccess = async () => {
    if (ConfigService.getItem("isFinshReading") !== "yes" || !isElectron) {
      handleFetchBooks();
    }

    handleFetchBookmarks();
    handleFetchNotes();

    if (ConfigService.getReaderConfig("hideSyncProgress") !== "yes") {
      toast.success(t("Synchronisation successful"), {
        id: "syncing",
      });
    }

    if (
      ConfigService.getItem("defaultSyncOption") === "adrive" &&
      ConfigService.getReaderConfig("hasShowAliyunWarning") !== "yes"
    ) {
      ConfigService.setReaderConfig("hasShowAliyunWarning", "yes");
      toast.success(
        t(
          "We have bypassed the synchronization of book cover for Aliyun Drive, covers will be downloaded automatically when you open the book next time."
        ),
        {
          duration: 4000,
        }
      );
    }
    //when book is empty, need to refresh the book list
    setTimeout(() => {
      if (useAppStore.getState().sidebar.mode === "home") {
        navigate("/manager/home");
      }
    }, 1000);
  };

  const handleSync = async (compareResult) => {
    try {
      let tasks = await SyncHelper.startSync(
        compareResult,
        ConfigService,
        DatabaseService,
        ConfigUtil,
        BookUtil,
        CoverUtil
      );
      await SyncHelper.runTasksWithLimit(
        tasks,
        99,
        ConfigService.getItem("defaultSyncOption")
      );

      clearInterval(timerRef.current);
      setIsSync(false);
      let stats = await getTaskStats();
      if (stats.hasFailedTasks) {
        toast.error(
          t(
            "Tasks failed after multiple retries, please check the network connection or reauthorize the data source in the settings"
          ),
          {
            id: "syncing",
            duration: 6000,
          }
        );
        return;
      }
      if (ConfigService.getReaderConfig("hideSyncProgress") !== "yes") {
        toast.loading(t("Almost finished"), {
          id: "syncing",
          position: "bottom-center",
        });
      }
      await handleSuccess();
    } catch (error) {
      console.error(error);
      clearInterval(timerRef.current);
      setIsSync(false);
      toast.error(
        t("Sync failed") +
          ": " +
          (error instanceof Error ? error.message : String(error))
      );

      return;
    }
  };

  handleCloudSyncRef.current = handleCloudSync;
  handleFinishReadingRef.current = handleFinishReading;

  useEffect(() => {
    let visibilityHandler: (() => Promise<void>) | null = null;
    const registeredIpcHandlers: [string, (...args: any[]) => any][] = [];

    const init = async () => {
      if (isElectron) {
        try {
          await generateSnapshot();
        } catch (error) {
          console.error("Failed to generate snapshot:", error);
        }
      }
      await removeUnsupportedSyncSources();
      handleFetchDefaultSyncOption();
      handleFetchDataSourceList();
      if (isElectron) {
        const fs = window.electronAPI.fs;
        const path = window.electronAPI.path;
        const ipcRenderer = window.electronAPI;
        const dirPath = ipcRenderer.sendSync("user-data", "ping");
        if (!fs.existsSync(dirPath)) {
          fs.mkdirSync(path.join(dirPath, "data", "book"), { recursive: true });
        }

        if (
          ConfigService.getReaderConfig("storageLocation") &&
          !ConfigService.getItem("storageLocation")
        ) {
          ConfigService.setItem(
            "storageLocation",
            ConfigService.getReaderConfig("storageLocation")
          );
        }

        //Check for data update
        //upgrade data from old version
        let res1 = await upgradeStorage(handleFinishUpgrade);
        let res2 = await upgradeConfig();
        if (!res1 || !res2) {
          console.error("upgrade failed");
        }

        const readingFinishedHandler = async () => {
          await handleFinishReadingRef.current();
        };
        const openBookFromLinkHandler = async (config: any) => {
          const book = await DatabaseService.getRecord(config.bookKey, "books");
          if (book) {
            BookUtil.redirectBook(book);
          }
        };
        const openNoteFromLinkHandler = async (config: any) => {
          const note = await DatabaseService.getRecord(config.noteKey, "notes");
          if (!note) return;
          const book = await DatabaseService.getRecord(note.bookKey, "books");
          if (!book) return;
          let bookLocation: any = {};
          try {
            bookLocation = JSON.parse(note.cfi) || {};
          } catch (error) {
            bookLocation.cfi = note.cfi;
            bookLocation.chapterTitle = note.chapter;
          }
          if (bookLocation.fingerprint) {
            bookLocation.chapterDocIndex = bookLocation.page - 1 + "";
            bookLocation.chapterHref = "title" + (bookLocation.page - 1);
          }
          ConfigService.setObjectConfig(
            note.bookKey,
            bookLocation,
            "recordLocation"
          );
          BookUtil.redirectBook(book);
        };
        readingFinishedHandlerRef.current = readingFinishedHandler;
        registeredIpcHandlers.push(
          ["reading-finished", readingFinishedHandler],
          ["open-book-from-link", openBookFromLinkHandler],
          ["open-note-from-link", openNoteFromLinkHandler]
        );
        for (const [channel, handler] of registeredIpcHandlers) {
          ipcRenderer.on(channel, handler);
        }
      } else {
        await upgradeConfig();
      }
      handleCloudSyncFunc(async () => {
        await handleCloudSyncRef.current();
      });
      visibilityHandler = async () => {
        if (
          document.visibilityState === "visible" &&
          !isElectron &&
          ConfigService.getReaderConfig("isFinishWebReading") === "yes"
        ) {
          await handleFinishReadingRef.current();
          // ConfigService.setReaderConfig("isFinishWebReading", "no");
        }
      };
      document.addEventListener("visibilitychange", visibilityHandler);
      let willAutoSync =
        ConfigService.getReaderConfig("isDisableAutoSync") !== "yes" &&
        ConfigService.getItem("defaultSyncOption");
      if (willAutoSync) {
        // 原先登录 Pro 后才会自动同步；二开后只要配置了 iCloud 就启动时同步
        setIsSync(true);
        await handleCloudSyncRef.current();
      }
      await handleOpenLastReadBook();
      startScheduledSync();
    };
    init();

    return () => {
      if (scheduledSyncTimerRef.current) {
        clearInterval(scheduledSyncTimerRef.current);
        scheduledSyncTimerRef.current = null;
      }
      if (isElectron && readingFinishedHandlerRef.current) {
        const ipcRenderer = window.electronAPI;
        ipcRenderer.removeListener(
          "reading-finished",
          readingFinishedHandlerRef.current
        );
        readingFinishedHandlerRef.current = null;
        for (const [channel, handler] of registeredIpcHandlers) {
          if (channel === "reading-finished") continue;
          ipcRenderer.removeListener(channel, handler);
        }
      }
      if (visibilityHandler) {
        document.removeEventListener("visibilitychange", visibilityHandler);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isNightSkin =
    ConfigService.getReaderConfig("appSkin") === "night" ||
    (ConfigService.getReaderConfig("appSkin") === "system" &&
      ConfigService.getReaderConfig("isOSNight") === "yes");
  return (
    <div className="header">
      <div className="header-brand">
        <img
          src={isNightSkin ? mentorMarkDark : mentorMarkLight}
          alt=""
          className="header-brand-mark"
        />
        <span className="header-brand-name">Mentor</span>
      </div>
      <nav className="header-nav">
        <span
          className={"header-nav-item" + (isStore ? "" : " is-active")}
          onClick={() => {
            handleShelf("");
            navigate("/manager/home");
          }}
        >
          {t("Shelf")}
        </span>
        <span
          className={"header-nav-item" + (isStore ? " is-active" : "")}
          onClick={() => navigate("/manager/store")}
        >
          {t("Book store")}
        </span>
      </nav>
      {/* 书城有自己的搜索框，书库搜索只在书架页显示 */}
      {!isStore && location.pathname !== "/manager/want-to-read" && (
        <div className="header-search-container">
          <SearchBox />
        </div>
      )}
      <div className="setting-icon-parrent">
        <div
          className="setting-icon-container"
          onClick={() => {
            navigate("/stats");
          }}
        >
          <span
            data-tooltip-id="my-tooltip"
            data-tooltip-content={t("Reading Stats")}
            data-tooltip-place="bottom"
          >
            <span
              className="icon-chart setting-icon"
              style={{ fontSize: "20px" }}
            ></span>
          </span>
        </div>
        <div
          className="setting-icon-container"
          onClick={() => {
            handleSetting(true);
            handleAbout(false);
          }}
          onMouseLeave={() => {
            handleAbout(false);
          }}
          style={{ marginTop: "2px" }}
        >
          <span
            data-tooltip-id="my-tooltip"
            data-tooltip-content={t("Setting")}
            data-tooltip-place="left"
          >
            <span
              className="icon-setting setting-icon"
              style={{ fontSize: "25px" }}
            ></span>
          </span>
        </div>
        <div
          className="setting-icon-container"
          onClick={async () => {
            const hasCloud = !!ConfigService.getItem("defaultSyncOption");
            if (!hasCloud) {
              toast(t("Sign in to sync your library"));
              handleLoginDialog(true);
              return;
            }
            setIsSync(true);
            await handleCloudSync();
          }}
          style={{ marginTop: "2px" }}
        >
          <span
            data-tooltip-id="my-tooltip"
            data-tooltip-content={t("Sync")}
            data-tooltip-place="left"
          >
            <span
              className={
                "icon-sync setting-icon" + (state.isSync ? " icon-rotate" : "")
              }
              style={{ fontSize: "25px" }}
            ></span>
          </span>
        </div>
      </div>

      <div className="header-account">
        <AccountButton />
      </div>

      {KookitConfig.CloudMode !== "production" ? (
        <div className="header-report-container" style={{ right: "300px" }}>
          <span
            style={{
              color: "red",
              opacity: 1,
              fontWeight: "bold",
            }}
          >
            <Trans>TEST</Trans>
            <span> </span>
          </span>
        </div>
      ) : null}

      <ImportLocal
        {...({
          handleDrag: props.handleDrag,
        } as any)}
      />
    </div>
  );
};

export default Header;
