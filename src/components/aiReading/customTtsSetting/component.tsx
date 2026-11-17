import { useState } from "react";
import { useTranslation } from "react-i18next";
import toast from "react-hot-toast";
import { handleContextMenu } from "../../../utils/common";
import {
  CustomTtsConfig,
  getCustomTtsConfig,
  isCustomTtsConfigured,
  parseVoiceNames,
  saveCustomTtsConfig,
  synthesizeSpeech,
} from "../../../utils/aiReading/customTts";
import { useAppStore } from "../../../store/useAppStore";

const FORMAT_OPTIONS: CustomTtsConfig["format"][] = [
  "mp3",
  "wav",
  "opus",
  "aac",
  "flac",
];

type TextField = "endpoint" | "apiKey" | "model" | "voices";

/** 自定义 TTS（OpenAI 兼容 /audio/speech）设置，替代原「官方 AI 语音」 */
const CustomTtsSetting = () => {
  const { t } = useTranslation();
  const handleFetchPlugins = useAppStore((s) => s.handleFetchPlugins);
  const [config, setConfig] = useState<CustomTtsConfig>(getCustomTtsConfig);
  const [isTesting, setIsTesting] = useState(false);

  const updateField = (field: TextField, value: string) => {
    setConfig((prev) => ({ ...prev, [field]: value }));
  };

  const persist = (next: CustomTtsConfig = config) => {
    saveCustomTtsConfig({
      ...next,
      endpoint: next.endpoint.trim(),
      model: next.model.trim(),
    });
    handleFetchPlugins();
  };

  const handleTest = async () => {
    persist();
    if (!isCustomTtsConfigured(config)) {
      toast.error(t("Please fill in the endpoint and model"));
      return;
    }
    const voice = parseVoiceNames(config.voices)[0];
    if (!voice) {
      toast.error(t("Please fill in at least one voice"));
      return;
    }
    setIsTesting(true);
    try {
      const audio = await synthesizeSpeech(t("Hello"), voice, 0, config);
      await new Audio(audio).play();
      toast.success(t("Test successful"));
    } catch (error) {
      toast.error(
        t("Test failed") +
          ": " +
          (error instanceof Error ? error.message : String(error))
      );
    } finally {
      setIsTesting(false);
    }
  };

  const renderInput = (
    field: TextField,
    label: string,
    placeholder: string,
    isSecret = false
  ) => {
    const id = "custom-tts-" + field;
    return (
      <div className="setting-dialog-new-title">
        <span>{t(label)}</span>
        <input
          type={isSecret ? "password" : "text"}
          className="token-dialog-username-box"
          id={id}
          style={{ width: "220px", margin: 0 }}
          placeholder={placeholder}
          value={config[field]}
          onContextMenu={() => handleContextMenu(id, true)}
          onChange={(e) => updateField(field, e.target.value)}
          onBlur={() => persist()}
        />
      </div>
    );
  };

  return (
    <>
      <div className="setting-dialog-new-title" style={{ fontWeight: 600 }}>
        {t("Custom TTS")}
      </div>
      <p className="setting-option-subtitle">
        {t(
          "Compatible with the OpenAI /audio/speech API, such as OpenAI, openai-edge-tts or kokoro-fastapi"
        )}
      </p>
      {renderInput("endpoint", "API endpoint", "https://api.openai.com/v1")}
      {renderInput("apiKey", "API key", "sk-...", true)}
      {renderInput("model", "Model", "tts-1")}
      {renderInput("voices", "Voices", "alloy,echo,nova")}
      <div className="setting-dialog-new-title">
        <span>{t("Audio format")}</span>
        <select
          className="lang-setting-dropdown"
          value={config.format}
          onChange={(e) => {
            const next = {
              ...config,
              format: e.target.value as CustomTtsConfig["format"],
            };
            setConfig(next);
            persist(next);
          }}
        >
          {FORMAT_OPTIONS.map((item) => (
            <option key={item} value={item} className="lang-setting-option">
              {item}
            </option>
          ))}
        </select>
      </div>
      <div
        className="setting-dialog-new-title"
        style={{ marginBottom: "60px" }}
      >
        <span></span>
        <span
          className="change-location-button"
          style={{ opacity: isTesting ? 0.5 : 1 }}
          onClick={() => !isTesting && handleTest()}
        >
          {t("Test")}
        </span>
      </div>
    </>
  );
};

export default CustomTtsSetting;
