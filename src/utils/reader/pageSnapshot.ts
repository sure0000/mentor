import { getOuterDoc } from "./docUtil";

/**
 * 重排前给阅读区拍一张「静态快照」，盖在 #page-area 上，等新排版绘制完成再淡出。
 * PDF / 漫画 / PPTX 等固定版式的正文是 iframe 里的 canvas（扫描件是 img），
 * 直接 toDataURL 后按屏幕坐标拼回一层，避免重排期间露出背景造成闪烁。
 */

type Rect = { left: number; top: number; width: number; height: number };
type SnapshotItem = { rect: Rect; src: string };

const MAX_ITEMS = 40;

const collectFromDoc = (
  doc: Document | null,
  offsetX: number,
  offsetY: number,
  items: SnapshotItem[]
) => {
  if (!doc || items.length >= MAX_ITEMS) return;
  doc.querySelectorAll("canvas, img").forEach((el) => {
    if (items.length >= MAX_ITEMS) return;
    const rect = el.getBoundingClientRect();
    if (rect.width < 4 || rect.height < 4) return;
    let src = "";
    try {
      src =
        el instanceof HTMLCanvasElement
          ? el.toDataURL()
          : (el as HTMLImageElement).src || "";
    } catch (_) {
      // 跨域 canvas 无法导出，跳过该元素
      return;
    }
    if (!src) return;
    items.push({
      rect: {
        left: rect.left + offsetX,
        top: rect.top + offsetY,
        width: rect.width,
        height: rect.height,
      },
      src,
    });
  });
  // PDF 等分页结构：外层 iframe 里还有每页一个的子 iframe
  doc.querySelectorAll("iframe").forEach((frame) => {
    const frameRect = frame.getBoundingClientRect();
    let subDoc: Document | null = null;
    try {
      subDoc = frame.contentDocument;
    } catch (_) {
      return;
    }
    collectFromDoc(
      subDoc,
      offsetX + frameRect.left,
      offsetY + frameRect.top,
      items
    );
  });
};

export const takePageAreaSnapshot = (): HTMLElement | null => {
  const pageArea = document.getElementById("page-area");
  if (!pageArea) return null;
  const items: SnapshotItem[] = [];
  const frame = pageArea.getElementsByTagName("iframe")[0];
  const frameRect = frame ? frame.getBoundingClientRect() : null;
  collectFromDoc(
    getOuterDoc(),
    frameRect ? frameRect.left : 0,
    frameRect ? frameRect.top : 0,
    items
  );
  if (!items.length) return null;

  return buildOverlay(pageArea, items);
};

const getAreaBackground = (pageArea: HTMLElement) => {
  // 快照层必须不透明：否则新排版（宽度/位置已变）会从旧页图片的空隙里透出来，
  // 新旧两份文字叠在一起就是「残影」。取阅读区最近的非透明祖先背景色作底
  for (
    let el: HTMLElement | null = pageArea;
    el;
    el = el.parentElement
  ) {
    const bg = getComputedStyle(el).backgroundColor;
    if (bg && bg !== "transparent" && !/rgba\(.*,\s*0\)$/.test(bg)) {
      return bg;
    }
  }
  return "";
};

