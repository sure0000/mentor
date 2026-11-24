// 全文翻译的「小段」切分与 DOM 标记。
// 引擎自带的全文翻译按整段（叶子块元素）追加译文，长段落对照不便；
// 这里把每段按句子切成小段，在每个小段末尾插入一个空的 <mentor-tr> 标记，
// 译文通过 ::after { content: attr(data-t) } 显示：
// - 标记不含文本，textContent / 引擎定位 / 已有高亮的字符区间都不受影响
// - 标记本身 display:inline（rangy 不会把它当作换行），只有伪元素是块级

export interface TextSegment {
  start: number;
  end: number;
  text: string;
}

// 加权长度（CJK 记 2）达到该值才结束一个小段：英文约 1~2 句，中文约 40 字
export const SEGMENT_MIN_WEIGHT = 80;

// 翻译单位：paragraph 整段一条译文（上下行对照，语境完整、译文更连贯）；sentence 按句子小段
export type TranslationUnit = "paragraph" | "sentence";
export const minWeightOf = (unit: TranslationUnit) =>
  unit === "sentence" ? SEGMENT_MIN_WEIGHT : Infinity;

const CJK_RE = /[぀-ヿ㐀-䶿一-鿿豈-﫿가-힯]/;

const weightOf = (text: string) => {
  let weight = 0;
  for (const ch of text) weight += CJK_RE.test(ch) ? 2 : 1;
  return weight;
};

const splitSentences = (text: string): { start: number; end: number }[] => {
  const Segmenter = (Intl as any).Segmenter;
  if (typeof Segmenter === "function") {
    const segments = new Segmenter(undefined, { granularity: "sentence" }).segment(text);
    return Array.from(segments as Iterable<{ index: number; segment: string }>).map((s) => ({
      start: s.index,
      end: s.index + s.segment.length,
    }));
  }
  const result: { start: number; end: number }[] = [];
  const re = /[^.!?。！？]*[.!?。！？]+["'”’」』)）]*\s*|[^.!?。！？]+$/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) && m[0]) {
    result.push({ start: m.index, end: m.index + m[0].length });
  }
  return result;
};

/** 把一段文本切成若干小段：短句合并，直到加权长度达到阈值；过短的尾巴并入前一段 */
export const splitSegments = (
  text: string,
  minWeight: number = SEGMENT_MIN_WEIGHT
): TextSegment[] => {
  if (!text.trim()) return [];
  const ranges: { start: number; end: number }[] = [];
  let current: { start: number; end: number } | null = null;
  for (const sentence of splitSentences(text)) {
    if (!current) current = { ...sentence };
    else current.end = sentence.end;
    if (weightOf(text.slice(current.start, current.end).trim()) >= minWeight) {
      ranges.push(current);
      current = null;
    }
  }
  if (current) {
    const last = ranges[ranges.length - 1];
    const tail = text.slice(current.start, current.end).trim();
    if (last && weightOf(tail) < minWeight / 3) last.end = current.end;
    else ranges.push(current);
  }
  return ranges
    .map((r) => ({ ...r, text: text.slice(r.start, r.end).trim() }))
    .filter((r) => r.text.length > 0);
};

/* ---------------- DOM ---------------- */

export const MARKER_TAG = "mentor-tr";
const DECORATED_ATTR = "data-mentor-tr";
const BLOCK_SELECTOR =
  "h1,h2,h3,h4,h5,h6,p,div,ul,dl,ol,li,dt,dd,pre,blockquote,address";
const PARENT_BLOCK_RE =
  /^(address|kookitmarker|section|blockquote|body|center|dir|div|dl|fieldset|form|h[1-6]|hr|isindex|menu|noframes|noscript|ol|p|pre|table|ul|dd|dt|frameset|li|tbody|td|tfoot|th|thead|tr|html)$/i;

const isParentBlock = (el: Element) =>
  Array.from(el.children).some((child) => PARENT_BLOCK_RE.test(child.nodeName));

const isTranslatableText = (text: string) =>
  !!text.trim() && text !== "img" && !text.startsWith("img");

/** 与引擎 getAudioText 一致的叶子块：没有块级子元素、有文本、不嵌套在另一个叶子块里 */
export const getLeafBlocks = (root: ParentNode): Element[] => {
  const leaves = Array.from(root.querySelectorAll(BLOCK_SELECTOR)).filter(
    (el) => !isParentBlock(el)
  );
  const leafSet = new Set(leaves);
  return leaves.filter((el) => {
    if (!isTranslatableText(el.textContent || "")) return false;
    for (let p = el.parentElement; p; p = p.parentElement) {
      if (leafSet.has(p)) return false;
    }
    return true;
  });
};

/** 从纯文本列表（后台章节，未渲染）得到与 DOM 一致的小段文本 */
export const getSegmentTexts = (
  blockTexts: string[],
  unit: TranslationUnit = "sentence"
): string[] =>
  blockTexts
    .filter(isTranslatableText)
    .flatMap((text) => splitSegments(text, minWeightOf(unit)).map((s) => s.text));

