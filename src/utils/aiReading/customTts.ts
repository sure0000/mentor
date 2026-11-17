// 自定义 TTS：替代原「官方 AI 语音」。走 OpenAI 兼容的 /audio/speech 接口
// （OpenAI、Azure OpenAI 兼容网关、以及 openai-edge-tts / kokoro-fastapi 等自建服务都支持）。
import { ConfigService } from "../../assets/lib/kookit-extra-browser.min";

export const CUSTOM_TTS_PLUGIN_KEY = "custom-tts-voice-plugin";

export type CustomTtsConfig = {
  endpoint: string;
  apiKey: string;
  model: string;
  /** 逗号分隔的音色名，例如 "alloy,echo,nova" */
  voices: string;
  format: "mp3" | "wav" | "opus" | "aac" | "flac";
};

const CONFIG_KEY = "customTtsConfig";

export const DEFAULT_CUSTOM_TTS_CONFIG: CustomTtsConfig = {
  endpoint: "",
  apiKey: "",
  model: "tts-1",
  voices: "alloy,echo,fable,onyx,nova,shimmer",
  format: "mp3",
};

export const getCustomTtsConfig = (): CustomTtsConfig => {
  try {
    const raw = ConfigService.getReaderConfig(CONFIG_KEY);
    if (!raw) return { ...DEFAULT_CUSTOM_TTS_CONFIG };
    return { ...DEFAULT_CUSTOM_TTS_CONFIG, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_CUSTOM_TTS_CONFIG };
  }
};

export const saveCustomTtsConfig = (config: CustomTtsConfig) => {
  ConfigService.setReaderConfig(CONFIG_KEY, JSON.stringify(config));
};

export const isCustomTtsConfigured = (config = getCustomTtsConfig()) =>
  Boolean(config.endpoint.trim() && config.model.trim());

export const parseVoiceNames = (voices: string): string[] =>
  voices
    .split(/[,，\n]/)
    .map((v) => v.trim())
    .filter(Boolean);

/** 拼出请求地址：允许用户填 base（.../v1）或完整地址（.../audio/speech） */
export const buildSpeechUrl = (endpoint: string): string => {
  const base = endpoint.trim().replace(/\/+$/, "");
  return /\/audio\/speech$/i.test(base) ? base : base + "/audio/speech";
};

/** Koodo 语速是 -100~100 的百分比偏移；OpenAI 接口 speed 范围 0.25~4 */
export const toSpeechSpeed = (koodoSpeed: number): number => {
  const s = (koodoSpeed + 100) / 100;
  return Math.min(4, Math.max(0.25, Number.isFinite(s) ? s : 1));
};

const blobToBase64DataUri = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });

/**
 * 合成一段语音，返回 data URI（data:audio/...;base64,xxx）。
 * 失败时抛错，错误消息给出 HTTP 状态，便于用户排查配置。
 */
export const synthesizeSpeech = async (
  text: string,
  voice: string,
  koodoSpeed: number,
  config = getCustomTtsConfig()
): Promise<string> => {
  if (!isCustomTtsConfigured(config)) throw new Error("tts-not-configured");
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (config.apiKey) headers.Authorization = "Bearer " + config.apiKey;
  const response = await fetch(buildSpeechUrl(config.endpoint), {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: config.model,
      input: text,
      voice,
      speed: toSpeechSpeed(koodoSpeed),
      response_format: config.format,
    }),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`HTTP ${response.status} ${detail.slice(0, 200)}`);
  }
  return blobToBase64DataUri(await response.blob());
};
