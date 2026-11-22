// 论文数据源：arXiv（预印本，PDF 全部免费）、Europe PMC（生物医学开放获取），
// 被引次数来自 OpenAlex（arXiv 本身没有引用数据）。
// arXiv 按被引排序时改从 OpenAlex 检索（限定 arXiv 来源），arXiv API 不支持按引用排序。

export type PaperSourceId = "arxiv" | "europepmc";
export type PaperSort = "cited" | "latest";

export interface Paper {
  id: string;
  source: PaperSourceId;
  title: string;
  authors: string[];
  summary: string;
  // YYYY-MM-DD 或 YYYY
  published: string;
  // 期刊名或 arXiv 分类
  venue: string;
  // null 表示尚未获取或获取失败
  citations: number | null;
  pdfUrl: string;
  landingUrl: string;
  doi: string;
}

export interface PaperPage {
  papers: Paper[];
  // 下一页请求地址，空字符串表示没有更多
  nextUrl: string;
}

export interface PaperCategory {
  source: PaperSourceId;
  // i18n key
  title: string;
  // Europe PMC / OpenAlex 检索词
  topic: string;
  // arXiv 分类代码，按最新排序时使用
  arxivCategory?: string;
}

const ARXIV_API = "https://export.arxiv.org/api/query";
const EPMC_API = "https://www.ebi.ac.uk/europepmc/webservices/rest/search";
const OPENALEX_API = "https://api.openalex.org/works";
// OpenAlex 中 arXiv 的来源 id
const OPENALEX_ARXIV_SOURCE = "S4306400194";
const PAGE_SIZE = 25;
const REQUEST_TIMEOUT = 30000;

export const buildArxivUrl = (
  searchQuery: string,
  sortBy: "submittedDate" | "relevance",
  start = 0
) => {
  const params = new URLSearchParams({
    search_query: searchQuery,
    sortBy,
    sortOrder: "descending",
    start: String(start),
    max_results: String(PAGE_SIZE),
  });
  return `${ARXIV_API}?${params.toString()}`;
};

// 只检索有开放获取 PDF 的文章
const EPMC_OA_FILTER = "OPEN_ACCESS:y AND HAS_PDF:y";

export const buildEuropePmcUrl = (
  query: string,
  sort: "CITED desc" | "P_PDATE_D desc",
  cursorMark = "*"
) => {
  const params = new URLSearchParams({
    query: query ? `(${query}) AND ${EPMC_OA_FILTER}` : EPMC_OA_FILTER,
    sort,
    format: "json",
    resultType: "core",
    pageSize: String(PAGE_SIZE),
    cursorMark,
  });
  return `${EPMC_API}?${params.toString()}`;
};

/** OpenAlex 中的 arXiv 论文，按被引次数降序，cursor 分页 */
export const buildOpenAlexArxivUrl = (search: string, cursor = "*") => {
  const params = new URLSearchParams({
    filter: `locations.source.id:${OPENALEX_ARXIV_SOURCE},title_and_abstract.search:${search.replace(/[,:]/g, " ")}`,
    sort: "cited_by_count:desc",
    "per-page": String(PAGE_SIZE),
    cursor,
    select:
      "id,doi,title,cited_by_count,publication_date,authorships,primary_location,locations,abstract_inverted_index",
  });
  return `${OPENALEX_API}?${params.toString()}`;
};

const arxivCategory = (
  title: string,
  category: string,
  topic: string
): PaperCategory => ({ source: "arxiv", title, topic, arxivCategory: category });

const europePmcCategory = (title: string, topic: string): PaperCategory => ({
  source: "europepmc",
  title,
  topic,
});

export const buildCategoryUrl = (category: PaperCategory, sort: PaperSort) => {
  if (category.source === "europepmc") {
    return buildEuropePmcUrl(
      category.topic,
      sort === "cited" ? "CITED desc" : "P_PDATE_D desc"
    );
  }
  return sort === "cited"
    ? buildOpenAlexArxivUrl(category.topic)
    : buildArxivUrl(`cat:${category.arxivCategory}`, "submittedDate");
};

export const paperCategories: PaperCategory[] = [
  arxivCategory("Artificial intelligence", "cs.AI", "artificial intelligence"),
  arxivCategory("Machine learning", "cs.LG", "machine learning"),
  arxivCategory("Natural language processing", "cs.CL", "natural language processing"),
  arxivCategory("Computer vision", "cs.CV", "computer vision"),
  arxivCategory("Quantum physics", "quant-ph", "quantum computing"),
  // Europe PMC 不带关键词检索全库时经常 500/503 超时，分类都限定在具体主题内
  europePmcCategory("Genomics", "genomics"),
  europePmcCategory("Neuroscience", "neuroscience"),
  europePmcCategory("Cancer research", "cancer"),
];

