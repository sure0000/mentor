// AI 伴读：提取器 iframe 的入口（extractor.html）。
// 在独立的 document 里创建一个不可见的 rendition，逐章取文本。
// 必须与阅读器隔离：实测在主页面里再建 rendition 会与阅读器的 #page-area 冲突，renderTo 永不返回。
import * as Kookit from "../../../assets/lib/kookit.min";
import { BookHelper } from "../../../assets/lib/kookit.min";
import { pickChapterText, RawChapter, TocItem } from "../indexText";
import { EXTRACTOR_CHANNEL, ExtractorEvent, ToExtractor } from "./protocol";

type Rendition = {
  renderTo: (el: HTMLElement) => Promise<unknown>;
  getChapterDoc: () => { label?: string; href?: string }[];
  getChapter: () => unknown;
  flatChapter: (c: unknown) => { label?: string; href?: string; index?: number }[];
  goToPosition: (pos: string) => Promise<unknown>;
  getPosition: () => { chapterTitle?: string };
  chapterText: () => Promise<string>;
};

const STEP_TIMEOUT_MS = 30000;
const RENDER_TIMEOUT_MS = 90000;

const post = (msg: ExtractorEvent) =>
  window.parent.postMessage({ channel: EXTRACTOR_CHANNEL, ...msg }, "*");

const withTimeout = <T,>(p: Promise<T>, ms: number, what: string) =>
  Promise.race<T>([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error("timeout: " + what)), ms)
    ),
  ]);

const yieldToEventLoop = () => new Promise((r) => setTimeout(r, 0));

const extract = async (req: ToExtractor) => {
  const host = document.getElementById("page-area") as HTMLElement;
  host.innerHTML = "";
  const o = req.options;
  const rendition = BookHelper.getRendition(
    req.buffer,
    {
      format: o.format,
      readerMode: "single",
      charset: o.charset || "utf-8",
      animation: "none",
      convertChinese: o.convertChinese,
      bookLayout: "",
      textRules: o.textRules,
      codeHighlight: "",
      fullTranslationMode: "no",
      textOrientation: "",
      parserRegex: o.parserRegex,
      isDarkMode: "no",
      isMobile: "no",
      password: o.password,
      isScannedPDF: "no",
      isKeepPDFBackground: "no",
    },
    Kookit
  ) as Rendition;
  await withTimeout(rendition.renderTo(host), RENDER_TIMEOUT_MS, "render");

  const docs = rendition.getChapterDoc() || [];
  const toc: TocItem[] = (rendition.flatChapter(rendition.getChapter()) || []).map(
    (c) => ({ label: c.label || "", href: c.href || "", level: c.index || 0 })
  );
  const chapters: RawChapter[] = [];
  for (let i = 0; i < docs.length; i++) {
    const doc = docs[i] || {};
    const row: RawChapter = {
      docIndex: i,
      href: doc.href || "",
      label: doc.label || "",
      positionTitle: "",
      text: "",
    };
    try {
      await withTimeout(
        rendition.goToPosition(
          JSON.stringify({
            chapterDocIndex: i,
            chapterHref: doc.href || "",
            chapterTitle: doc.label || "",
            count: 0,
            percentage: 0,
            text: "",
            cfi: "",
          })
        ),
        STEP_TIMEOUT_MS,
        "goto"
      );
      row.positionTitle = rendition.getPosition()?.chapterTitle || "";
      const engineText = await withTimeout(
        rendition.chapterText(),
        STEP_TIMEOUT_MS,
        "text"
      );
      const frame = host.querySelector("iframe");
      const domText = frame?.contentDocument?.body?.innerText || "";
      row.text = pickChapterText(engineText || "", domText);
    } catch (e) {
      row.error = String(e instanceof Error ? e.message : e).slice(0, 200);
    }
    chapters.push(row);
    post({ type: "progress", done: i + 1, total: docs.length });
    await yieldToEventLoop();
  }
  post({ type: "result", chapters, toc });
};

window.addEventListener("message", (event: MessageEvent) => {
  const data = event.data as ToExtractor;
  if (event.source !== window.parent || !data || data.channel !== EXTRACTOR_CHANNEL) {
    return;
  }
  if (data.type === "extract") {
    extract(data).catch((e) =>
      post({
        type: "error",
        message: String(e instanceof Error ? e.message : e).slice(0, 300),
      })
    );
  }
});

post({ type: "ready" });