/** 在 block 内文本偏移 index 处插入 marker（index 为 textContent 下标） */
const insertAt = (doc: Document, block: Element, index: number, marker: Element) => {
  const walker = doc.createTreeWalker(block, NodeFilter.SHOW_TEXT);
  let offset = 0;
  let lastNode: Text | null = null;
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    const len = node.data.length;
    if (index <= offset + len) {
      const local = index - offset;
      if (local >= len) {
        node.parentNode?.insertBefore(marker, node.nextSibling);
      } else {
        const rest = node.splitText(local);
        rest.parentNode?.insertBefore(marker, rest);
      }
      return;
    }
    offset += len;
    lastNode = node;
  }
  if (lastNode) lastNode.parentNode?.insertBefore(marker, lastNode.nextSibling);
  else block.appendChild(marker);
};

/** 给文档中尚未处理的叶子块插入小段标记，返回新插入的标记数量 */
export const decorateDocument = (
  doc: Document,
  unit: TranslationUnit = "sentence"
): number => {
  if (!doc.body) return 0;
  let count = 0;
  for (const block of getLeafBlocks(doc.body)) {
    if (block.hasAttribute(DECORATED_ATTR)) continue;
    block.setAttribute(DECORATED_ATTR, "1");
    const segments = splitSegments(block.textContent || "", minWeightOf(unit));
    // 倒序插入：空标记不改变 textContent，但倒序可避免拆分后的节点干扰前面的偏移
    for (let i = segments.length - 1; i >= 0; i--) {
      const marker = doc.createElement(MARKER_TAG);
      marker.setAttribute("data-src", segments[i].text);
      marker.className = "mentor-tr-loading";
      insertAt(doc, block, segments[i].end, marker);
      count++;
    }
  }
  return count;
};

export const getMarkers = (doc: Document): HTMLElement[] =>
  doc.body ? Array.from(doc.body.querySelectorAll<HTMLElement>(MARKER_TAG)) : [];

/** 用查询函数填充译文；仅译文模式下，整段译完后再隐藏原文，避免加载期间页面空白 */
export const fillMarkers = (
  doc: Document,
  lookup: (text: string) => string | undefined,
  isFailed: (text: string) => boolean
): boolean => {
  let changed = false;
  const touchedBlocks = new Set<Element>();
  for (const marker of getMarkers(doc)) {
    if (marker.hasAttribute("data-t")) continue;
    const src = marker.getAttribute("data-src") || "";
    const translated = lookup(src);
    if (translated !== undefined) {
      marker.setAttribute("data-t", translated);
      marker.className = "";
      changed = true;
      const block = marker.closest(`[${DECORATED_ATTR}]`);
      if (block) touchedBlocks.add(block);
    } else if (isFailed(src) && marker.className !== "mentor-tr-failed") {
      marker.className = "mentor-tr-failed";
      changed = true;
    }
  }
  touchedBlocks.forEach((block) => {
    const done = Array.from(block.querySelectorAll(MARKER_TAG)).every((m) =>
      m.hasAttribute("data-t")
    );
    if (done) block.classList.add("mentor-tr-done");
  });
  return changed;
};

const STYLE_ID = "mentor-tr-style";

export const injectTranslationStyle = (
  doc: Document,
  mode: string,
  fontSize: number,
  unit: TranslationUnit = "sentence"
) => {
  let style = doc.getElementById(STYLE_ID);
  if (!style) {
    style = doc.createElement("style");
    style.id = STYLE_ID;
    (doc.head || doc.documentElement).appendChild(style);
  }
  const onlyTarget =
    mode === "target"
      ? `[${DECORATED_ATTR}].mentor-tr-done,[${DECORATED_ATTR}].mentor-tr-done *{font-size:0 !important;}` +
        `[${DECORATED_ATTR}].mentor-tr-done ${MARKER_TAG}::after{font-size:${fontSize}px !important;opacity:1 !important;border-left:none !important;padding-left:0 !important;margin:0 !important;display:inline !important;}`
      : "";
  // 段落模式：译文作为独立一行紧跟原文段落，继承段落的缩进与对齐，形成上下行对照；
  // 句子模式：译文插在段内，用左侧竖线与原文区分
  const blockStyle =
    unit === "paragraph"
      ? `margin:0.35em 0 0;padding:0;font-size:0.95em;opacity:0.7;text-indent:inherit;`
      : `margin:0.25em 0 0.7em;padding-left:0.75em;border-left:2px solid currentColor;` +
        `opacity:0.72;font-size:0.9em;text-indent:0;`;
  style.textContent =
    `${MARKER_TAG}{display:inline;font-style:normal;font-weight:normal;text-decoration:none;}` +
    `${MARKER_TAG}::after{display:block;content:attr(data-t);${blockStyle}line-height:1.65;` +
    `text-align:start;white-space:normal;}` +
    `${MARKER_TAG}.mentor-tr-loading::after{content:"···";border-left-color:transparent;opacity:0.35;animation:mentor-tr-blink 1.2s ease-in-out infinite;}` +
    `${MARKER_TAG}.mentor-tr-failed::after{content:"×";border-left-color:transparent;opacity:0.3;}` +
    `@keyframes mentor-tr-blink{0%,100%{opacity:0.15}50%{opacity:0.5}}` +
    onlyTarget;
};
