// 二开：云同步只保留 iCloud Drive（以及其等价的本地文件夹方式），
// 不再依赖 Koodo 服务器做令牌加解密 / OAuth 中转。
// 数据源配置（目前只有 drivePath）以明文 JSON 存在 TokenService 里，
// TokenService 在 Electron 下由主进程 safeStorage 加密落盘，浏览器下用 JWT 加密。
import toast from "react-hot-toast";
import { ConfigService } from "../../assets/lib/kookit-extra-browser.min";
import i18n from "../../i18n";
import TokenService from "../storage/tokenService";

/** 二开保留的同步方式 */
export const SUPPORTED_SYNC_SERVICES = ["icloud"];

export const isSupportedSyncService = (service: string) =>
  SUPPORTED_SYNC_SERVICES.includes(service);

/** 保存数据源配置。保持旧接口返回 { code } 以兼容调用方 */
export const encryptToken = async (service: string, config: object) => {
  if (!isSupportedSyncService(service)) {
    toast.error(i18n.t("This data source is no longer supported"));
    return { code: 400, msg: "unsupported" };
  }
  await TokenService.setToken(service + "_token", JSON.stringify(config));
  return { code: 200, data: {} };
};

/** 读取数据源配置，返回结构与旧接口一致：data.token 为 JSON 字符串 */
export const decryptToken = async (service: string) => {
  const raw = await TokenService.getToken(service + "_token");
  if (!raw || raw === "{}") return { code: 404, data: null };
  try {
    JSON.parse(raw);
  } catch {
    // 旧版本存的是服务器加密串，本地无法解密，需要重新绑定
    return { code: 410, data: null };
  }
  return { code: 200, data: { token: raw } };
};

/** 删除不再支持的数据源（OneDrive、Google Drive、WebDAV 等），一次性迁移 */
export const removeUnsupportedSyncSources = async () => {
  const list: string[] = ConfigService.getAllListConfig("dataSourceList") || [];
  for (const service of list) {
    if (isSupportedSyncService(service)) continue;
    ConfigService.deleteListConfig(service, "dataSourceList");
    await TokenService.deleteToken(service + "_token");
  }
  const current = ConfigService.getItem("defaultSyncOption");
  if (current && !isSupportedSyncService(current)) {
    ConfigService.removeItem("defaultSyncOption");
  }
  ConfigService.setReaderConfig("isEnableKoodoSync", "no");
};
