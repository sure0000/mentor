import type { DoubanBook } from "../request/douban";

export type StoreSourceId = "douban" | "goodreads";
export interface WantedBook extends DoubanBook {
  sourceId: StoreSourceId;
  isbn?: string;
}

export const WANTED_BOOKS_KEY = "mentor-want-to-read";
const editionKey = (md5: string) => "mentor-store-edition:" + md5;
export const sameStoreBook = (a: WantedBook, b: WantedBook) =>
  a.sourceId === b.sourceId && a.id === b.id;

export const loadWantedBooks = (): WantedBook[] => {
  try {
    const data: unknown = JSON.parse(localStorage.getItem(WANTED_BOOKS_KEY) || "[]");
    return Array.isArray(data) ? data.filter((b) =>
      b && (b.sourceId === "douban" || b.sourceId === "goodreads") &&
      typeof b.id === "string" && typeof b.title === "string" &&
      typeof b.url === "string" && typeof b.abstract === "string" &&
      typeof b.coverUrl === "string" && typeof b.votes === "number" &&
      (b.rating === null || typeof b.rating === "number")
    ) : [];
  } catch {
    return [];
  }
};

export const toggleWantedBook = (books: WantedBook[], book: WantedBook) => {
  const next = books.some((b) => sameStoreBook(b, book))
    ? books.filter((b) => !sameStoreBook(b, book))
    : [book, ...books];
  localStorage.setItem(WANTED_BOOKS_KEY, JSON.stringify(next));
  return next;
};

type CatalogId = Pick<WantedBook, "sourceId" | "id">;

// 同一个下载文件可以来自多个书目；不按文件名或书名猜测对应关系。
export const linkStoreEdition = (md5: string, book: CatalogId) => {
  if (!md5) return;
  const key = editionKey(md5);
  const ids: CatalogId[] = JSON.parse(localStorage.getItem(key) || "[]");
  if (!ids.some((b) => b.sourceId === book.sourceId && b.id === book.id)) {
    localStorage.setItem(key, JSON.stringify([...ids, { sourceId: book.sourceId, id: book.id }]));
  }
};

const normalizeIsbn = (value?: string) => {
  const isbn = typeof value === "string" ? value.replace(/[-\s]/g, "").toUpperCase() : "";
  return /^(?:\d{9}[\dX]|97[89]\d{10})$/.test(isbn) ? isbn : "";
};

export const removeStartedBook = (md5: string, isbn?: string) => {
  const books = loadWantedBooks();
  if (!books.length) return;
  const ids: CatalogId[] = JSON.parse(localStorage.getItem(editionKey(md5)) || "[]");
  const number = normalizeIsbn(isbn);
  const next = books.filter((book) =>
    !(number && normalizeIsbn(book.isbn) === number) &&
    !ids.some((b) => b.id === book.id && b.sourceId === book.sourceId)
  );
  if (next.length === books.length) return;
  localStorage.setItem(WANTED_BOOKS_KEY, JSON.stringify(next));
  return next;
};
