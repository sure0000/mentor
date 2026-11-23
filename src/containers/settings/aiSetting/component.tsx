import { useTranslation } from "react-i18next";
import { useState } from "react";
import toast from "react-hot-toast";
import { handleContextMenu, vexTextareaAsync } from "../../../utils/common";
import { aiRequest } from "../../../utils/request/common";
import {
  ConfigService,
  KookitConfig,
} from "../../../assets/lib/kookit-extra-browser.min";
import { useAppStore } from "../../../store/useAppStore";
import CustomTtsSetting from "../../../components/aiReading/customTtsSetting";
import SwitchRow from "../../../components/readerSettings/switchRow";
import { CHAPTER_END_PROMPT_KEY } from "../../../utils/aiReading/guideNav";
import { getPrompt } from "../../../utils/aiReading/aiGateway";
import {
  DEFAULT_PROMPTS,
  PROMPT_PLACEHOLDERS,
  PromptKey,
} from "../../../utils/aiReading/prompts";

export interface AIModelConfig {
  endpoint: string;
  modelName: string;
  modelId: string;
  apiKey: string;
  providerId: string;
  providerName: string;
}

type ModelEntry = { key: string; displayName: string; config: AIModelConfig };

/** 新建时使用的固定 key；已有配置则沿用原 key */
const DEFAULT_MODEL_KEY = "default";
const MODEL_PURPOSE_KEYS = [
  "aiAssistanceModel",
  "aiTranslateModel",
  "aiDictModel",
] as const;
const LOCAL_PROVIDERS = ["ollama", "lmstudio", "vllm"];
const PROMPT_ITEMS: { type: PromptKey; label: string }[] = [
  { type: "aiAssistance", label: "AI assistance" },
  { type: "aiTranslate", label: "Translation" },
  { type: "aiDict", label: "Dictionary" },
  { type: "bookQa", label: "Whole-book Q&A" },
  { type: "chapterPoints", label: "Key points of this chapter" },
  { type: "readingMarks", label: "Terms and core ideas" },
  { type: "bookGuide", label: "Book overview" },
  { type: "companionAssist", label: "Reading aid" },
  { type: "companionRelate", label: "Knowledge links" },
  { type: "companionFurther", label: "Further reading" },
];

/** 读取当前在用的模型：优先「AI 助手」指定的，其次任意一个已保存的 */
const loadCurrentModel = (): ModelEntry | null => {
  const assignedKey = ConfigService.getReaderConfig("aiAssistanceModel");
  const assigned = assignedKey
    ? (ConfigService.getObjectConfig(
        assignedKey,
        "aiModelConfig",
        null
      ) as ModelEntry | null)
    : null;
  if (assigned?.config) return assigned;
  const all = Object.values(
    (ConfigService.getAllObjectConfig("aiModelConfig") || {}) as Record<
      string,
      ModelEntry
    >
  );
  return all.find((e) => e?.config?.endpoint) || null;
};

const findProvider = (id: string) =>
  KookitConfig.AiProviderList.find((p) => p.id === id);

