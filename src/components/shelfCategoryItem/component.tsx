import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import toast from "react-hot-toast";
import "../bookCardItem/bookCardItem.css";
import "../dialogs/actionDialog/actionDialog.css";
import "./shelfCategoryItem.css";
import CollectionCover from "../collectionCover";
import DeleteDialog from "../dialogs/deleteDialog";
import { useAppStore } from "../../store/useAppStore";
import {
  isBookDragEvent,
  parseBookDragData,
} from "../../utils/reader/bookDrag";
import {
  deleteCategory,
  moveBooksToCategory,
  renameCategory,
  sanitizeCategoryName,
  validateCategoryName,
} from "../../utils/reader/shelfUtil";
import { clampMenuPosition, estimateMenuHeight } from "../../utils/common";

export interface ShelfCategoryItemProps {
  name: string;
  /** 用于拼封面的书籍 key（已剔除不存在的书） */
  bookKeys: string[];
  /** 分类内实际显示的条目数（合集算一项） */
  count: number;
  cardScale: number;
  onOpen: (name: string) => void;
}

// 与书卡封面尺寸一致（110 x 137，见 bookCardItem.css），保证分类与书籍在同一网格中对齐
const COVER_WIDTH = 110;
const COVER_HEIGHT = 137;
const COVER_PADDING = 6;
const MENU_WIDTH = 170;

