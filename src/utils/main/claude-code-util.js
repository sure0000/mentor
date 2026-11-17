/* AI 伴读：通过本机 Claude Code（claude -p）调用模型。运行在 Electron 主进程。
 *
 * 安全边界（需求 FR-AI-03）：
 *   --tools ""                 不开放任何工具，AI 无法读写文件或执行命令
 *   --strict-mcp-config        不加载 MCP 服务器
 *   --no-session-persistence   不在用户的 Claude Code 历史里留下会话
 *   --setting-sources user     只加载用户级设置（登录/网关配置在这里，必须保留）
 *   工作目录为空的临时目录
 * 提示词走 stdin，避免命令行长度上限，也避免出现在进程列表里。 */
"use strict";
const { spawn, execFile } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const CANDIDATES = [
  path.join(os.homedir(), ".local/bin/claude"),
  path.join(os.homedir(), ".claude/local/claude"),
  "/opt/homebrew/bin/claude",
  "/usr/local/bin/claude",
];

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

/** 找到 claude 可执行文件。从 Dock 启动时 PATH 很短，所以先查常见位置，再问登录 shell */
function locate(override) {
  return new Promise((resolve) => {
    if (override && fs.existsSync(override)) return resolve(override);
    const hit = CANDIDATES.find((p) => fs.existsSync(p));
    if (hit) return resolve(hit);
    if (process.platform === "win32") return resolve(null);
    execFile(
      process.env.SHELL || "/bin/zsh",
      ["-lc", "command -v claude"],
      { timeout: 5000 },
      (err, out) => {
        const p = String(out || "").trim();
        resolve(!err && p && fs.existsSync(p) ? p : null);
      }
    );
  });
}

function version(bin) {
  return new Promise((resolve) =>
    execFile(bin, ["--version"], { timeout: 15000 }, (err, out) =>
      resolve(err ? null : String(out).trim())
    )
  );
}

/**
 * 解析一行 stream-json。返回：
 *   {kind:"text", text}     文字增量（来自 --include-partial-messages 的 text_delta）
 *   {kind:"retry"}          API 重试
 *   {kind:"result", ...}    最终结果
 *   null                    其它事件 / 无法解析
 */
function parseStreamLine(line) {
  if (!line || !line.trim()) return null;
  let e;
  try {
    e = JSON.parse(line);
  } catch (err) {
    return null;
  }
  if (!e || typeof e !== "object") return null;
  if (e.type === "stream_event" && e.event) {
    const d = e.event.delta;
    if (
      e.event.type === "content_block_delta" &&
      d &&
      d.type === "text_delta" &&
      typeof d.text === "string"
    ) {
      return { kind: "text", text: d.text };
    }
    return null;
  }
  if (e.type === "system" && e.subtype === "api_retry") return { kind: "retry" };
  if (e.type === "result") {
    return {
      kind: "result",
      isError: !!e.is_error,
      subtype: e.subtype || "",
      text: typeof e.result === "string" ? e.result : "",
      costUsd: typeof e.total_cost_usd === "number" ? e.total_cost_usd : 0,
      structured:
        e.structured_output && typeof e.structured_output === "object"
          ? e.structured_output
          : null,
    };
  }
  return null;
}

/** 把失败归类为错误码，界面据此给出中文提示与解决办法（FR-AI-07） */
function classifyError(text) {
  const s = String(text || "").toLowerCase();
  if (/not logged in|please run \/login|invalid api key|authentication|unauthorized|401|oauth/.test(s))
    return "not-logged-in";
  if (/budget/.test(s)) return "over-budget";
  if (/enotfound|econnrefused|econnreset|etimedout|network|fetch failed|socket/.test(s))
    return "network";
  return "failed";
}

const running = new Map(); // requestId -> { child, timer }

function killTree(child) {
  if (!child || child.exitCode !== null) return;
  try {
    // detached 启动后子进程是进程组组长，负 pid 可连同其子进程一起结束
    if (process.platform !== "win32") process.kill(-child.pid, "SIGTERM");
    else child.kill("SIGTERM");
  } catch (e) {
    try {
      child.kill("SIGTERM");
    } catch (err) {
      // 已退出
    }
  }
}

