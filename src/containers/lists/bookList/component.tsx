import { useLatest } from "../../../utils/hooks/useLatest";
import { useTranslation } from "react-i18next";
import React, { useEffect, useRef, useState } from "react";
import "./booklist.css";
import { CollectionCoverGrid } from "../../../components/collectionCover/component";
import BookCardItem from "../../../components/bookCardItem";
import CollectionItem from "../../../components/collectionItem";
import BookModel from "../../../models/Book";
import {
  ConfigService,
  CollectionUtil,
} from "../../../assets/lib/kookit-extra-browser.min";
import { Link, Navigate } from "react-router-dom";
import SelectBook from "../../../components/selectBook";
import Book from "../../../models/Book";
import { isElectron } from "react-device-detect";
import DatabaseService from "../../../utils/storage/databaseService";
import { throttle } from "../../../utils/common";
import ShelfCategoryItem from "../../../components/shelfCategoryItem";
import ContinueReading from "../../../components/continueReading";
import SortDialog from "../../../components/dialogs/sortBookDialog";
import {
  createCategory,
  getCategoryBookKeys,
  getCategoryList,
  moveBooksToCategory,
  sanitizeCategoryName,
  validateCategoryName,
} from "../../../utils/reader/shelfUtil";
import {
  isBookDragEvent,
  parseBookDragData,
} from "../../../utils/reader/bookDrag";
import toast from "react-hot-toast";
import { useAppStore } from "../../../store/useAppStore";

export interface BookListState {
  displayedBooksCount: number;
  isLoadingMore: boolean;
  fullBooksData: BookModel[];
  cardScale: number;
  readingStatusFilter: string;
  isCreatingCategory: boolean;
  newCategoryName: string;
  isBackDropTarget: boolean;
}

const collectionUtil = new CollectionUtil(ConfigService);
declare var window: any;
let currentBookMode = "home";
function getBookCountPerPage() {
  const container = document.querySelector(
    ".book-list-container"
  ) as HTMLElement;
  if (!container) return 24; // fallback
  const containerWidth = container.clientWidth;
  const containerHeight = container.clientHeight;
  const bookWidth = 145;
  const bookHeight = 230;
  const columns = Math.max(1, Math.floor(containerWidth / bookWidth));
  const rows = Math.max(1, Math.floor(containerHeight / bookHeight)) + 2;
  return columns * rows;
}

