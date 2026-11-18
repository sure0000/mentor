import { useEffect, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { isElectron } from "react-device-detect";
import "./iCloudStatus.css";

interface ICloudStatusResult {
  supported: boolean;
  available: boolean;
  path: string;
}

interface Props {
  // iCloud 是否已添加为数据源
  isBound: boolean;
  // 当前默认同步方式是否为 iCloud
  isDefault: boolean;
}

/**
 * iCloud 登录状态卡片。iCloud 的登录由 macOS 系统负责，应用内只能检测和引导：
 * 未登录或未开启 iCloud 云盘时，一键打开系统设置的 Apple 账户页。
 */
const ICloudStatus = ({ isBound, isDefault }: Props) => {
  const { t } = useTranslation();
  const [status, setStatus] = useState<ICloudStatusResult | null>(null);

  const refresh = async () => {
    if (!isElectron) return;
    setStatus(await window.electronAPI.invoke("icloud-status"));
  };

  useEffect(() => {
    refresh();
    // 用户去系统设置登录后切回应用时自动刷新状态
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, []);

  if (!status?.supported) return null;

  let stateText = t("Not signed in to iCloud, or iCloud Drive is turned off");
  let stateClass = "is-off";
  if (status.available && isBound) {
    stateText = isDefault
      ? t("Syncing with iCloud Drive")
      : t("Connected, not the default sync option");
    stateClass = isDefault ? "is-on" : "is-idle";
  } else if (status.available) {
    stateText = t("iCloud Drive is available, add it as a data source to sync");
    stateClass = "is-idle";
  }

  return (
    <div className="icloud-status-card">
      <div className="icloud-status-head">
        <span className="icloud-status-title">iCloud</span>
        <span className={"icloud-status-dot " + stateClass}></span>
        <span className="icloud-status-text">{stateText}</span>
      </div>
      {status.available ? (
        <div className="icloud-status-path" title={status.path}>
          <Trans>Sync folder</Trans>: {status.path}
        </div>
      ) : (
        <div className="icloud-status-actions">
          <span
            className="icloud-status-button"
            onClick={() => window.electronAPI.invoke("open-icloud-settings")}
          >
            <Trans>Open iCloud settings</Trans>
          </span>
          <span className="icloud-status-hint">
            <Trans>
              Sign in with your Apple Account and turn on iCloud Drive, then come back to Mentor
            </Trans>
          </span>
        </div>
      )}
    </div>
  );
};

export default ICloudStatus;
