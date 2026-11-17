import { describe, expect, it } from "vitest";
import claudeCodeModule from "./claude-code-util";

interface ClaudeCodeInternal {
  parseStreamLine: (line: string) => null | {
    kind: string;
    text?: string;
    isError?: boolean;
    subtype?: string;
    costUsd?: number;
    structured?: unknown;
  };
  classifyError: (text: string) => string;
}
const { parseStreamLine, classifyError } =
  claudeCodeModule as unknown as ClaudeCodeInternal;

describe("parseStreamLine", () => {
  it("extracts text deltas from partial messages", () => {
    const line = JSON.stringify({
      type: "stream_event",
      event: {
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: "你好" },
      },
    });
    expect(parseStreamLine(line)).toEqual({ kind: "text", text: "你好" });
  });

  it("ignores full assistant messages to avoid duplicating text", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: { content: [{ type: "text", text: "你好" }] },
    });
    expect(parseStreamLine(line)).toBeNull();
  });

  it("parses the final result with cost", () => {
    const line = JSON.stringify({
      type: "result",
      subtype: "success",
      is_error: false,
      result: "你好世界",
      total_cost_usd: 0.0012,
    });
    expect(parseStreamLine(line)).toEqual({
      kind: "result",
      isError: false,
      subtype: "success",
      text: "你好世界",
      costUsd: 0.0012,
      structured: null,
    });
  });

  it("returns structured output when present", () => {
    const line = JSON.stringify({
      type: "result",
      subtype: "success",
      is_error: false,
      result: "{}",
      total_cost_usd: 0,
      structured_output: { points: ["a"] },
    });
    expect(parseStreamLine(line)?.structured).toEqual({ points: ["a"] });
  });

  it("reports api retries", () => {
    expect(
      parseStreamLine(JSON.stringify({ type: "system", subtype: "api_retry" }))
    ).toEqual({ kind: "retry" });
  });

  it("returns null for blank or malformed lines", () => {
    expect(parseStreamLine("")).toBeNull();
    expect(parseStreamLine("not json")).toBeNull();
    expect(parseStreamLine(JSON.stringify({ type: "system", subtype: "init" }))).toBeNull();
  });
});

describe("classifyError", () => {
  it("detects login problems", () => {
    expect(classifyError("Invalid API key · Please run /login")).toBe("not-logged-in");
  });
  it("detects network problems", () => {
    expect(classifyError("getaddrinfo ENOTFOUND api.anthropic.com")).toBe("network");
  });
  it("falls back to failed", () => {
    expect(classifyError("something odd")).toBe("failed");
  });
});