const ShelfCategoryItem: React.FC<ShelfCategoryItemProps> = (props) => {
  const { name, bookKeys, count, cardScale, onOpen } = props;
  const { t } = useTranslation();
  const refreshBookKey = useAppStore((s) => s.manager.refreshBookKey);
  const handleFetchBooks = useAppStore((s) => s.handleFetchBooks);
  // 菜单渲染到 body 并用 fixed 定位，避免被滚动容器裁剪或被后面的书卡遮挡
  const [menuPosition, setMenuPosition] = useState<{
    left: number;
    top: number;
  } | null>(null);
  const isMenuOpen = menuPosition !== null;
  const [isRenaming, setIsRenaming] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isDropTarget, setIsDropTarget] = useState(false);
  const [draftName, setDraftName] = useState(name);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const openMenu = (x: number, y: number) => {
    setMenuPosition(
      clampMenuPosition(x, y, MENU_WIDTH, estimateMenuHeight(3))
    );
  };
  const closeMenu = () => setMenuPosition(null);

  useEffect(() => {
    if (!isMenuOpen) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        closeMenu();
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeMenu();
    };
    // 列表滚动或窗口尺寸变化时菜单位置会失效，直接关闭
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("scroll", closeMenu, true);
    window.addEventListener("resize", closeMenu);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("scroll", closeMenu, true);
      window.removeEventListener("resize", closeMenu);
    };
  }, [isMenuOpen]);

  const handleRename = () => {
    const nextName = sanitizeCategoryName(draftName);
    setIsRenaming(false);
    if (nextName === name) return;
    const error = validateCategoryName(nextName);
    if (error) {
      toast(t(error));
      setDraftName(name);
      return;
    }
    renameCategory(name, nextName);
    toast.success(t("Renamed successfully"));
    handleFetchBooks();
  };

  const handleDrop = (event: React.DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDropTarget(false);
    if (!isBookDragEvent(event)) return;
    const keys = parseBookDragData(event);
    if (keys.length === 0) return;
    moveBooksToCategory(keys, name);
    toast.success(t("Moved to {{name}}", { name }));
    handleFetchBooks();
  };

  const width = COVER_WIDTH * cardScale;
  const height = COVER_HEIGHT * cardScale;

  const handleMoreClick = (event: React.MouseEvent<HTMLSpanElement>) => {
    event.stopPropagation();
    if (isMenuOpen) {
      closeMenu();
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    openMenu(rect.right - MENU_WIDTH, rect.bottom + 4);
  };

  // 外层框架复用书卡的 class（book-list-item / book-item-cover / book-item-title /
  // reading-progress-icon / book-more-action），保证尺寸、阴影、悬停效果与单本书完全一致；
  // 差异只在封面内容（2x2 拼图）、标题前的文件夹图标和底部的数量文案
  return (
    <li
      className={
        "book-list-item shelf-category-item" +
        (isMenuOpen ? " is-menu-open" : "") +
        (isDropTarget ? " book-drop-target" : "")
      }
      onContextMenu={(event) => {
        event.preventDefault();
        openMenu(event.clientX, event.clientY);
      }}
      onDragEnter={(event) => {
        if (isBookDragEvent(event)) {
          event.preventDefault();
          setIsDropTarget(true);
        }
      }}
      onDragOver={(event) => {
        if (isBookDragEvent(event)) {
          event.preventDefault();
          // 必须与书籍拖拽源的 effectAllowed（"copy"）一致，否则浏览器不会触发 drop
          event.dataTransfer.dropEffect = "copy";
        }
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setIsDropTarget(false);
        }
      }}
      onDrop={handleDrop}
    >
      <div
        className="book-item-cover shelf-category-cover"
        style={{ height: `${height}px` }}
        onClick={() => onOpen(name)}
      >
        {bookKeys.length > 0 ? (
          <CollectionCover
            bookKeys={bookKeys}
            refreshBookKey={refreshBookKey}
            width={width - COVER_PADDING * 2}
            height={height - COVER_PADDING * 2}
          />
        ) : (
          <span className="icon-folder shelf-category-empty-icon"></span>
        )}
        {count > 0 && <span className="book-cover-badge">{count}</span>}
      </div>
      {isRenaming ? (
        <input
          className="shelf-category-rename-input"
          autoFocus
          onFocus={(event) => event.target.select()}
          value={draftName}
          onChange={(event) => setDraftName(event.target.value)}
          onBlur={handleRename}
          onKeyDown={(event) => {
            if (event.key === "Enter") handleRename();
            if (event.key === "Escape") {
              setDraftName(name);
              setIsRenaming(false);
            }
          }}
        />
      ) : (
        <p
          className="book-item-title shelf-category-title"
          title={name}
          onClick={() => onOpen(name)}
          onDoubleClick={() => {
            setDraftName(name);
            setIsRenaming(true);
          }}
        >
          <span className="icon-folder book-item-title-icon"></span>
          {name}
        </p>
      )}
      <div className="reading-progress-icon">
        {t("{{count}} books", { count })}
      </div>
      <span
        className="icon-more book-more-action"
        onMouseDown={(event) => event.stopPropagation()}
        onClick={handleMoreClick}
      ></span>
        {menuPosition &&
          createPortal(
            // 与书籍右键菜单共用样式（actionDialog.css），保持外观一致
            <div
              ref={menuRef}
              className="action-dialog-container"
              style={{
                left: menuPosition.left,
                top: menuPosition.top,
                width: MENU_WIDTH,
                zIndex: 30,
              }}
            >
              <div className="action-dialog-actions-container">
                <div
                  className="action-dialog-edit"
                  onClick={() => {
                    closeMenu();
                    onOpen(name);
                  }}
                >
                  <span className="icon-folder action-menu-icon"></span>
                  <p className="action-name">{t("Open")}</p>
                </div>
                <div
                  className="action-dialog-edit"
                  onClick={() => {
                    closeMenu();
                    setDraftName(name);
                    setIsRenaming(true);
                  }}
                >
                  <span className="icon-edit-line action-menu-icon"></span>
                  <p className="action-name">{t("Rename")}</p>
                </div>
                <div
                  className="action-dialog-delete is-danger action-menu-divider"
                  onClick={() => {
                    closeMenu();
                    setIsDeleting(true);
                  }}
                >
                  <span className="icon-trash-line action-menu-icon"></span>
                  <p className="action-name">{t("Delete category")}</p>
                </div>
              </div>
            </div>,
            document.body
          )}
      {isDeleting && (
        <>
          <DeleteDialog
            name={name}
            title="Delete category"
            description="The category will be removed and its books will move back to Uncategorized"
            handleClose={() => setIsDeleting(false)}
            handleConfirm={() => {
              deleteCategory(name);
              handleFetchBooks();
            }}
          />
          <div
            className="drag-background"
            onClick={() => setIsDeleting(false)}
          ></div>
        </>
      )}
    </li>
  );
};

export default ShelfCategoryItem;
