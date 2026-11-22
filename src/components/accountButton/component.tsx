import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import "./accountButton.css";
import { useAppStore } from "../../store/useAppStore";
import {
  AccountInfo,
  getAccount,
  logout,
  subscribeAccount,
} from "../../utils/storage/accountService";
import { vexComfirmAsync } from "../../utils/common";
import toast from "react-hot-toast";

/** 顶栏账号入口：未登录显示「登录」，已登录显示头像与账号菜单 */
const AccountButton = () => {
  const handleLoginDialog = useAppStore((s) => s.handleLoginDialog);
  const handleSetting = useAppStore((s) => s.handleSetting);
  const handleSettingMode = useAppStore((s) => s.handleSettingMode);
  const handleFetchDataSourceList = useAppStore(
    (s) => s.handleFetchDataSourceList
  );
  const handleFetchDefaultSyncOption = useAppStore(
    (s) => s.handleFetchDefaultSyncOption
  );
  const { t } = useTranslation();
  const [account, setAccount] = useState<AccountInfo | null>(getAccount());
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  useEffect(() => subscribeAccount(setAccount), []);

  if (!account) {
    return (
      <span className="account-login-button" onClick={() => handleLoginDialog(true)}>
        {t("Sign in")}
      </span>
    );
  }

  const providerName = account.provider === "github" ? "GitHub" : "iCloud";
  const displayName = account.name || account.login || providerName;

  return (
    <div
      className="account-button"
      onMouseLeave={() => setIsMenuOpen(false)}
    >
      <span
        className={"account-avatar is-" + account.provider}
        onClick={() => setIsMenuOpen(!isMenuOpen)}
      >
        {account.avatar ? (
          <img src={account.avatar} alt="" />
        ) : account.provider === "github" ? (
          <span className="icon-github"></span>
        ) : (
          <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
            <path d="M19.35 10.04A7.49 7.49 0 0 0 12 4C9.11 4 6.6 5.64 5.35 8.04A5.994 5.994 0 0 0 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96z" />
          </svg>
        )}
      </span>
      {isMenuOpen && (
        <div className="account-menu">
          <div className="account-menu-head">
            <div className="account-menu-name">{displayName}</div>
            <div className="account-menu-meta">
              {t("Syncing via {{name}}", { name: providerName })}
            </div>
            {account.location && (
              <div className="account-menu-meta" title={account.location}>
                {account.location}
              </div>
            )}
          </div>
          <div
            className="account-menu-item"
            onClick={() => {
              setIsMenuOpen(false);
              handleSetting(true);
              handleSettingMode("sync");
            }}
          >
            {t("Sync settings")}
          </div>
          <div
            className="account-menu-item is-danger"
            onClick={async () => {
              setIsMenuOpen(false);
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
          </div>
        </div>
      )}
    </div>
  );
};

export default AccountButton;
