// 开源书城的书源配置。新增书源只需在 bookSourceList 中追加一项。
// type 为 opds 的书源走 OPDS 搜索；openstax 一次拉取完整书目后在本地按书名匹配；
// wikisource 通过 MediaWiki 搜索接口检索，再由 ws-export 导出 EPUB；
// archive 走 Internet Archive 检索接口，只含公版馆藏。

export interface BookSourceCategory {
  // i18n key
  title: string;
  url: string;
}

export interface BookSource {
  id: string;
  // 书源名称是专有名词，不做翻译
  name: string;
  type: "opds" | "openstax" | "wikisource" | "archive" | "shuge" | "googlebooks" | "zlibrary";
  homepage: string;
  categories: BookSourceCategory[];
  // 搜索 URL 模板，{searchTerms} 会被替换为关键词
  searchTemplate: string;
  // 书源网站的搜索页，找不到可下载版本时在浏览器中打开让用户自行查找
  webSearchTemplate: string;
  // 列表页中指向单本书详情 feed 的链接特征（Gutenberg 的书目列表是导航条目）
  bookFeedPattern?: RegExp;
  // 列表 feed 没有真实封面时，根据书籍详情 feed 地址推导封面
  coverFromBookFeed?: (bookFeedUrl: string) => string;
  // wikisource 书源的语言代码
  lang?: string;
}

const gutenbergCover = (bookFeedUrl: string) => {
  const match = bookFeedUrl.match(/\/ebooks\/(\d+)\.opds/);
  return match
    ? `https://www.gutenberg.org/cache/epub/${match[1]}/pg${match[1]}.cover.medium.jpg`
    : "";
};

