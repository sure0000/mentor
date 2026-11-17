import { describe, expect, it } from "vitest";
import {
  buildSpeechUrl,
  parseVoiceNames,
  toSpeechSpeed,
} from "./customTts";
import { parseJsonLoose } from "./aiGateway";

describe("customTts helpers", () => {
  it("appends /audio/speech to a base url", () => {
    expect(buildSpeechUrl("https://api.openai.com/v1")).toBe(
      "https://api.openai.com/v1/audio/speech"
    );
    expect(buildSpeechUrl("https://x.dev/v1/  ")).toBe(
      "https://x.dev/v1/audio/speech"
    );
  });

  it("keeps a full speech url as is", () => {
    expect(buildSpeechUrl("http://127.0.0.1:5050/v1/audio/speech")).toBe(
      "http://127.0.0.1:5050/v1/audio/speech"
    );
  });

  it("maps Koodo speed offset to OpenAI speed range", () => {
    expect(toSpeechSpeed(0)).toBe(1);
    expect(toSpeechSpeed(50)).toBe(1.5);
    expect(toSpeechSpeed(-100)).toBe(0.25);
    expect(toSpeechSpeed(1000)).toBe(4);
    expect(toSpeechSpeed(NaN)).toBe(1);
  });

  it("splits voice names by comma, Chinese comma and newline", () => {
    expect(parseVoiceNames("alloy, echo，nova\n onyx ,,")).toEqual([
      "alloy",
      "echo",
      "nova",
      "onyx",
    ]);
  });
});

describe("parseJsonLoose", () => {
  it("parses a bare object", () => {
    expect(parseJsonLoose('{"name":"三体","author":"刘慈欣"}')).toEqual({
      name: "三体",
      author: "刘慈欣",
    });
  });

  it("parses an array wrapped in a code fence with chatter", () => {
    expect(parseJsonLoose('结果如下：\n```json\n["a","b"]\n```\n完毕')).toEqual(
      ["a", "b"]
    );
  });

  it("prefers whichever JSON value starts first", () => {
    expect(parseJsonLoose('[{"text":"x","role":"male","index":0}]')).toEqual([
      { text: "x", role: "male", index: 0 },
    ]);
  });

  it("throws when there is no JSON", () => {
    expect(() => parseJsonLoose("sorry")).toThrow();
  });
});
