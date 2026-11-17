// 开源书城的书源配置。新增书源只需在 bookSourceList 中追加一项。
// 目前仅支持 OPDS 类型；其它协议（如 MediaWiki API）后续再扩展 type。

export interface BookSourceCategory {
  // i18n key
  title: string;
  url: string;
}

export interface BookSource {
  id: string;
  // 书源名称是专有名词，不做翻译
  name: string;
  type: "opds";
  homepage: string;
  categories: BookSourceCategory[];
  // 搜索 URL 模板，{searchTerms} 会被替换为关键词
  searchTemplate: string;
  // 列表页中指向单本书详情 feed 的链接特征（Gutenberg 的书目列表是导航条目）
  bookFeedPattern?: RegExp;
  // 列表 feed 没有真实封面时，根据书籍详情 feed 地址推导封面
  coverFromBookFeed?: (bookFeedUrl: string) => string;
}

const gutenbergCover = (bookFeedUrl: string) => {
  const match = bookFeedUrl.match(/\/ebooks\/(\d+)\.opds/);
  return match
    ? `https://www.gutenberg.org/cache/epub/${match[1]}/pg${match[1]}.cover.medium.jpg`
    : "";
};

export const bookSourceList: BookSource[] = [
  {
    id: "gutenberg",
    name: "Project Gutenberg",
    type: "opds",
    homepage: "https://www.gutenberg.org",
    categories: [
      {
        title: "Popular",
        url: "https://www.gutenberg.org/ebooks/search.opds/?sort_order=downloads",
      },
      {
        title: "Chinese",
        url: "https://www.gutenberg.org/ebooks/search.opds/?query=l.zh&sort_order=downloads",
      },
      {
        title: "Latest",
        url: "https://www.gutenberg.org/ebooks/search.opds/?sort_order=release_date",
      },
    ],
    searchTemplate:
      "https://www.gutenberg.org/ebooks/search.opds/?query={searchTerms}",
    bookFeedPattern: /\/ebooks\/\d+\.opds$/,
    coverFromBookFeed: gutenbergCover,
  },
];
