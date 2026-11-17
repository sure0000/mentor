// 原先这些接口走 Koodo 官方服务器（需 Pro）。二开版本全部改为：
// - 文本类 AI 能力 → 统一 AI 网关（Claude Code 或用户自配的 OpenAI 兼容接口）
// - 语音 → 自定义 TTS（OpenAI 兼容 /audio/speech）
// - 书籍元数据 → Open Library 公共接口（免 Key）
// 函数签名与返回结构（{ code, data }）保持与旧实现一致，调用方无需大改。
import i18n from "../../i18n";
import toast from "react-hot-toast";
import {
  AiUnavailableError,
  aiJson,
  aiStreamText,
} from "../aiReading/aiGateway";
import { synthesizeSpeech } from "../aiReading/customTts";

type StreamCallback = (result: { text?: string; done?: boolean }) => void;
type ApiResult<T> = { code: number; data?: T; msg?: string };

const notifyUnavailable = (error: unknown) => {
  if (error instanceof AiUnavailableError) {
    toast(
      i18n.t(
        "No AI service configured. Please add one in Settings > AI service"
      ),
      { id: "ai-unavailable" }
    );
  } else {
    toast.error(
      i18n.t("Fetch failed, error code") +
        ": " +
        (error instanceof Error ? error.message : String(error)),
      { id: "ai-error" }
    );
  }
};

const runStream = async (
  system: string,
  prompt: string,
  onMessage: StreamCallback,
  purpose: "translate" | "dict" | "assistance"
) => {
  try {
    await aiStreamText({
      system,
      prompt,
      purpose,
      onText: (text) => onMessage({ text }),
    }).done;
  } catch (error) {
    notifyUnavailable(error);
  }
  onMessage({ done: true });
  return { done: true };
};

const langName = (code: string) =>
  !code || code === "auto" || code === "Automatic" ? "" : code;

export const getTransStream = async (
  text: string,
  from: string,
  to: string,
  onMessage: StreamCallback
) =>
  runStream(
    "你是专业翻译。只输出译文，不要解释，保留原文的段落与换行。",
    (langName(from) ? `源语言：${from}\n` : "") +
      `目标语言：${to}\n\n待翻译文本：\n${text}`,
    onMessage,
    "translate"
  );

export const getAnswerStream = async (
  text: string,
  question: string,
  history: { role: string; content: string }[],
  mode: string,
  onMessage: StreamCallback
) => {
  const historyText = history
    .slice(-10)
    .map((m) => (m.role === "user" ? "【用户】" : "【助手】") + m.content)
    .join("\n");
  return runStream(
    "你是阅读助手，基于用户提供的书籍内容回答问题，回答简洁、准确，使用用户提问的语言。",
    (text ? `书籍内容：\n${text}\n\n` : "") +
      (historyText ? `对话记录：\n${historyText}\n\n` : "") +
      `${mode === "chat" ? "用户说" : "问题"}：${question}`,
    onMessage,
    "assistance"
  );
};

export const getDictionaryStream = async (
  word: string,
  from: string,
  to: string,
  sentence: string,
  isFullAnalysis: boolean,
  onMessage: StreamCallback
) =>
  runStream(
    "你是词典。用 Markdown 输出：读音、词性与释义（用目标语言）、2 个例句及翻译" +
      (isFullAnalysis ? "、该词在所给句子中的具体含义" : "") +
      "。不要输出与词条无关的内容。",
    `词条：${word}\n` +
      (langName(from) ? `源语言：${from}\n` : "") +
      `目标语言：${to}\n` +
      (sentence ? `所在句子：${sentence}\n` : ""),
    onMessage,
    "dict"
  );

/** 自定义 TTS 合成，返回结构与旧官方接口一致：data.audio_base64 为 data URI */
export const getTTSAudio = async (
  text: string,
  _language: string,
  voice: string,
  speed: number,
  _pitch: number,
  _isFirst: boolean
): Promise<ApiResult<{ audio_base64: string }> | null> => {
  try {
    // 旧接口 speed 为倍速（1.0 = 正常），换算回 Koodo 的百分比偏移
    const audio = await synthesizeSpeech(text, voice, speed * 100 - 100);
    return { code: 200, data: { audio_base64: audio } };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    toast.error(
      message === "tts-not-configured"
        ? i18n.t("Please configure the custom TTS service in Settings > AI service")
        : i18n.t("Fetch failed, error code") + ": " + message,
      { id: "tts-error" }
    );
    return null;
  }
};

