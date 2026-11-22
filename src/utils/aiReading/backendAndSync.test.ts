import { beforeEach, describe, expect, it, vi } from "vitest";

const readerConfig: Record<string, string> = {};
const objectConfig: Record<string, unknown> = {};
const items: Record<string, string> = {};
let dataSourceList: string[] = [];
const tokens: Record<string, string> = {};
let isElectron = true;

vi.mock("react-device-detect", () => ({
  get isElectron() {
    return isElectron;
  },
}));
vi.mock("react-hot-toast", () => ({ default: { error: vi.fn() } }));
vi.mock("../../i18n", () => ({ default: { t: (k: string) => k } }));
vi.mock("../request/common", () => ({ chatStream: vi.fn() }));
vi.mock("../storage/tokenService", () => ({
  default: {
    setToken: async (k: string, v: string) => {
      tokens[k] = v;
    },
    getToken: async (k: string) => tokens[k] || null,
    deleteToken: async (k: string) => {
      delete tokens[k];
    },
  },
}));
vi.mock("../../assets/lib/kookit-extra-browser.min", () => ({
  ConfigService: {
    getReaderConfig: (k: string) => readerConfig[k] || "",
    setReaderConfig: (k: string, v: string) => {
      readerConfig[k] = v;
    },
    getObjectConfig: (k: string) => objectConfig[k] ?? null,
    getAllObjectConfig: () => objectConfig,
    getItem: (k: string) => items[k] || null,
    removeItem: (k: string) => {
      delete items[k];
    },
    getAllListConfig: () => dataSourceList,
    deleteListConfig: (k: string) => {
      dataSourceList = dataSourceList.filter((x) => x !== k);
    },
  },
}));

import { resolveAiBackend } from "./aiGateway";
import {
  decryptToken,
  encryptToken,
  removeUnsupportedSyncSources,
} from "../request/thirdparty";

const reset = () => {
  for (const o of [readerConfig, objectConfig, items, tokens]) {
    for (const k of Object.keys(o)) delete (o as Record<string, unknown>)[k];
  }
  dataSourceList = [];
  isElectron = true;
};

describe("resolveAiBackend", () => {
  beforeEach(reset);

  it("uses the purpose-specific custom model first", () => {
    objectConfig.m1 = { key: "m1", config: { endpoint: "https://a", modelId: "x" } };
    objectConfig.m0 = { key: "m0", config: { endpoint: "https://z" } };
    readerConfig.aiTranslateModel = "m1";
    readerConfig.aiAssistanceModel = "m0";
    expect(resolveAiBackend("translate")).toMatchObject({
      kind: "custom",
      endpoint: "https://a",
    });
  });

  it("falls back to the assistance model", () => {
    objectConfig.m3 = { key: "m3", config: { endpoint: "https://c" } };
    readerConfig.aiAssistanceModel = "m3";
    expect(resolveAiBackend("dict")).toMatchObject({ endpoint: "https://c" });
  });

  it("falls back to any saved custom model", () => {
    objectConfig.m2 = { key: "m2", config: { endpoint: "https://b" } };
    expect(resolveAiBackend()).toMatchObject({ endpoint: "https://b" });
  });

  it("returns null with nothing configured", () => {
    expect(resolveAiBackend()).toBeNull();
  });
});

describe("sync source storage", () => {
  beforeEach(reset);

  it("round-trips iCloud config locally", async () => {
    expect((await encryptToken("icloud", { drivePath: "/x" })).code).toBe(200);
    const res = await decryptToken("icloud");
    expect(res.code).toBe(200);
    expect(JSON.parse(res.data!.token)).toEqual({ drivePath: "/x" });
  });

  it("rejects removed sources", async () => {
    expect((await encryptToken("webdav", {})).code).toBe(400);
  });

  it("reports legacy server-encrypted tokens as needing rebind", async () => {
    tokens.icloud_token = "eyJ-not-json";
    expect((await decryptToken("icloud")).code).toBe(410);
  });

  it("removes unsupported sources and resets the default", async () => {
    dataSourceList = ["webdav", "icloud", "google"];
    tokens.webdav_token = "x";
    items.defaultSyncOption = "webdav";
    readerConfig.isEnableKoodoSync = "yes";
    await removeUnsupportedSyncSources();
    expect(dataSourceList).toEqual(["icloud"]);
    expect(tokens.webdav_token).toBeUndefined();
    expect(items.defaultSyncOption).toBeUndefined();
    expect(readerConfig.isEnableKoodoSync).toBe("no");
  });
});
