import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { isElectron } from "react-device-detect";
import toast from "react-hot-toast";
import "./loginDialog.css";
import { useAppStore } from "../../../store/useAppStore";
import { openInBrowser } from "../../../utils/common";
import {
  completeGitHubLogin,
  GitHubLoginResult,
  loginWithGitHubToken,
  loginWithICloud,
} from "../../../utils/storage/accountService";

declare var window: any;

interface ICloudStatus {
  supported: boolean;
  available: boolean;
}

type Step =
  | { kind: "choose" }
  | { kind: "github-code"; userCode: string; verificationUri: string }
  | { kind: "github-browser" }
  | { kind: "github-token" }
  | { kind: "working"; text: string };

const GITHUB_TOKEN_URL =
  "https://github.com/settings/tokens/new?scopes=repo&description=Mentor";

const GITHUB_ERRORS: Record<string, string> = {
  access_denied: "Authorization was cancelled on GitHub",
  expired_token: "The code has expired, please try again",
  network: "Unable to connect to GitHub, check your network or proxy",
  "bad-token": "Token is invalid or expired",
  "create-repo-failed": "Failed to create the sync repository",
  "repo-not-found": "Repository not found, or the token has no access to it",
  "no-write-permission": "The token has no write permission for this repository",
};

/**
 * 登录：iCloud 或 GitHub，二选一。登录方式即同步方式。
 */
