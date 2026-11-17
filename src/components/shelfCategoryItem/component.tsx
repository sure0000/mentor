import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import toast from "react-hot-toast";
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
  bookKeys: string[];
  cardScale: number;
  onOpen: (name: string) => void;
}

const COVER_WIDTH = 110;
const COVER_HEIGHT = 150;
const MENU_WIDTH = 140;

const ShelfCategoryItem: React.FC<ShelfCategoryItemProps> = (props) => {
  const { name, bookKeys, cardScale, onOpen } = props;
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
      clampMenuPosition(x, y, MENU_WIDTH, estimateMenuHeight(2))
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

  return (
    <li
      className="shelf-category-item"
      style={{ width: `${150 * cardScale}px` }}
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
        className={
          "shelf-category-cover" + (isDropTarget ? " is-drop-target" : "")
        }
        style={{ width: `${width}px`, height: `${height}px` }}
        onClick={() => onOpen(name)}
      >
        {bookKeys.length > 0 ? (
          <CollectionCover
            bookKeys={bookKeys}
            refreshBookKey={refreshBookKey}
            width={width - 12}
            height={height - 12}
          />
        ) : (
          <span className="icon-folder shelf-category-empty-icon"></span>
        )}
      </div>
      {isRenaming ? (
        <input
          className="shelf-category-rename-input"
          style={{ width: `${width}px` }}
          autoFocus
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
          className="shelf-category-title"
          style={{ width: `${width}px` }}
          onClick={() => onOpen(name)}
        >
          {name}
        </p>
      )}
      <div className="shelf-category-meta" style={{ width: `${width}px` }}>
        <span>{t("{{count}} books", { count: bookKeys.length })}</span>
        <div
          className={"shelf-category-more" + (isMenuOpen ? " is-open" : "")}
          onMouseDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            if (isMenuOpen) {
              closeMenu();
              return;
            }
            const rect = event.currentTarget.getBoundingClientRect();
            openMenu(rect.right - MENU_WIDTH + 8, rect.bottom + 6);
          }}
        >
          <span className="icon-more"></span>
        </div>
        {menuPosition &&
          createPortal(
            <div
              ref={menuRef}
              className="shelf-category-menu"
              style={{
                left: menuPosition.left,
                top: menuPosition.top,
                width: MENU_WIDTH,
              }}
            >
              <div
                className="shelf-category-menu-item"
                onClick={() => {
                  closeMenu();
                  setDraftName(name);
                  setIsRenaming(true);
                }}
              >
                <span className="icon-edit-line"></span>
                {t("Rename")}
              </div>
              <div
                className="shelf-category-menu-item is-danger"
                onClick={() => {
                  closeMenu();
                  setIsDeleting(true);
                }}
              >
                <span className="icon-trash-line"></span>
                {t("Delete category")}
              </div>
            </div>,
            document.body
          )}
      </div>
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
