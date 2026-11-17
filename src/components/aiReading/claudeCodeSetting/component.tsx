import { useState } from "react";
import { useTranslation } from "react-i18next";
import toast from "react-hot-toast";
import { isElectron } from "react-device-detect";
import { ConfigService } from "../../../assets/lib/kookit-extra-browser.min";
import { handleContextMenu } from "../../../utils/common";
import {
  CLAUDE_CODE_ERROR_KEYS,
  checkClaudeCode,
} from "../../../utils/aiReading/claudeCode";
import SwitchRow from "../../readerSettings/switchRow";
import { CHAPTER_END_PROMPT_KEY } from "../../../utils/aiReading/guideNav";

const MODEL_OPTIONS = ["", "sonnet", "opus", "haiku"];

/** AI 伴读：Claude Code（本机）后端设置。可执行文件路径 + 模型 + 检测按钮 */
const ClaudeCodeSetting = () => {
  const { t } = useTranslation();
  const [binPath, setBinPath] = useState<string>(
    ConfigService.getReaderConfig("claudeCodePath") || ""
  );
  const [model, setModel] = useState<string>(
    ConfigService.getReaderConfig("claudeCodeModel") || ""
  );
  const [isChecking, setIsChecking] = useState(false);
  const [isChapterEndPrompt, setIsChapterEndPrompt] = useState(
    ConfigService.getReaderConfig(CHAPTER_END_PROMPT_KEY) === "yes"
  );

  if (!isElectron) {
    return null;
  }

  const handleDetect = async () => {
    setIsChecking(true);
    try {
      const res = await checkClaudeCode(binPath);
      if (res.ok) {
        toast.success(t("Claude Code found") + ": " + res.version);
      } else {
        toast.error(t(CLAUDE_CODE_ERROR_KEYS["not-found"]));
      }
    } finally {
      setIsChecking(false);
    }
  };

  return (
    <>
      <div className="setting-dialog-new-title">
        <span>{t("Claude Code path")}</span>
        <span style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <input
            type="text"
            className="token-dialog-username-box"
            id="claude-code-path-box"
            style={{ width: "180px", margin: 0 }}
            placeholder={t("Leave empty to detect automatically")}
            value={binPath}
            onContextMenu={() => {
              handleContextMenu("claude-code-path-box", true);
            }}
            onChange={(e) => setBinPath(e.target.value)}
            onBlur={() =>
              ConfigService.setReaderConfig("claudeCodePath", binPath.trim())
            }
          />
          <span
            className="change-location-button"
            style={{ fontSize: "12px", opacity: isChecking ? 0.5 : 1 }}
            onClick={() => !isChecking && handleDetect()}
          >
            {t("Detect")}
          </span>
        </span>
      </div>
      <div className="setting-dialog-new-title">
        <span>{t("Claude Code model")}</span>
        <select
          className="lang-setting-dropdown"
          value={model}
          onChange={(e) => {
            setModel(e.target.value);
            ConfigService.setReaderConfig("claudeCodeModel", e.target.value);
            toast.success(t("Change successful"));
          }}
        >
          {MODEL_OPTIONS.map((item) => (
            <option key={item} value={item} className="lang-setting-option">
              {item || t("Default")}
            </option>
          ))}
        </select>
      </div>
      <SwitchRow
        variant="setting"
        title={t("Suggest reading companion after finishing a chapter")}
        isEnabled={isChapterEndPrompt}
        onClick={() => {
          const next = !isChapterEndPrompt;
          setIsChapterEndPrompt(next);
          ConfigService.setReaderConfig(
            CHAPTER_END_PROMPT_KEY,
            next ? "yes" : "no"
          );
          toast.success(t("Change successful"));
        }}
      />
    </>
  );
};

export default ClaudeCodeSetting;
