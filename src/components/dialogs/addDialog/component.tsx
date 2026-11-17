import { useTranslation } from "react-i18next";
import React, { useState } from "react";
import { Trans } from "react-i18next";
import { useAppStore } from "../../../store/useAppStore";
import "./addDialog.css";
import toast from "react-hot-toast";
import {
  ConfigService,
  CollectionUtil,
} from "../../../assets/lib/kookit-extra-browser.min";
import {
  createCategory,
  getCategoryList,
  moveBooksToCategory,
  sanitizeCategoryName,
  validateCategoryName,
} from "../../../utils/reader/shelfUtil";

const collectionUtil = new CollectionUtil(ConfigService);

// 下拉框中的特殊选项
const NEW_CATEGORY = "__new__";
const UNCATEGORIZED = "";

/** 分类对话框：把书移动到某个分类（每本书只属于一个分类），或移回「未分类」 */
const AddDialog = () => {
  const currentBook = useAppStore((s) => s.book.currentBook);
  const selectedBooks = useAppStore((s) => s.manager.selectedBooks);
  const isSelectBook = useAppStore((s) => s.manager.isSelectBook);
  const handleAddDialog = useAppStore((s) => s.handleAddDialog);
  const handleActionDialog = useAppStore((s) => s.handleActionDialog);
  const handleSelectBook = useAppStore((s) => s.handleSelectBook);
  const handleSelectedBooks = useAppStore((s) => s.handleSelectedBooks);
  const handleFetchBooks = useAppStore((s) => s.handleFetchBooks);
  const { t } = useTranslation();
  const categoryList = getCategoryList();
  const [target, setTarget] = useState(
    categoryList.length > 0 ? categoryList[0] : NEW_CATEGORY
  );
  const [newName, setNewName] = useState("");

  const getBookKeys = () => {
    const keys = isSelectBook ? selectedBooks : [currentBook.key];
    // 合集作为整体移动时，连同合集内的书一起移动
    return keys.flatMap((key) => {
      const collection = collectionUtil.isCollection(key)
        ? collectionUtil.getCollection(key)
        : null;
      return collection ? [key, ...collection.books] : [key];
    });
  };

  const handleConfirm = () => {
    let category = target;
    if (target === NEW_CATEGORY) {
      category = sanitizeCategoryName(newName);
      const error = validateCategoryName(category);
      if (error) {
        toast(t(error));
        return;
      }
      createCategory(category);
    }
    moveBooksToCategory(getBookKeys(), category);
    if (isSelectBook) {
      handleSelectedBooks([]);
      handleSelectBook(false);
    }
    handleAddDialog(false);
    handleActionDialog(false);
    toast.success(
      category
        ? t("Moved to {{name}}", { name: category })
        : t("Moved to {{name}}", { name: t("Uncategorized") })
    );
    handleFetchBooks();
  };

  return (
    <div className="add-dialog-container">
      <div className="add-dialog-title">
        <Trans>Move to category</Trans>
      </div>
      <div className="add-dialog-body">
        <div className="add-dialog-field">
          <span className="add-dialog-label">
            <Trans>Category</Trans>
          </span>
          <select
            className="add-dialog-shelf-list-box"
            value={target}
            onChange={(event: React.ChangeEvent<HTMLSelectElement>) => {
              setTarget(event.target.value);
            }}
          >
            {categoryList.map((item) => (
              <option
                value={item}
                key={item}
                className="add-dialog-shelf-list-option"
              >
                {item}
              </option>
            ))}
            <option
              value={UNCATEGORIZED}
              className="add-dialog-shelf-list-option"
            >
              {t("Uncategorized")}
            </option>
            <option
              value={NEW_CATEGORY}
              className="add-dialog-shelf-list-option"
            >
              {t("New category")}
            </option>
          </select>
        </div>
        {target === NEW_CATEGORY && (
          <div className="add-dialog-field">
            <span className="add-dialog-label">
              <Trans>New</Trans>
            </span>
            <input
              className="add-dialog-new-shelf-box"
              autoFocus
              placeholder={t("Category name")}
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") handleConfirm();
              }}
            />
          </div>
        )}
      </div>
      <div className="add-dialog-button-container">
        <div
          className="add-dialog-cancel"
          onClick={() => {
            handleAddDialog(false);
          }}
        >
          <Trans>Cancel</Trans>
        </div>
        <div className="add-dialog-confirm" onClick={handleConfirm}>
          <Trans>Confirm</Trans>
        </div>
      </div>
    </div>
  );
};

export default AddDialog;
