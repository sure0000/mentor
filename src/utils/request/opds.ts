import CryptoJS from "crypto-js";
import { supportedFormats } from "../common";
import { fetchWithPolicy } from "./http";
import type { HttpOptions } from "./http";

export interface OPDSCatalog {
  id: string;
  title: string;
  url: string;
  username?: string;
  password?: string;
  isBuiltIn?: boolean;
  isElectronicOnly?: boolean;
}

export interface OPDSLink {
  href: string;
  type: string;
  rel: string;
  title?: string;
}

export interface OPDSEntry {
  id: string;
  title: string;
  authors: string[];
  summary: string;
  coverUrl: string;
  thumbnailUrl: string;
  links: OPDSLink[];
  updated: string;
  isNavigation: boolean;
  // Dublin Core metadata
  publisher: string;
  language: string;
  pubDate: string;
  rights: string;
  categories: string[];
}

export interface OPDSFeed {
  title: string;
  url: string;
  entries: OPDSEntry[];
  links: OPDSLink[];
  searchTemplate: string;
}

export const DOWNLOAD_TYPES: Record<string, string> = {
  "application/epub+zip": "epub",
  "application/epub": "epub",
  "application/pdf": "pdf",
  "application/x-pdf": "pdf",
  "text/plain": "txt",
  "application/x-mobipocket-ebook": "mobi",
  "application/vnd.amazon.ebook": "azw",
  "application/x-mobi8-ebook": "azw3",
  "application/vnd.amazon.mobi8-ebook": "azw3",
  "text/html": "html",
  "application/xml": "xml",
  "text/xml": "xml",
  "application/xhtml+xml": "xhtml",
  "application/x-mimearchive": "mhtml",
  "message/rfc822": "mhtml",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    "docx",
  "application/msword": "doc",
  "application/rtf": "rtf",
  "text/rtf": "rtf",
  "text/markdown": "md",
  "text/x-markdown": "md",
  "application/fb2+zip": "fb2",
  "application/fb2": "fb2",
  "application/x-fb2": "fb2",
  "application/vnd.ms-htmlhelp": "chm",
  "application/x-chm": "chm",
  "application/vnd.ms-htmlhelpfile": "chm",
  "application/x-cbz": "cbz",
  "application/vnd.comicbook+zip": "cbz",
  "application/x-cbt": "cbt",
  "application/vnd.comicbook+tar": "cbt",
  "application/x-cbr": "cbr",
  "application/vnd.comicbook-rar": "cbr",
  "application/x-cb7": "cb7",
  "application/vnd.comicbook+7z": "cb7",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation":
    "pptx",
  "application/vnd.ms-powerpoint": "ppt",
  "application/oxps": "oxps",
  "application/vnd.ms-xpsdocument": "xps",
  "image/vnd.djvu": "djvu",
  "application/ofd": "ofd",
  "application/x-ofd": "ofd",
  "application/x-caj": "caj",
  "application/caj": "caj",
};

export const ACQUISITION_RELS = [
  "http://opds-spec.org/acquisition",
  "http://opds-spec.org/acquisition/open-access",
  "http://opds-spec.org/acquisition/buy",
  "http://opds-spec.org/acquisition/borrow",
  "http://opds-spec.org/acquisition/sample",
  // 普通 Atom feed（如 Standard Ebooks）用 enclosure 表示可下载文件
  "enclosure",
];

function encodeBasicAuth(username: string, password: string): string {
  return btoa(unescape(encodeURIComponent(`${username}:${password}`)));
}

function getBaseRequestHeaders(
  extraHeaders: Record<string, string> = {}
): Record<string, string> {
  return {
    Accept: "application/atom+xml, application/xml, text/html, text/xml, */*",
    ...extraHeaders,
  };
}

function getBasicAuthHeader(
  catalog?: Pick<OPDSCatalog, "username" | "password"> | null
): string {
  if (!catalog?.username && !catalog?.password) return "";
  return `Basic ${encodeBasicAuth(catalog?.username || "", catalog?.password || "")}`;
}

function randomString(): string {
  return Math.random().toString(36).slice(2, 12);
}

function parseDigestChallenge(header: string): Record<string, string> {
  const digestPart = header.replace(/^Digest\s+/i, "");
  const result: Record<string, string> = {};
  const pattern = /([a-z0-9_-]+)=("([^"]*)"|([^,\s]+))/gi;
  let match: RegExpExecArray | null = null;
  while ((match = pattern.exec(digestPart))) {
    result[match[1]] = match[3] || match[4] || "";
  }
  return result;
}

