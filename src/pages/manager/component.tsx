import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { useEffect, useRef, useState } from "react";
import "./manager.css";
import Header from "../../containers/header";
import DeleteDialog from "../../components/dialogs/deleteDialog";
import EditDialog from "../../components/dialogs/editDialog";
import AddDialog from "../../components/dialogs/addDialog";
import { Trans } from "react-i18next";
import SettingDialog from "../../components/dialogs/settingDialog";
import LoginDialog from "../../components/dialogs/loginDialog";
import { Route, Routes } from "react-router-dom";
import { routes } from "../../router/routes";
import LoadingDialog from "../../components/dialogs/loadingDialog";
import { Toaster } from "react-hot-toast";
import DetailDialog from "../../components/dialogs/detailDialog";
import { Tooltip } from "react-tooltip";
import {
  ConfigService,
  CollectionUtil,
} from "../../assets/lib/kookit-extra-browser.min";
import CollectionDialog from "../../components/dialogs/collectionDialog";
import CollectionDetailDialog from "../../components/dialogs/collectionDetailDialog";
import AddCollectionDialog from "../../components/dialogs/addCollectionDialog";
import PopupNote from "../../components/popups/popupNote";
import toast from "react-hot-toast";
import { supportedFormats } from "../../utils/common";
import {
  isBookDragEvent,
  isExternalFileDragEvent,
} from "../../utils/reader/bookDrag";
import Footer from "../../components/footer";
import { useAppStore } from "../../store/useAppStore";

const collectionUtil = new CollectionUtil(ConfigService);

export interface ManagerState {
  totalBooks: number;
  isDrag: boolean;
}