/** 整页翻译：一次请求翻译一批段落，返回与输入等长的数组 */
export const getBatchTrans = async (
  texts: string[],
  _from: string,
  to: string
): Promise<ApiResult<{ texts: string[] }>> => {
  try {
    const result = await aiJson<string[]>({
      purpose: "translate",
      system:
        "你是专业翻译。输入是 JSON 字符串数组，逐条翻译为目标语言，" +
        "输出同样长度、同样顺序的 JSON 字符串数组。",
      prompt: `目标语言：${to}\n\n${JSON.stringify(texts)}`,
    });
    if (!Array.isArray(result) || result.length !== texts.length) {
      return { code: 500, msg: "length-mismatch" };
    }
    return { code: 200, data: { texts: result.map((t) => String(t ?? "")) } };
  } catch (error) {
    notifyUnavailable(error);
    return { code: 500, msg: String(error) };
  }
};

/** 多角色朗读分句：把段落拆成句子并标注说话人类型 */
export const getSplitSentence = async (
  texts: { text: string; index: number }[]
): Promise<
  ApiResult<{ sentences: { text: string; role: string; index: number }[] }>
> => {
  try {
    const result = await aiJson<
      { text: string; role: string; index: number }[]
    >({
      purpose: "assistance",
      system:
        "你负责为有声书分配朗读角色。输入是 JSON 数组 [{text,index}]。" +
        "把每段拆成句子，按原顺序输出 JSON 数组 [{text,role,index}]：" +
        "text 为原文句子（不得改写、不得遗漏），index 沿用所属段落的 index，" +
        "role 取值 narrator（叙述）/ male（男性角色台词）/ female（女性角色台词）/ child（儿童台词）。",
      prompt: JSON.stringify(texts),
    });
    if (!Array.isArray(result) || result.length === 0) {
      return { code: 500, msg: "empty" };
    }
    return { code: 200, data: { sentences: result } };
  } catch (error) {
    notifyUnavailable(error);
    return { code: 500, msg: String(error) };
  }
};

/** 从文件名式的标题里识别书名与作者 */
export const analyzeBookTitle = async (
  title: string
): Promise<ApiResult<{ name: string; author: string }>> => {
  try {
    const result = await aiJson<{ name?: string; author?: string }>({
      purpose: "assistance",
      system:
        "从电子书文件名中识别书名和作者，去掉网站名、格式、版本、编号等噪声。" +
        '输出 JSON：{"name": "书名", "author": "作者，未知则为空字符串"}。',
      prompt: title,
    });
    if (!result || !result.name) return { code: 500, msg: "empty" };
    return {
      code: 200,
      data: { name: String(result.name), author: String(result.author || "") },
    };
  } catch (error) {
    notifyUnavailable(error);
    return { code: 500, msg: String(error) };
  }
};

type OpenLibraryDoc = {
  key: string;
  title?: string;
  author_name?: string[];
  publisher?: string[];
  isbn?: string[];
  cover_i?: number;
  first_publish_year?: number;
  language?: string[];
  subject?: string[];
  number_of_pages_median?: number;
  ratings_average?: number;
  ratings_count?: number;
};

/** 书籍元数据检索：Open Library 公共接口，无需 Key */
export const getBookMetadata = async (name: string, author: string) => {
  try {
    const params = new URLSearchParams({
      title: name,
      limit: "10",
      fields:
        "key,title,author_name,publisher,isbn,cover_i,first_publish_year,language,subject,number_of_pages_median,ratings_average,ratings_count",
    });
    if (author) params.set("author", author);
    const response = await fetch(
      "https://openlibrary.org/search.json?" + params.toString()
    );
    if (!response.ok) return { code: response.status, msg: "http" };
    const json = (await response.json()) as { docs?: OpenLibraryDoc[] };
    const docs = json.docs || [];
    if (docs.length === 0) return { code: 200, data: null };
    return {
      code: 200,
      data: docs.map((d) => ({
        key: d.key,
        name: d.title || "",
        author: (d.author_name || []).join(", "),
        publisher: (d.publisher || [])[0] || "",
        isbn: (d.isbn || [])[0] || "",
        cover: d.cover_i
          ? `https://covers.openlibrary.org/b/id/${d.cover_i}-L.jpg`
          : "",
        pub_date: d.first_publish_year ? String(d.first_publish_year) : "",
        language: (d.language || [])[0] || "",
        categories: (d.subject || []).slice(0, 5).join(", "),
        pages: d.number_of_pages_median,
        rating: d.ratings_average,
        rating_count: d.ratings_count,
        rating_source: d.ratings_average ? "Open Library" : "",
        description: "",
      })),
    };
  } catch (error) {
    return { code: 500, msg: String(error) };
  }
};
