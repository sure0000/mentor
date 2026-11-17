import { ConfigService } from "../../assets/lib/kookit-extra-browser.min";

/**
 * 书架分类（类似微信读书的书架文件夹）。
 * 数据沿用原有的 `shelfList`（分类名 → 书籍 key 列表）和 `sortedShelfList`（分类顺序），
 * 但约定每本书最多只属于一个分类；不在任何分类里的书即「未分类」，直接平铺在书架上。
 */

const SHELF_LIST = "shelfList";
const SORTED_SHELF_LIST = "sortedShelfList";
const INVALID_NAME_CHARS = /[\[\]{}",:\/\\|<>*?]/g;

export const sanitizeCategoryName = (name: string) =>
  name.replace(INVALID_NAME_CHARS, "").trim();

export const getCategoryList = (): string[] => {
  const sorted: string[] = ConfigService.getAllListConfig(SORTED_SHELF_LIST) || [];
  const titles = Object.keys(ConfigService.getAllMapConfig(SHELF_LIST) || {});
  return Array.from(new Set([...sorted, ...titles])).filter((item) =>
    titles.includes(item)
  );
};

export const getCategoryBookKeys = (name: string): string[] => {
  const shelfList = ConfigService.getAllMapConfig(SHELF_LIST) || {};
  return Array.isArray(shelfList[name]) ? shelfList[name] : [];
};

export const isCategorized = (bookKey: string) =>
  ConfigService.getFromAllMapConfig(bookKey, SHELF_LIST).length > 0;

/** 返回错误文案的 i18n key；成功时返回空字符串 */
export const validateCategoryName = (name: string): string => {
  if (!name) return "Category name is empty";
  if (getCategoryList().includes(name)) return "Duplicate category";
  return "";
};

export const createCategory = (name: string) => {
  // setListConfig 会插到最前面；新分类按创建顺序追加到末尾
  ConfigService.setAllListConfig([...getCategoryList(), name], SORTED_SHELF_LIST);
  ConfigService.setOneMapConfig(name, [], SHELF_LIST);
};

export const renameCategory = (oldName: string, newName: string) => {
  const bookKeys = getCategoryBookKeys(oldName);
  const order = getCategoryList().map((item) =>
    item === oldName ? newName : item
  );
  ConfigService.deleteMapConfig(oldName, SHELF_LIST);
  ConfigService.setOneMapConfig(newName, bookKeys, SHELF_LIST);
  ConfigService.setAllListConfig(order, SORTED_SHELF_LIST);
};

/** 删除分类，分类中的书回到「未分类」，不会删除书本身 */
export const deleteCategory = (name: string) => {
  ConfigService.deleteMapConfig(name, SHELF_LIST);
  ConfigService.deleteListConfig(name, SORTED_SHELF_LIST);
};

/** 把书移动到指定分类；category 为空字符串表示移回「未分类」 */
export const moveBooksToCategory = (bookKeys: string[], category: string) => {
  bookKeys.forEach((key) => {
    ConfigService.deleteFromAllMapConfig(key, SHELF_LIST);
    if (category) {
      ConfigService.setMapConfig(category, key, SHELF_LIST);
    }
  });
};
