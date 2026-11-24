// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  parseGoodreadsBook,
  parseGoodreadsList,
  resizeGoodreadsCover,
  splitSummaryParagraphs,
  stripSeries,
} from "./goodreads";

// 结构取自 Goodreads 真实页面（2026-11），只保留解析用到的节点
const LIST = `
<table><tr itemscope itemtype="http://schema.org/Book">
  <td><a title="The Hunger Games" href="/book/show/2767052-the-hunger-games">
    <img class="bookCover" src="https://i.gr-assets.com/images/S/compressed.photo.goodreads.com/books/1586722975i/2767052._SX50_.jpg" /></a></td>
  <td><a class="bookTitle" href="/book/show/2767052-the-hunger-games">
    <span itemprop='name'>The Hunger Games (The Hunger Games, #1)</span></a>
    <a class="authorName" href="https://www.goodreads.com/author/show/153394"><span>Suzanne Collins</span></a>
    <span class="minirating"><span class="stars"></span> 4.36 avg rating &mdash; 10,380,891 ratings</span></td>
</tr></table>
<a class="next_page" rel="next" href="/list/show/1.Best_Books_Ever?page=2">next</a>`;

const SEARCH = `
<table><tr itemscope itemtype="http://schema.org/Book">
  <td><a class="bookTitle" href="/book/show/44767458-dune?from_search=true&amp;rank=1">
    <span>Dune (Dune, #1)</span></a>
    <a class="authorName"><span>Frank Herbert</span></a>
    <span class="minirating">4.29 avg rating &mdash; 1,731,615 ratings</span></td>
</tr></table>
<a class="next_page" href="/search?page=2&amp;q=dune">next</a>`;

const DETAIL = `
<script type="application/ld+json">{"@type":"Book","name":"Dune (Dune, #1)",
"image":"https://m.media-amazon.com/images/44767458.jpg","isbn":"9780593099322",
"author":[{"@type":"Person","name":"Frank Herbert"}],
"aggregateRating":{"ratingValue":4.29,"ratingCount":1731620}}</script>
<h1 data-testid="bookTitle">Dune</h1>
<p data-testid="publicationInfo">First published June 1, 1965</p>
<div data-testid="description"><span class="Formatted">Set on Arrakis.<br /><br />House Atreides is betrayed.</span></div>`;

describe("goodreads", () => {
  it("parses list page", () => {
    const list = parseGoodreadsList(LIST, "https://www.goodreads.com/list/show/1");
    expect(list.books).toEqual([
      {
        id: "2767052",
        title: "The Hunger Games",
        abstract: "Suzanne Collins",
        coverUrl:
          "https://i.gr-assets.com/images/S/compressed.photo.goodreads.com/books/1586722975i/2767052.jpg",
        rating: 4.36,
        votes: 10380891,
        url: "https://www.goodreads.com/book/show/2767052-the-hunger-games",
      },
    ]);
    expect(list.nextUrl).toBe(
      "https://www.goodreads.com/list/show/1.Best_Books_Ever?page=2"
    );
  });

  it("parses search page and strips tracking params", () => {
    const list = parseGoodreadsList(SEARCH, "https://www.goodreads.com/search?q=dune");
    expect(list.books[0].url).toBe("https://www.goodreads.com/book/show/44767458-dune");
    expect(list.books[0].title).toBe("Dune");
    expect(list.nextUrl).toBe("https://www.goodreads.com/search?page=2&q=dune");
  });

  it("parses book detail", () => {
    const detail = parseGoodreadsBook(DETAIL);
    expect(detail.title).toBe("Dune");
    expect(detail.authors).toEqual(["Frank Herbert"]);
    expect(detail.isbn).toBe("9780593099322");
    expect(detail.rating).toBe(4.29);
    expect(detail.votes).toBe(1731620);
    expect(detail.pubDate).toBe("First published June 1, 1965");
    expect(splitSummaryParagraphs(detail.summary)).toEqual([
      "Set on Arrakis.",
      "House Atreides is betrayed.",
    ]);
  });

  it("helpers", () => {
    expect(stripSeries("Harry Potter (Harry Potter, #1.5)")).toBe("Harry Potter");
    expect(stripSeries("1984")).toBe("1984");
    expect(resizeGoodreadsCover("https://x/123._SY75_.jpg")).toBe("https://x/123.jpg");
  });
});
