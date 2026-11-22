// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  arxivDoi,
  fetchCitationCounts,
  buildArxivKeywordUrl,
  buildArxivSearchUrl,
  buildEuropePmcUrl,
  parseArxivFeed,
  parseEuropePmc,
  parseOpenAlexArxiv,
  buildCategoryUrl,
  paperCategories,
} from "./papers";

// 结构取自 arXiv API 真实返回（2026-11），只保留解析用到的节点
const ARXIV = `<?xml version='1.0' encoding='UTF-8'?>
<feed xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/" xmlns:arxiv="http://arxiv.org/schemas/atom" xmlns="http://www.w3.org/2005/Atom">
  <opensearch:totalResults>3</opensearch:totalResults>
  <opensearch:startIndex>0</opensearch:startIndex>
  <entry>
    <id>http://arxiv.org/abs/2611.22219v1</id>
    <title>Fine-Grained Japanese Clinical
      Named Entity Recognition</title>
    <published>2026-11-17T05:01:24Z</published>
    <summary>  Background: LLMs offer an alternative. </summary>
    <author><name>Taro Yamada</name></author>
    <author><name>Hanako Sato</name></author>
    <link href="https://arxiv.org/abs/2611.22219v1" rel="alternate" type="text/html"/>
    <link href="https://arxiv.org/pdf/2611.22219v1" rel="related" type="application/pdf" title="pdf"/>
    <arxiv:primary_category term="cs.CL"/>
  </entry>
</feed>`;

const EPMC = JSON.stringify({
  nextCursorMark: "AoJXrBAo",
  resultList: {
    result: [
      {
        id: "25516281",
        source: "MED",
        pmcid: "PMC4302049",
        doi: "10.1186/S13059-014-0550-8",
        title: "Moderated estimation of <i>fold change</i>.",
        authorString: "Love MI, Huber W, Anders S.",
        abstractText: "In comparative <b>sequencing</b> assays",
        firstPublicationDate: "2014-01-01",
        citedByCount: 85130,
        journalInfo: { journal: { title: "Genome Biology" } },
        fullTextUrlList: {
          fullTextUrl: [
            { documentStyle: "doi", availabilityCode: "S", url: "https://doi.org/x" },
            { documentStyle: "pdf", availabilityCode: "OA", url: "https://academic.example/a.pdf" },
            { documentStyle: "pdf", availabilityCode: "OA", url: "https://europepmc.org/articles/PMC4302049?pdf=render" },
          ],
        },
      },
    ],
  },
});