const Manager = () => {
  const books = useAppStore((s) => s.manager.books);
  const isShowPopupNote = useAppStore((s) => s.manager.isShowPopupNote);
  const importBookFunc = useAppStore((s) => s.book.importBookFunc);
  const cloudSyncFunc = useAppStore((s) => s.book.cloudSyncFunc);
  const isSettingOpen = useAppStore((s) => s.manager.isSettingOpen);
  const isLoginOpen = useAppStore((s) => s.manager.isLoginOpen);
  const isOpenDeleteDialog = useAppStore((s) => s.book.isOpenDeleteDialog);
  const isOpenDissolveDialog = useAppStore(
    (s) => s.book.isOpenDissolveDialog
  );
  const currentBook = useAppStore((s) => s.book.currentBook);
  const isOpenEditDialog = useAppStore((s) => s.book.isOpenEditDialog);
  const isDetailDialog = useAppStore((s) => s.manager.isDetailDialog);
  const isOpenAddDialog = useAppStore((s) => s.book.isOpenAddDialog);
  const isOpenCollectionDialog = useAppStore(
    (s) => s.collection.isOpenCollectionDialog
  );
  const isOpenCollectionDetailDialog = useAppStore(
    (s) => s.collection.isOpenCollectionDetailDialog
  );
  const isOpenAddCollectionDialog = useAppStore(
    (s) => s.collection.isOpenAddCollectionDialog
  );
  const isShowLoading = useAppStore((s) => s.manager.isShowLoading);
  const handleFetchBooks = useAppStore((s) => s.handleFetchBooks);
  const handleFetchPlugins = useAppStore((s) => s.handleFetchPlugins);
  const handleFetchNotes = useAppStore((s) => s.handleFetchNotes);
  const handleFetchBookmarks = useAppStore((s) => s.handleFetchBookmarks);
  const handleFetchBookSortCode = useAppStore(
    (s) => s.handleFetchBookSortCode
  );
  const handleFetchNoteSortCode = useAppStore(
    (s) => s.handleFetchNoteSortCode
  );
  const handleFetchViewMode = useAppStore((s) => s.handleFetchViewMode);
  const handleReadingState = useAppStore((s) => s.handleReadingState);
  const handleMode = useAppStore((s) => s.handleMode);
  const handleEditDialog = useAppStore((s) => s.handleEditDialog);
  const handleDeleteDialog = useAppStore((s) => s.handleDeleteDialog);
  const handleDissolveDialog = useAppStore((s) => s.handleDissolveDialog);
  const handleAddDialog = useAppStore((s) => s.handleAddDialog);
  const handleDetailDialog = useAppStore((s) => s.handleDetailDialog);
  const handleLoadingDialog = useAppStore((s) => s.handleLoadingDialog);
  const handleShowPopupNote = useAppStore((s) => s.handleShowPopupNote);
  const handleSetting = useAppStore((s) => s.handleSetting);
  const handleCollectionDialog = useAppStore((s) => s.handleCollectionDialog);
  const handleCollectionDetailDialog = useAppStore(
    (s) => s.handleCollectionDetailDialog
  );
  const handleAddCollectionDialog = useAppStore(
    (s) => s.handleAddCollectionDialog
  );
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [state, setState] = useState<ManagerState>({
    totalBooks: parseInt(ConfigService.getReaderConfig("totalBooks")) || 0,
    isDrag: false,
  });
  const isDraggingFromAppRef = useRef(false);
  const prevBooksRef = useRef(books);

  const handleDrag = (isDrag: boolean) => {
    setState((prev) => ({ ...prev, isDrag }));
  };

  const handleDissolveConfirm = () => {
    if (!currentBook?.key) return;
    collectionUtil.dissolveCollection(currentBook.key);
    handleFetchBooks();
  };

  const handleDocumentDragStart = (e: DragEvent) => {
    if (isBookDragEvent(e)) {
      isDraggingFromAppRef.current = true;
    }
  };
  const handleDocumentDragEnd = () => {
    if (isDraggingFromAppRef.current) {
      handleDrag(false);
    }
    isDraggingFromAppRef.current = false;
  };
  const handleExternalDragEnter = (e: DragEvent) => {
    if (isExternalFileDragEvent(e)) {
      handleDrag(true);
    }
  };

  useEffect(() => {
    handleFetchBooks();
    handleFetchPlugins();
    handleFetchNotes();
    handleFetchBookmarks();
    handleFetchBookSortCode();
    handleFetchNoteSortCode();
    handleFetchViewMode();

    handleReadingState(false);
    document.addEventListener("dragstart", handleDocumentDragStart, true);
    document.addEventListener("dragend", handleDocumentDragEnd, true);
    document.addEventListener("dragenter", handleExternalDragEnter, true);
    return () => {
      document.removeEventListener(
        "dragstart",
        handleDocumentDragStart,
        true
      );
      document.removeEventListener("dragend", handleDocumentDragEnd, true);
      document.removeEventListener(
        "dragenter",
        handleExternalDragEnter,
        true
      );
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const prevBooks = prevBooksRef.current;
    if (books && state.totalBooks !== books.length) {
      const totalBooks = books.length;
      setState((prev) =>
        prev.totalBooks === totalBooks ? prev : { ...prev, totalBooks }
      );
      ConfigService.setReaderConfig("totalBooks", totalBooks.toString());
    }
    if (books && books.length === 1 && !prevBooks) {
      navigate("/manager/home");
    }
    prevBooksRef.current = books;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [books]);

  const PopupProps = {
    chapterDocIndex: 0,
    chapter: "test",
  };
  return (
    <div
      className="manager no-sidebar"
      onDragEnter={(e) => {
        if (isExternalFileDragEvent(e)) {
          handleDrag(true);
        }
      }}
    >
      <Tooltip id="my-tooltip" style={{ zIndex: 25 }} />
      {isShowPopupNote && (
        <div
          className="popup-box-container"
          style={{
            marginLeft: 0,
            height: "360px",
          }}
        >
          <PopupNote {...(PopupProps as any)} />
        </div>
      )}

      <div
        className={`drag-background${state.isDrag ? " drag-active" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
        onDrop={async (e) => {
          e.preventDefault();
          e.stopPropagation();
          handleDrag(false);
          const collectFiles = (entry: FileSystemEntry): Promise<File[]> => {
            return new Promise((resolve) => {
              if (entry.isFile) {
                (entry as FileSystemFileEntry).file(
                  (file) => resolve([file]),
                  () => resolve([])
                );
              } else if (entry.isDirectory) {
                const reader = (
                  entry as FileSystemDirectoryEntry
                ).createReader();
                const readAll = (
                  collected: FileSystemEntry[] = []
                ): Promise<FileSystemEntry[]> =>
                  new Promise((res) => {
                    reader.readEntries(
                      (results) => {
                        if (results.length === 0) {
                          res(collected);
                        } else {
                          readAll([...collected, ...Array.from(results)]).then(
                            res
                          );
                        }
                      },
                      () => res(collected)
                    );
                  });
                readAll().then((entries) =>
                  Promise.all(entries.map(collectFiles)).then((arrays) =>
                    resolve(([] as File[]).concat(...arrays))
                  )
                );
              } else {
                resolve([]);
              }
            });
          };
          const items = e.dataTransfer.items;
          let allFiles: File[] = [];
          if (items && items.length > 0) {
            const entries: FileSystemEntry[] = [];
            for (let i = 0; i < items.length; i++) {
              const entry = items[i].webkitGetAsEntry();
              if (entry) entries.push(entry);
            }
            const fileArrays = await Promise.all(entries.map(collectFiles));
            allFiles = ([] as File[]).concat(...fileArrays);
          }
          for (const file of allFiles) {
            const ext = "." + file.name.split(".").pop()?.toLowerCase();
            if (!supportedFormats.includes(ext)) {
              toast.error(t("Unsupported file format") + ": " + ext);
              continue;
            }
            await importBookFunc(file);
          }
          if (
            ConfigService.getReaderConfig("isDisableAutoSync") !== "yes" &&
            ConfigService.getItem("defaultSyncOption")
          ) {
            await cloudSyncFunc();
          }
        }}
        onClick={() => {
          handleEditDialog(false);
          handleDeleteDialog(false);
          handleDissolveDialog(false);
          handleAddDialog(false);
          handleDetailDialog(false);
          handleLoadingDialog(false);
          handleShowPopupNote(false);
          handleSetting(false);
          handleCollectionDialog(false);
          handleCollectionDetailDialog(false);
          handleAddCollectionDialog(false);
          handleDrag(false);
        }}
        style={
          isSettingOpen ||
          isOpenDeleteDialog ||
          isOpenDissolveDialog ||
          isOpenEditDialog ||
          isDetailDialog ||
          isShowPopupNote ||
          isOpenAddDialog ||
          isOpenCollectionDialog ||
          isOpenCollectionDetailDialog ||
          isOpenAddCollectionDialog ||
          isShowLoading ||
          state.isDrag
            ? {}
            : {
                display: "none",
              }
        }
      >
        {state.isDrag && (
          <div className="drag-info">
            <p className="arrow-text">
              <Trans>Drop your books here</Trans>
            </p>
          </div>
        )}
      </div>
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
      <Header {...({ handleDrag: handleDrag } as any)} />
      {isOpenDeleteDialog && <DeleteDialog />}
      {isOpenDissolveDialog && (
        <DeleteDialog
          name={currentBook.name}
          title="Dissolve collection"
          description="The collection will be removed and all books will be kept in your library."
          confirmText="Dissolve"
          successText="Dissolve successful"
          handleClose={() => handleDissolveDialog(false)}
          handleConfirm={handleDissolveConfirm}
        />
      )}
      {isOpenEditDialog && <EditDialog />}
      {isOpenAddDialog && <AddDialog />}
      {isShowLoading && <LoadingDialog />}
      {isSettingOpen && <SettingDialog />}
      {isLoginOpen && <LoginDialog />}
      {isDetailDialog && <DetailDialog />}
      {isOpenCollectionDialog && <CollectionDialog />}
      {isOpenCollectionDetailDialog && <CollectionDetailDialog />}
      {isOpenAddCollectionDialog && <AddCollectionDialog />}
      {(!books || books.length === 0) && state.totalBooks ? null : (
        <Routes>
          {routes.map((ele) => (
            <Route
              element={<ele.component />}
              key={ele.path}
              path={ele.path}
            />
          ))}
        </Routes>
      )}
      <Footer />
    </div>
  );
};
export default Manager;