const BookList = () => {
  const books = useAppStore((s) => s.manager.books);
  const wantedBooks = useAppStore((s) => s.manager.wantedBooks);
  const wantedCount = wantedBooks.length;
  const mode = useAppStore((s) => s.sidebar.mode);
  const selectedBooks = useAppStore((s) => s.manager.selectedBooks);
  const shelfTitle = useAppStore((s) => s.sidebar.shelfTitle);
  const searchResults = useAppStore((s) => s.manager.searchResults);
  const isSearch = useAppStore((s) => s.manager.isSearch);
  const isSelectBook = useAppStore((s) => s.manager.isSelectBook);
  const isSortDisplay = useAppStore((s) => s.manager.isSortDisplay);
  const handleSortDisplay = useAppStore((s) => s.handleSortDisplay);
  const handleFetchBooks = useAppStore((s) => s.handleFetchBooks);
  const handleShelf = useAppStore((s) => s.handleShelf);
  const handleLoadMore = useAppStore((s) => s.handleLoadMore);
  const { t } = useTranslation();
  const scrollContainer = useRef<HTMLUListElement | null>(null);
  const [state, setState] = useState<BookListState>(() => ({
    displayedBooksCount: 24,
    isLoadingMore: false,
    fullBooksData: [],
    // Migrated comment
    cardScale: parseFloat(ConfigService.getReaderConfig("cardScale") || "1"),
    readingStatusFilter: "",
    isCreatingCategory: false,
    newCategoryName: "",
    isBackDropTarget: false,
  }));

  // Migrated comment
  // Migrated comment
  const stateRef = useLatest(state);

  const handleKeyFilter = (items: any[], arr: string[]) => {
    let itemArr: any[] = [];
    arr.forEach((item) => {
      items.forEach((subItem: any) => {
        if (subItem.key === item) {
          itemArr.push(subItem);
        }
      });
    });
    return itemArr;
  };

  const filterByCategory = (items: any, shelfTitle: string) => {
    if (!shelfTitle) return items;
    let currentShelfTitle = shelfTitle;
    let currentShelfList = ConfigService.getMapConfig(
      currentShelfTitle,
      "shelfList"
    );
    let shelfItems = items.filter((item: { key: number }) => {
      return currentShelfList.indexOf(item.key) > -1;
    });
    return shelfItems;
  };

  //get the searched books according to the index
  const handleIndexFilter = (items: any, arr: number[]) => {
    let itemArr: any[] = [];
    arr.forEach((item) => {
      items[item] && itemArr.push(items[item]);
    });
    return itemArr;
  };

  const isCollectionInShelf = (
    collectionKey: string,
    memberKeys: string[]
  ): boolean => {
    if (
      ConfigService.getFromAllMapConfig(collectionKey, "shelfList").length > 0
    ) {
      return true;
    }
    return memberKeys.some((bookKey) => {
      return ConfigService.getFromAllMapConfig(bookKey, "shelfList").length > 0;
    });
  };

  const handleFilterShelfBook = (items: BookModel[]) => {
    return items.filter((item) => {
      if (collectionUtil.isCollection(item.key)) {
        let collection = collectionUtil.getCollection(item.key);
        if (!collection) return false;
        return !isCollectionInShelf(collection.key, collection.books);
      }
      return (
        ConfigService.getFromAllMapConfig(item.key, "shelfList").length === 0
      );
    });
  };

  const resolveCollectionItems = (items: any[]): any[] => {
    if (!items) return [];
    let result: any[] = [];
    let seen = new Set<string>();
    items.forEach((item) => {
      let key = item.key;
      if (!key) return;
      if (collectionUtil.isCollection(key)) {
        if (collectionUtil.isCollectionDeleted(key)) return;
        if (!seen.has(key)) {
          seen.add(key);
          result.push(item);
        }
        return;
      }
      let collection = collectionUtil.getActiveCollectionByBook(key);
      if (collection) {
        if (!seen.has(collection.key)) {
          seen.add(collection.key);
          result.push({ ...item, key: collection.key });
        }
        return;
      }
      if (!seen.has(key)) {
        seen.add(key);
        result.push(item);
      }
    });
    return result;
  };

  const filterBooksByReadingStatus = (
    books: Book[],
    status: string
  ): Book[] => {
    if (!status) return books;
    return books.filter((book) => {
      if (collectionUtil.isCollection(book.key)) {
        let collection = collectionUtil.getCollection(book.key);
        if (!collection) return false;
        return collectionUtil.getCollectionReadingStatus(collection) === status;
      }
      const record = ConfigService.getObjectConfig(
        book.key,
        "recordLocation",
        {}
      );
      const percentage: string =
        record && record.percentage ? record.percentage : "";
      if (status === "unread") {
        return !percentage || percentage === "0";
      } else if (status === "reading") {
        return percentage && percentage !== "0" && percentage !== "1";
      } else if (status === "finished") {
        return percentage === "1";
      }
      return true;
    });
  };

  const handleBooks = () => {
    // 书架：根目录只显示未分类的书（分类以文件夹形式单独渲染），进入分类后只显示该分类的书
    let bookMode = isSearch ? "search" : shelfTitle ? "shelf" : "home";
    let filteredBooks =
      bookMode === "search"
        ? searchResults
        : bookMode === "shelf"
          ? filterByCategory(books, shelfTitle)
          : books;
    filteredBooks = resolveCollectionItems(filteredBooks);
    if (bookMode === "home") {
      filteredBooks = handleFilterShelfBook(filteredBooks);
    }
    if (stateRef.current.readingStatusFilter) {
      filteredBooks = filterBooksByReadingStatus(
        filteredBooks,
        stateRef.current.readingStatusFilter
      );
    }
    const topBookKeys: string[] = ConfigService.getAllListConfig("topBooks");
    if (topBookKeys.length > 0) {
      const topSet = new Set(topBookKeys);
      const topBooks = [...topBookKeys]
        .map((key) => filteredBooks.find((b) => b.key === key))
        .filter(Boolean) as Book[];
      const restBooks = filteredBooks.filter((b) => !topSet.has(b.key));
      filteredBooks = [...topBooks, ...restBooks];
    }
    return {
      books: filteredBooks,
      bookMode,
    };
  };

  // Migrated comment
  const loadFullBooksData = async (
    displayedBooksCount = stateRef.current.displayedBooksCount
  ) => {
    const { books } = handleBooks();
    const displayedBooks = books.slice(0, displayedBooksCount);

    const fullBooksData: Book[] = [];
    for (let i = 0; i < displayedBooks.length; i++) {
      const key = displayedBooks[i].key;
      if (collectionUtil.isCollection(key)) {
        const collection = collectionUtil.getCollection(key);
        if (collection) {
          fullBooksData.push(collectionUtil.getCollectionAsBook(collection));
        }
        continue;
      }
      const book = await DatabaseService.getRecord(key, "books");
      if (book) {
        fullBooksData.push(book);
      }
    }

    setState((prevState) => ({ ...prevState, fullBooksData }));
  };

  const handleFinishReading = async () => {
    if (!scrollContainer.current) return;
    if (scrollContainer.current && scrollContainer.current.scrollTop > 100) {
      //ignore if the scroll is not at top
    } else {
      handleFetchBooks();
    }
  };

  const loadMoreBooks = () => {
    const { books } = handleBooks();
    const { displayedBooksCount } = stateRef.current;

    if (displayedBooksCount >= books.length) {
      return;
      // Migrated comment
    }

    setState((prevState) => ({ ...prevState, isLoadingMore: true }));
    handleLoadMore(true);
    // Migrated comment
    setTimeout(async () => {
      const newDisplayedBooksCount = Math.min(
        displayedBooksCount + getBookCountPerPage(),
        books.length
      );

      // Migrated comment
      const newBooks = books.slice(displayedBooksCount, newDisplayedBooksCount);
      const newFullBooksData: Book[] = [];
      for (let i = 0; i < newBooks.length; i++) {
        const key = newBooks[i].key;
        if (collectionUtil.isCollection(key)) {
          const collection = collectionUtil.getCollection(key);
          if (collection) {
            newFullBooksData.push(
              collectionUtil.getCollectionAsBook(collection)
            );
          }
          continue;
        }
        const book = await DatabaseService.getRecord(key, "books");
        if (book) {
          newFullBooksData.push(book);
        }
      }

      setState((prevState) => ({
        ...prevState,
        displayedBooksCount: newDisplayedBooksCount,
        isLoadingMore: false,
        fullBooksData: [...stateRef.current.fullBooksData, ...newFullBooksData],
      }));
    }, 100);
  };

  const handleScroll = () => {
    const scrollContainerCurrent = scrollContainer.current;
    if (!scrollContainerCurrent || stateRef.current.isLoadingMore) return;

    const { scrollTop, scrollHeight, clientHeight } = scrollContainerCurrent;
    // Migrated comment
    if (scrollTop + clientHeight >= scrollHeight - 300) {
      loadMoreBooks();
    }
  };

  // Migrated comment
  const handleFinishReadingRef = useLatest(handleFinishReading);
  const handleScrollRef = useLatest(handleScroll);

  // Migrated comment
  useEffect(() => {
    handleFetchBooks();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Migrated comment
  useEffect(() => {
    const displayedBooksCount = getBookCountPerPage();
    setState((prevState) => ({
      ...prevState,
      displayedBooksCount,
    }));

    // Migrated comment
    const resizeHandler = throttle(() => {
      //recount the book count per page when the window is resized
      handleFetchBooks();
    });
    window.addEventListener("resize", resizeHandler);

    // Migrated comment
    const scrollContainerCurrent = scrollContainer.current;
    const scrollHandler = () => {
      handleScrollRef.current();
    };
    if (scrollContainerCurrent) {
      scrollContainerCurrent.addEventListener("scroll", scrollHandler);
    }

    // Migrated comment
    const visibilityChangeHandler = async () => {
      if (document.visibilityState === "visible" && !isElectron) {
        await handleFinishReadingRef.current();
      }
    };
    document.addEventListener("visibilitychange", visibilityChangeHandler);

    const ipcRenderer = isElectron ? window.electronAPI : null;
    let readingFinishedHandler: ((config: any) => void) | null = null;
    if (isElectron) {
      readingFinishedHandler = async () => {
        handleFinishReadingRef.current();
      };
      ipcRenderer.on("reading-finished", readingFinishedHandler);
    }

    // Migrated comment
    loadFullBooksData(displayedBooksCount);

    return () => {
      // Migrated comment
      if (scrollContainerCurrent) {
        scrollContainerCurrent.removeEventListener("scroll", scrollHandler);
      }

      // Migrated comment
      window.removeEventListener("resize", resizeHandler);

      // Migrated comment
      document.removeEventListener("visibilitychange", visibilityChangeHandler);

      // Migrated comment
      if (isElectron && readingFinishedHandler) {
        ipcRenderer.removeListener("reading-finished", readingFinishedHandler);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Migrated comment
  const prevPropsRef = useRef({
    books,
    searchResults,
    isSearch,
    mode,
    shelfTitle,
  });
  useEffect(() => {
    const prevProps = prevPropsRef.current;
    prevPropsRef.current = {
      books,
      searchResults,
      isSearch,
      mode,
      shelfTitle,
    };
    if (
      prevProps.books !== books ||
      prevProps.searchResults !== searchResults ||
      prevProps.isSearch !== isSearch ||
      prevProps.mode !== mode ||
      prevProps.shelfTitle !== shelfTitle
    ) {
      const nextDisplayedBooksCount = getBookCountPerPage();
      setState((prevState) => ({
        ...prevState,
        displayedBooksCount: nextDisplayedBooksCount,
        isLoadingMore: false,
      }));
      handleLoadMore(false);
      // Migrated comment
      if (scrollContainer.current) {
        scrollContainer.current.scrollTop = 0;
      }
      // Migrated comment
      loadFullBooksData(nextDisplayedBooksCount);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [books, searchResults, isSearch, mode, shelfTitle]);

  // Migrated comment
  const prevReadingStatusFilterRef = useRef(state.readingStatusFilter);
  useEffect(() => {
    const prevReadingStatusFilter = prevReadingStatusFilterRef.current;
    prevReadingStatusFilterRef.current = state.readingStatusFilter;
    if (prevReadingStatusFilter !== state.readingStatusFilter) {
      loadFullBooksData();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.readingStatusFilter]);

  const handleCreateCategory = () => {
    const name = sanitizeCategoryName(state.newCategoryName);
    setState((prev) => ({
      ...prev,
      isCreatingCategory: false,
      newCategoryName: "",
    }));
    if (!name) return;
    const error = validateCategoryName(name);
    if (error) {
      toast(t(error));
      return;
    }
    createCategory(name);
    toast.success(t("Created successfully"));
    handleFetchBooks();
  };

  const renderCategoryFolders = () => {
    if (isSearch || shelfTitle || state.readingStatusFilter) return null;
    return getCategoryList().map((name) => {
      // 与进入分类后的列表走同一套过滤：剔除已删除/不存在的书，合集折叠为一项，
      // 否则封面上的数量会和分类内实际显示的数量对不上
      const categoryBooks = filterByCategory(books, name);
      const displayCount = resolveCollectionItems(categoryBooks).length;
      const existingKeys = new Set(categoryBooks.map((book: Book) => book.key));
      const coverKeys = getCategoryBookKeys(name).filter((key) =>
        existingKeys.has(key)
      );
      return (
        <ShelfCategoryItem
          key={name}
          name={name}
          bookKeys={coverKeys}
          count={displayCount}
          cardScale={state.cardScale}
          onOpen={(category) => handleShelf(category)}
        />
      );
    });
  };

  const renderShelfToolbar = () => {
    if (isSearch) return null;
    return (
      <li className="shelf-toolbar">
        <div className="shelf-toolbar-title">
          {shelfTitle ? (
            <>
              <span
                className={
                  "shelf-toolbar-back" +
                  (state.isBackDropTarget ? " is-drop-target" : "")
                }
                onClick={() => handleShelf("")}
                // 在分类内把书拖到「书架」上，即移回未分类
                onDragEnter={(event) => {
                  if (!isBookDragEvent(event)) return;
                  event.preventDefault();
                  setState((prev) => ({ ...prev, isBackDropTarget: true }));
                }}
                onDragOver={(event) => {
                  if (!isBookDragEvent(event)) return;
                  event.preventDefault();
                  event.dataTransfer.dropEffect = "copy";
                }}
                onDragLeave={(event) => {
                  if (
                    event.currentTarget.contains(
                      event.relatedTarget as Node | null
                    )
                  )
                    return;
                  setState((prev) => ({ ...prev, isBackDropTarget: false }));
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  setState((prev) => ({ ...prev, isBackDropTarget: false }));
                  if (!isBookDragEvent(event)) return;
                  const keys = parseBookDragData(event);
                  if (keys.length === 0) return;
                  moveBooksToCategory(keys, "");
                  toast.success(
                    t("Moved to {{name}}", { name: t("Uncategorized") })
                  );
                  handleFetchBooks();
                }}
              >
                <span className="icon-dropdown shelf-toolbar-back-icon"></span>
                {t("Shelf")}
              </span>
              <span className="shelf-toolbar-separator">/</span>
              <span>{shelfTitle}</span>
            </>
          ) : (
            <span>{t("Shelf")}</span>
          )}
        </div>
        <div className="shelf-toolbar-actions">
        {renderStatusTabs()}
        {!shelfTitle &&
          (state.isCreatingCategory ? (
            <input
              className="shelf-toolbar-input"
              autoFocus
              placeholder={t("Category name")}
              value={state.newCategoryName}
              onChange={(event) =>
                setState((prev) => ({
                  ...prev,
                  newCategoryName: event.target.value,
                }))
              }
              onBlur={handleCreateCategory}
              onKeyDown={(event) => {
                if (event.key === "Enter") handleCreateCategory();
                if (event.key === "Escape") {
                  setState((prev) => ({
                    ...prev,
                    isCreatingCategory: false,
                    newCategoryName: "",
                  }));
                }
              }}
            />
          ) : (
            <span
              className="shelf-toolbar-button"
              onClick={() =>
                setState((prev) => ({ ...prev, isCreatingCategory: true }))
              }
            >
              <span className="icon-add"></span>
              {t("New category")}
            </span>
          ))}
        <div
          className="shelf-toolbar-sort"
          onMouseLeave={() => handleSortDisplay(false)}
        >
          <span
            className={
              "shelf-toolbar-icon" + (isSortDisplay ? " is-active" : "")
            }
            data-tooltip-id="my-tooltip"
            data-tooltip-content={t("Sort by")}
            onClick={() => handleSortDisplay(!isSortDisplay)}
          >
            <span className="icon-sort-desc"></span>
          </span>
          {isSortDisplay && <SortDialog />}
        </div>
        </div>
      </li>
    );
  };

  const statusTabs: { value: string; label: string }[] = [
    { value: "", label: "All" },
    { value: "reading", label: "CurrentlyReading" },
    { value: "unread", label: "Unread" },
    { value: "finished", label: "Finished" },
  ];
  const renderStatusTabs = () => (
    <div className="shelf-status-tabs">
      {statusTabs.map((tab) => (
        <span
          key={tab.value}
          className={
            "shelf-status-tab" +
            (state.readingStatusFilter === tab.value ? " is-active" : "")
          }
          onClick={() =>
            setState((prevState) => ({
              ...prevState,
              readingStatusFilter: tab.value,
            }))
          }
        >
          {t(tab.label)}
        </span>
      ))}
    </div>
  );

  const renderBookList = (books: Book[], bookMode: string) => {
    if (
      books.length === 0 &&
      !isSearch &&
      !shelfTitle &&
      getCategoryList().length === 0 && wantedCount === 0
    ) {
      return <Navigate to="/manager/empty" replace />;
    }
    if (bookMode !== currentBookMode) {
      currentBookMode = bookMode;
    }

    // Migrated comment
    // Migrated comment
    const filteredKeys = new Set(books.map((b) => b.key));
    const displayedBooks = isSearch
      ? books
      : state.fullBooksData.filter((b) => filteredKeys.has(b.key));

    return displayedBooks.map((item: BookModel, index: number) => {
      if (collectionUtil.isCollection(item.key)) {
        const collection = collectionUtil.getCollection(item.key);
        if (!collection) return null;
        const collectionProps = {
          collection,
          isSelected: selectedBooks.indexOf(item.key) > -1,
          allBooks: displayedBooks,
          bookIndex: index,
        };
        return (
          <CollectionItem
            key={item.key}
            {...collectionProps}
            viewMode="card"
            cardScale={state.cardScale}
          />
        );
      }
      if (!item.format || item.format === "COLLECTION") {
        return null;
      }
      return (
        <BookCardItem
          key={index}
          book={item}
          cardScale={state.cardScale}
          isSelected={selectedBooks.indexOf(item.key) > -1}
          allBooks={displayedBooks}
          bookIndex={index}
        />
      );
    });
  };

  if (!books) {
    return null;
  }
  if (!books[0] && !wantedCount) {
    return <Navigate to="/manager/empty" replace />;
  }
  const { books: displayedBookList, bookMode } = handleBooks();
  return (
    <>
      {isSelectBook && (
        <div className="book-list-header">
          <SelectBook />
        </div>
      )}
      <div
        className="book-list-container-parent"
      >
        <div className="book-list-container">
          <ul
            className="book-list-item-box"
            ref={scrollContainer}
            style={{ "--card-scale": state.cardScale } as React.CSSProperties}
          >
            {!isSearch && !shelfTitle && !state.readingStatusFilter && (
              <ContinueReading />
            )}
            {renderShelfToolbar()}
            {wantedCount > 0 && !isSearch && !shelfTitle && !state.readingStatusFilter && (
              <li className="book-list-item shelf-category-item">
                <Link className="wanted-category-link" to="/manager/want-to-read">
                  <div className="book-item-cover shelf-category-cover">
                    <CollectionCoverGrid
                      width={110 * state.cardScale - 12}
                      height={137 * state.cardScale - 12}
                      cells={wantedBooks.slice(0, 4).map((book) => ({
                        key: book.sourceId + ":" + book.id,
                        item: { cover: book.coverUrl, title: book.title, format: "" },
                      }))}
                    />
                    <span className="book-cover-badge">{wantedCount}</span>
                  </div>
                  <p className="book-item-title shelf-category-title">
                    <span className="icon-heart book-heart-action" aria-hidden="true" />{" "}
                    {t("Want to read")}
                  </p>
                  <div className="reading-progress-icon">{t("{{count}} books", { count: wantedCount })}</div>
                </Link>
              </li>
            )}
            {renderCategoryFolders()}
            {renderBookList(displayedBookList, bookMode)}
            {bookMode === "shelf" && displayedBookList.length === 0 && (
              <li className="shelf-empty-hint">
                {t("No books in this category yet")}
              </li>
            )}
          </ul>
        </div>
      </div>
    </>
  );
};

export default BookList;
