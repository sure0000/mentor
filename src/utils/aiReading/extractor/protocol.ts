// 主页面 <-> 提取器 iframe（extractor.html）之间的消息格式
import type { RawChapter, TocItem } from "../indexText";

export const EXTRACTOR_CHANNEL = "koodo-ai-extractor";

export interface ExtractOptions {
  format: string;
  charset: string;
  parserRegex: string;
  password: string;
  convertChinese: string;
  textRules: unknown[];
}

export type ToExtractor = {
  channel: typeof EXTRACTOR_CHANNEL;
  type: "extract";
  buffer: ArrayBuffer;
  options: ExtractOptions;
};

export type ExtractorEvent =
  | { type: "ready" }
  | { type: "progress"; done: number; total: number }
  | { type: "result"; chapters: RawChapter[]; toc: TocItem[] }
  | { type: "error"; message: string };

export type FromExtractor = { channel: typeof EXTRACTOR_CHANNEL } & ExtractorEvent;
