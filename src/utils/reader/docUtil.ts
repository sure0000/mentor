import Book from "../../models/Book";
import { isPaginatedBook, throttle } from "../common";

export const getOuterDoc = () => {
  let pageArea = document.getElementById("page-area");

  if (!pageArea) return null;
  let iframe = pageArea.getElementsByTagName("iframe")[0];
  if (!iframe) return null;
  return iframe.contentDocument;
};

export const getIframeDoc = (book: Book) => {
  let doc = getOuterDoc();
  if (!doc) return [];
  if (isPaginatedBook(book)) {
    let subIframes = doc.querySelectorAll("iframe");
    return [
      doc,
      ...Array.from(subIframes).map((subIframe) => {
        let subDoc = subIframe.contentDocument;
        return subDoc;
      }),
    ];
  } else {
    return [doc];
  }
};
export const getIframeWin = () => {
  let pageArea = document.getElementById("page-area");
  if (!pageArea) return null;
  let iframe = pageArea.getElementsByTagName("iframe")[0];
  if (!iframe) return null;
  return iframe;
};

const PAGE_SHADOW_STYLE_ID = "mentor-page-shadow";

/**
 * PDF 等固定版式：给每页（外层 iframe 中的 .pdf-container）加细边框和阴影，
 * 让页面自带的白边看得出是页面的一部分，而不是阅读区的留白。
 * 只往引擎外层 iframe 注入样式，不改页面内容与尺寸，不影响分页和坐标换算。
 */
export const addPageShadow = () => {
  const doc = getOuterDoc();
  if (!doc || doc.getElementById(PAGE_SHADOW_STYLE_ID)) return;
  const style = doc.createElement("style");
  style.id = PAGE_SHADOW_STYLE_ID;
  style.textContent = `
.pdf-container {
  box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.06), 0 2px 10px rgba(0, 0, 0, 0.12);
  border-radius: 2px;
}`;
  (doc.head || doc.documentElement).appendChild(style);
};

const PDF_SELECTION_STYLE_ID = "mentor-pdf-selection";


/** 把选区的矩形按行合并：同一行取并集，相邻行之间按中线切开，保证互不重叠 */
export const mergeSelectionRects = (
  rects: { left: number; top: number; right: number; bottom: number }[]
) => {
  const lines: { left: number; top: number; right: number; bottom: number }[] = [];
  rects
    .filter((r) => r.right - r.left > 0.5 && r.bottom - r.top > 0.5)
    .sort((a, b) => a.top - b.top || a.left - b.left)
    .forEach((r) => {
      const h = r.bottom - r.top;
      const line = lines.find((l) => {
        const overlap = Math.min(l.bottom, r.bottom) - Math.max(l.top, r.top);
        return overlap > 0.5 * Math.min(h, l.bottom - l.top);
      });
      if (line) {
        line.left = Math.min(line.left, r.left);
        line.right = Math.max(line.right, r.right);
        line.top = Math.min(line.top, r.top);
        line.bottom = Math.max(line.bottom, r.bottom);
      } else {
        lines.push({ left: r.left, top: r.top, right: r.right, bottom: r.bottom });
      }
    });
  lines.sort((a, b) => a.top - b.top);
  for (let i = 0; i + 1 < lines.length; i++) {
    const cur = lines[i];
    const next = lines[i + 1];
    if (cur.bottom > next.top) {
      const mid = (cur.bottom + next.top) / 2;
      cur.bottom = mid;
      next.top = mid;
    }
  }
  return lines;
};

const SEL_LAYER_CLASS = "mentor-pdf-sel-layer";

/** 在文档上按行绘制选区（只画落在 PDF 文字层里的部分）；坐标取自屏幕矩形，页面缩放后同样准确 */
const paintSelection = (doc: Document) => {
  let layer = doc.documentElement.querySelector<HTMLElement>("." + SEL_LAYER_CLASS);
  const selection = doc.getSelection();
  const range = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
  if (!range || range.collapsed) {
    if (layer) layer.textContent = "";
    return;
  }
  const rects: { left: number; top: number; right: number; bottom: number }[] = [];
  const walker = doc.createTreeWalker(range.commonAncestorContainer, NodeFilter.SHOW_TEXT);
  let node: Node | null = walker.currentNode.nodeType === Node.TEXT_NODE ? walker.currentNode : walker.nextNode();
  for (; node; node = walker.nextNode()) {
    const parent = node.parentElement;
    if (!parent || !parent.closest(".textLayer") || parent.closest(".endOfContent")) continue;
    if (!range.intersectsNode(node)) continue;
    const text = node as Text;
    const r = doc.createRange();
    r.setStart(text, text === range.startContainer ? range.startOffset : 0);
    r.setEnd(text, text === range.endContainer ? range.endOffset : text.length);
    // DOMRect 的字段是原型上的 getter，展开复制会丢失，先转成普通对象
    Array.from(r.getClientRects()).forEach((c) =>
      rects.push({ left: c.left, top: c.top, right: c.right, bottom: c.bottom })
    );
  }
  const lines = mergeSelectionRects(rects);
  if (!layer) {
    layer = doc.createElement("div");
    layer.className = SEL_LAYER_CLASS;
    // 挂在根元素下，绝对定位以初始包含块为准，不受 body 外边距影响；页面内滚动时随内容移动
    doc.documentElement.appendChild(layer);
  }
  const win = doc.defaultView;
  const sx = win?.scrollX || 0;
  const sy = win?.scrollY || 0;
  layer.textContent = "";
  lines.forEach((l) => {
    const div = doc.createElement("div");
    div.className = "mentor-pdf-sel-line";
    div.style.left = l.left + sx + "px";
    div.style.top = l.top + sy + "px";
    div.style.width = l.right - l.left + "px";
    div.style.height = l.bottom - l.top + "px";
    layer!.appendChild(div);
  });
};

