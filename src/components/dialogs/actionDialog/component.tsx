import { useTranslation } from "react-i18next";
import React, { useEffect, useRef, useState } from "react";
import "./actionDialog.css";
import { useAppStore } from "../../../store/useAppStore";
import toast from "react-hot-toast";
import MoreAction from "../moreAction";
import MarkAction from "../markAction";
import {
  ConfigService,
  CollectionUtil,
} from "../../../assets/lib/kookit-extra-browser.min";
import {
  CONTEXT_MENU_WIDTH,
  shouldSubmenuOpenLeft,
} from "../../../utils/common";

import BookModel from "../../../models/Book";

export interface ActionDialogProps {
  book: BookModel;

  left: number;
  top: number;

  handleFetchBookmarks: () => void;
  handleFetchNotes: () => void;
}

export interface ActionDialogState {
  isShowExport: boolean;
  isShowMark: boolean;

  isExceed: boolean;
}

const collectionUtil = new CollectionUtil(ConfigService);

// 主菜单与子菜单是两个独立的 DOM 节点，鼠标移入子菜单时主菜单会先收到
// mouseleave。延迟关闭可以给子菜单的 mouseenter 留出取消关闭的时机。
const MENU_CLOSE_DELAY = 150;

const ActionDialog = (props: Pick<ActionDialogProps, "left" | "top">) => {
  const currentBook = useAppStore((s) => s.book.currentBook);
  const mode = useAppStore((s) => s.sidebar.mode);
  const handleEditDialog = useAppStore((s) => s.handleEditDialog);
  const handleAddDialog = useAppStore((s) => s.handleAddDialog);
  const handleDeleteDialog = useAppStore((s) => s.handleDeleteDialog);
  const handleDissolveDialog = useAppStore((s) => s.handleDissolveDialog);
  const handleReadingBook = useAppStore((s) => s.handleReadingBook);
  const handleActionDialog = useAppStore((s) => s.handleActionDialog);
  const handleFetchBooks = useAppStore((s) => s.handleFetchBooks);
  const handleDetailDialog = useAppStore((s) => s.handleDetailDialog);
  const handleSelectBook = useAppStore((s) => s.handleSelectBook);
  const handleSelectedBooks = useAppStore((s) => s.handleSelectedBooks);
  const handleCollectionDialog = useAppStore((s) => s.handleCollectionDialog);
  const handleCollectionDialogKey = useAppStore(
    (s) => s.handleCollectionDialogKey
  );
  const handleCollectionDetailDialog = useAppStore(
    (s) => s.handleCollectionDetailDialog
  );
  const handleCurrentCollectionKey = useAppStore(
    (s) => s.handleCurrentCollectionKey
  );
  const handleAddCollectionDialog = useAppStore(
    (s) => s.handleAddCollectionDialog
  );
  const { t } = useTranslation();
  const [state, setState] = useState<ActionDialogState>(() => ({
    isShowExport: false,
    isShowMark: false,
    isExceed: shouldSubmenuOpenLeft(props.left, CONTEXT_MENU_WIDTH),
  }));
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelClose = () => {
    if (closeTimerRef.current !== null) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  };
  const scheduleClose = () => {
    cancelClose();
    closeTimerRef.current = setTimeout(() => {
      closeTimerRef.current = null;
      handleActionDialog(false);
    }, MENU_CLOSE_DELAY);
  };
  useEffect(() => cancelClose, []);

  const updateState = (patch: Partial<ActionDialogState>) => {
    setState((prev) => ({ ...prev, ...patch }));
  };

  const handleDeleteBook = () => {
    handleReadingBook(currentBook);
    handleDeleteDialog(true);
    handleActionDialog(false);
  };
  const handleEditBook = () => {
    if (collectionUtil.isCollection(currentBook.key)) {
      handleCollectionDialogKey(currentBook.key);
      handleCollectionDialog(true);
      handleActionDialog(false);
      return;
    }
    handleEditDialog(true);
    handleReadingBook(currentBook);
    handleActionDialog(false);
  };
  const handleDetailBook = () => {
    if (collectionUtil.isCollection(currentBook.key)) {
      handleCurrentCollectionKey(currentBook.key);
      handleCollectionDetailDialog(true);
      handleActionDialog(false);
      return;
    }
    handleDetailDialog(true);
    handleReadingBook(currentBook);
    handleActionDialog(false);
  };
  const handleAddShelf = () => {
    handleAddDialog(true);
    handleReadingBook(currentBook);
    handleActionDialog(false);
  };
  const handleAddCollection = () => {
    handleAddCollectionDialog(true);
    handleReadingBook(currentBook);
    handleActionDialog(false);
  };
  const handleDissolveCollection = () => {
    if (!collectionUtil.getCollection(currentBook.key)) return;
    handleReadingBook(currentBook);
    handleDissolveDialog(true);
    handleActionDialog(false);
  };
  const handleMultiSelect = () => {
    handleSelectBook(true);
    handleSelectedBooks([currentBook.key]);
    handleActionDialog(false);
  };
  const handleTopBook = () => {
    ConfigService.setListConfig(currentBook.key, "topBooks");
    toast.success(t("Addition successful"));
    handleActionDialog(false);
    handleFetchBooks();
  };
  const handleCancelTopBook = () => {
    ConfigService.deleteListConfig(currentBook.key, "topBooks");
    toast.success(t("Cancellation successful"));
    handleActionDialog(false);
    handleFetchBooks();
  };
  const handleMoreAction = (isShow: boolean) => {
    updateState({ isShowExport: isShow });
  };
  const handleMarkAction = (isShow: boolean) => {
    updateState({ isShowMark: isShow });
  };

  const isCollection = collectionUtil.isCollection(currentBook.key);
  const isTop =
    ConfigService.getAllListConfig("topBooks").indexOf(currentBook.key) > -1;

  const openSubmenu = (
    patch: Pick<ActionDialogState, "isShowMark" | "isShowExport">
  ) => {
    updateState({
      ...patch,
      isExceed: shouldSubmenuOpenLeft(props.left, CONTEXT_MENU_WIDTH),
    });
  };

  // 菜单按用途分组：查看 → 整理 → 状态与批量 → 危险操作。
  // 子菜单按行号定位，所以这里的顺序就是子菜单锚点的依据。
  type MenuItem = {
    key: string;
    icon: string;
    label: string;
    onClick?: () => void;
    submenu?: "mark" | "more";
    danger?: boolean;
    divider?: boolean;
    hidden?: boolean;
  };
  const items: MenuItem[] = (
    [
      {
        key: "detail",
        icon: "icon-idea-line",
        label: "Details",
        onClick: handleDetailBook,
      },
      {
        key: "edit",
        icon: "icon-edit-line",
        label: "Edit",
        onClick: handleEditBook,
      },
      {
        key: "move",
        icon: "icon-folder",
        label: "Move to category",
        onClick: handleAddShelf,
        divider: true,
      },
      {
        key: "collection",
        icon: "icon-stack",
        label: "Add to collection",
        onClick: handleAddCollection,
        hidden: isCollection,
      },
      {
        key: "top",
        icon: "icon-pin",
        label: isTop ? "Unpin from top" : "Pin to top",
        onClick: isTop ? handleCancelTopBook : handleTopBook,
      },
      {
        key: "mark",
        icon: "icon-check",
        label: "Mark as",
        submenu: "mark",
        divider: true,
      },
      {
        key: "select",
        icon: "icon-select",
        label: "Multiple selection",
        onClick: handleMultiSelect,
      },
      {
        key: "more",
        icon: "icon-more",
        label: "More actions",
        submenu: "more",
        hidden: isCollection,
      },
      {
        key: "dissolve",
        icon: "icon-close",
        label: "Dissolve collection",
        onClick: handleDissolveCollection,
        divider: true,
        hidden: !isCollection,
      },
      {
        key: "delete",
        icon: "icon-trash-line",
        label: isCollection ? "Delete collection" : "Delete",
        onClick: handleDeleteBook,
        danger: true,
        divider: !isCollection,
      },
    ] as MenuItem[]
  ).filter((item) => !item.hidden);
  const markIndex = items.findIndex((item) => item.submenu === "mark");
  const moreIndex = items.findIndex((item) => item.submenu === "more");

  const moreActionProps = {
    left: props.left,
    top: props.top,
    isShowExport: state.isShowExport,
    isExceed: state.isExceed,
    menuItemIndex: moreIndex,
    handleMoreAction: handleMoreAction,
    handleMenuEnter: cancelClose,
    handleMenuLeave: scheduleClose,
  };
  const markActionProps = {
    left: props.left,
    top: props.top,
    isShowMark: state.isShowMark,
    isExceed: state.isExceed,
    handleMarkAction: handleMarkAction,
    handleMenuEnter: cancelClose,
    handleMenuLeave: scheduleClose,
    menuItemIndex: markIndex,
  };

  const renderItem = (item: MenuItem) => {
    const isSubmenuOpen =
      (item.submenu === "mark" && state.isShowMark) ||
      (item.submenu === "more" && state.isShowExport);
    const className =
      (item.danger ? "action-dialog-delete is-danger" : "action-dialog-edit") +
      (item.divider ? " action-menu-divider" : "") +
      (isSubmenuOpen ? " is-submenu-open" : "");
    const submenuHandlers = item.submenu
      ? {
          onMouseEnter: () =>
            openSubmenu(
              item.submenu === "mark"
                ? { isShowMark: true, isShowExport: false }
                : { isShowMark: false, isShowExport: true }
            ),
          onMouseLeave: (event: React.MouseEvent) => {
            updateState(
              item.submenu === "mark"
                ? { isShowMark: false }
                : { isShowExport: false }
            );
            event.stopPropagation();
          },
        }
      : {
          // 移到普通项上时收起已展开的子菜单
          onMouseEnter: () => {
            if (state.isShowMark || state.isShowExport) {
              updateState({ isShowMark: false, isShowExport: false });
            }
          },
        };
    return (
      <div
        key={item.key}
        className={className}
        onClick={item.onClick}
        {...submenuHandlers}
      >
        <span className={`${item.icon} action-menu-icon`}></span>
        <p className="action-name">{t(item.label)}</p>
        {item.submenu && (
          <span className="icon-dropdown action-menu-arrow"></span>
        )}
      </div>
    );
  };

  return (
    <>
      <div
        className="action-dialog-container"
        onMouseLeave={() => {
          scheduleClose();
        }}
        onMouseEnter={() => {
          cancelClose();
          handleActionDialog(true);
        }}
        style={{ left: props.left, top: props.top }}
      >
        <div className="action-dialog-actions-container">
          {items.map(renderItem)}
        </div>
      </div>
      <MarkAction {...(markActionProps as any)} />
      <MoreAction {...(moreActionProps as any)} />
    </>
  );
};

export default ActionDialog;