const AISetting = () => {
  const handleFetchPlugins = useAppStore((s) => s.handleFetchPlugins);
  const { t } = useTranslation();
  const [current] = useState(loadCurrentModel);
  const [modelKey] = useState(current?.key || DEFAULT_MODEL_KEY);
  const [providerId, setProviderId] = useState(
    current?.config.providerId || "openai"
  );
  const [endpoint, setEndpoint] = useState(
    current?.config.endpoint ?? findProvider("openai")?.defaultEndpoint ?? ""
  );
  const [apiKey, setApiKey] = useState(current?.config.apiKey || "");
  const [modelId, setModelId] = useState(current?.config.modelId || "");
  const [fetchedModels, setFetchedModels] = useState<string[]>([]);
  const [isFetching, setIsFetching] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [isMoreOpen, setIsMoreOpen] = useState(false);
  const [isChapterEndPrompt, setIsChapterEndPrompt] = useState(
    ConfigService.getReaderConfig(CHAPTER_END_PROMPT_KEY) === "yes"
  );

  const provider = findProvider(providerId);
  const isCustom = providerId === "custom";
  const needsKey = !LOCAL_PROVIDERS.includes(providerId);

  /** 自动保存：一个模型同时用于 AI 助手 / 翻译 / 词典 */
  const persist = (
    patch: Partial<{
      providerId: string;
      endpoint: string;
      apiKey: string;
      modelId: string;
    }> = {}
  ) => {
    const next = { providerId, endpoint, apiKey, modelId, ...patch };
    const p = findProvider(next.providerId);
    const config: AIModelConfig = {
      endpoint: next.endpoint.trim().replace(/\/+$/, ""),
      apiKey: next.apiKey.trim(),
      modelId: next.modelId.trim(),
      modelName: next.modelId.trim(),
      providerId: next.providerId,
      providerName: p ? p.name : "Custom",
    };
    ConfigService.setObjectConfig(
      modelKey,
      { key: modelKey, displayName: config.modelName, config },
      "aiModelConfig"
    );
    MODEL_PURPOSE_KEYS.forEach((k) => ConfigService.setReaderConfig(k, modelKey));
    handleFetchPlugins();
  };

  const handleProviderChange = (id: string) => {
    const nextEndpoint = findProvider(id)?.defaultEndpoint || "";
    setProviderId(id);
    setEndpoint(nextEndpoint);
    setModelId("");
    setFetchedModels([]);
    persist({ providerId: id, endpoint: nextEndpoint, modelId: "" });
  };

  const handleFetchModels = async () => {
    if (!provider?.modelsEndpoint) return;
    if (needsKey && !apiKey) {
      toast.error(t("Please enter API Key first"));
      return;
    }
    setIsFetching(true);
    try {
      const headers: Record<string, string> = {};
      if (apiKey) {
        if (provider.authType === "x-api-key") {
          headers["x-api-key"] = apiKey;
          headers["anthropic-version"] = "2023-06-01";
        } else {
          headers["Authorization"] = `Bearer ${apiKey}`;
        }
      }
      const response = await aiRequest(provider.modelsEndpoint, "GET", headers);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = JSON.parse(response.body);
      const raw: Record<string, string>[] =
        data.data || data.models || data.results || data || [];
      const ids = raw
        .map((m) => m.id || m.model || m.name)
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b));
      setFetchedModels(ids);
      if (ids.length === 0) {
        toast.error(t("No models found"));
      } else {
        toast.success(t("Fetched models") + ": " + ids.length);
      }
    } catch (e) {
      toast.error(
        t("Failed to fetch model list") +
          ": " +
          (e instanceof Error ? e.message : String(e))
      );
    } finally {
      setIsFetching(false);
    }
  };

  const handleTest = async () => {
    persist();
    if (!endpoint || !modelId || (needsKey && !apiKey)) {
      toast.error(t("Please fill in all required fields"));
      return;
    }
    setIsTesting(true);
    try {
      const response = await aiRequest(
        endpoint.replace(/\/+$/, "") + "/chat/completions",
        "POST",
        {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        JSON.stringify({
          model: modelId,
          messages: [
            { role: "user", content: "Hi, just testing. Reply with OK." },
          ],
          max_tokens: 10,
        })
      );
      if (!response.ok) {
        throw new Error(
          `HTTP ${response.status}: ${response.body.substring(0, 200)}`
        );
      }
      toast.success(t("Test successful"));
    } catch (e) {
      toast.error(
        t("Test failed") + ": " + (e instanceof Error ? e.message : String(e))
      );
    } finally {
      setIsTesting(false);
    }
  };

  const handleEditPrompt = async (type: PromptKey) => {
    const placeholders = PROMPT_PLACEHOLDERS[type];
    const message =
      t("Edit prompt") +
      (placeholders.length
        ? "\n" + t("Available placeholders") + " " + placeholders.join(" ")
        : "") +
      "\n" +
      t("Leave empty to restore the default prompt");
    const result = await vexTextareaAsync(message, getPrompt(type));
    if (result === false) return;
    const value = result.trim();
    // 清空或与默认一致时不保存，之后默认提示词更新也能自动生效
    ConfigService.setReaderConfig(
      type + "Prompt",
      value && value !== DEFAULT_PROMPTS[type] ? value : ""
    );
    toast.success(t("Change successful"));
  };

  const renderInput = (params: {
    id: string;
    label: string;
    value: string;
    placeholder: string;
    onChange: (v: string) => void;
    isSecret?: boolean;
    listId?: string;
  }) => (
    <div className="setting-dialog-new-title">
      <span>{t(params.label)}</span>
      <input
        type={params.isSecret ? "password" : "text"}
        className="token-dialog-username-box"
        id={params.id}
        list={params.listId}
        style={{ width: "220px", margin: 0 }}
        placeholder={params.placeholder}
        value={params.value}
        onContextMenu={() => handleContextMenu(params.id, true)}
        onChange={(e) => params.onChange(e.target.value)}
        onBlur={() => persist()}
      />
    </div>
  );

  return (
    <>
      <div className="setting-dialog-new-title" style={{ fontWeight: 600 }}>
        {t("Large language model")}
      </div>
      <p className="setting-option-subtitle">
        {t("Used for reading companion, Q&A, translation and dictionary")}
      </p>

      <div className="setting-dialog-new-title">
        <span>{t("Provider")}</span>
        <select
          className="lang-setting-dropdown"
          style={{ width: "220px" }}
          value={providerId}
          onChange={(e) => handleProviderChange(e.target.value)}
        >
          {KookitConfig.AiProviderList.map((p) => (
            <option key={p.id} value={p.id} className="lang-setting-option">
              {t(p.name)}
            </option>
          ))}
        </select>
      </div>

      {isCustom &&
        renderInput({
          id: "ai-endpoint-box",
          label: "API endpoint",
          value: endpoint,
          placeholder: "https://api.example.com/v1",
          onChange: setEndpoint,
        })}

      {needsKey &&
        renderInput({
          id: "ai-api-key-box",
          label: "API key",
          value: apiKey,
          placeholder: "sk-...",
          onChange: setApiKey,
          isSecret: true,
        })}

      {renderInput({
        id: "ai-model-id-box",
        label: "Model",
        value: modelId,
        placeholder: t("e.g. gpt-4o, claude-sonnet-4-20250514"),
        onChange: setModelId,
        listId: "ai-model-options",
      })}
      <datalist id="ai-model-options">
        {fetchedModels.map((id) => (
          <option key={id} value={id} />
        ))}
      </datalist>

      <div className="setting-dialog-new-title">
        <span></span>
        <span style={{ display: "flex", gap: "8px" }}>
          {provider?.modelsEndpoint && (
            <span
              className="change-location-button"
              style={{ opacity: isFetching ? 0.5 : 1 }}
              onClick={() => !isFetching && handleFetchModels()}
            >
              {isFetching ? t("Loading...") : t("Fetch models")}
            </span>
          )}
          <span
            className="change-location-button"
            style={{ opacity: isTesting ? 0.5 : 1 }}
            onClick={() => !isTesting && handleTest()}
          >
            {isTesting ? t("Testing...") : t("Test")}
          </span>
        </span>
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

      <div className="setting-dialog-new-title">
        <span>{t("More settings")}</span>
        <span
          className="change-location-button"
          onClick={() => setIsMoreOpen(!isMoreOpen)}
        >
          {isMoreOpen ? t("Collapse") : t("Expand")}
        </span>
      </div>
      {isMoreOpen && (
        <>
          {!isCustom &&
            renderInput({
              id: "ai-endpoint-box",
              label: "API endpoint",
              value: endpoint,
              placeholder: provider?.defaultEndpoint || "",
              onChange: setEndpoint,
            })}
          <div
            className="setting-dialog-new-title"
            style={{ fontWeight: 600 }}
          >
            {t("Prompt")}
          </div>
          {PROMPT_ITEMS.map((item) => (
            <div className="setting-dialog-new-title" key={item.type}>
              <span>{t(item.label)}</span>
              <span
                className="change-location-button"
                onClick={() => handleEditPrompt(item.type)}
              >
                {t("Edit")}
              </span>
            </div>
          ))}
          <CustomTtsSetting />
        </>
      )}
    </>
  );
};

export default AISetting;
