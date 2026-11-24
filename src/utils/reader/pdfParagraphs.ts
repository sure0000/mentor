// PDF 对照翻译：从 PDF 文字层（.textLayer 中的透明 span）按版面几何还原段落。
// PDF 文字层是一行行（甚至半行）的碎片，直接翻译语境破碎；这里先合并成行，再按
// 行距、缩进、短行等特征切成段落，供对照翻译面板使用。

export interface TextBox {
  text: string;
  left: number;
  top: number;
  right: number;
  bottom: number;
}

interface Line extends TextBox {
  height: number;
}

const CJK_RE = /[぀-ヿ㐀-䶿一-鿿豈-﫿가-힯　-〿＀-￯]/;
const SENTENCE_END_RE = /[.!?。！？:：;；"”’」』)）]$/;

const median = (values: number[]) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};

/** 两段文本拼接：CJK 直接相连，行尾连字符去掉，其余补空格 */
const joinText = (a: string, b: string) => {
  if (!a) return b;
  if (!b) return a;
  if (/[A-Za-z]-$/.test(a) && /^[a-z]/.test(b)) return a.slice(0, -1) + b;
  const last = a[a.length - 1];
  const first = b[0];
  if (CJK_RE.test(last) || CJK_RE.test(first) || /\s$/.test(a) || /^\s/.test(b)) {
    return a + b;
  }
  return a + " " + b;
};

/** 按文字层顺序把碎片合并成行：与当前行垂直方向重叠且在其右侧的归为同一行 */
export const groupLines = (boxes: TextBox[]): Line[] => {
  const lines: Line[] = [];
  for (const box of boxes) {
    if (!box.text.trim()) {
      // 空白碎片只作为词间分隔
      const cur = lines[lines.length - 1];
      if (cur && !/\s$/.test(cur.text)) cur.text += " ";
      continue;
    }
    const h = box.bottom - box.top;
    const cur = lines[lines.length - 1];
    if (cur) {
      const overlap = Math.min(cur.bottom, box.bottom) - Math.max(cur.top, box.top);
      if (overlap > 0.5 * Math.min(h, cur.height) && box.left >= cur.left - 1) {
        cur.text = joinText(cur.text, box.text);
        cur.right = Math.max(cur.right, box.right);
        cur.top = Math.min(cur.top, box.top);
        cur.bottom = Math.max(cur.bottom, box.bottom);
        cur.height = Math.max(cur.height, h);
        continue;
      }
    }
    lines.push({ ...box, height: h });
  }
  return lines
    .map((l) => ({ ...l, text: l.text.replace(/\s+/g, " ").trim() }))
    .filter((l) => l.text);
};

/** 判断 next 是否开始一个新段落 */
const isParagraphBreak = (prev: Line, next: Line, lineGap: number, blockRight: number) => {
  const gap = next.top - prev.bottom;
  const h = Math.max(prev.height, next.height);
  // 回到上方或跳到另一栏
  if (next.top < prev.top - h * 0.5) return true;
  if (next.left > prev.right) return true;
  // 行距明显大于正文行距（段间距、标题）
  if (gap > Math.max(lineGap * 1.6, lineGap + h * 0.6)) return true;
  // 字号明显不同（标题与正文）
  if (Math.abs(next.height - prev.height) > Math.min(next.height, prev.height) * 0.3) return true;
  // 上一行是句末短行：段落末行
  const isShort = blockRight - prev.right > h * 2;
  if (isShort && SENTENCE_END_RE.test(prev.text)) return true;
  // 首行缩进
  if (next.left - prev.left > h * 1.2 && SENTENCE_END_RE.test(prev.text)) return true;
  return false;
};

export interface ParagraphBlock extends TextBox {
  /** 段内正文行高（像素），用于确定覆盖译文的初始字号 */
  lineHeight: number;
}

/** 把一页的文字碎片还原成段落，并带上段落在页面上的包围盒 */
export const groupParagraphBlocks = (boxes: TextBox[]): ParagraphBlock[] => {
  const lines = groupLines(boxes);
  if (!lines.length) return [];
  const gaps: number[] = [];
  for (let i = 1; i < lines.length; i++) {
    const g = lines[i].top - lines[i - 1].bottom;
    if (g >= -1 && lines[i].top > lines[i - 1].top) gaps.push(Math.max(0, g));
  }
  const lineGap = median(gaps);
  const blockRight = Math.max(...lines.map((l) => l.right));
  const groups: Line[][] = [[lines[0]]];
  for (let i = 1; i < lines.length; i++) {
    if (isParagraphBreak(lines[i - 1], lines[i], lineGap, blockRight)) groups.push([lines[i]]);
    else groups[groups.length - 1].push(lines[i]);
  }
  return groups
    .map((group) => ({
      text: group.reduce((acc, l) => joinText(acc, l.text), "").trim(),
      left: Math.min(...group.map((l) => l.left)),
      top: Math.min(...group.map((l) => l.top)),
      right: Math.max(...group.map((l) => l.right)),
      bottom: Math.max(...group.map((l) => l.bottom)),
      lineHeight: median(group.map((l) => l.height)),
    }))
    // 过滤页码、单个符号等噪声
    .filter((b) => b.text.length > 1 && !/^\d+$/.test(b.text));
};

/** 把一页的文字碎片还原成段落文本 */
export const groupParagraphs = (boxes: TextBox[]): string[] =>
  groupParagraphBlocks(boxes).map((b) => b.text);