function buildDigestAuthHeader(
  url: string,
  method: string,
  catalog: Pick<OPDSCatalog, "username" | "password">,
  challengeHeader: string
): string {
  const challenge = parseDigestChallenge(challengeHeader);
  const username = catalog.username || "";
  const password = catalog.password || "";
  const parsedUrl = new URL(url);
  const uri = `${parsedUrl.pathname}${parsedUrl.search}`;
  const realm = challenge.realm || "";
  const nonce = challenge.nonce || "";
  const algorithm = (challenge.algorithm || "MD5").toUpperCase();
  const qopList = (challenge.qop || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const qop = qopList.includes("auth") ? "auth" : qopList[0] || "";
  const nc = "00000001";
  const cnonce = randomString();
  const hash = (value: string) => CryptoJS.MD5(value.trim()).toString();

  let ha1 = hash(`${username}:${realm}:${password}`);
  if (algorithm === "MD5-SESS") {
    ha1 = hash(`${ha1}:${nonce}:${cnonce}`);
  }
  const ha2 = hash(`${method.toUpperCase()}:${uri}`);
  const response = qop
    ? hash(`${ha1}:${nonce}:${nc}:${cnonce}:${qop}:${ha2}`)
    : hash(`${ha1}:${nonce}:${ha2}`);

  const parts = [
    `Digest username="${username}"`,
    `realm="${realm}"`,
    `nonce="${nonce}"`,
    `uri="${uri}"`,
    `response="${response}"`,
  ];
  if (challenge.opaque) {
    parts.push(`opaque="${challenge.opaque}"`);
  }
  if (algorithm) {
    parts.push(`algorithm="${challenge.algorithm || "MD5"}"`);
  }
  if (qop) {
    parts.push(`qop="${qop}"`);
    parts.push(`nc=${nc}`);
    parts.push(`cnonce="${cnonce}"`);
  }
  return parts.join(", ");
}

export async function fetchWithCatalogAuth(
  url: string,
  init: RequestInit = {},
  catalog?: Pick<OPDSCatalog, "username" | "password"> | null,
  options: HttpOptions = {}
): Promise<Response> {
  const method = init.method || "GET";
  const baseHeaders = {
    ...getBaseRequestHeaders(init.headers as Record<string, string>),
  };
  const firstResponse = await fetchWithPolicy(
    url,
    {
      ...init,
      method,
      headers: baseHeaders,
    },
    options
  );
  if (
    firstResponse.status !== 401 ||
    !catalog ||
    (!catalog.username && !catalog.password)
  ) {
    return firstResponse;
  }

  const challengeHeader = firstResponse.headers.get("www-authenticate") || "";
  let authorization = "";
  if (/^Digest\s+/i.test(challengeHeader)) {
    authorization = buildDigestAuthHeader(
      url,
      method,
      catalog,
      challengeHeader
    );
  } else if (/^Basic\s+/i.test(challengeHeader)) {
    authorization = getBasicAuthHeader(catalog);
  } else if (challengeHeader.toLowerCase().includes("digest")) {
    authorization = buildDigestAuthHeader(
      url,
      method,
      catalog,
      challengeHeader
    );
  } else {
    authorization = getBasicAuthHeader(catalog);
  }

  return fetchWithPolicy(
    url,
    {
      ...init,
      method,
      headers: {
        ...baseHeaders,
        Authorization: authorization,
      },
    },
    options
  );
}

function resolveUrl(href: string, baseUrl: string): string {
  if (!href) return "";
  try {
    return new URL(href, baseUrl).href;
  } catch {
    return href;
  }
}

// Query Dublin Core elements across dc: and dcterms: namespaces
function getDC(entry: Element, localName: string): string {
  return (
    entry.getElementsByTagNameNS(
      "http://purl.org/dc/elements/1.1/",
      localName
    )[0]?.textContent ||
    entry.getElementsByTagNameNS("http://purl.org/dc/terms/", localName)[0]
      ?.textContent ||
    ""
  );
}

export function parseOPDSFeed(xmlText: string, feedUrl: string): OPDSFeed {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlText, "application/xml");
  if (doc.querySelector("parsererror")) {
    throw new Error("Invalid XML response");
  }

  const feedTitle =
    doc.querySelector("feed > title")?.textContent ||
    doc.querySelector("title")?.textContent ||
    "";

  const feedLinks: OPDSLink[] = Array.from(
    doc.querySelectorAll("feed > link")
  ).map((link) => ({
    href: resolveUrl(link.getAttribute("href") || "", feedUrl),
    type: link.getAttribute("type") || "",
    rel: link.getAttribute("rel") || "",
    title: link.getAttribute("title") || undefined,
  }));

  let searchTemplate = "";
  const searchLink = feedLinks.find(
    (l) =>
      l.rel === "search" ||
      l.type?.includes("opensearch") ||
      l.type?.includes("application/opensearchdescription")
  );
  if (searchLink) searchTemplate = searchLink.href;

  const entries: OPDSEntry[] = Array.from(doc.querySelectorAll("entry")).map(
    (entry) => {
      const entryLinks: OPDSLink[] = Array.from(
        entry.querySelectorAll("link")
      ).map((link) => ({
        href: resolveUrl(link.getAttribute("href") || "", feedUrl),
        type: link.getAttribute("type") || "",
        rel: link.getAttribute("rel") || "",
        title: link.getAttribute("title") || undefined,
      }));

      const hasAcquisitionLink = entryLinks.some((l) =>
        ACQUISITION_RELS.some((rel) => l.rel === rel)
      );
      const hasSupportedDownload = entryLinks.some(
        (l) =>
          ACQUISITION_RELS.some((rel) => l.rel === rel) &&
          supportedFormats.includes("." + (DOWNLOAD_TYPES[l.type] || ""))
      );
      const hasNavigationLink = entryLinks.some(
        (l) =>
          l.type?.includes("application/atom+xml") ||
          l.type?.includes("text/html") ||
          l.rel === "subsection" ||
          l.rel === "related"
      );
      const isNavigation =
        hasNavigationLink && !hasAcquisitionLink && !hasSupportedDownload;

      const coverLink = entryLinks.find(
        (l) =>
          l.rel === "http://opds-spec.org/image" ||
          l.rel === "http://opds-spec.org/cover"
      );
      const thumbnailLink =
        entryLinks.find(
          (l) =>
            l.rel === "http://opds-spec.org/image/thumbnail" ||
            l.rel === "http://opds-spec.org/thumbnail"
        ) || coverLink;
      // 普通 Atom feed 用 Media RSS 的 <media:thumbnail url="..."> 提供封面
      const mediaThumbnail = resolveUrl(
        entry
          .getElementsByTagNameNS("http://search.yahoo.com/mrss/", "thumbnail")[0]
          ?.getAttribute("url") || "",
        feedUrl
      );

      const authors = Array.from(entry.querySelectorAll("author"))
        .map((a) => a.querySelector("name")?.textContent || "")
        .filter(Boolean);

      const categories = Array.from(entry.querySelectorAll("category"))
        .map((c) => c.getAttribute("label") || c.getAttribute("term") || "")
        .filter(Boolean);

      const summaryEl =
        entry.querySelector("summary") || entry.querySelector("content");
      // Atom text construct: type="html" holds escaped markup that
      // textContent already decodes, type="xhtml" holds real child elements.
      const summary = summaryEl
        ? summaryEl.getAttribute("type")?.includes("xhtml")
          ? summaryEl.innerHTML
          : summaryEl.textContent || ""
        : "";

      return {
        id: entry.querySelector("id")?.textContent || "",
        title: entry.querySelector("title")?.textContent || "",
        authors,
        summary,
        coverUrl: coverLink?.href || mediaThumbnail,
        thumbnailUrl: thumbnailLink?.href || mediaThumbnail,
        links: entryLinks,
        updated: entry.querySelector("updated")?.textContent || "",
        isNavigation,
        publisher: getDC(entry, "publisher"),
        language: getDC(entry, "language"),
        pubDate: getDC(entry, "date") || getDC(entry, "issued"),
        rights: getDC(entry, "rights"),
        categories,
      };
    }
  );

  return {
    title: feedTitle,
    url: feedUrl,
    entries,
    links: feedLinks,
    searchTemplate,
  };
}

export async function fetchOPDSFeed(
  url: string,
  catalog?: Pick<OPDSCatalog, "username" | "password"> | null
): Promise<OPDSFeed> {
  const response = await fetchWithCatalogAuth(url, {}, catalog);
  if (!response.ok)
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  const text = await response.text();
  return parseOPDSFeed(text, url);
}

export async function downloadOPDSFile(
  title: string,
  link: OPDSLink,
  catalog?: Pick<OPDSCatalog, "username" | "password"> | null
): Promise<File> {
  const ext = DOWNLOAD_TYPES[link.type] || link.href.split(".").pop() || "";
  // 整本书可能有几十 MB，按大文件放宽超时且不重试
  const response = await fetchWithCatalogAuth(link.href, {}, catalog, {
    timeout: 10 * 60 * 1000,
    retries: 0,
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const arrayBuffer = await response.arrayBuffer();
  const fileName = title.replace(/[/\\?%*:|"<>]/g, "-") + "." + ext;
  return new File([arrayBuffer], fileName);
}
