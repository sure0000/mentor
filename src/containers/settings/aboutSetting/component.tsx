import { useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import toast from "react-hot-toast";
import packageJson from "../../../../package.json";

import { isElectron } from "react-device-detect";
import { openInBrowser } from "../../../utils/common";
import { checkForUpdate, UpdateInfo } from "../../../utils/request/update";

declare var window: any;

const AboutSetting = () => {
  const { t } = useTranslation();
  const [checking, setChecking] = useState(false);
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);

  const handleCheckUpdate = async () => {
    if (checking) return;
    setChecking(true);
    try {
      const info = await checkForUpdate(packageJson.version);
      setUpdateInfo(info);
      if (!info.hasUpdate) {
        toast.success(t("You are using the latest version"));
      }
    } catch (error) {
      console.error(error);
      toast.error(t("Failed to check for update"));
    } finally {
      setChecking(false);
    }
  };

  return (
    <>
      <div className="setting-dialog-new-title">
        <Trans>Current version</Trans>
        <div style={{ display: "flex", alignItems: "center" }}>
          <span>{packageJson.version}</span>
        </div>
      </div>
      <div className="setting-dialog-new-title">
        <Trans>Check for update</Trans>
        {updateInfo?.hasUpdate ? (
          <span
            className="change-location-button"
            onClick={() => openInBrowser(updateInfo.url)}
          >
            {t("Update to")} {updateInfo.latestVersion}
          </span>
        ) : (
          <span className="change-location-button" onClick={handleCheckUpdate}>
            {checking ? t("Checking for update") : t("Check for update")}
          </span>
        )}
      </div>
      {isElectron && (
        <div className="setting-dialog-new-title">
          <Trans>Get debug logs</Trans>
          <span
            className="change-location-button"
            onClick={async () => {
              const ipcRenderer = window.electronAPI;
              ipcRenderer.invoke("get-debug-logs", "ping");
            }}
          >
            <Trans>Locate</Trans>
          </span>
        </div>
      )}

      {isElectron && (
        <div className="setting-dialog-new-title">
          <Trans>Open console</Trans>
          <span
            className="change-location-button"
            onClick={async () => {
              window.electronAPI.invoke("open-console", "ping");
            }}
          >
            <Trans>View</Trans>
          </span>
        </div>
      )}
    </>
  );
};

export default AboutSetting;
