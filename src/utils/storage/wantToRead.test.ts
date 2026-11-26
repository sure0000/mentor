// @vitest-environment jsdom
import { beforeEach, expect, it } from "vitest";
import { linkStoreEdition, loadWantedBooks, removeStartedBook, toggleWantedBook, type WantedBook } from "./wantToRead";

const book: WantedBook = {
  id: "42", sourceId: "douban", title: "红楼梦", abstract: "曹雪芹",
  coverUrl: "", votes: 0, rating: null, url: "https://book.douban.com/subject/42/",
};
beforeEach(() => localStorage.clear());

it("keeps a downloaded book until its matching file opens, without removing namesakes", () => {
  const other = { ...book, sourceId: "goodreads" as const };
  toggleWantedBook(toggleWantedBook([], book), other);
  linkStoreEdition("hash", book);
  expect(loadWantedBooks()).toEqual([other, book]);
  expect(removeStartedBook("different")).toBeUndefined();
  expect(removeStartedBook("hash")).toEqual([other]);
  expect(removeStartedBook("hash")).toBeUndefined();
  expect(loadWantedBooks()).toEqual([other]);
});

it("also matches a separately imported edition by ISBN, never by an empty ISBN", () => {
  toggleWantedBook([], { ...book, isbn: "978-7-02-000220-7" });
  expect(removeStartedBook("other", "")).toBeUndefined();
  expect(removeStartedBook("other", "9787020002207")).toEqual([]);
});

it("saves a catalog book without a downloaded file and restores it on reload", () => {
  expect(loadWantedBooks()).toEqual([]);
  toggleWantedBook([], book);
  expect(loadWantedBooks()).toEqual([book]);
  toggleWantedBook(loadWantedBooks(), { ...book, title: "新版书名" });
  expect(loadWantedBooks()).toEqual([]);
});

it("keeps matching ids from different catalogs independent", () => {
  const other = { ...book, sourceId: "goodreads" as const, url: "https://www.goodreads.com/book/show/42" };
  toggleWantedBook(toggleWantedBook([], book), other);
  expect(loadWantedBooks()).toEqual([other, book]);
  toggleWantedBook(loadWantedBooks(), book);
  expect(loadWantedBooks()).toEqual([other]);
});

it("recovers from malformed persisted data", () => {
  localStorage.setItem("mentor-want-to-read", "invalid");
  expect(loadWantedBooks()).toEqual([]);
  localStorage.setItem("mentor-want-to-read", JSON.stringify([null, {}, book]));
  expect(loadWantedBooks()).toEqual([book]);
});
