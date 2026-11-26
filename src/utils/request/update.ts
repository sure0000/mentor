// 检查更新：读取 GitHub Releases 的最新版本，与当前版本比较。
import { compareVersions } from "../common";

export const RELEASE_REPO = "sure0000/mentor";
export const RELEASES_PAGE = `https://github.com/${RELEASE_REPO}/releases/latest`;
const LATEST_RELEASE_API = `https://api.github.com/repos/${RELEASE_REPO}/releases/latest`;

export interface UpdateInfo {
  hasUpdate: boolean;
  latestVersion: string;
  url: string;
}

interface GithubRelease {
  tag_name?: unknown;
  html_url?: unknown;
}

// tag 形如 "v1.0.2"，去掉前缀 v 后与 package.json 版本比较
export const parseUpdateInfo = (
  release: GithubRelease,
  currentVersion: string
): UpdateInfo | null => {
  if (typeof release.tag_name !== "string") return null;
  const latestVersion = release.tag_name.trim().replace(/^v/i, "");
  if (!/^\d+(\.\d+)*$/.test(latestVersion)) return null;
  const url =
    typeof release.html_url === "string" &&
    release.html_url.startsWith("https://github.com/")
      ? release.html_url
      : RELEASES_PAGE;
  return {
    hasUpdate: compareVersions(latestVersion, currentVersion) > 0,
    latestVersion,
    url,
  };
};

export const checkForUpdate = async (
  currentVersion: string
): Promise<UpdateInfo> => {
  const response = await fetch(LATEST_RELEASE_API, {
    headers: { Accept: "application/vnd.github+json" },
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) {
    throw new Error(`Check for update failed: ${response.status}`);
  }
  const info = parseUpdateInfo(await response.json(), currentVersion);
  if (!info) throw new Error("Invalid release info");
  return info;
};