const buildOverlay = (
  pageArea: HTMLElement,
  items: SnapshotItem[],
  areaRect: Rect = pageArea.getBoundingClientRect()
) => {
  const background = getAreaBackground(pageArea);
  const overlay = document.createElement("div");
  overlay.className = "page-area-snapshot";
  overlay.style.cssText = [
    "position:fixed",
    `left:${areaRect.left}px`,
    `top:${areaRect.top}px`,
    `width:${areaRect.width}px`,
    `height:${areaRect.height}px`,
    "overflow:hidden",
    "pointer-events:none",
    "z-index:12",
    `background:${background || "#fff"}`,
  ].join(";");
  // 页面图片放在独立的内容层里，停靠动画时只对它做 transform（合成层动画，不触发重排）
  const content = document.createElement("div");
  content.className = "page-area-snapshot-content";
  content.style.cssText =
    "position:absolute;left:0;top:0;width:100%;height:100%;will-change:transform";
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  items.forEach((item) => {
    // 元素坐标是视口坐标，换算成相对快照层的位置
    const left = item.rect.left - areaRect.left;
    const top = item.rect.top - areaRect.top;
    minX = Math.min(minX, left);
    minY = Math.min(minY, top);
    maxX = Math.max(maxX, left + item.rect.width);
    const img = document.createElement("img");
    img.src = item.src;
    img.style.cssText = [
      "position:absolute",
      `left:${left}px`,
      `top:${top}px`,
      `width:${item.rect.width}px`,
      `height:${item.rect.height}px`,
      "display:block",
    ].join(";");
    content.appendChild(img);
  });
  content.dataset.box = JSON.stringify({ x: minX, y: minY, w: maxX - minX });
  overlay.appendChild(content);
  document.body.appendChild(overlay);
  return overlay;
};

const decodeImage = (src: string) =>
  new Promise<HTMLImageElement | null>((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });

// 取截图左上角（阅读区留白处）的真实像素作为快照底色：
// DOM 祖先的背景色不一定是用户看到的颜色（主题背景画在别的层上）
const samplePixel = (img: HTMLImageElement) => {
  try {
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    const ctx = canvas.getContext("2d");
    if (!ctx) return "";
    ctx.drawImage(img, 2, 2, 1, 1, 0, 0, 1, 1);
    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
    return `rgb(${r}, ${g}, ${b})`;
  } catch (_) {
    return "";
  }
};

/**
 * EPUB / TXT 等可重排书籍的正文是 DOM 文字，没法像 canvas 那样逐个导出，
 * 改用主进程 capturePage 把阅读区当前画面整块截下来，作为一张图盖在阅读区上。
 * 截图异步完成（通常几十毫秒），调用方必须等它返回后再改页宽 / 清内容。
 */
export const capturePageAreaSnapshot = async (): Promise<HTMLElement | null> => {
  const pageArea = document.getElementById("page-area");
  if (!pageArea || !window.electronAPI) return null;
  const areaRect = pageArea.getBoundingClientRect();
  const rect = {
    left: Math.max(0, areaRect.left),
    top: Math.max(0, areaRect.top),
    width: Math.min(areaRect.width, window.innerWidth - Math.max(0, areaRect.left)),
    height: Math.min(areaRect.height, window.innerHeight - Math.max(0, areaRect.top)),
  };
  if (rect.width < 4 || rect.height < 4) return null;
  let src = "";
  try {
    src = await window.electronAPI.invoke<string>("capture-reader-page", rect);
  } catch (_) {
    return null;
  }
  // 先解码再上屏，否则快照层第一帧是空的，反而多闪一下
  const img = src ? await decodeImage(src) : null;
  if (!img) return null;
  const overlay = buildOverlay(pageArea, [{ rect, src }], rect);
  const background = samplePixel(img);
  if (background) overlay.style.background = background;
  overlay.dataset.kind = "capture";
  return overlay;
};

/**
 * 可重排书籍的快照撤除：旧画面淡出、新正文淡入，两段有少量重叠，做成一次连贯的溶解。
 * - 旧画面淡出时快照层底色改为透明，露出的是真实的桌面 / 纸张背景（它们本身带位移过渡），
 *   不再插一帧纯色底，避免纸张栏外的桌面区域被刷成同一种颜色
 * - 新正文（#page-area）先保持透明，等旧画面淡到一半再淡入，重叠段两份文字都很淡，看不出叠影
 * - 全部是 opacity 动画，跑在合成线程上，不触发重排
 */
