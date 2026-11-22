import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { Trans } from "react-i18next";
import i18n from "../../../i18n";
import { isElectron } from "react-device-detect";
import { syncSettingList } from "../../../constants/settingList";
import SwitchRow from "../../../components/readerSettings/switchRow";
import toast from "react-hot-toast";
import {
  generateSyncRecord,
  showTaskProgress,
  vexComfirmAsync,
} from "../../../utils/common";
import { backup } from "../../../utils/file/backup";
import { restore } from "../../../utils/file/restore";
import {
  ConfigService,
  SyncHelper,
} from "../../../assets/lib/kookit-extra-browser.min";
import BookUtil from "../../../utils/file/bookUtil";
import { useAppStore } from "../../../store/useAppStore";
import {
  AccountInfo,
  getAccount,
  logout,
  subscribeAccount,
} from "../../../utils/storage/accountService";
import "./iCloudStatus.css";

interface SyncSettingState {
  isKeepLocal: boolean;
  isDisableAutoSync: boolean;
  autoOffline: boolean;
  hideSyncProgress: boolean;
  scheduledSyncInterval: string;
}

const SYNC_INTERVALS: { value: string; minutes?: number; hours?: number }[] = [
  { value: "" },
  { value: "5", minutes: 5 },
  { value: "15", minutes: 15 },
  { value: "30", minutes: 30 },
  { value: "60", hours: 1 },
  { value: "360", hours: 6 },
  { value: "1440", hours: 24 },
];

/**
 * 同步设置：同步方式由登录账号决定（iCloud 或 GitHub），这里只展示账号与同步选项。
 */
