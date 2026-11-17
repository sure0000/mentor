// AI 伴读：对阅读器 rendition 的所有调用集中在这里（需求 §8：引擎升级时只改这一处）
import type { IndexChapter } from "./indexText";

type ReaderRendition = {
  goToPosition: (position: string) => Promise<unknown>;
};

/** 跳到索引中的某一章（按 chapterDocIndex，与 navList 的跳转参数一致） */
export const jumpToChapter = (
  rendition: ReaderRendition,
  chapter: Pick<IndexChapter, "docIndex" | "href" | "title">
) =>
  rendition.goToPosition(
    JSON.stringify({
      text: "",
      chapterTitle: chapter.title,
      chapterDocIndex: chapter.docIndex,
      chapterHref: chapter.href,
      count: 0,
      percentage: 0,
      cfi: "",
    })
  );

type PositionRendition = {
  getPosition: () => { chapterDocIndex?: string | number };
  on: (event: string, cb: () => void) => void;
  off?: (event: string, cb: () => void) => void;
};

/** 当前阅读位置所在的文档下标（与索引的 docIndex 对应）；取不到时为 -1 */
export const getCurrentDocIndex = (rendition: PositionRendition) => {
  try {
    const value = parseInt(String(rendition.getPosition()?.chapterDocIndex ?? ""));
    return Number.isFinite(value) ? value : -1;
  } catch (e) {
    return -1;
  }
};

/** 订阅翻页 / 重新渲染，返回取消订阅函数 */
export const onReaderPositionChange = (
  rendition: PositionRendition,
  cb: () => void
) => {
  rendition.on("page-changed", cb);
  rendition.on("rendered", cb);
  return () => {
    rendition.off?.("page-changed", cb);
    rendition.off?.("rendered", cb);
  };
};

type SearchRendition = {
  doSearch: (q: string) => Promise<{ cfi: string; excerpt: string }[]>;
  goToPosition: (position: string) => Promise<unknown>;
};

/**
 * 跳到原文短引所在位置：用引擎的全书搜索找到短引片段，取与目标章节一致的结果跳过去（段落级）；
 * 找不到时退回到章节开头。
 */
export const jumpToQuote = async (
  rendition: SearchRendition,
  target: { docIndex: number; title: string; href?: string },
  quote: string
) => {
  // 搜索用短引中较长的一段连续文字（引擎按原文匹配，标点差异会导致搜不到）
  const probe =
    quote
      .split(/[，。、；：！？,.;:!?“”"'‘’「」()（）\s]+/)
      .sort((a, b) => b.length - a.length)[0] || quote;
  if (probe.length >= 4) {
    try {
      const results = await rendition.doSearch(probe.slice(0, 30));
      const hit =
        results.find((r) => {
          try {
            return parseInt(JSON.parse(r.cfi).chapterDocIndex) === target.docIndex;
          } catch (e) {
            return false;
          }
        }) || null;
      if (hit) {
        const loc = JSON.parse(hit.cfi);
        await rendition.goToPosition(
          JSON.stringify({
            text: loc.text,
            chapterTitle: loc.chapterTitle,
            chapterDocIndex: loc.chapterDocIndex,
            chapterHref: loc.chapterHref,
            count: loc.hasOwnProperty("cfi") ? "ignore" : loc.count,
            percentage: loc.percentage,
            cfi: loc.cfi,
            page: loc.page,
          })
        );
        return "quote" as const;
      }
    } catch (e) {
      console.warn("quote search failed", e);
    }
  }
  await jumpToChapter(rendition, {
    docIndex: target.docIndex,
    href: target.href || "",
    title: target.title,
  });
  return "chapter" as const;
};
