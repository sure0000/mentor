// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  parseDoubanList,
  parseDoubanSearch,
  parseDoubanSubject,
  resizeDoubanCover,
} from "./douban";

// 结构取自豆瓣真实页面（2026-11），只保留解析用到的节点
const TOP250 = `
<table><tr class="item">
  <td><a class="nbg" href="https://book.douban.com/subject/1007305/">
    <img src="https://img3.doubanio.com/view/subject/s/public/s1070959.jpg" /></a></td>
  <td><div class="pl2"><a href="https://book.douban.com/subject/1007305/" title="红楼梦">
    红楼梦 </a></div>
    <p class="pl">(清)曹雪芹 / 人民文学出版社 / 1982-3 / 59.70元</p>
    <div class="star clearfix"><span class="allstar50"></span>
      <span class="rating_nums">9.7</span>
      <span class="pl">( 471606人评价 )</span></div></td>
</tr></table>
<div class="paginator"><span class="next">
  <link rel="next" href="https://book.douban.com/top250?start=25"/>
  <a href="https://book.douban.com/top250?start=25">后页&gt;</a></span></div>`;

const TAG = `
<ul><li class="subject-item">
  <div class="pic"><a class="nbg" href="https://book.douban.com/subject/38370177/">
    <img src="https://img3.doubanio.com/view/subject/s/public/s35466757.jpg"></a></div>
  <div class="info"><h2><a href="https://book.douban.com/subject/38370177/" title="秦二世必须死">秦二世必须死</a></h2>
    <div class="pub"> 马伯庸 / 民主与建设出版社 / 2026-4 / 118.00元 </div>
    <div class="star clearfix"><span class="rating_nums"></span>
      <span class="pl">(少于10人评价)</span></div></div>
</li></ul>
<div class="paginator"><span class="next">
  <a href="/tag/小说?start=20&amp;type=T">后页&gt;</a></span></div>`;

const SEARCH = `<script>window.__DATA__ = {"count": 15, "items": [
  {"id": 4164, "title": "[丛书] 《红楼梦》连环画", "tpl_name": "search_simple", "url": "https://book.douban.com/series/4164"},
  {"id": 1007305, "title": "红楼梦", "abstract": "(清)曹雪芹 / 人民文学出版社", "cover_url": "https://img3.doubanio.com/view/subject/m/public/s1070959.jpg",
   "rating": {"count": 471606, "value": 9.7}, "tpl_name": "search_subject", "url": "https://book.douban.com/subject/1007305/"}
], "start": 0, "total": 40};
</script>`;

const SUBJECT = `
<h1><span property="v:itemreviewed">海边的卡夫卡</span></h1>
<div id="mainpic"><a class="nbg" href="https://img3.doubanio.com/view/subject/l/public/s1.jpg">
  <img src="https://img3.doubanio.com/view/subject/s/public/s1.jpg"></a></div>
<div id="info">
  <span><span class="pl"> 作者</span>: <a href="/author/1">[日] 村上春树</a></span><br/>
  <span class="pl">出版社:</span> <a href="/press/1">上海译文出版社</a><br>
  <span class="pl">出版时间:</span> 2003-4<br/>
  <span class="pl">原作名:</span> 海辺のカフカ<br/>
  <span class="pl">ISBN:</span> 9787532734191<br/>
</div>
<strong class="ll rating_num" property="v:average"> 8.2 </strong>
<span property="v:votes">106073</span>
<div id="link-report">
  <span class="short"><div class="intro"><p>截断的简介...</p>
    <p><a href="javascript:void(0)" class="j a_show_full">(展开全部)</a></p></div></span>
  <span class="all hidden"><div><style>.intro p{}</style>
    <div class="intro"><p>完整的简介</p></div></div></span>
</div>`;

describe("douban", () => {
  it("解析 Top 250 书单、评分和下一页", () => {
    const list = parseDoubanList(TOP250, "https://book.douban.com/top250");
    expect(list.books).toEqual([
      {
        id: "1007305",
        title: "红楼梦",
        abstract: "(清)曹雪芹 / 人民文学出版社 / 1982-3 / 59.70元",
        coverUrl: "https://img3.doubanio.com/view/subject/l/public/s1070959.jpg",
        rating: 9.7,
        votes: 471606,
        url: "https://book.douban.com/subject/1007305/",
      },
    ]);
    expect(list.nextUrl).toBe("https://book.douban.com/top250?start=25");
  });

  it("标签页评价人数不足时评分为 null，相对分页地址补全", () => {
    const list = parseDoubanList(
      TAG,
      "https://book.douban.com/tag/%E5%B0%8F%E8%AF%B4?start=0&type=T"
    );
    expect(list.books[0].title).toBe("秦二世必须死");
    expect(list.books[0].rating).toBeNull();
    expect(list.nextUrl).toBe(
      "https://book.douban.com/tag/%E5%B0%8F%E8%AF%B4?start=20&type=T"
    );
  });

  it("搜索结果只保留单本书并计算下一页", () => {
    const url =
      "https://search.douban.com/book/subject_search?search_text=x&cat=1001&start=0";
    const list = parseDoubanSearch(SEARCH, url);
    expect(list.books.map((b) => b.id)).toEqual(["1007305"]);
    expect(list.books[0].rating).toBe(9.7);
    expect(list.nextUrl).toContain("start=15");
  });

  it("搜索页结构变化时返回空结果而不是抛错", () => {
    expect(parseDoubanSearch("<html></html>", "https://x/")).toEqual({
      books: [],
      nextUrl: "",
    });
  });

  it("解析详情页字段、评分和完整简介", () => {
    const detail = parseDoubanSubject(SUBJECT);
    expect(detail).toMatchObject({
      title: "海边的卡夫卡",
      originalTitle: "海辺のカフカ",
      authors: ["[日] 村上春树"],
      publisher: "上海译文出版社",
      pubDate: "2003-4",
      isbn: "9787532734191",
      coverUrl: "https://img3.doubanio.com/view/subject/l/public/s1.jpg",
      rating: 8.2,
      votes: 106073,
    });
    expect(detail.summary).toContain("完整的简介");
    expect(detail.summary).not.toContain("style");
  });

  it("封面尺寸替换", () => {
    expect(
      resizeDoubanCover("https://img3.doubanio.com/view/subject/s/public/a.jpg", "l")
    ).toBe("https://img3.doubanio.com/view/subject/l/public/a.jpg");
  });
});