const SyncSetting = () => {
  const handleFetchBooks = useAppStore((s) => s.handleFetchBooks);
  const handleFetchDataSourceList = useAppStore(
    (s) => s.handleFetchDataSourceList
  );
  const handleFetchDefaultSyncOption = useAppStore(
    (s) => s.handleFetchDefaultSyncOption
  );
  const handleLoadingDialog = useAppStore((s) => s.handleLoadingDialog);
  const handleLoginDialog = useAppStore((s) => s.handleLoginDialog);
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [account, setAccount] = useState<AccountInfo | null>(getAccount());
  const [state, setState] = useState<SyncSettingState>(() => ({
    isKeepLocal: ConfigService.getReaderConfig("isKeepLocal") === "yes",
    autoOffline: ConfigService.getReaderConfig("autoOffline") === "yes",
    isDisableAutoSync:
      ConfigService.getReaderConfig("isDisableAutoSync") === "yes",
    hideSyncProgress:
      ConfigService.getReaderConfig("hideSyncProgress") === "yes",
    scheduledSyncInterval:
      ConfigService.getReaderConfig("scheduledSyncInterval") || "",
  }));

  useEffect(() => subscribeAccount(setAccount), []);

  const toggle = (name: keyof SyncSettingState) => {
    const next = !state[name];
    setState((prev) => ({ ...prev, [name]: next }));
    ConfigService.setReaderConfig(name, next ? "yes" : "no");
    toast.success(t("Change successful"));
    return next;
  };

  const downloadAllBooks = async () => {
    const tasks = await SyncHelper.syncBook(ConfigService, BookUtil);
    const timer = await showTaskProgress(() => {});
    if (!timer) return;
    await SyncHelper.runTasksWithLimit(
      tasks,
      99,
      ConfigService.getItem("defaultSyncOption")
    );
    clearInterval(timer);
    toast.success(t("Download completed"), { id: "autoOffline" });
    setTimeout(() => toast.dismiss("syncing"), 3000);
  };

  // service 为 "local" 时导出/导入本地压缩包，否则备份到当前账号
  const runBackup = async (service: string) => {
    const isLocal = service === "local";
    if (!isLocal) {
      handleLoadingDialog(true);
      toast(t("Uploading, please wait"), { id: "backup" });
    }
    const result = await backup(service);
    handleLoadingDialog(false);
    toast.dismiss("backup");
    if (result === "cancel") return;
    if (result === "success") {
      toast.success(t("Execute successful"));
      handleFetchBooks();
      await generateSyncRecord();
    } else {
      toast.error(
        t(isLocal ? "Backup failed" : "Upload failed, check your connection")
      );
    }
  };

  const runRestore = async (service: string) => {
    if (service !== "local") {
      const ok = await vexComfirmAsync(
        "Restoring will replace the data on this device with the backup. Continue?"
      );
      if (!ok) return;
      handleLoadingDialog(true);
      toast(t("Downloading, please wait"), { id: "backup" });
    }
    const result = await restore(service);
    handleLoadingDialog(false);
    toast.dismiss("backup");
    if (result === "cancel") return;
    if (result === "success") {
      toast.success(t("Execute successful"));
      handleFetchBooks();
      await generateSyncRecord();
      setTimeout(() => navigate("/manager/home"), 2000);
    } else {
      toast.error(t("Download failed,network problem or no backup"));
    }
  };

  const renderAccount = () => {
    if (!account) {
      return (
        <div className="icloud-status-card">
          <div className="icloud-status-head">
            <span className="icloud-status-title">{t("Not signed in")}</span>
            <span className="icloud-status-dot is-off"></span>
          </div>
          <div className="icloud-status-actions">
            <span
              className="icloud-status-button"
              onClick={() => handleLoginDialog(true)}
            >
              {t("Sign in")}
            </span>
            <span className="icloud-status-hint">
              {t(
                "Sign in with iCloud or GitHub, your library will sync through that account"
              )}
            </span>
          </div>
        </div>
      );
    }
    const providerName = account.provider === "github" ? "GitHub" : "iCloud";
    return (
      <div className="icloud-status-card">
        <div className="icloud-status-head">
          <span className="icloud-status-title">
            {account.name || account.login || providerName}
          </span>
          <span className="icloud-status-dot is-on"></span>
          <span className="icloud-status-text">
            {t("Syncing via {{name}}", { name: providerName })}
          </span>
        </div>
        {account.location && (
          <div className="icloud-status-path" title={account.location}>
            {account.provider === "github"
              ? t("Repository")
              : t("Sync folder")}
            : {account.location}
          </div>
        )}
        <div className="icloud-status-actions">
          <span
            className="icloud-status-button is-plain"
            onClick={async () => {
              const ok = await vexComfirmAsync(
                "After signing out, sync stops. Books and notes on this device are kept. Continue?"
              );
              if (!ok) return;
              await logout();
              handleFetchDataSourceList();
              handleFetchDefaultSyncOption();
              toast.success(t("Signed out"));
            }}
          >
            {t("Sign out")}
          </span>
        </div>
      </div>
    );
  };

  return (
    <>
      {isElectron ? (
        renderAccount()
      ) : (
        <p className="setting-option-subtitle">
          {t("Sign in is available in the desktop app")}
        </p>
      )}

      {account &&
        syncSettingList.map((item) => (
          <div key={item.propName}>
            <SwitchRow
              variant="setting"
              title={<Trans>{item.title}</Trans>}
              isEnabled={state[item.propName as keyof SyncSettingState] as boolean}
              onClick={async () => {
                const next = toggle(item.propName as keyof SyncSettingState);
                if (item.propName === "autoOffline" && next) {
                  await downloadAllBooks();
                }
              }}
            />
            {item.desc && (
              <p className="setting-option-subtitle">
                <Trans>{item.desc}</Trans>
              </p>
            )}
          </div>
        ))}

      {account && (
        <>
          <div className="setting-dialog-new-title">
            <Trans>Scheduled sync interval</Trans>
            <select
              className="lang-setting-dropdown"
              value={state.scheduledSyncInterval}
              onChange={(event) => {
                const value = event.target.value;
                ConfigService.setReaderConfig("scheduledSyncInterval", value);
                setState((prev) => ({ ...prev, scheduledSyncInterval: value }));
                toast.success(t("Change successful"));
                toast(
                  t(
                    "The new sync interval will take effect after restarting Koodo Reader"
                  )
                );
              }}
            >
              {SYNC_INTERVALS.map((item) => (
                <option
                  key={item.value}
                  value={item.value}
                  className="lang-setting-option"
                >
                  {!item.value
                    ? t("Disabled")
                    : item.minutes
                      ? i18n.t("Minute duration", { tts: item.minutes })
                      : i18n.t("Hour duration", { tts: item.hours })}
                </option>
              ))}
            </select>
          </div>
          <p className="setting-option-subtitle">
            <Trans>
              {
                "Automatically sync your library with cloud at the specified interval."
              }
            </Trans>
          </p>

          <div className="setting-dialog-new-title">
            <Trans>Back up to cloud</Trans>
            <span
              className="change-location-button"
              onClick={() => runBackup(account.provider)}
            >
              <Trans>Backup</Trans>
            </span>
          </div>
          <div className="setting-dialog-new-title">
            <Trans>Restore from cloud</Trans>
            <span
              className="change-location-button"
              onClick={() => runRestore(account.provider)}
            >
              <Trans>Restore</Trans>
            </span>
          </div>
        </>
      )}

      <div className="setting-dialog-new-title">
        <Trans>Export backup file</Trans>
        <span className="change-location-button" onClick={() => runBackup("local")}>
          <Trans>Export</Trans>
        </span>
      </div>
      <div className="setting-dialog-new-title">
        <Trans>Import backup file</Trans>
        <span
          className="change-location-button"
          onClick={() => runRestore("local")}
        >
          <Trans>Import backup</Trans>
        </span>
      </div>

      {account && (
        <>
          <div className="setting-dialog-new-title">
            <Trans>Reset sync records</Trans>
            <span
              className="change-location-button"
              onClick={async () => {
                await generateSyncRecord();
                toast.success(t("Reset successful"));
              }}
            >
              <Trans>Reset</Trans>
            </span>
          </div>
          <p className="setting-option-subtitle">
            {t(
              "Use this when data on other devices is wrong but this device is correct: reset here, then sync again"
            )}
          </p>
        </>
      )}
    </>
  );
};

export default SyncSetting;
