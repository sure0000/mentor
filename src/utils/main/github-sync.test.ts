import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import githubSync from "./github-sync";

const { GitHubSyncUtil, verifyGitHubConfig, parseRepo, normalizeDir } =
  githubSync;

interface StoredFile {
  sha: string;
  content: string;
}

// 内存版 GitHub Contents API，只实现同步用到的接口
const createFakeGitHub = () => {
  const files = new Map<string, StoredFile>();
  let shaSeed = 0;
  const calls: { method: string; url: string; body?: Record<string, unknown> }[] = [];
  const json = (status: number, data: unknown) =>
    new Response(JSON.stringify(data), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  const fetchImpl = async (input: string, init: RequestInit = {}) => {
    const url = new URL(input);
    const method = init.method || "GET";
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, url: url.pathname, body });
    const blob = url.pathname.match(/\/git\/blobs\/(.+)$/);
    if (blob) {
      const file = [...files.values()].find((f) => f.sha === blob[1]);
      return file ? json(200, { content: file.content }) : json(404, {});
    }
    const match = url.pathname.match(/\/repos\/[^/]+\/[^/]+\/contents\/(.+)$/);
    if (!match) return json(404, {});
    const filePath = decodeURIComponent(match[1]);
    if (method === "PUT") {
      const existing = files.get(filePath);
      if (existing && body?.sha !== existing.sha) return json(409, {});
      const sha = `sha${++shaSeed}`;
      files.set(filePath, { sha, content: String(body?.content) });
      return json(existing ? 200 : 201, { content: { sha } });
    }
    if (method === "DELETE") {
      const existing = files.get(filePath);
      if (!existing || existing.sha !== body?.sha) return json(409, {});
      files.delete(filePath);
      return json(200, {});
    }
    const file = files.get(filePath);
    if (file) return json(200, { sha: file.sha, size: 1 });
    const children = [...files.entries()]
      .filter(([p]) => path.posix.dirname(p) === filePath)
      .map(([p, f]) => ({ name: path.posix.basename(p), sha: f.sha, size: 1, type: "file" }));
    return children.length ? json(200, children) : json(404, {});
  };
  return { files, calls, fetchImpl: fetchImpl as unknown as typeof fetch };
};

describe("github-sync", () => {
  let storagePath = "";
  beforeEach(() => {
    storagePath = fs.mkdtempSync(path.join(os.tmpdir(), "mentor-gh-"));
  });
  afterEach(() => {
    fs.rmSync(storagePath, { recursive: true, force: true });
  });

  const writeLocal = (rel: string, content: string) => {
    fs.mkdirSync(path.dirname(path.join(storagePath, rel)), { recursive: true });
    fs.writeFileSync(path.join(storagePath, rel), content);
  };

  it("解析仓库地址", () => {
    expect(parseRepo("me/notes")).toEqual({ owner: "me", repo: "notes" });
    expect(parseRepo("https://github.com/me/notes.git")).toEqual({ owner: "me", repo: "notes" });
    expect(parseRepo("git@github.com:me/notes")).toEqual({ owner: "me", repo: "notes" });
    expect(parseRepo("not a repo")).toBeNull();
  });

  it("目录前缀去掉越界片段", () => {
    expect(normalizeDir("../a/./b//c/")).toBe("a/b/c");
    expect(normalizeDir("")).toBe("");
  });

  it("上传、列出、覆盖、下载、删除完整流程", async () => {
    const gh = createFakeGitHub();
    const util = new GitHubSyncUtil(
      { repo: "me/sync", token: "t", storagePath },
      gh.fetchImpl
    );
    writeLocal("config/sync.json", '{"v":1}');
    expect(await util.uploadFile("sync.json", "sync.json", "config")).toBe(true);
    expect(gh.files.has("Mentor/config/sync.json")).toBe(true);
    expect(await util.listFiles("config")).toEqual(["sync.json"]);

    // 第二次上传需要带上 sha，否则 GitHub 返回 409
    writeLocal("config/sync.json", '{"v":2}');
    expect(await util.uploadFile("sync.json", "sync.json", "config")).toBe(true);

    fs.rmSync(path.join(storagePath, "config/sync.json"));
    expect(await util.downloadFile("sync.json", "sync.json", "config")).toBe(true);
    expect(fs.readFileSync(path.join(storagePath, "config/sync.json"), "utf-8")).toBe('{"v":2}');

    expect(await util.deleteFile("sync.json", "config")).toBe(true);
    expect(gh.files.size).toBe(0);
  });

  it("另一台设备更新后 sha 过期，自动重新获取并覆盖", async () => {
    const gh = createFakeGitHub();
    const util = new GitHubSyncUtil(
      { repo: "me/sync", token: "t", storagePath, dir: "" },
      gh.fetchImpl
    );
    writeLocal("book/a.epub", "v1");
    await util.uploadFile("a.epub", "a.epub", "book");
    // 模拟其他设备写入，本地缓存的 sha 失效
    gh.files.set("book/a.epub", { sha: "other-device", content: "eA==" });
    writeLocal("book/a.epub", "v2");
    expect(await util.uploadFile("a.epub", "a.epub", "book")).toBe(true);
    expect(Buffer.from(gh.files.get("book/a.epub")!.content, "base64").toString()).toBe("v2");
  }, 15000);

  it("远端不存在的文件下载返回 false", async () => {
    const gh = createFakeGitHub();
    const util = new GitHubSyncUtil({ repo: "me/sync", token: "t", storagePath }, gh.fetchImpl);
    expect(await util.downloadFile("missing.epub", "missing.epub", "book")).toBe(false);
  });

  it("空文件不上传、视为成功", async () => {
    const gh = createFakeGitHub();
    const util = new GitHubSyncUtil({ repo: "me/sync", token: "t", storagePath }, gh.fetchImpl);
    writeLocal("config/empty.json", "");
    expect(await util.uploadFile("empty.json", "empty.json", "config")).toBe(true);
    expect(gh.calls.filter((c) => c.method === "PUT")).toHaveLength(0);
  });

  it("校验令牌：区分令牌无效、仓库不存在、无写权限", async () => {
    const respond = (user: number, repo: number, repoBody: unknown = {}) =>
      (async (url: string) =>
        url.endsWith("/user")
          ? new Response(JSON.stringify({ login: "me" }), { status: user })
          : new Response(JSON.stringify(repoBody), { status: repo })) as unknown as typeof fetch;
    const config = { repo: "me/sync", token: "t" };
    expect((await verifyGitHubConfig(config, respond(401, 200))).error).toBe("bad-token");
    expect((await verifyGitHubConfig(config, respond(200, 404))).error).toBe("repo-not-found");
    expect(
      (await verifyGitHubConfig(config, respond(200, 200, { permissions: { push: false } }))).error
    ).toBe("no-write-permission");
    expect(
      await verifyGitHubConfig(config, respond(200, 200, { private: true, permissions: { push: true } }))
    ).toEqual({ ok: true, login: "me", isPrivate: true });
    expect((await verifyGitHubConfig({ repo: "bad", token: "t" })).error).toBe("invalid-repo");
  });
});
