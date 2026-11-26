// 微信读书式正文栏：桌面端正文栏有最大宽度，两侧留白随窗口变宽而增大；
// 窗口变窄时正文栏先变窄、留白随之减少，并始终保留一条最小留白不贴边。
export const WEREAD_MAX_COLUMN_WIDTH = 820;
export const WEREAD_MIN_SIDE_GUTTER = 16;
// 页面宽度比例 100% 时正文栏占视口的比例
const BASE_COLUMN_RATIO = 0.6;

export const getColumnWidth = (
  viewportWidth: number,
  availableWidth: number,
  scale: number | string
) => {
  const parsedScale = typeof scale === "number" ? scale : parseFloat(scale);
  const ratio = Number.isFinite(parsedScale) ? Math.abs(parsedScale) : 1;
  const preferred = viewportWidth * BASE_COLUMN_RATIO * ratio;
  const cap = Math.min(
    WEREAD_MAX_COLUMN_WIDTH,
    Math.max(0, availableWidth - WEREAD_MIN_SIDE_GUTTER * 2)
  );
  return Math.max(0, Math.min(preferred, cap));
};
