// 统一 AI 网关：替代原先依赖 Koodo 官方服务器的 AI 能力（翻译、词典、整页翻译、
// 单词释义、书名识别、元数据补全、TTS 分句等）。
// 后端按「AI 服务」设置选择：本机 Claude Code，或用户自配的 OpenAI 兼容接口。
import { isElectron } from "react-device-detect";
import { ConfigService } from "../../assets/lib/kookit-extra-browser.min";
import { chatStream } from "../request/common";
import {
  CLAUDE_CODE_PLUGIN_KEY,
  cancelClaudeCode,
  startClaudeCodeChat,
} from "./claudeCode";

export type AiBackend =
  | { kind: "claude-code" }
  | {
      kind: "custom";
      endpoint: string;
      apiKey: string;
      modelId: string;
      providerId: string;
    };

export class AiUnavailableError extends Error {
  constructor() {
    super("ai-unavailable");
  }
}

type ModelEntry = { key: string; config?: Record<string, string> };

const getModelConfig = (modelKey: string): Record<string, string> | null => {
  if (!modelKey) return null;
  const entry = ConfigService.getObjectConfig(
    modelKey,
    "aiModelConfig",
    null
  ) as ModelEntry | null;
  if (!entry || !entry.config || !entry.config.endpoint) return null;
  return entry.config;
};

/** 任意一个已保存的自定义模型（用于没有单独指定的场景） */
const getAnyModelConfig = (): Record<string, string> | null => {
  const all = (ConfigService.getAllObjectConfig("aiModelConfig") ||
    {}) as Record<string, ModelEntry>;
  for (const entry of Object.values(all)) {
    if (entry && entry.config && entry.config.endpoint) return entry.config;
  }
  return null;
};

const toCustom = (config: Record<string, string>): AiBackend => ({
  kind: "custom",
  endpoint: config.endpoint,
  apiKey: config.apiKey || "",
  modelId: config.modelId || "",
  providerId: config.providerId || "",
});

/**
 * 解析某个用途应使用的 AI 后端。
 * purpose 对应设置里的模型选择：translate / dict / assistance；
 * 其余用途（书名识别、元数据等）跟随「AI 助手」的选择。
 */
export const resolveAiBackend = (
  purpose: "translate" | "dict" | "assistance" = "assistance"
): AiBackend | null => {
  const purposeKey =
    purpose === "translate"
      ? "aiTranslateModel"
      : purpose === "dict"
        ? "aiDictModel"
        : "aiAssistanceModel";
  const specific = getModelConfig(ConfigService.getReaderConfig(purposeKey));
  if (specific) return toCustom(specific);
  if (
    isElectron &&
    ConfigService.getReaderConfig("aiService") === CLAUDE_CODE_PLUGIN_KEY
  ) {
    return { kind: "claude-code" };
  }
  const assist = getModelConfig(
    ConfigService.getReaderConfig("aiAssistanceModel")
  );
  if (assist) return toCustom(assist);
  const any = getAnyModelConfig();
  if (any) return toCustom(any);
  if (isElectron) {
    // 未配置任何自定义模型时，桌面端默认尝试本机 Claude Code
    return { kind: "claude-code" };
  }
  return null;
};

export const isAiAvailable = (
  purpose: "translate" | "dict" | "assistance" = "assistance"
) => resolveAiBackend(purpose) !== null;

export type AiStreamHandle = {
  cancel: () => void;
  done: Promise<void>;
};

/** 流式文本生成，onText 收到的是增量片段 */
export const aiStreamText = (params: {
  system: string;
  prompt: string;
  onText: (delta: string) => void;
  purpose?: "translate" | "dict" | "assistance";
}): AiStreamHandle => {
  const backend = resolveAiBackend(params.purpose);
  if (!backend) {
    return { cancel: () => {}, done: Promise.reject(new AiUnavailableError()) };
  }
  if (backend.kind === "claude-code") {
    const { requestId, promise } = startClaudeCodeChat({
      system: params.system,
      prompt: params.prompt,
      onText: params.onText,
    });
    return {
      cancel: () => {
        cancelClaudeCode(requestId);
      },
      done: promise.then((r) => {
        if (!r.ok && r.code !== "cancelled") {
          throw new Error(r.message || r.code);
        }
      }),
    };
  }
  let cancelled = false;
  const done = chatStream(
    backend.endpoint,
    backend.providerId,
    backend.apiKey,
    backend.modelId,
    params.prompt,
    params.system ? [{ role: "system", content: params.system }] : [],
    (r: { text?: string }) => {
      if (!cancelled && r && r.text) params.onText(r.text);
    }
  ).then(() => undefined);
  return { cancel: () => (cancelled = true), done };
};

/** 非流式：拿完整文本 */
export const aiText = async (params: {
  system: string;
  prompt: string;
  purpose?: "translate" | "dict" | "assistance";
}): Promise<string> => {
  let text = "";
  await aiStreamText({ ...params, onText: (d) => (text += d) }).done;
  return text;
};

/** 从模型输出里取出第一个 JSON 对象或数组（容忍代码块与前后说明文字） */
export const parseJsonLoose = (text: string): unknown => {
  const t = (text || "").trim();
  const fenced = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : t;
  const objStart = candidate.indexOf("{");
  const arrStart = candidate.indexOf("[");
  const useArray = arrStart >= 0 && (objStart < 0 || arrStart < objStart);
  const start = useArray ? arrStart : objStart;
  const end = candidate.lastIndexOf(useArray ? "]" : "}");
  if (start < 0 || end <= start) throw new Error("no-json");
  return JSON.parse(candidate.slice(start, end + 1));
};

/** 非流式：要求返回 JSON，解析失败抛错 */
export const aiJson = async <T>(params: {
  system: string;
  prompt: string;
  purpose?: "translate" | "dict" | "assistance";
}): Promise<T> => {
  const text = await aiText({
    ...params,
    system:
      params.system +
      "\n\n只输出一个 JSON 值，不要输出解释、不要使用 Markdown 代码块。",
  });
  return parseJsonLoose(text) as T;
};