type TextPoint = { node: Text; offset: number; layer: HTMLElement };

/**
 * 文字层中离 (x, y) 最近的文字位置。
 * 落在文字上直接用浏览器的命中结果；落在空白处（行尾标点之后、行间、页边）时：
 * 优先找同一行（纵向覆盖 y）的文字块，否则找纵向最近的一行；
 * 点在文字块右侧取其末尾，左侧取开头，中间再按横坐标求字符位置。
 */
const textPointAt = (doc: Document, layer: HTMLElement, x: number, y: number): TextPoint | null => {
  const caretFrom = (cx: number, cy: number) =>
    (doc as Document & { caretRangeFromPoint?: (x: number, y: number) => Range | null }).caretRangeFromPoint?.(cx, cy) ||
    null;
  const hit = caretFrom(x, y);
  if (
    hit &&
    hit.startContainer.nodeType === Node.TEXT_NODE &&
    layer.contains(hit.startContainer) &&
    !(hit.startContainer.parentElement?.closest(".endOfContent"))
  ) {
    return { node: hit.startContainer as Text, offset: hit.startOffset, layer };
  }
  let best: { el: HTMLElement; rect: DOMRect; score: number } | null = null;
  layer.querySelectorAll<HTMLElement>("span").forEach((el) => {
    const text = el.firstChild;
    if (!text || text.nodeType !== Node.TEXT_NODE || !text.textContent) return;
    const rect = el.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const dy = y < rect.top ? rect.top - y : y > rect.bottom ? y - rect.bottom : 0;
    const dx = x < rect.left ? rect.left - x : x > rect.right ? x - rect.right : 0;
    // 纵向距离优先：同一行内比横向，避免跳到上下行
    const score = dy * 10000 + dx;
    if (!best || score < best.score) best = { el, rect, score };
  });
  if (!best) return null;
  const { el, rect } = best as { el: HTMLElement; rect: DOMRect };
  const node = el.firstChild as Text;
  if (x >= rect.right) return { node, offset: node.length, layer };
  if (x <= rect.left) return { node, offset: 0, layer };
  const inner = caretFrom(x, rect.top + rect.height / 2);
  if (inner && inner.startContainer === node) return { node, offset: inner.startOffset, layer };
  return { node, offset: x - rect.left > rect.width / 2 ? node.length : 0, layer };
};

/**
 * PDF 文字层选区修正（参照 pdf.js TextLayerBuilder 的全局选区监听）。
 *
 * 文字层由一个个绝对定位的透明 span 组成，行与行之间是空白。引擎带了 .endOfContent
 * 和 `.textLayer.selecting .endOfContent { top: 0 }` 规则，却没有切换 selecting、
 * 也没有移动 endOfContent，于是拖过行间空白时浏览器会把选区焦点落到文字层末尾：
 * 从下往上选时选区会跳到整页末尾或直接选不中。
 *
 * 这里在选区变化时：给文字层加 selecting，并把 endOfContent 挪到选区「正在移动的一端」
 * 紧邻的位置（往上拖插在锚点前，往下拖插在锚点后），让空白处的命中延续当前方向；
 * 松开鼠标后复原。每页是独立 iframe 文档，按文档绑定一次即可。
 */
