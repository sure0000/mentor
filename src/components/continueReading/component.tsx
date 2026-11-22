import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import "./continueReading.css";
import {
  ConfigService,
  CollectionUtil,
} from "../../assets/lib/kookit-extra-browser.min";
import BookModel from "../../models/Book";
import BookUtil from "../../utils/file/bookUtil";
import CoverUtil from "../../utils/file/coverUtil";
import DatabaseService from "../../utils/storage/databaseService";
import EmptyCover from "../emptyCover";
import { useAppStore } from "../../store/useAppStore";

const collectionUtil = new CollectionUtil(ConfigService);

interface RecentItem {
  book: BookModel;
  cover: string;
  percentage: number;
  chapterTitle: string;
}

const getRecord = (bookKey: string) => {
  const record = ConfigService.getObjectConfig(bookKey, "recordLocation", {});
  const percentage = parseFloat(record?.percentage || "0");
  return {
    percentage: isNaN(percentage) ? 0 : Math.min(1, Math.max(0, percentage)),
    chapterTitle: (record?.chapterTitle as string) || "",
  };
};

/** 书架顶部的「继续阅读」：最近读过且没读完的那本书 */
const ContinueReading = () => {
  const books = useAppStore((s) => s.manager.books);
  const handleReadingBook = useAppStore((s) => s.handleReadingBook);
  const { t } = useTranslation();
  const [item, setItem] = useState<RecentItem | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const recentKeys: string[] =
        ConfigService.getAllListConfig("recentBooks") || [];
      for (const key of recentKeys.slice(0, 10)) {
        // 合集按其中最近读的书展示没有意义，直接跳过
        if (collectionUtil.isCollection(key)) continue;
        const { percentage, chapterTitle } = getRecord(key);
        if (percentage >= 1) continue;
        const book: BookModel | null = await DatabaseService.getRecord(
          key,
          "books"
        );
        if (!book) continue;
        const hasCover = await CoverUtil.isCoverExist(book);
        const cover = hasCover ? await CoverUtil.getCover(book) : "";
        if (!cancelled) setItem({ book, cover, percentage, chapterTitle });
        return;
      }
      if (!cancelled) setItem(null);
    })();
    return () => {
      cancelled = true;
    };
  }, [books]);

  if (!item) return null;
  const { book, cover, percentage, chapterTitle } = item;
  const percentText = Math.round(percentage * 100) + "%";
  const open = () => {
    handleReadingBook(book);
    BookUtil.redirectBook(book);
  };

  return (
    <li className="continue-reading" onClick={open}>
      <div className="continue-reading-cover">
        {cover ? (
          <img src={cover} alt="" draggable={false} />
        ) : (
          <EmptyCover format={book.format} title={book.name} scale={0.62} />
        )}
      </div>
      <div className="continue-reading-body">
        <div className="continue-reading-label">{t("Continue reading")}</div>
        <div className="continue-reading-title" title={book.name}>
          {book.name}
        </div>
        <div className="continue-reading-meta">
          {[book.author, chapterTitle].filter(Boolean).join(" · ")}
        </div>
        <div className="continue-reading-progress">
          <div className="continue-reading-bar">
            <div
              className="continue-reading-bar-inner"
              style={{ width: percentText }}
            />
          </div>
          <span className="continue-reading-percent">
            {percentage > 0 ? percentText : t("Unread")}
          </span>
        </div>
      </div>
      <span className="continue-reading-button">{t("Read")}</span>
    </li>
  );
};

export default ContinueReading;
