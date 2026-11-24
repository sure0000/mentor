import axios from "axios";
import toast from "react-hot-toast";
import { SSE } from "sse.js";
import { CommonTool } from "../../assets/lib/kookit-extra-browser.min";
import { isElectron } from "react-device-detect";
export const uploadFile = async (url: string, file: any) => {
  return new Promise<boolean>((resolve) => {
    axios
      .put(url, file, {})
      .then(() => {
        resolve(true);
      })
      .catch((err) => {
        console.error(err);
        resolve(false);
      });
  });
};
export const aiRequest = async (
  url: string,
  method: "GET" | "POST",
  headers: Record<string, string>,
  body?: string
): Promise<{
  ok: boolean;
  status: number;
  statusText: string;
  body: string;
}> => {
  const response = await fetch(url, {
    method,
    headers,
    body: method === "POST" ? body : undefined,
  });
  const text = await response.text();
  return {
    ok: response.ok,
    status: response.status,
    statusText: response.statusText,
    body: text,
  };
};

export const chatStream = async (
  url: string,
  providerId: string,
  apiKey: string,
  model: string,
  prompt: string,
  chat: any[],
  onMessage: (result) => void,
  signal?: AbortSignal,
  // 静默模式下失败只记日志不弹提示，由调用方自行降级
  silent = false
) => {
  const messages = [...chat, { role: "user", content: prompt }].slice(-5);
  const chatUrl = url + "/chat/completions";
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: "Bearer " + apiKey,
  };
  const payload = JSON.stringify({
    model,
    messages,
    stream: true,
    ...CommonTool.getDisableThinkingParams(providerId || ""),
  });

  return new Promise<{ done: boolean }>((resolve, reject) => {
    let settled = false;
    let receivedMessage = false;
    const source = new SSE(chatUrl, {
      headers,
      payload,
      method: "POST",
    });

    const finish = () => {
      if (settled) {
        return;
      }
      settled = true;
      source.close();
      resolve({ done: true });
    };
    if (signal) {
      if (signal.aborted) {
        finish();
        return;
      }
      signal.addEventListener("abort", finish, { once: true });
    }

    // 流式剔除 <think>...</think> 思考内容，只透传最终回答
    const OPEN_TAG = "<think>";
    const CLOSE_TAG = "</think>";
    let inThink = false;
    let thinkPassed = false;
    let tagBuffer = "";

    const flushText = (text: string) => {
      if (text) {
        onMessage({ text });
      }
    };

    const processDelta = (raw: string) => {
      if (thinkPassed) {
        flushText(raw);
        return;
      }
      tagBuffer += raw;
      let output = "";
      while (tagBuffer) {
        const tag = inThink ? CLOSE_TAG : OPEN_TAG;
        const idx = tagBuffer.indexOf(tag);
        if (idx !== -1) {
          if (!inThink) {
            output += tagBuffer.slice(0, idx);
          }
          tagBuffer = tagBuffer.slice(idx + tag.length);
          inThink = !inThink;
          thinkPassed = !inThink;
          if (thinkPassed) {
            tagBuffer = tagBuffer.replace(/^\s+/, "");
          }
          continue;
        }
        // 保留可能是半个标签的尾部，等下一个分片拼齐后再判断
        let keep = 0;
        for (
          let len = Math.min(tagBuffer.length, tag.length - 1);
          len > 0;
          len--
        ) {
          if (tag.startsWith(tagBuffer.slice(-len))) {
            keep = len;
            break;
          }
        }
        if (!inThink) {
          output += tagBuffer.slice(0, tagBuffer.length - keep);
        }
        tagBuffer = tagBuffer.slice(tagBuffer.length - keep);
        break;
      }
      flushText(output);
    };

    // sse.js 结束时会先清空 source.xhr，这里提前保留引用以便读取非流式响应
    let xhr: XMLHttpRequest | null = null;
    source.addEventListener("open", () => {
      xhr = (source as unknown as { xhr: XMLHttpRequest | null }).xhr;
      console.info("ChatStream connection established.");
      // 空响应排查：区分「请求被中断」和「服务端返回空内容」两种情况
      xhr?.addEventListener("load", () =>
        console.warn(
          "ChatStream load:",
          xhr?.status,
          xhr?.responseText.length,
          xhr?.getResponseHeader("content-type")
        )
      );
      xhr?.addEventListener("abort", () => console.warn("ChatStream aborted"));
    });

    source.addEventListener("message", (e: any) => {
      if (!e.data) return;
      receivedMessage = true;
      if (e.data.trim() === "[DONE]") {
        finish();
        return;
      }
      try {
        const json = JSON.parse(e.data);
        const text = json?.choices?.[0]?.delta?.content;
        if (text) {
          processDelta(text);
        }
        const finishReason = json?.choices?.[0]?.finish_reason;
        if (finishReason) {
          finish();
        }
      } catch (err) {
        console.error("ChatStream parse error:", err);
      }
    });

    source.addEventListener("error", (e: any) => {
      if (settled) {
        return;
      }
      settled = true;
      console.error(
        "ChatStream error:",
        e?.responseCode,
        typeof e?.data === "string" ? e.data.slice(0, 500) : e?.data
      );
      if (!silent) {
        toast.error(e.data ? JSON.stringify(e.data) : "Unknown error", {
          id: "chat-stream-error",
          duration: 5000,
        });
      }
      source.close();
      reject(e);
    });

    // SSE 连接结束时（无论服务端是否发送 [DONE]）都要结束流，
    // 否则上层 stopUpdateInterval 不会被调用，自动滚底定时器会一直运行
    source.addEventListener("readystatechange", () => {
      if (source.readyState === SSE.CLOSED) {
        // 一条 SSE 消息都没收到就结束：服务端多半返回了非流式的错误 JSON（常见为限流）
        const raw = xhr?.responseText || "";
        if (!settled && !receivedMessage && raw.trim()) {
          settled = true;
          console.error("ChatStream non-SSE response:", raw.slice(0, 500));
          let msg = raw.slice(0, 200);
          try {
            const json = JSON.parse(raw);
            msg = json?.error?.message || json?.message || json?.msg || msg;
          } catch {
            // 非 JSON 时直接用原文
          }
          if (!silent) {
            toast.error(String(msg), { id: "chat-stream-error", duration: 5000 });
          }
          reject(new Error(String(msg)));
          return;
        }
        finish();
      }
    });
  });
};
export const parseWithSystemOCR = async (imageBase64: string) => {
  if (!isElectron) {
    return;
  }
  const ipcRenderer = window.electronAPI;
  let result = await ipcRenderer.invoke("system-ocr", {
    base64: imageBase64,
    lang: "auto",
  });
  return result.text || "";
};