describe("papers", () => {
  it("解析 arXiv feed：去版本号、合并换行、生成 DOI 和下一页", () => {
    const url = "https://export.arxiv.org/api/query?search_query=cat:cs.CL&start=0&max_results=25";
    const page = parseArxivFeed(ARXIV, url);
    expect(page.papers[0]).toEqual({
      id: "2611.22219",
      source: "arxiv",
      title: "Fine-Grained Japanese Clinical Named Entity Recognition",
      authors: ["Taro Yamada", "Hanako Sato"],
      summary: "Background: LLMs offer an alternative.",
      published: "2026-11-17",
      venue: "cs.CL",
      citations: null,
      pdfUrl: "https://arxiv.org/pdf/2611.22219v1",
      landingUrl: "https://arxiv.org/abs/2611.22219",
      doi: "10.48550/arxiv.2611.22219",
    });
    expect(new URL(page.nextUrl).searchParams.get("start")).toBe("1");
  });

  it("arXiv 已到最后一页时没有 nextUrl", () => {
    const url = "https://export.arxiv.org/api/query?search_query=x&start=2&max_results=25";
    expect(parseArxivFeed(ARXIV, url).nextUrl).toBe("");
  });

  it("旧式 arXiv id 生成 DOI", () => {
    expect(arxivDoi("hep-th/9901001v2")).toBe("10.48550/arxiv.hep-th/9901001");
  });

  it("多词先按标题短语检索，单词直接全文检索", () => {
    const phrase = new URL(buildArxivSearchUrl(' Attention is "all" you (need) '));
    expect(phrase.searchParams.get("search_query")).toBe('ti:"Attention is all you need"');
    const single = new URL(buildArxivSearchUrl("transformer"));
    expect(single.searchParams.get("search_query")).toBe("all:transformer");
  });

  it("关键词检索去掉停用词；全是停用词时保留原词", () => {
    const url = new URL(buildArxivKeywordUrl("Attention is all you need"));
    expect(url.searchParams.get("search_query")).toBe("all:Attention AND all:need");
    const allStop = new URL(buildArxivKeywordUrl("is it"));
    expect(allStop.searchParams.get("search_query")).toBe("all:is AND all:it");
  });

  it("解析 Europe PMC：去标签、优先 Europe PMC 的开放获取 PDF、被引数", () => {
    const url = buildEuropePmcUrl("", "CITED desc");
    const page = parseEuropePmc(EPMC, url);
    expect(page.papers[0]).toMatchObject({
      id: "MED-25516281",
      title: "Moderated estimation of fold change",
      authors: ["Love MI", "Huber W", "Anders S"],
      summary: "In comparative sequencing assays",
      venue: "Genome Biology",
      citations: 85130,
      pdfUrl: "https://europepmc.org/articles/PMC4302049?pdf=render",
      landingUrl: "https://europepmc.org/article/PMC/PMC4302049",
      doi: "10.1186/s13059-014-0550-8",
    });
    expect(new URL(page.nextUrl).searchParams.get("cursorMark")).toBe("AoJXrBAo");
  });

  it("Europe PMC 查询总是限定开放获取且有 PDF", () => {
    const query = new URL(buildEuropePmcUrl("crispr", "CITED desc")).searchParams.get("query");
    expect(query).toBe("(crispr) AND OPEN_ACCESS:y AND HAS_PDF:y");
  });

  it("解析 OpenAlex 的 arXiv 结果：还原摘要、arXiv id、正式发表的期刊名、下一页游标", () => {
    const json = JSON.stringify({
      meta: { next_cursor: "abc" },
      results: [
        {
          doi: "https://doi.org/10.1145/2939672.2939785",
          title: "XGBoost: A Scalable Tree Boosting System",
          cited_by_count: 77687,
          publication_date: "2016-08-13",
          authorships: [{ author: { display_name: "Tianqi Chen" } }],
          primary_location: { source: { id: "https://openalex.org/S1", display_name: "KDD" } },
          locations: [{ landing_page_url: "http://arxiv.org/abs/1603.02754v3" }],
          abstract_inverted_index: { Tree: [0], boosting: [1], works: [2] },
        },
        { doi: "https://doi.org/10.1/none", title: "No arXiv", locations: [] },
      ],
    });
    const page = parseOpenAlexArxiv(json, "https://api.openalex.org/works?cursor=*");
    expect(page.papers).toHaveLength(1);
    expect(page.papers[0]).toMatchObject({
      id: "1603.02754",
      citations: 77687,
      venue: "KDD",
      summary: "Tree boosting works",
      pdfUrl: "https://arxiv.org/pdf/1603.02754",
      doi: "10.48550/arxiv.1603.02754",
    });
    expect(new URL(page.nextUrl).searchParams.get("cursor")).toBe("abc");
  });

  it("arXiv 分类按被引排序走 OpenAlex，按最新走 arXiv API", () => {
    const ai = paperCategories[0];
    expect(buildCategoryUrl(ai, "cited")).toContain("api.openalex.org");
    expect(buildCategoryUrl(ai, "cited")).toContain("sort=cited_by_count%3Adesc");
    expect(buildCategoryUrl(ai, "latest")).toContain("export.arxiv.org");
  });

  describe("fetchCitationCounts", () => {
    afterEach(() => vi.unstubAllGlobals());

    it("预印本合并到期刊版本后，按 locations 里的 arXiv DOI 找回被引数", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () =>
          new Response(
            JSON.stringify({
              results: [
                {
                  doi: "https://doi.org/10.1038/s41586-025-09422-z",
                  cited_by_count: 18933,
                  locations: [
                    { landing_page_url: "http://arxiv.org/abs/2501.12948" },
                    { landing_page_url: "https://doi.org/10.48550/arxiv.2501.12948" },
                  ],
                },
                {
                  doi: "https://doi.org/10.48550/arxiv.1706.03762",
                  cited_by_count: 151508,
                  locations: [],
                },
              ],
            })
          )
        )
      );
      const counts = await fetchCitationCounts([
        "10.48550/arxiv.2501.12948",
        "10.48550/arxiv.1706.03762",
      ]);
      expect(counts.get("10.48550/arxiv.2501.12948")).toBe(18933);
      expect(counts.get("10.48550/arxiv.1706.03762")).toBe(151508);
    });

    it("限流或网络失败时返回空表", async () => {
      vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 429 })));
      expect((await fetchCitationCounts(["10.1/a"])).size).toBe(0);
    });
  });
});
