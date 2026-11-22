// 二开：云同步只保留 iCloud Drive（macOS 桌面端）。
// 其余网盘依赖 Koodo 服务器做 OAuth 中转或令牌加密，已移除。
export const driveList = [
  {
    label: "iCloud",
    value: "icloud",
    icon: "icon-icloud",
    support: ["desktop"],
    scoped: true,
  },
  {
    // GitHub 私有仓库同步，由主进程 src/utils/main/github-sync.js 实现
    label: "GitHub",
    value: "github",
    icon: "icon-github",
    support: ["desktop"],
    scoped: true,
  },
] as {
  label: string;
  value: string;
  icon: string;
  support: string[];
  scoped: boolean;
  isPro?: boolean;
  needExtension?: boolean;
}[];