const LoginDialog = () => {
  const handleLoginDialog = useAppStore((s) => s.handleLoginDialog);
  const handleFetchDataSourceList = useAppStore(
    (s) => s.handleFetchDataSourceList
  );
  const handleFetchDefaultSyncOption = useAppStore(
    (s) => s.handleFetchDefaultSyncOption
  );
  const handleCloudSyncFunc = useAppStore((s) => s.book.cloudSyncFunc);
  const { t } = useTranslation();
  const [step, setStep] = useState<Step>({ kind: "choose" });
  const [icloud, setICloud] = useState<ICloudStatus | null>(null);
  // "browser" 一键登录 / "device" 设备码 / "" 未配置（令牌方式）
  const [githubMode, setGitHubMode] = useState("");
  const [tokenForm, setTokenForm] = useState({ token: "", repo: "" });
  const stepRef = useRef(step);
  stepRef.current = step;

  useEffect(() => {
    if (!isElectron) return;
    const refresh = async () =>
      setICloud(await window.electronAPI.invoke("icloud-status"));
    refresh();
    window.electronAPI
      .invoke("github-login-available")
      .then((mode: string) => setGitHubMode(mode || ""));
    window.addEventListener("focus", refresh);
    const off = window.electronAPI.on(
      "github-login-result",
      (_event: unknown, result: GitHubLoginResult) => onGitHubResult(result)
    );
    return () => {
      window.removeEventListener("focus", refresh);
      off?.();
      window.electronAPI.invoke("github-login-cancel");
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const close = () => handleLoginDialog(false);

  const afterLogin = async (provider: string) => {
    handleFetchDataSourceList();
    handleFetchDefaultSyncOption();
    toast.success(
      t("Signed in with {{name}}, sync is turned on", { name: provider })
    );
    close();
    // 登录后立即同步一次，把云端已有数据拉下来
    if (handleCloudSyncFunc) await handleCloudSyncFunc();
  };

  const onGitHubResult = async (result: GitHubLoginResult) => {
    if (
      stepRef.current.kind !== "github-code" &&
      stepRef.current.kind !== "github-browser"
    )
      return;
    if (!result.ok) {
      toast.error(t(GITHUB_ERRORS[result.error || ""] || "Sign in failed"));
      setStep({ kind: "choose" });
      return;
    }
    setStep({ kind: "working", text: t("Setting up sync") });
    if (await completeGitHubLogin(result)) {
      await afterLogin("GitHub");
    } else {
      toast.error(t("Sign in failed"));
      setStep({ kind: "choose" });
    }
  };

  const startICloud = async () => {
    if (!icloud?.available) {
      window.electronAPI.invoke("open-icloud-settings");
      return;
    }
    setStep({ kind: "working", text: t("Setting up sync") });
    const result = await loginWithICloud();
    if (result.ok) {
      await afterLogin("iCloud");
    } else {
      toast.error(t("Sign in failed"));
      setStep({ kind: "choose" });
    }
  };

  const startGitHub = async () => {
    if (!githubMode) {
      setStep({ kind: "github-token" });
      return;
    }
    setStep({ kind: "working", text: t("Connecting to GitHub") });
    const res = await window.electronAPI.invoke("github-login-start");
    if (!res?.ok) {
      toast.error(t(GITHUB_ERRORS[res?.error] || "Sign in failed"));
      setStep({ kind: "choose" });
      return;
    }
    if (res.mode === "browser") {
      // 主进程已打开浏览器授权页，授权后自动回到应用
      setStep({ kind: "github-browser" });
      return;
    }
    setStep({
      kind: "github-code",
      userCode: res.userCode,
      verificationUri: res.verificationUri,
    });
    navigator.clipboard?.writeText(res.userCode).catch(() => {});
    openInBrowser(res.verificationUri);
  };

  const submitToken = async () => {
    const token = tokenForm.token.trim();
    if (!token) {
      toast.error(t("Missing parameters"));
      return;
    }
    setStep({ kind: "working", text: t("Setting up sync") });
    // 主进程校验令牌，必要时创建默认私有仓库 <login>/mentor-sync
    const result: GitHubLoginResult = await window.electronAPI.invoke(
      "github-token-login",
      { token, repo: tokenForm.repo.trim() }
    );
    if (!result?.ok || !result.repo) {
      toast.error(t(GITHUB_ERRORS[result?.error || ""] || "Sign in failed"));
      setStep({ kind: "github-token" });
      return;
    }
    if (
      await loginWithGitHubToken({ token, repo: result.repo }, result.login || "")
    ) {
      await afterLogin("GitHub");
    } else {
      toast.error(t("Sign in failed"));
      setStep({ kind: "github-token" });
    }
  };

  const renderChoose = () => (
    <>
      <div className="login-dialog-title">{t("Sign in to Mentor")}</div>
      <div className="login-dialog-subtitle">
        {t(
          "Your books, notes and reading progress sync through the account you sign in with"
        )}
      </div>
      <div className="login-dialog-options">
        {icloud?.supported && (
          <div className="login-option" onClick={startICloud}>
            <span className="login-option-logo is-icloud">
              <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor">
                <path d="M19.35 10.04A7.49 7.49 0 0 0 12 4C9.11 4 6.6 5.64 5.35 8.04A5.994 5.994 0 0 0 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96z" />
              </svg>
            </span>
            <span className="login-option-body">
              <span className="login-option-name">
                {t("Continue with iCloud")}
              </span>
              <span className="login-option-desc">
                {icloud.available
                  ? t("Syncs via iCloud Drive across your Apple devices")
                  : t("Sign in to iCloud and turn on iCloud Drive in System Settings first")}
              </span>
            </span>
            <span className="login-option-arrow">›</span>
          </div>
        )}
        <div className="login-option" onClick={startGitHub}>
          <span className="login-option-logo is-github">
            <span className="icon-github"></span>
          </span>
          <span className="login-option-body">
            <span className="login-option-name">
              {t("Continue with GitHub")}
            </span>
            <span className="login-option-desc">
              {t("Syncs via a private repository on your GitHub account")}
            </span>
          </span>
          <span className="login-option-arrow">›</span>
        </div>
      </div>
      <div className="login-dialog-footnote">
        {t("You can keep using Mentor without signing in; data stays on this device")}
      </div>
    </>
  );

  const renderGitHubBrowser = () => (
    <>
      <span className="login-option-logo is-github login-hero-logo">
        <span className="icon-github"></span>
      </span>
      <div className="login-dialog-title">{t("Continue in your browser")}</div>
      <div className="login-dialog-subtitle">
        {t("Click Authorize on the GitHub page, Mentor will sign you in automatically")}
      </div>
      <div className="login-waiting">
        <span className="login-spinner" />
        {t("Waiting for authorization")}
      </div>
      <div className="login-dialog-actions">
        <span className="login-link" onClick={startGitHub}>
          {t("Open GitHub again")}
        </span>
        <span
          className="login-link is-muted"
          onClick={() => {
            window.electronAPI.invoke("github-login-cancel");
            setStep({ kind: "choose" });
          }}
        >
          {t("Back")}
        </span>
      </div>
    </>
  );

  const renderGitHubCode = (s: Extract<Step, { kind: "github-code" }>) => (
    <>
      <div className="login-dialog-title">{t("Authorize on GitHub")}</div>
      <div className="login-dialog-subtitle">
        {t("Enter this code on the GitHub page that just opened")}
      </div>
      <div
        className="login-code"
        title={t("Copy")}
        onClick={() => {
          navigator.clipboard?.writeText(s.userCode).catch(() => {});
          toast.success(t("Copied"));
        }}
      >
        {s.userCode}
      </div>
      <div className="login-waiting">
        <span className="login-spinner" />
        {t("Waiting for authorization")}
      </div>
      <div className="login-dialog-actions">
        <span
          className="login-link"
          onClick={() => openInBrowser(s.verificationUri)}
        >
          {t("Open GitHub again")}
        </span>
        <span
          className="login-link is-muted"
          onClick={() => {
            window.electronAPI.invoke("github-login-cancel");
            setStep({ kind: "choose" });
          }}
        >
          {t("Back")}
        </span>
      </div>
    </>
  );

  const renderGitHubToken = () => (
    <>
      <div className="login-dialog-title">{t("Continue with GitHub")}</div>
      <div className="login-dialog-subtitle">
        {t(
          "Create a token with the repo scope, Mentor will store your data in a private repository"
        )}
      </div>
      <input
        className="login-input"
        type="password"
        placeholder={t("Personal access token")}
        value={tokenForm.token}
        onChange={(e) => setTokenForm({ ...tokenForm, token: e.target.value })}
      />
      <input
        className="login-input"
        type="text"
        placeholder={t("Repository") + " (" + t("Optional") + "): owner/mentor-sync"}
        value={tokenForm.repo}
        onChange={(e) => setTokenForm({ ...tokenForm, repo: e.target.value })}
      />
      <div className="login-primary" onClick={submitToken}>
        {t("Sign in")}
      </div>
      <div className="login-dialog-actions">
        <span className="login-link" onClick={() => openInBrowser(GITHUB_TOKEN_URL)}>
          {t("Create token")}
        </span>
        <span
          className="login-link is-muted"
          onClick={() => setStep({ kind: "choose" })}
        >
          {t("Back")}
        </span>
      </div>
    </>
  );

  return (
    <div className="login-dialog-mask" onClick={close}>
      <div className="login-dialog" onClick={(e) => e.stopPropagation()}>
        <span className="icon-close login-dialog-close" onClick={close}></span>
        {!isElectron ? (
          <div className="login-dialog-subtitle">
            {t("Sign in is available in the desktop app")}
          </div>
        ) : step.kind === "choose" ? (
          renderChoose()
        ) : step.kind === "github-browser" ? (
          renderGitHubBrowser()
        ) : step.kind === "github-code" ? (
          renderGitHubCode(step)
        ) : step.kind === "github-token" ? (
          renderGitHubToken()
        ) : (
          <div className="login-waiting is-block">
            <span className="login-spinner" />
            {step.text}
          </div>
        )}
      </div>
    </div>
  );
};

export default LoginDialog;