// arXiv 把 is / all / you 这类停用词也当检索词，整句 AND 会匹配不到任何结果
const ARXIV_STOPWORDS = new Set(
  "a an and are as at be by for from in is it of on or that the to with all you we your our this".split(
    " "
  )
);

const sanitizeArxivQuery = (query: string) =>
  query.replace(/[():"]/g, " ").replace(/\s+/g, " ").trim();

/**
 * 多个词时先按标题短语精确检索（论文名搜索效果最好），
 * 没有结果再由调用方用 buildArxivKeywordUrl 退回到关键词检索。
 */
export const buildArxivSearchUrl = (
  query: string,
  sortBy: "submittedDate" | "relevance" = "relevance"
) => {
  const text = sanitizeArxivQuery(query);
  if (!text.includes(" ")) return buildArxivUrl(`all:${text}`, sortBy);
  return buildArxivUrl(`ti:"${text}"`, sortBy);
};

/** 去掉停用词后各关键词 AND 检索 */
export const buildArxivKeywordUrl = (
  query: string,
  sortBy: "submittedDate" | "relevance" = "relevance"
) => {
  const words = sanitizeArxivQuery(query).split(" ").filter(Boolean);
  const keywords = words.filter((w) => !ARXIV_STOPWORDS.has(w.toLowerCase()));
  const terms = (keywords.length ? keywords : words).map((w) => `all:${w}`);
  return buildArxivUrl(terms.join(" AND "), sortBy);
};

export const buildEuropePmcSearchUrl = (
  query: string,
  sort: PaperSort = "cited"
) =>
  buildEuropePmcUrl(
    query.trim(),
    sort === "cited" ? "CITED desc" : "P_PDATE_D desc"
  );

/** 搜索地址：第一个没有结果时依次尝试后面的备用地址 */
export const buildPaperSearchUrls = (
  source: PaperSourceId,
  query: string,
  sort: PaperSort
): string[] => {
  if (source === "europepmc") return [buildEuropePmcSearchUrl(query, sort)];
  if (sort === "cited") {
    return [buildOpenAlexArxivUrl(sanitizeArxivQuery(query))];
  }
  const phraseUrl = buildArxivSearchUrl(query, "submittedDate");
  const keywordUrl = buildArxivKeywordUrl(query, "submittedDate");
  return keywordUrl !== phraseUrl ? [phraseUrl, keywordUrl] : [phraseUrl];
};

const clean = (text: string | null | undefined) =>
  (text || "").replace(/\s+/g, " ").trim();

// arXiv id 去掉版本号，如 2611.22219v1 → 2611.22219，hep-th/9901001v2 → hep-th/9901001
const stripArxivVersion = (id: string) => id.replace(/v\d+$/, "");

export const arxivDoi = (arxivId: string) =>
  `10.48550/arxiv.${stripArxivVersion(arxivId)}`.toLowerCase();

export const parseArxivFeed = (xml: string, pageUrl: string): PaperPage => {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  if (doc.querySelector("parsererror")) throw new Error("Invalid XML response");
  const papers: Paper[] = Array.from(doc.getElementsByTagName("entry")).map(
    (entry) => {
      const absUrl = clean(entry.getElementsByTagName("id")[0]?.textContent);
      const rawId = absUrl.replace(/^https?:\/\/arxiv\.org\/abs\//, "");
      const links = Array.from(entry.getElementsByTagName("link"));
      const pdf =
        links.find((l) => l.getAttribute("title") === "pdf")?.getAttribute("href") ||
        `https://arxiv.org/pdf/${rawId}`;
      const category =
        entry
          .getElementsByTagNameNS("http://arxiv.org/schemas/atom", "primary_category")[0]
          ?.getAttribute("term") || "";
      const id = stripArxivVersion(rawId);
      return {
        id,
        source: "arxiv",
        title: clean(entry.getElementsByTagName("title")[0]?.textContent),
        authors: Array.from(entry.getElementsByTagName("author")).map((a) =>
          clean(a.getElementsByTagName("name")[0]?.textContent)
        ),
        summary: clean(entry.getElementsByTagName("summary")[0]?.textContent),
        published: clean(
          entry.getElementsByTagName("published")[0]?.textContent
        ).slice(0, 10),
        venue: category,
        citations: null,
        pdfUrl: pdf.replace(/^http:/, "https:"),
        landingUrl: `https://arxiv.org/abs/${id}`,
        doi: arxivDoi(rawId),
      };
    }
  );
  const total = parseInt(
    doc.getElementsByTagNameNS("http://a9.com/-/spec/opensearch/1.1/", "totalResults")[0]
      ?.textContent || "0"
  );
  const start = parseInt(new URL(pageUrl).searchParams.get("start") || "0");
  let nextUrl = "";
  if (papers.length > 0 && start + papers.length < total) {
    const url = new URL(pageUrl);
    url.searchParams.set("start", String(start + papers.length));
    nextUrl = url.href;
  }
  return { papers, nextUrl };
};

interface EuropePmcFullTextUrl {
  documentStyle?: string;
  availabilityCode?: string;
  url?: string;
}

interface EuropePmcResult {
  id?: string;
  source?: string;
  pmcid?: string;
  doi?: string;
  title?: string;
  authorString?: string;
  abstractText?: string;
  pubYear?: string;
  firstPublicationDate?: string;
  citedByCount?: number | string;
  journalInfo?: { journal?: { title?: string } };
  fullTextUrlList?: { fullTextUrl?: EuropePmcFullTextUrl[] };
}

interface EuropePmcResponse {
  nextCursorMark?: string;
  resultList?: { result?: EuropePmcResult[] };
  request?: { cursorMark?: string };
}

const stripTags = (html: string) =>
  clean(new DOMParser().parseFromString(html, "text/html").body.textContent);

export const parseEuropePmc = (json: string, pageUrl: string): PaperPage => {
  const data: EuropePmcResponse = JSON.parse(json);
  const results = data.resultList?.result || [];
  const papers: Paper[] = results.map((r) => {
    const urls = r.fullTextUrlList?.fullTextUrl || [];
    // 优先 Europe PMC 自己渲染的开放获取 PDF，其次出版社的开放获取 PDF
    const oaPdfs = urls.filter(
      (u) => u.documentStyle === "pdf" && u.availabilityCode === "OA" && u.url
    );
    const pdf =
      oaPdfs.find((u) => u.url!.includes("europepmc.org"))?.url ||
      oaPdfs[0]?.url ||
      "";
    const citations = parseInt(String(r.citedByCount ?? ""));
    return {
      id: `${r.source}-${r.id}`,
      source: "europepmc",
      title: stripTags(r.title || "").replace(/\.$/, ""),
      authors: (r.authorString || "")
        .replace(/\.$/, "")
        .split(",")
        .map((a) => a.trim())
        .filter(Boolean),
      summary: stripTags(r.abstractText || ""),
      published: r.firstPublicationDate || r.pubYear || "",
      venue: r.journalInfo?.journal?.title || "",
      citations: isNaN(citations) ? null : citations,
      pdfUrl: pdf,
      landingUrl: r.pmcid
        ? `https://europepmc.org/article/PMC/${r.pmcid}`
        : `https://europepmc.org/article/${r.source}/${r.id}`,
      doi: (r.doi || "").toLowerCase(),
    };
  });
  // cursorMark 不变说明已经是最后一页
  const current = new URL(pageUrl).searchParams.get("cursorMark") || "*";
  let nextUrl = "";
  if (results.length > 0 && data.nextCursorMark && data.nextCursorMark !== current) {
    const url = new URL(pageUrl);
    url.searchParams.set("cursorMark", data.nextCursorMark);
    nextUrl = url.href;
  }
  return { papers, nextUrl };
};

interface OpenAlexLocation {
  landing_page_url?: string | null;
  source?: { id?: string; display_name?: string } | null;
}

interface OpenAlexSearchWork {
  id?: string;
  doi?: string | null;
  title?: string | null;
  cited_by_count?: number;
  publication_date?: string | null;
  authorships?: { author?: { display_name?: string } }[];
  primary_location?: OpenAlexLocation | null;
  locations?: OpenAlexLocation[];
  abstract_inverted_index?: Record<string, number[]> | null;
}

interface OpenAlexSearchResponse {
  meta?: { next_cursor?: string | null };
  results?: OpenAlexSearchWork[];
}

// OpenAlex 摘要以倒排索引返回：词 → 出现位置
const invertedIndexToText = (index?: Record<string, number[]> | null) => {
  if (!index) return "";
  const words: string[] = [];
  for (const [word, positions] of Object.entries(index)) {
    for (const pos of positions) words[pos] = word;
  }
  return clean(words.join(" "));
};

const ARXIV_ABS_RE = /arxiv\.org\/abs\/([^?#]+?)(?:v\d+)?$/i;
const ARXIV_DOI_RE = /10\.48550\/arxiv\.(.+)$/i;

const findArxivId = (work: OpenAlexSearchWork) => {
  const urls = [work.doi, ...(work.locations || []).map((l) => l.landing_page_url)];
  for (const url of urls) {
    const match = (url || "").match(ARXIV_ABS_RE) || (url || "").match(ARXIV_DOI_RE);
    if (match) return stripArxivVersion(match[1]);
  }
  return "";
};

export const parseOpenAlexArxiv = (json: string, pageUrl: string): PaperPage => {
  const data: OpenAlexSearchResponse = JSON.parse(json);
  const papers: Paper[] = [];
  for (const work of data.results || []) {
    const arxivId = findArxivId(work);
    if (!arxivId) continue;
    const primary = work.primary_location?.source;
    papers.push({
      id: arxivId,
      source: "arxiv",
      title: clean(work.title),
      authors: (work.authorships || [])
        .map((a) => clean(a.author?.display_name))
        .filter(Boolean),
      summary: invertedIndexToText(work.abstract_inverted_index),
      published: work.publication_date || "",
      // 正式发表后显示期刊/会议名
      venue:
        primary?.id?.endsWith(OPENALEX_ARXIV_SOURCE) || !primary?.display_name
          ? "arXiv"
          : primary.display_name,
      citations: work.cited_by_count ?? null,
      pdfUrl: `https://arxiv.org/pdf/${arxivId}`,
      landingUrl: `https://arxiv.org/abs/${arxivId}`,
      doi: arxivDoi(arxivId),
    });
  }
  let nextUrl = "";
  const cursor = data.meta?.next_cursor;
  if ((data.results || []).length > 0 && cursor) {
    const url = new URL(pageUrl);
    url.searchParams.set("cursor", cursor);
    nextUrl = url.href;
  }
  return { papers, nextUrl };
};

export const fetchPaperPage = async (
  source: PaperSourceId,
  url: string
): Promise<PaperPage> => {
  // Europe PMC 偶尔 30 秒以上才返回 5xx，超时后让用户重试，而不是一直转圈
  const response = await fetch(url, {
    signal: AbortSignal.timeout(REQUEST_TIMEOUT),
  });
  if (!response.ok)
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  const text = await response.text();
  if (url.startsWith(OPENALEX_API)) return parseOpenAlexArxiv(text, url);
  return source === "arxiv"
    ? parseArxivFeed(text, url)
    : parseEuropePmc(text, url);
};

interface OpenAlexWork {
  doi?: string;
  cited_by_count?: number;
  locations?: { landing_page_url?: string }[];
}

export const normalizeDoi = (value: string) =>
  value.replace(/^https?:\/\/(dx\.)?doi\.org\//i, "").toLowerCase();

/**
 * 批量查询 OpenAlex 被引次数，返回 doi → 次数。
 * 匿名访问有每日额度，失败时返回空表，界面不显示被引数即可。
 */
export const fetchCitationCounts = async (
  dois: string[]
): Promise<Map<string, number>> => {
  const result = new Map<string, number>();
  const unique = Array.from(new Set(dois.filter(Boolean)));
  if (unique.length === 0) return result;
  const params = new URLSearchParams({
    filter: `doi:${unique.join("|")}`,
    select: "doi,cited_by_count,locations",
    "per-page": "50",
  });
  try {
    const response = await fetch(`${OPENALEX_API}?${params.toString()}`, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT),
    });
    if (!response.ok) return result;
    const data: { results?: OpenAlexWork[] } = await response.json();
    const wanted = new Set(unique.map(normalizeDoi));
    for (const work of data.results || []) {
      // 预印本后来正式发表时，OpenAlex 会把它合并到期刊版本，主 DOI 变成期刊 DOI，
      // arXiv DOI 只出现在 locations 里，所以要在所有位置里找回查询用的 DOI
      const candidates = [
        work.doi,
        ...(work.locations || []).map((l) => l.landing_page_url),
      ];
      for (const candidate of candidates) {
        const doi = normalizeDoi(candidate || "");
        if (wanted.has(doi)) result.set(doi, work.cited_by_count || 0);
      }
    }
  } catch (err) {
    console.error("fetch citation counts failed", err);
  }
  return result;
};

/** 下载 PDF 前用作文件名 */
export const paperFileName = (paper: Paper) =>
  paper.title.replace(/[/\\?%*:|"<>]/g, "-").slice(0, 120) || paper.id;
