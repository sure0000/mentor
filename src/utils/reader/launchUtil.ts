import {
  browserName,
  browserVersion,
  isElectron,
  osName,
  osVersion,
} from "react-device-detect";
import { ConfigService } from "../../assets/lib/kookit-extra-browser.min";
import packageJson from "../../../package.json";
import FontUtil from "../file/fontUtil";
import {
  legacyThemeColorMap,
  SERIF_FONT_STACK,
} from "../../constants/themeList";

export const syncNativeThemeSource = (appSkin: string) => {
  if (!isElectron) {
    return;
  }
  const ipcRenderer = window.electronAPI;
  ipcRenderer.invoke("set-native-theme-source", appSkin || "system");
};

// 旧版阅读主题色迁移到新的微信读书风格配色，只处理与旧预设完全一致的值
const migrateLegacyThemeColors = () => {
  const bg = ConfigService.getReaderConfig("backgroundColor");
  const text = ConfigService.getReaderConfig("textColor");
  if (bg && legacyThemeColorMap[bg]) {
    ConfigService.setReaderConfig("backgroundColor", legacyThemeColorMap[bg]);
  }
  if (text) {
    const next =
      text === "rgba(255,255,255,1)"
        ? legacyThemeColorMap["rgba(255,255,255,1)|text"]
        : legacyThemeColorMap[text];
    if (next) ConfigService.setReaderConfig("textColor", next);
  }
};

// 微信读书风格的默认排版：滚动阅读 + 居中纸张栏、宋体、18px、较宽松的行距与段距。
// 只执行一次，且只补齐用户从未设置过的项；PDF 等固定版式书使用 pdfReaderMode，不受影响
const WEREAD_LAYOUT_DEFAULTS: Record<string, string> = {
  readerMode: "scroll",
  fontFamily: SERIF_FONT_STACK,
  fontSize: "18",
  lineHeight: "1.75",
  paraSpacing: "12",
  textAlign: "Justify",
};
const applyWereadLayoutDefaults = () => {
  if (ConfigService.getItem("isWereadLayoutApplied") === "yes") return;
  Object.entries(WEREAD_LAYOUT_DEFAULTS).forEach(([key, value]) => {
    if (!ConfigService.getReaderConfig(key)) {
      ConfigService.setReaderConfig(key, value);
    }
  });
  ConfigService.setItem("isWereadLayoutApplied", "yes");
};

// 旧版本默认是「双页铺满」，与微信读书的居中正文栏不一致：
// 老用户没主动改过模式时，一次性切到滚动阅读，切换后仍可在设置里改回
const migrateToWereadReadingMode = () => {
  if (ConfigService.getItem("isWereadColumnApplied") === "yes") return;
  if ((ConfigService.getReaderConfig("readerMode") || "double") === "double") {
    ConfigService.setReaderConfig("readerMode", "scroll");
  }
  ConfigService.setItem("isWereadColumnApplied", "yes");
};

export const initTheme = () => {
  const style = document.createElement("link");
  style.rel = "stylesheet";
  let isNight = false;
  if (isElectron) {
    const ipcRenderer = window.electronAPI;
    isNight = ipcRenderer.sendSync("system-color");
  } else {
    isNight =
      window.matchMedia &&
      window.matchMedia("(prefers-color-scheme: dark)").matches;
  }
  ConfigService.setReaderConfig("isOSNight", isNight ? "yes" : "no");
  ConfigService.setItem("appVersion", packageJson.version);
  ConfigService.setItem(
    "appPlatform",
    isElectron ? osName + " " + osVersion : browserName + " " + browserVersion
  );
  if (!ConfigService.getReaderConfig("appSkin")) {
    ConfigService.setReaderConfig("appSkin", "system");
    //new user don't need to upgrade
    ConfigService.setItem("isUpgradedConfig", "yes");
    ConfigService.setItem("isUpgradedStorage", "yes");
    // 新用户默认使用宋体阅读，与微信读书一致
    if (!ConfigService.getReaderConfig("fontFamily")) {
      ConfigService.setReaderConfig("fontFamily", SERIF_FONT_STACK);
    }
  }
  migrateLegacyThemeColors();
  applyWereadLayoutDefaults();
  migrateToWereadReadingMode();
  // 仿真翻页已移除，旧配置回落到滑动翻页
  if (ConfigService.getReaderConfig("animation") === "mimical") {
    ConfigService.setReaderConfig("animation", "sliding");
  }
  syncNativeThemeSource(ConfigService.getReaderConfig("appSkin"));

  const isNightSkin =
    ConfigService.getReaderConfig("appSkin") === "night" ||
    (ConfigService.getReaderConfig("appSkin") === "system" &&
      ConfigService.getReaderConfig("isOSNight") === "yes");
  style.href = "./assets/styles/theme.css";
  document.documentElement.dataset.theme = isNightSkin ? "dark" : "light";
  document.head.appendChild(style);
};
export const initSystemFont = async () => {
  await applyCustomSystemFont();
};

export const applyCustomSystemFont = async () => {
  const systemFont = ConfigService.getReaderConfig("systemFont");
  const body = document.getElementsByTagName("body")[0];
  if (!body) return;

  if (!systemFont) {
    body.removeAttribute("style");
    const styleEl = document.getElementById("custom-system-font-style");
    if (styleEl) styleEl.textContent = "";
    return;
  }

  if (FontUtil.isCustomFont(systemFont)) {
    const url = await FontUtil.getFontUrl(systemFont);
    if (!url) return;
    let styleEl = document.getElementById("custom-system-font-style");
    if (!styleEl) {
      styleEl = document.createElement("style");
      styleEl.id = "custom-system-font-style";
      document.head.appendChild(styleEl);
    }
    styleEl.textContent = `
      @font-face {
        font-family: "${systemFont}";
        src: url("${url}");
      }
    `;
    body.setAttribute("style", `font-family:"${systemFont}"!important`);
  } else {
    const styleEl = document.getElementById("custom-system-font-style");
    if (styleEl) styleEl.textContent = "";
    body.setAttribute("style", "font-family:" + systemFont + "!important");
  }
};
