// 微信读书风格的四个常用阅读主题：白、纸黄、护眼绿、夜间（顺序与 backgroundList/textList 一一对应）
export const DAY_BG = "rgba(255,255,255,1)";
export const DAY_TEXT = "rgba(31,33,38,1)";
export const NIGHT_BG = "rgba(28,29,33,1)";
export const NIGHT_TEXT = "rgba(178,180,186,1)";
export const readerPresetThemes = [
  { key: "light", title: "White", backgroundColor: DAY_BG, textColor: DAY_TEXT },
  {
    key: "paper",
    title: "Parchment",
    backgroundColor: "rgba(246,239,222,1)",
    textColor: "rgba(66,52,36,1)",
  },
  {
    key: "green",
    title: "Eye protection",
    backgroundColor: "rgba(211,232,212,1)",
    textColor: "rgba(40,62,44,1)",
  },
  { key: "night", title: "Night", backgroundColor: NIGHT_BG, textColor: NIGHT_TEXT },
];
export const backgroundList = [
  DAY_BG,
  NIGHT_BG,
  readerPresetThemes[1].backgroundColor,
  readerPresetThemes[2].backgroundColor,
];
export const textList = [
  DAY_TEXT,
  NIGHT_TEXT,
  readerPresetThemes[1].textColor,
  readerPresetThemes[2].textColor,
];
// 旧版主题色 -> 新主题色，启动时迁移一次
export const legacyThemeColorMap: Record<string, string> = {
  "rgba(44,47,49,1)": NIGHT_BG,
  "rgba(233, 216, 188,1)": readerPresetThemes[1].backgroundColor,
  "rgba(197, 231, 207,1)": readerPresetThemes[2].backgroundColor,
  "rgba(0,0,0,1)": DAY_TEXT,
  "rgba(255,255,255,1)|text": NIGHT_TEXT,
  "rgba(89, 68, 41,1)": readerPresetThemes[1].textColor,
  "rgba(54, 80, 62,1)": readerPresetThemes[2].textColor,
};
export const isNightReaderBg = (color: string) =>
  color === NIGHT_BG || color === "rgba(44,47,49,1)";
// 微信读书默认的宋体阅读字体；以引号开头，会被当作系统字体栈直接写入 CSS
export const SERIF_FONT_STACK =
  '"Source Han Serif SC", "Noto Serif CJK SC", "Songti SC", "STSong", "SimSun", Georgia, serif';
export const SANS_FONT_STACK =
  '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Source Han Sans SC", "Noto Sans CJK SC", sans-serif';
export const themeList = [
  { id: 0, color: "default", title: "Default" },
  { id: 1, color: "#0179CA", title: "Blue" },
  { id: 2, color: "#008F91", title: "Green" },
  { id: 3, color: "#F16464", title: "Red" },
  { id: 4, color: "#6867D1", title: "Purple" },
  { id: 5, color: "#F97316", title: "Orange" },
  { id: 6, color: "#EC4899", title: "Pink" },
  { id: 7, color: "#EAB308", title: "Yellow" },
  { id: 8, color: "#8B5CF6", title: "Violet" },
  { id: 9, color: "#0EA5E9", title: "Sky" },
  { id: 10, color: "#64748B", title: "Slate" },
];
