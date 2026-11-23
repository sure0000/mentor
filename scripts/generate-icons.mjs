// 由 Lucide 线性图标生成 src/assets/styles/icons.css，覆盖 icomoon 字体图标。
// 类名保持不变（.icon-xxx），组件无需修改；品牌图标等未映射的仍走 icomoon 字体。
// 用法：node scripts/generate-icons.mjs <lucide-static>/icons
import fs from "node:fs";
import path from "node:path";

const STROKE_WIDTH = "1.75";

// icomoon 类名 -> Lucide 图标名
const ICON_MAP = {
  account: "circle-user-round",
  add: "plus",
  "address-book": "book-user",
  "ai-assist": "sparkles",
  archive: "archive",
  audio: "audio-lines",
  backup: "database-backup",
  bookmark: "bookmark",
  "bookmark-line": "bookmark",
  bookshelf: "library",
  "bookshelf-line": "library",
  browser: "globe",
  chart: "chart-no-axes-column",
  check: "check",
  clock: "clock",
  clockwise: "rotate-cw",
  close: "x",
  cloud: "cloud-download",
  collapse: "list-collapse",
  collect: "star",
  "convert-text": "scan-text",
  copy: "copy",
  "copy-line": "copy",
  counterclockwise: "rotate-ccw",
  cover: "gallery-vertical-end",
  crop: "crop",
  day: "sun",
  desktop: "monitor",
  detail: "info",
  dict: "book-a",
  digest: "quote",
  dropdown: "chevron-down",
  earphone: "headphones",
  "earphone-line": "headphones",
  edit: "square-pen",
  "edit-line": "square-pen",
  email: "mail",
  english: "languages",
  "eraser-line": "eraser",
  exit: "log-out",
  exit1: "log-out",
  export: "share",
  eye: "eye",
  facebook: "facebook",
  feedback: "message-square-text",
  folder: "folder",
  font: "type",
  ftp: "server",
  fullscreen: "maximize",
  "fullscreen-line": "maximize",
  github: "github",
  grid: "layout-grid",
  heart: "heart",
  highlight: "highlighter",
  "highlight-line": "highlighter",
  home: "house",
  "home-line": "house",
  idea: "lightbulb",
  "idea-line": "lightbulb",
  image: "image",
  import: "import",
  internet: "globe",
  keyboard: "keyboard",
  "light-bulb": "lightbulb",
  list: "list",
  loading: "loader-circle",
  local: "hard-drive",
  lock: "lock",
  love: "heart",
  menu: "menu",
  message: "message-circle",
  minus: "minus",
  more: "ellipsis",
  move: "move",
  night: "moon",
  note: "notebook-pen",
  "pen-line": "pen-line",
  "pencil-ruler": "pencil-ruler",
  phone: "smartphone",
  pin: "pin",
  popup: "app-window",
  recent: "history",
  report: "flag",
  restore: "archive-restore",
  s3compatible: "server",
  save: "save",
  scroll: "scroll-text",
  scroll1: "scroll-text",
  search: "search",
  "search-book": "file-search",
  select: "square-check-big",
  send: "send",
  setting: "settings",
  sftp: "server",
  share: "share-2",
  shelf: "library-big",
  sidebar: "panel-right",
  "single-page": "rectangle-vertical",
  smb: "server",
  "sort-desc": "arrow-down-wide-narrow",
  sort: "arrow-down-wide-narrow",
  speaker: "volume-2",
  stack: "layers",
  "star-line": "star",
  success: "circle-check",
  sync: "refresh-cw",
  trans: "languages",
  translation: "languages",
  trash: "trash-2",
  "trash-line": "trash-2",
  "two-page": "book-open",
  unlock: "lock-open",
  user: "user",
  webdav: "server",
  "zoom-in": "zoom-in",
  "zoom-out": "zoom-out",
};

const iconsDir = process.argv[2];
if (!iconsDir) {
  console.error("usage: node scripts/generate-icons.mjs <lucide-static>/icons");
  process.exit(1);
}

const toDataUri = (svg) => {
  const cleaned = svg
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\s*class="[^"]*"/, "")
    .replace(/stroke-width="[^"]*"/, `stroke-width="${STROKE_WIDTH}"`)
    .replace(/stroke="currentColor"/, 'stroke="black"')
    .replace(/\s+/g, " ")
    .replace(/> </g, "><")
    .replace(/"/g, "'")
    .trim();
  // 仅转义 data URI 中必须转义的字符，保持产物可读
  const encoded = cleaned.replace(/[%#<>]/g, (c) =>
    encodeURIComponent(c)
  );
  return `url("data:image/svg+xml,${encoded}")`;
};

const rules = Object.entries(ICON_MAP).map(([cls, name]) => {
  const svg = fs.readFileSync(path.join(iconsDir, `${name}.svg`), "utf8");
  const uri = toDataUri(svg);
  return `.icon-${cls}:before {\n  -webkit-mask-image: ${uri};\n  mask-image: ${uri};\n}`;
});

const selectors = Object.keys(ICON_MAP)
  .map((cls) => `.icon-${cls}:before`)
  .join(",\n");

const css = `/*
 * 自动生成，请勿手改：node scripts/generate-icons.mjs <lucide-static>/icons
 * Icons from Lucide (https://lucide.dev), ISC License,
 * Copyright (c) Lucide Contributors 2022; portions (c) Cole Bemis 2013-2022 (Feather, MIT).
 */
${selectors} {
  content: "";
  display: inline-block;
  width: 1em;
  height: 1em;
  vertical-align: -0.125em;
  background-color: currentColor;
  -webkit-mask-repeat: no-repeat;
  mask-repeat: no-repeat;
  -webkit-mask-position: center;
  mask-position: center;
  -webkit-mask-size: contain;
  mask-size: contain;
}

${rules.join("\n")}
`;

const out = path.resolve("src/assets/styles/icons.css");
fs.writeFileSync(out, css);
console.log(`wrote ${Object.keys(ICON_MAP).length} icons to ${out}`);