export const enablePdfTextSelection = (doc: Document) => {
  // 引擎每页自带 `.textLayer ::selection { background: rgba(0,0,255,.25) }`，且插在我们的样式之后，
  // 同优先级时引擎规则胜出。这里用更高优先级 + !important，并在已存在时也更新内容
  let style = doc.getElementById(PDF_SELECTION_STYLE_ID) as HTMLStyleElement | null;
  if (!style) {
    style = doc.createElement("style");
    style.id = PDF_SELECTION_STYLE_ID;
    (doc.head || doc.documentElement).appendChild(style);
  }
  // 不用浏览器自带的选区底色：每个文字块单独上色，相邻行上下重叠（放大后更明显），重叠处会叠深。
  // 隐藏原生底色，由 paintSelection 按行合并后自绘
  style.textContent = `
html body .textLayer ::selection,
html body .textLayer::selection { background: transparent !important; }
.mentor-pdf-sel-layer { position: absolute; left: 0; top: 0; width: 0; height: 0; pointer-events: none; z-index: 2; }
.mentor-pdf-sel-line { position: absolute; background: rgba(27, 136, 238, 0.26); border-radius: 2px; }`;

  const homes = new Map<HTMLElement, HTMLElement>();
  let isPointerDown = false;
  let prevRange: Range | null = null;

  const endOf = (layer: HTMLElement) => {
    const cached = homes.get(layer);
    if (cached) return cached;
    const found = layer.querySelector<HTMLElement>(".endOfContent");
    if (found) homes.set(layer, found);
    return found;
  };

  const reset = () => {
    homes.forEach((end, layer) => {
      layer.classList.remove("selecting");
      if (end.parentElement !== layer || layer.lastElementChild !== end) {
        layer.append(end);
      }
      end.style.width = "";
      end.style.height = "";
    });
  };

  /** 从空白处开始的拖选：起点固定在离按下位置最近的文字上，由这里接管扩展 */
  let dragAnchor: TextPoint | null = null;

  const extendDrag = throttle((x: number, y: number) => {
    if (!dragAnchor) return;
    const layer =
      ((doc.elementFromPoint(x, y) as HTMLElement | null)?.closest?.(".textLayer") as HTMLElement | null) ||
      dragAnchor.layer;
    const focus = textPointAt(doc, layer, x, y);
    if (!focus) return;
    doc.getSelection()?.setBaseAndExtent(dragAnchor.node, dragAnchor.offset, focus.node, focus.offset);
  }, 16);

  doc.addEventListener("mousedown", (event) => {
    isPointerDown = true;
    if (event.button !== 0 || event.detail > 1) return;
    const target = event.target as HTMLElement | null;
    const layer = target?.closest?.(".textLayer") as HTMLElement | null;
    if (!layer) return;
    // 按在文字上：交给浏览器原生选区（保留双击选词等行为）
    if (target && target !== layer && target.tagName === "SPAN" && target.textContent) return;
    const point = textPointAt(doc, layer, event.clientX, event.clientY);
    if (!point) return;
    event.preventDefault();
    dragAnchor = point;
    layer.classList.add("selecting");
    doc.getSelection()?.collapse(point.node, point.offset);
  });
  doc.addEventListener("mousemove", (event) => {
    if (!dragAnchor) return;
    if (!(event.buttons & 1)) {
      dragAnchor = null;
      return;
    }
    extendDrag(event.clientX, event.clientY);
  });
  doc.addEventListener("pointerdown", () => {
    isPointerDown = true;
  });
  doc.addEventListener("pointerup", () => {
    isPointerDown = false;
    dragAnchor = null;
    reset();
  });
  doc.defaultView?.addEventListener("blur", () => {
    isPointerDown = false;
    reset();
  });

  let paintFrame = 0;
  const schedulePaint = () => {
    if (paintFrame) return;
    paintFrame = (doc.defaultView || window).requestAnimationFrame(() => {
      paintFrame = 0;
      paintSelection(doc);
    });
  };
  // 页面缩放 / 窗口变化后按新位置重画
  doc.defaultView?.addEventListener("resize", schedulePaint);

  doc.addEventListener("selectionchange", () => {
    schedulePaint();
    const selection = doc.getSelection();
    if (!selection || selection.rangeCount === 0) {
      prevRange = null;
      reset();
      return;
    }
    const range = selection.getRangeAt(0);
    const layers = Array.from(doc.querySelectorAll<HTMLElement>(".textLayer"));
    let touched = false;
    for (const layer of layers) {
      if (range.intersectsNode(layer)) {
        layer.classList.add("selecting");
        touched = true;
      } else {
        layer.classList.remove("selecting");
      }
    }
    if (!touched || !isPointerDown || dragAnchor) {
      prevRange = range.cloneRange();
      return;
    }
    // 判断这次移动的是选区起点还是终点：终点没变说明在改起点（往上拖）
    const modifyStart =
      !!prevRange &&
      (range.compareBoundaryPoints(Range.END_TO_END, prevRange) === 0 ||
        range.compareBoundaryPoints(Range.START_TO_END, prevRange) === 0);
    let anchor: Node | null = modifyStart ? range.startContainer : range.endContainer;
    if (anchor && anchor.nodeType === Node.TEXT_NODE) anchor = anchor.parentNode;
    const anchorEl = anchor as HTMLElement | null;
    const layer = anchorEl?.closest?.(".textLayer") as HTMLElement | null;
    const end = layer ? endOf(layer) : null;
    if (layer && end && anchorEl && anchorEl !== end && anchorEl.parentElement) {
      end.style.width = layer.style.width;
      end.style.height = layer.style.height;
      anchorEl.parentElement.insertBefore(end, modifyStart ? anchorEl : anchorEl.nextSibling);
    }
    prevRange = range.cloneRange();
  });
};
