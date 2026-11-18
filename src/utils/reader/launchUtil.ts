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

export const syncNativeThemeSource = (appSkin: string) => {
  if (!isElectron) {
    return;
  }
  const ipcRenderer = window.electronAPI;
  ipcRenderer.invoke("set-native-theme-source", appSkin || "system");
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
    if (!ConfigService.getReaderConfig("isHideBackground")) {
      ConfigService.setReaderConfig("isHideBackground", "yes");
    }
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