/**
 * 运行一次流式调用。
 * @param o.bin         claude 路径
 * @param o.requestId   请求 ID（用于取消）
 * @param o.prompt      用户提示（经 stdin 传入）
 * @param o.system      系统提示
 * @param o.model       模型别名或全名，可空
 * @param o.budgetUsd   单次花费上限（美元），可空
 * @param o.schema      JSON Schema（对象）。给出时走结构化输出，结果在 structured 字段
 * @param o.timeoutMs   超时
 * @param o.onText      文字增量回调
 * @param o.log         日志器（只在 debug 级记录参数，不记录提示词内容）
 * @returns Promise<{ok:true, text, costUsd, durationMs} | {ok:false, code, message, costUsd, durationMs}>
 */
function run(o) {
  return new Promise((resolve) => {
    const started = Date.now();
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "koodo-ai-"));
    const args = [
      "-p",
      "--output-format",
      "stream-json",
      "--verbose",
      "--include-partial-messages",
      "--tools",
      "",
      "--strict-mcp-config",
      "--no-session-persistence",
      "--setting-sources",
      "user",
      "--system-prompt",
      o.system || "",
    ];
    if (o.model) args.push("--model", o.model);
    if (o.budgetUsd) args.push("--max-budget-usd", String(o.budgetUsd));
    if (o.schema) args.push("--json-schema", JSON.stringify(o.schema));
    if (o.log) o.log.debug("[claude-code] spawn", o.bin, args.filter((a, i) => args[i - 1] !== "--system-prompt").join(" "));

    let settled = false;
    let child;
    const finish = (r) => {
      if (settled) return;
      settled = true;
      const entry = running.get(o.requestId);
      if (entry) clearTimeout(entry.timer);
      running.delete(o.requestId);
      try {
        fs.rmSync(cwd, { recursive: true, force: true });
      } catch (e) {
        // 忽略
      }
      resolve(Object.assign({ durationMs: Date.now() - started }, r));
    };

    try {
      child = spawn(o.bin, args, {
        cwd,
        detached: process.platform !== "win32",
        env: Object.assign({}, process.env, { CLAUDE_CODE_ENTRYPOINT: "mentor" }),
      });
    } catch (err) {
      return finish({ ok: false, code: "spawn-failed", message: err.message, costUsd: 0 });
    }

    const timer = setTimeout(() => {
      const entry = running.get(o.requestId);
      if (entry) entry.timedOut = true;
      killTree(child);
    }, o.timeoutMs || DEFAULT_TIMEOUT_MS);
    running.set(o.requestId, { child, timer, cancelled: false, timedOut: false });

    let buf = "";
    let stderr = "";
    let result = null;
    let text = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      buf += chunk;
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const ev = parseStreamLine(buf.slice(0, i));
        buf = buf.slice(i + 1);
        if (!ev) continue;
        if (ev.kind === "text") {
          text += ev.text;
          o.onText && o.onText(ev.text);
        } else if (ev.kind === "result") result = ev;
      }
    });
    child.stderr.on("data", (d) => {
      stderr += d;
      if (stderr.length > 8000) stderr = stderr.slice(-8000);
    });
    child.stdin.on("error", () => {});
    child.stdin.end(o.prompt || "");

    child.on("error", (err) =>
      finish({ ok: false, code: "spawn-failed", message: err.message, costUsd: 0 })
    );
    child.on("close", (exitCode) => {
      if (buf.trim()) {
        const ev = parseStreamLine(buf);
        if (ev && ev.kind === "result") result = ev;
      }
      const entry = running.get(o.requestId) || {};
      const costUsd = result ? result.costUsd : 0;
      if (entry.cancelled) return finish({ ok: false, code: "cancelled", message: "", costUsd, text });
      if (entry.timedOut) return finish({ ok: false, code: "timeout", message: "", costUsd, text });
      if (!result) {
        const msg = stderr.trim().slice(-400) || `exit ${exitCode}`;
        return finish({ ok: false, code: classifyError(msg), message: msg, costUsd: 0 });
      }
      if (result.isError || result.subtype !== "success") {
        const msg = result.text || result.subtype || "unknown";
        const code = result.subtype === "error_max_budget_usd" ? "over-budget" : classifyError(msg + " " + stderr);
        return finish({ ok: false, code, message: msg.slice(0, 400), costUsd });
      }
      if (o.schema && !result.structured) {
        return finish({ ok: false, code: "failed", message: "no structured output", costUsd });
      }
      finish({ ok: true, text: text || result.text, structured: result.structured, costUsd });
    });
  });
}

function cancel(requestId) {
  const entry = running.get(requestId);
  if (!entry) return false;
  entry.cancelled = true;
  killTree(entry.child);
  return true;
}

function cancelAll() {
  for (const id of Array.from(running.keys())) cancel(id);
}

module.exports = { locate, version, run, cancel, cancelAll, parseStreamLine, classifyError };
