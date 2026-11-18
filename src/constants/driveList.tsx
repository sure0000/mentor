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
interface ConfigItem {
  label: string;
  value: string;
  type: string;
  required?: boolean;
  example?: string;
  note?: string;
}

// Type the driveInputConfig
interface DriveInputConfig {
  [key: string]: ConfigItem[];
}
export const driveInputConfig: DriveInputConfig = {
  github: [
    {
      label: "Repository",
      value: "repo",
      type: "text",
      required: true,
      example: "username/mentor-sync",
      note: "Use a private repository. Single files over 95MB are skipped",
    },
    {
      label: "Personal access token",
      value: "token",
      type: "password",
      required: true,
      note: "Create a fine-grained token with Contents read and write permission for this repository only",
    },
    {
      label: "Branch",
      value: "branch",
      type: "text",
      required: false,
      example: "main",
    },
    {
      label: "Folder in repository",
      value: "dir",
      type: "text",
      required: false,
      example: "Mentor",
    },
  ],
};
