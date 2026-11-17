// AI 伴读：渲染进程侧的 Claude Code 调用封装。实际进程在主进程（src/utils/main/claude-code-util.js）。
import { ConfigService } from "../../assets/lib/kookit-extra-browser.min";

export const CLAUDE_CODE_PLUGIN_KEY = "claude-code-assistant-plugin";

export type ClaudeCodeErrorCode =
  | "not-found"
  | "not-logged-in"
  | "network"
  | "timeout"
  | "over-budget"
  | "cancelled"
  | "spawn-failed"
  | "failed";

export type ClaudeCodeResult =
  | {
      ok: true;
      text: string;
      structured?: unknown;
      costUsd: number;
      durationMs: number;
    }
  | {
      ok: false;
      code: ClaudeCodeErrorCode;
      message?: string;
      costUsd: number;
      durationMs: number;
    };

export type ClaudeCodeCheck =
  | { ok: true; bin: string; version: string }
  | { ok: false; code: "not-found"; bin?: string };

export type ChatTurn = { role: "user" | "assistant"; content: string };

/** 错误码 → 用户可见提示的 i18n key（en.json / zh-CN.json 中定义） */
export const CLAUDE_CODE_ERROR_KEYS: Record<ClaudeCodeErrorCode, string> = {
  "not-found":
    "Claude Code not found. Install it or set its path in Settings > AI",
  "not-logged-in":
    "Claude Code is not logged in. Run claude in a terminal and log in first",
  network: "Network error. Check your connection and try again",
  timeout: "Request timed out. Try again or ask a shorter question",
  "over-budget": "Stopped because the per-request budget was exceeded",
  cancelled: "Stopped",
  "spawn-failed": "Failed to start Claude Code",
  failed: "Claude Code request failed",
};

export const getClaudeCodeConfig = () => ({
  binPath: ConfigService.getReaderConfig("claudeCodePath") || "",
  model: ConfigService.getReaderConfig("claudeCodeModel") || "",
});

export const checkClaudeCode = (binPath: string): Promise<ClaudeCodeCheck> =>
  window.electronAPI.invoke("claude-code-check", { binPath });

const newRequestId = () =>
  "cc-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);

/** 按字数从最近往前保留历史，避免只保留固定条数（FR-QA-05 的简化版） */
export const buildConversationPrompt = (
  history: ChatTurn[],
  question: string,
  maxHistoryChars = 12000
): string => {
  const kept: ChatTurn[] = [];
  let used = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    const len = history[i].content.length;
    if (used + len > maxHistoryChars) break;
    kept.unshift(history[i]);
    used += len;
  }
  if (kept.length === 0) return question;
  const lines = kept.map(
    (m) => (m.role === "user" ? "【用户】" : "【助手】") + "\n" + m.content
  );
  return (
    "以下是此前的对话记录：\n\n" +
    lines.join("\n\n") +
    "\n\n---\n现在的问题：\n" +
    question
  );
};

/**
 * 发起一次流式调用。返回 { requestId, promise }，可用 cancelClaudeCode(requestId) 取消。
 */
export const startClaudeCodeChat = (params: {
  system: string;
  prompt: string;
  onText: (text: string) => void;
  /** 给出时走 --json-schema 结构化输出，结果在 result.structured */
  schema?: object;
}): { requestId: string; promise: Promise<ClaudeCodeResult> } => {
  const requestId = newRequestId();
  const { binPath, model } = getClaudeCodeConfig();
  const off = window.electronAPI.on(
    "claude-code-delta",
    (payload: { requestId: string; text: string }) => {
      if (payload && payload.requestId === requestId && payload.text) {
        params.onText(payload.text);
      }
    }
  );
  const promise = window.electronAPI
    .invoke<ClaudeCodeResult>("claude-code-chat", {
      requestId,
      prompt: params.prompt,
      system: params.system,
      model,
      binPath,
      schema: params.schema,
    })
    .finally(() => off());
  return { requestId, promise };
};

export const cancelClaudeCode = (requestId: string): Promise<boolean> =>
  window.electronAPI.invoke("claude-code-cancel", requestId);

export const formatUsage = (costUsd: number, durationMs: number): string =>
  `${(durationMs / 1000).toFixed(1)}s · $${costUsd.toFixed(4)}`;
