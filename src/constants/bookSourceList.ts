// 开源书城的书源配置。新增书源只需在 bookSourceList 中追加一项。
// type 为 opds 的书源走 OPDS 搜索；openstax 一次拉取完整书目后在本地按书名匹配。

export interface BookSourceCategory {
  // i18n key
  title: string;
  url: string;
}

export interface BookSource {
  id: string;
  // 书源名称是专有名词，不做翻译
  name: string;
  type: "opds" | "openstax";
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
}

const gutenbergCover = (bookFeedUrl: string) => {
  const match = bookFeedUrl.match(/\/ebooks\/(\d+)\.opds/);
  return match
    ? `https://www.gutenberg.org/cache/epub/${match[1]}/pg${match[1]}.cover.medium.jpg`
    : "";
};

export const bookSourceList: BookSource[] = [
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
];