export const bookSourceList: BookSource[] = [
  {
    id: "zlibrary",
    name: "Z-Library",
    type: "zlibrary",
    homepage: "https://z-lib.fm",
    categories: [{ title: "Popular", url: "https://z-lib.fm" }],
    searchTemplate: "https://z-lib.fm/s/{searchTerms}",
    webSearchTemplate: "https://z-lib.fm/s/{searchTerms}",
  },
  {
    id: "shuge",
    name: "书格",
    type: "shuge",
    homepage: "https://www.shuge.org",
    categories: [{ title: "Classics", url: "https://www.shuge.org" }],
    searchTemplate: "https://www.shuge.org/wp-json/wp/v2/search?subtype=portfolio&per_page=20&_fields=id,title,url&search={searchTerms}",
    webSearchTemplate: "https://www.shuge.org/?s={searchTerms}",
  },
  {
    id: "googlebooks",
    name: "Google Books",
    type: "googlebooks",
    homepage: "https://books.google.com",
    categories: [{ title: "Popular", url: "https://books.google.com" }],
    searchTemplate: "https://www.googleapis.com/books/v1/volumes?filter=free-ebooks&maxResults=20&q=intitle%3A%22{searchTerms}%22",
    webSearchTemplate: "https://books.google.com/books?as_brr=1&q={searchTerms}",
  },
  {
    // 莱斯大学的开放教材（CC BY），数学、计算机、统计等，提供完整 PDF
    id: "openstax",
    name: "OpenStax",
    type: "openstax",
    homepage: "https://openstax.org",
    categories: [
      {
        title: "Math",
        url: "https://openstax.org/subjects/math",
      },
      {
        title: "Computer science",
        url: "https://openstax.org/subjects/computer-science",
      },
    ],
    // 没有书目搜索 API，findInSource 在本地书目里匹配，不使用 searchTemplate
    searchTemplate: "https://openstax.org/search?q={searchTerms}",
    webSearchTemplate: "https://openstax.org/search?q={searchTerms}",
  },
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
    webSearchTemplate: "https://www.gutenberg.org/ebooks/search/?query={searchTerms}",
    bookFeedPattern: /\/ebooks\/\d+\.opds$/,
    coverFromBookFeed: gutenbergCover,
  },
  {
    // 精校排版的英文公版书；公开 feed 只有最新发布，完整目录需会员
    id: "standardebooks",
    name: "Standard Ebooks",
    type: "opds",
    homepage: "https://standardebooks.org",
    categories: [
      {
        title: "Latest",
        url: "https://standardebooks.org/feeds/atom/new-releases",
      },
    ],
    searchTemplate:
      "https://standardebooks.org/feeds/atom/all?query={searchTerms}",
    webSearchTemplate: "https://standardebooks.org/ebooks?query={searchTerms}",
  },
  {
    // 开放许可（CC 等）的多语言电子书
    id: "unglueit",
    name: "Unglue.it",
    type: "opds",
    homepage: "https://unglue.it",
    categories: [
      {
        title: "Popular",
        url: "https://unglue.it/api/opds/all/?order_by=popular",
      },
      {
        title: "Latest",
        url: "https://unglue.it/api/opds/all/?order_by=newest",
      },
      {
        title: "Fiction",
        url: "https://unglue.it/api/opds/kw.Fiction/?order_by=popular",
      },
    ],
    // Unglue.it 没有全文搜索接口，按主题关键词检索
    searchTemplate: "https://unglue.it/api/opds/kw.{searchTerms}/",
    webSearchTemplate: "https://unglue.it/search/?q={searchTerms}",
  },
  {
    // 法语公版书
    id: "ebooksgratuits",
    name: "Ebooks libres et gratuits",
    type: "opds",
    homepage: "https://www.ebooksgratuits.com",
    categories: [
      {
        title: "Popular",
        url: "https://www.ebooksgratuits.com/opds/feed.php?mode=rate",
      },
      {
        title: "Latest",
        url: "https://www.ebooksgratuits.com/opds/feed.php",
      },
    ],
    searchTemplate:
      "https://www.ebooksgratuits.com/opds/feed.php?mode=search&query={searchTerms}",
    webSearchTemplate: "https://www.ebooksgratuits.com/ebooks.php?titre={searchTerms}",
  },
  {
    // 西班牙语公版书
    id: "textosinfo",
    name: "textos.info",
    type: "opds",
    homepage: "https://www.textos.info",
    categories: [
      {
        title: "Popular",
        url: "https://www.textos.info/populares.atom",
      },
      {
        title: "Latest",
        url: "https://www.textos.info/novedades.atom",
      },
    ],
    searchTemplate:
      "https://www.textos.info/busqueda.atom&query={searchTerms}",
    webSearchTemplate: "https://www.textos.info/buscar/{searchTerms}",
  },
  {
    // 以排版质量见长的公版书目录；站点启用了人机验证，部分网络下可能访问失败
    id: "feedbooks",
    name: "Feedbooks",
    type: "opds",
    homepage: "https://www.feedbooks.com",
    categories: [
      {
        title: "Popular",
        url: "https://catalog.feedbooks.com/catalog/public_domain.atom",
      },
    ],
    searchTemplate:
      "https://catalog.feedbooks.com/search.atom?query={searchTerms}",
    webSearchTemplate: "https://www.feedbooks.com/search?query={searchTerms}",
  },
  {
    // ManyBooks OPDS 目录；站点对人机验证较严格，部分网络下可能访问失败
    id: "manybooks",
    name: "ManyBooks",
    type: "opds",
    homepage: "https://manybooks.net",
    categories: [
      {
        title: "Popular",
        url: "https://manybooks.net/opds",
      },
    ],
    searchTemplate: "https://manybooks.net/opds/search?query={searchTerms}",
    webSearchTemplate: "https://manybooks.net/search?search_api_fulltext={searchTerms}",
  },
  {
    // 中文维基文库：典籍、史书、小说等，经 ws-export 导出 EPUB
    id: "wikisource-zh",
    name: "Wikisource (中文)",
    type: "wikisource",
    lang: "zh",
    homepage: "https://zh.wikisource.org",
    categories: [
      { title: "Classics", url: "https://zh.wikisource.org" },
    ],
    searchTemplate:
      "https://zh.wikisource.org/w/index.php?search={searchTerms}&fulltext=1",
    webSearchTemplate:
      "https://zh.wikisource.org/w/index.php?search={searchTerms}&fulltext=1",
  },
  {
    // 英文维基文库
    id: "wikisource-en",
    name: "Wikisource (English)",
    type: "wikisource",
    lang: "en",
    homepage: "https://en.wikisource.org",
    categories: [
      { title: "Classics", url: "https://en.wikisource.org" },
    ],
    searchTemplate:
      "https://en.wikisource.org/w/index.php?search={searchTerms}&fulltext=1",
    webSearchTemplate:
      "https://en.wikisource.org/w/index.php?search={searchTerms}&fulltext=1",
  },
  {
    // 图书馆扫描的公版书，收录了 Gutenberg 馆藏，主站维护时可作后备
    id: "archive",
    name: "Internet Archive",
    type: "archive",
    homepage: "https://archive.org",
    categories: [
      { title: "Popular", url: "https://archive.org/details/americana" },
    ],
    // 实际检索由 buildArchiveSearchUrl 构造，不使用 searchTemplate
    searchTemplate: "https://archive.org/search?query={searchTerms}",
    webSearchTemplate: "https://archive.org/search?query={searchTerms}",
  },
];
