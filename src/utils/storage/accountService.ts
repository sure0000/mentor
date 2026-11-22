// 账号登录：登录方式即同步方式。
// - iCloud：由 macOS 系统登录，应用内检测 iCloud 云盘并绑定 Mentor 文件夹
// - GitHub：OAuth 设备码登录，自动创建私有仓库 mentor-sync 作为同步后端
// 同一时间只有一个账号；切换账号会先退出当前账号（本地数据保留）。
import { ConfigService } from "../../assets/lib/kookit-extra-browser.min";
import { isElectron } from "react-device-detect";
import { getICloudDrivePath } from "../common";
import { removeCloudConfig } from "../file/common";
import { encryptToken } from "../request/thirdparty";
import SyncService from "./syncService";
import TokenService from "./tokenService";

declare var window: any;

export type AccountProvider = "icloud" | "github";

export interface AccountInfo {
  provider: AccountProvider;
  // 展示用：iCloud 为空，GitHub 为登录名
  login: string;
  name: string;
  avatar: string;
  // 同步位置：iCloud 文件夹路径 / GitHub 仓库 owner/name
  location: string;
}

const ACCOUNT_KEY = "mentorAccount";

export const getAccount = (): AccountInfo | null => {
  const raw = ConfigService.getItem(ACCOUNT_KEY);
  if (raw) {
    try {
      return JSON.parse(raw) as AccountInfo;
    } catch {
      // 损坏的记录按未登录处理
    }
  }
  // 兼容登录功能上线前已经绑定的数据源：当作已登录
  const legacy = ConfigService.getItem("defaultSyncOption");
  if (legacy === "icloud" || legacy === "github") {
    return { provider: legacy, login: "", name: "", avatar: "", location: "" };
  }
  return null;
};

const listeners = new Set<(account: AccountInfo | null) => void>();
export const subscribeAccount = (fn: (account: AccountInfo | null) => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};
const notify = () => {
  const account = getAccount();
  listeners.forEach((fn) => fn(account));
};

const closeSyncUtil = async (service: string) => {
  SyncService.removeSyncUtil(service);
  removeCloudConfig(service);
  if (isElectron) {
    await window.electronAPI.invoke("cloud-close", { service });
  }
};

/** 写入数据源并设为唯一的同步方式 */
const bindProvider = async (
  provider: AccountProvider,
  config: Record<string, string>,
  info: Omit<AccountInfo, "provider">
) => {
  // 只保留一个数据源：先清掉另一种
  for (const other of ["icloud", "github"]) {
    if (other !== provider) await unbindProvider(other);
  }
  const res = await encryptToken(provider, config);
  if (res.code !== 200) return false;
  await closeSyncUtil(provider);
  ConfigService.setListConfig(provider, "dataSourceList");
  ConfigService.setItem("defaultSyncOption", provider);
  ConfigService.setItem(ACCOUNT_KEY, JSON.stringify({ provider, ...info }));
  notify();
  return true;
};

const unbindProvider = async (provider: string) => {
  await TokenService.setToken(provider + "_token", "");
  await closeSyncUtil(provider);
  ConfigService.deleteListConfig(provider, "dataSourceList");
  if (ConfigService.getItem("defaultSyncOption") === provider) {
    ConfigService.removeItem("defaultSyncOption");
  }
};

/** iCloud 登录：要求系统已登录 Apple 账户并开启 iCloud 云盘 */
export const loginWithICloud = async (): Promise<
  { ok: true } | { ok: false; error: "unavailable" | "bind-failed" }
> => {
  const drivePath = getICloudDrivePath();
  if (!drivePath) return { ok: false, error: "unavailable" };
  const ok = await bindProvider(
    "icloud",
    { drivePath },
    { login: "", name: "iCloud", avatar: "", location: drivePath }
  );
  return ok ? { ok: true } : { ok: false, error: "bind-failed" };
};

export interface GitHubLoginResult {
  ok: boolean;
  error?: string;
  token?: string;
  login?: string;
  name?: string;
  avatar?: string;
  repo?: string;
}

/** GitHub 设备码登录成功后，用主进程返回的令牌与仓库完成绑定 */
export const completeGitHubLogin = async (result: GitHubLoginResult) => {
  if (!result.ok || !result.token || !result.repo) return false;
  return bindProvider(
    "github",
    { repo: result.repo, token: result.token },
    {
      login: result.login || "",
      name: result.name || result.login || "",
      avatar: result.avatar || "",
      location: result.repo,
    }
  );
};

/** 令牌方式登录 GitHub（未配置 OAuth Client ID 时的回退） */
export const loginWithGitHubToken = async (
  config: { repo: string; token: string },
  login: string
) =>
  bindProvider(
    "github",
    config,
    { login, name: login, avatar: "", location: config.repo }
  );

/** 退出登录：解除同步，本地书籍与笔记保留 */
export const logout = async () => {
  const account = getAccount();
  if (account) await unbindProvider(account.provider);
  ConfigService.removeItem(ACCOUNT_KEY);
  notify();
};