export const dissolvePageAreaSnapshot = (
  overlay: HTMLElement | null,
  pageArea: HTMLElement | null
) => {
  if (!overlay) return;
  const content = overlay.firstElementChild as HTMLElement | null;
  if (!content || typeof content.animate !== "function") {
    overlay.remove();
    return;
  }
  const OLD_DURATION = 200;
  const NEW_DELAY = 110;
  const NEW_DURATION = 260;
  // fill: backwards 让新正文在延迟期间保持透明，结束后回到自身样式，不残留内联状态
  pageArea?.animate([{ opacity: 0 }, { opacity: 1 }], {
    duration: NEW_DURATION,
    delay: NEW_DELAY,
    easing: "cubic-bezier(0.33, 0, 0.2, 1)",
    fill: "backwards",
  });
  overlay.style.background = "transparent";
  const fadeOld = content.animate([{ opacity: 1 }, { opacity: 0 }], {
    duration: OLD_DURATION,
    easing: "cubic-bezier(0.4, 0, 0.6, 1)",
    fill: "forwards",
  });
  const remove = () => overlay.remove();
  fadeOld.onfinish = remove;
  // 兜底：动画被节流（窗口失焦等）时也保证移除
  setTimeout(remove, OLD_DURATION + 300);
};

/**
 * 侧边栏停靠/取消停靠时，让旧页快照与侧边栏同步滑到新版心位置（同一缓动曲线），
 * 真实重排在快照下面进行，完成后再无缝替换。纯 transform 动画，跑在合成线程上。
 * 缩放规则：原来按宽度铺满的页面按新旧宽度比例缩放；原来没铺满的只在放不下时缩小。
 * 最终位置可能与引擎实际排版有几像素出入，替换时由真实页面接管。
 */
export const morphPageAreaSnapshot = (
  overlay: HTMLElement | null,
  target: { left: number; width: number },
  duration = 300
) => {
  if (!overlay) return;
  const content = overlay.firstElementChild as HTMLElement | null;
  if (!content || typeof content.animate !== "function") return;
  let box: { x: number; y: number; w: number };
  try {
    box = JSON.parse(content.dataset.box || "");
  } catch (_) {
    return;
  }
  const oldLeft = parseFloat(overlay.style.left);
  const oldWidth = parseFloat(overlay.style.width);
  if (!(box.w > 0) || !(oldWidth > 0) || !(target.width > 0)) return;

  // 快照层扩到新旧区域的并集，保证滑动途中露出的部分也被底色盖住
  const unionLeft = Math.min(oldLeft, target.left);
  const unionRight = Math.max(oldLeft + oldWidth, target.left + target.width);
  const shift = oldLeft - unionLeft;
  overlay.style.left = `${unionLeft}px`;
  overlay.style.width = `${unionRight - unionLeft}px`;
  content.style.left = `${shift}px`;
  content.style.width = `${oldWidth}px`;

  const isFilled = box.w >= oldWidth - 24;
  const scale = isFilled
    ? target.width / oldWidth
    : Math.min(1, target.width / box.w);
  // 内容层坐标系下：新版心内水平居中，顶部对齐
  const targetX =
    target.left - unionLeft - shift + (target.width - box.w * scale) / 2;
  const dx = targetX - box.x;
  content.style.transformOrigin = `${box.x}px ${box.y}px`;
  const finalTransform = `translate(${dx}px, 0) scale(${scale})`;
  content.animate(
    [{ transform: "translate(0, 0) scale(1)" }, { transform: finalTransform }],
    { duration, easing: "cubic-bezier(0.22, 1, 0.36, 1)", fill: "forwards" }
  );
};

export const releasePageAreaSnapshot = (
  overlay: HTMLElement | null,
  animate: boolean
) => {
  if (!overlay) return;
  const remove = () => overlay.remove();
  if (!animate) {
    remove();
    return;
  }
  overlay.style.transition = "opacity 0.24s ease";
  overlay.style.opacity = "0";
  setTimeout(remove, 260);
};
