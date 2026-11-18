// GitHub 仓库作为同步后端（仅 Electron 主进程使用）。
// 接口与 kookit SyncUtil 的 remote 实现保持一致（uploadFile / downloadFile / listFiles /
// listFileInfos / deleteFile / taskQueue），由 main.js 的 getSyncUtil 在 service 为 "github" 时使用，
// 渲染进程现有的 cloud-* 调用无需改动。
//
// 存储结构：仓库根目录下 <dir>/<type>/<fileName>，type 为 book / config / cover / font / backup。
// 认证使用 fine-grained personal access token（只需目标仓库的 Contents 读写权限）。

const fs = require("fs");
const path = require("path");

const API = "https://api.github.com";
// Contents API 上传上限约 100MB（Base64 后），GitHub 对单文件也是 100MB 硬限制
const MAX_FILE_SIZE = 95 * 1024 * 1024;
const SYNC_TYPES = ["book", "config", "cover", "font"];

// 与 kookit 内部 TaskQueue 行为一致：并发受限、统计进度、任一任务失败后跳过剩余任务
class TaskQueue {
  constructor(maxConcurrency) {
    this.queue = [];
    this.runningTasks = 0;
    this.totalTasks = 0;
    this.completedTasks = 0;
    this.hasFailedTasks = false;
    this.downloadedSize = 0;
    this.maxConcurrency = maxConcurrency;
  }
  addTask(task) {
    this.totalTasks++;
    return new Promise((resolve, reject) => {
      if (this.hasFailedTasks) {
        resolve(undefined);
        return;
      }
      const run = async () => {
        if (this.hasFailedTasks) {
          this.completedTasks++;
          resolve(undefined);
          return;
        }
        try {
          this.runningTasks++;
          const result = await task();
          this.completedTasks++;
          resolve(result);
        } catch (error) {
          this.completedTasks++;
          reject(error);
        } finally {
          this.runningTasks--;
          this.runNext();
        }
      };
      if (this.runningTasks < this.maxConcurrency) run();
      else this.queue.push(run);
    });
  }
  runNext() {
    if (this.queue.length > 0 && this.runningTasks < this.maxConcurrency) {
      const next = this.queue.shift();
      next && next();
    }
  }
  clearQueue() {
    this.queue = [];
  }
  getStats() {
    return {
      total: this.totalTasks,
      completed: this.completedTasks,
      pending: this.queue.length,
      running: this.runningTasks,
      hasFailedTasks: this.hasFailedTasks,
    };
  }
  resetCounters() {
    this.totalTasks = 0;
    this.completedTasks = 0;
    this.hasFailedTasks = false;
  }
  getDownloadedSize() {
    return this.downloadedSize;
  }
  setDownloadedSize(size) {
    this.downloadedSize = size;
  }
}

/** "owner/repo"、"https://github.com/owner/repo(.git)" 都解析成 { owner, repo } */
const parseRepo = (input) => {
  const text = String(input || "")
    .trim()
    .replace(/\.git$/, "")
    .replace(/\/+$/, "");
  const match = text.match(/(?:github\.com[/:])?([\w.-]+)\/([\w.-]+)$/);
  if (!match) return null;
  return { owner: match[1], repo: match[2] };
};

// 目录前缀只允许普通路径片段，防止 ../ 之类越界
const normalizeDir = (dir) =>
  String(dir || "")
    .split(/[\\/]+/)
    .map((part) => part.trim())
    .filter((part) => part && part !== "." && part !== "..")
    .join("/");

const encodePath = (p) => p.split("/").map(encodeURIComponent).join("/");

class GitHubSync {
  constructor(config, fetchImpl) {
    this.config = config || {};
    this.storagePath = this.config.storagePath;
    this.fetch = fetchImpl || fetch;
    this.taskQueue = new TaskQueue(3);
    const repo = parseRepo(this.config.repo);
    this.owner = repo ? repo.owner : "";
    this.repo = repo ? repo.repo : "";
    this.branch = String(this.config.branch || "").trim();
    this.baseDir = normalizeDir(this.config.dir === undefined ? "Mentor" : this.config.dir);
    // 远端文件 sha 缓存：更新/删除文件都需要 sha
    this.shaCache = new Map();
  }

  remotePath(relativePath) {
    const clean = normalizeDir(relativePath);
    return this.baseDir ? `${this.baseDir}/${clean}` : clean;
  }

  async request(method, apiPath, body) {
    if (!this.owner || !this.repo || !this.config.token) {
      throw new Error("GitHub sync is not configured");
    }
    const response = await this.fetch(`${API}${apiPath}`, {
      method,
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${this.config.token}`,
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "Mentor",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    return response;
  }

  contentsUrl(remotePath) {
    const ref = this.branch ? `?ref=${encodeURIComponent(this.branch)}` : "";
    return `/repos/${this.owner}/${this.repo}/contents/${encodePath(remotePath)}${ref}`;
  }

  async getSha(remotePath) {
    if (this.shaCache.has(remotePath)) return this.shaCache.get(remotePath);
    const response = await this.request("GET", this.contentsUrl(remotePath));
    if (response.status === 404) return "";
    if (!response.ok) throw new Error(`GitHub HTTP ${response.status}`);
    const data = await response.json();
    const sha = Array.isArray(data) ? "" : data.sha || "";
    if (sha) this.shaCache.set(remotePath, sha);
    return sha;
  }

  async retry(operation, retries = 2) {
    for (let attempt = 0; ; attempt++) {
      const result = await operation().catch((error) => {
        console.error("GitHub sync error:", error.message);
        return false;
      });
      if (result) return result;
      if (attempt >= retries) {
        this.taskQueue.hasFailedTasks = true;
        return result;
      }
      await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, attempt + 1)));
    }
  }

  // source: 本地 storagePath 下的相对路径；target: 远端相对路径（如 book/xxx.epub）
  uploadFile(source, target) {
    return this.taskQueue.addTask(() =>
      this.retry(async () => {
        const localPath = path.join(this.storagePath, source);
        if (!fs.existsSync(localPath)) return false;
        const { size } = fs.statSync(localPath);
        if (size > MAX_FILE_SIZE) {
          console.error(`GitHub sync: ${target} exceeds 95MB, skipped`);
          // 不重试，直接失败
          return false;
        }
        const remote = this.remotePath(target);
        const sha = await this.getSha(remote);
        const response = await this.request("PUT", this.contentsUrl(remote).split("?")[0], {
          message: `Mentor sync: ${target}`,
          content: fs.readFileSync(localPath).toString("base64"),
          ...(sha ? { sha } : {}),
          ...(this.branch ? { branch: this.branch } : {}),
        });
        if (response.status === 409 || response.status === 422) {
          // sha 过期（其他设备刚更新过），清缓存后由 retry 重新获取
          this.shaCache.delete(remote);
          return false;
        }
        if (!response.ok) throw new Error(`GitHub HTTP ${response.status}`);
        const data = await response.json();
        if (data.content && data.content.sha) this.shaCache.set(remote, data.content.sha);
        return true;
      })
    );
  }

  downloadFile(source, target) {
    return this.taskQueue.addTask(() =>
      this.retry(async () => {
        this.taskQueue.setDownloadedSize(0);
        const remote = this.remotePath(source);
        // raw 媒体类型直接返回文件内容，最大支持 100MB（JSON 形式只支持 1MB）
        const response = await this.request("GET", this.contentsUrl(remote), undefined);
        if (response.status === 404) return false;
        if (!response.ok) throw new Error(`GitHub HTTP ${response.status}`);
        const meta = await response.json();
        if (Array.isArray(meta) || !meta.sha) return false;
        this.shaCache.set(remote, meta.sha);
        const blob = await this.request(
          "GET",
          `/repos/${this.owner}/${this.repo}/git/blobs/${meta.sha}`
        );
        if (!blob.ok) throw new Error(`GitHub HTTP ${blob.status}`);
        const blobData = await blob.json();
        const buffer = Buffer.from(blobData.content || "", "base64");
        const localPath = path.join(this.storagePath, target);
        fs.mkdirSync(path.dirname(localPath), { recursive: true });
        fs.writeFileSync(localPath, buffer);
        this.taskQueue.setDownloadedSize(buffer.length);
        return true;
      })
    );
  }

  async listFileInfos(type) {
    try {
      const remote = this.remotePath(type);
      const response = await this.request("GET", this.contentsUrl(remote));
      if (response.status === 404) return [];
      if (!response.ok) throw new Error(`GitHub HTTP ${response.status}`);
      const data = await response.json();
      if (!Array.isArray(data)) return [];
      return data.map((item) => {
        this.shaCache.set(`${remote}/${item.name}`, item.sha);
        return {
          name: item.name,
          size: item.size,
          type: item.type === "dir" ? "folder" : "file",
          // Contents API 不返回修改时间
          modified: "",
        };
      });
    } catch (error) {
      console.error("GitHub list error:", error.message);
      return [];
    }
  }

  async listFiles(type) {
    return (await this.listFileInfos(type)).map((item) => item.name);
  }

  async deleteFile(source) {
    try {
      const remote = this.remotePath(source);
      const sha = await this.getSha(remote);
      if (!sha) return false;
      const response = await this.request("DELETE", this.contentsUrl(remote).split("?")[0], {
        message: `Mentor sync: delete ${source}`,
        sha,
        ...(this.branch ? { branch: this.branch } : {}),
      });
      this.shaCache.delete(remote);
      return response.ok;
    } catch (error) {
      console.error("GitHub delete error:", error.message);
      return false;
    }
  }
}

// 对外暴露与 kookit SyncUtil 相同的外层接口（按 type 拼路径、下载前确认文件存在等）
class GitHubSyncUtil {
  constructor(config, fetchImpl) {
    this.storagePath = config.storagePath;
    this.remote = new GitHubSync(config, fetchImpl);
  }
  async downloadFile(fileName, targetName, type) {
    const dir = path.join(this.storagePath, type);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    if (type !== "cover") {
      const list = await this.listFiles(type);
      if (!list.find((name) => fileName.indexOf(name) > -1)) return false;
    }
    return this.remote.downloadFile(`${type}/${fileName}`, `${type}/${targetName}`);
  }
  async uploadFile(fileName, targetName, type) {
    const localPath = path.join(this.storagePath, type, fileName);
    // 与 kookit 一致：空文件视为成功，不上传
    if (fs.existsSync(localPath) && fs.statSync(localPath).size === 0) return true;
    return this.remote.uploadFile(`${type}/${fileName}`, `${type}/${targetName}`);
  }
  async deleteFile(fileName, type) {
    const list = await this.listFiles(type);
    if (!list.find((name) => fileName.indexOf(name) > -1)) return false;
    return this.remote.deleteFile(`${type}/${fileName}`);
  }
  async isExist(fileName, type) {
    return (await this.listFiles(type)).find((name) => name.indexOf(fileName) !== -1);
  }
  listFiles(type) {
    return this.remote.listFiles(type);
  }
  listFileInfos(type) {
    return this.remote.listFileInfos(type);
  }
  async downloadAllFiles() {
    for (const type of SYNC_TYPES) {
      for (const name of await this.listFiles(type)) {
        await this.downloadFile(name, name, type);
      }
    }
  }
  getStats() {
    return this.remote.taskQueue.getStats();
  }
  clearQueue() {
    return this.remote.taskQueue.clearQueue();
  }
  resetCounters() {
    this.remote.taskQueue.resetCounters();
  }
  getDownloadedSize() {
    return this.remote.taskQueue.getDownloadedSize();
  }
}

/**
 * 校验令牌与仓库：返回 { ok, login, isPrivate, error }。
 * 绑定时调用，确保令牌有该仓库的写权限。
 */
const verifyGitHubConfig = async (config, fetchImpl = fetch) => {
  const repo = parseRepo(config && config.repo);
  if (!repo) return { ok: false, error: "invalid-repo" };
  if (!config.token) return { ok: false, error: "missing-token" };
  const headers = {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${config.token}`,
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "Mentor",
  };
  try {
    const userRes = await fetchImpl(`${API}/user`, { headers });
    if (userRes.status === 401) return { ok: false, error: "bad-token" };
    if (!userRes.ok) return { ok: false, error: `http-${userRes.status}` };
    const user = await userRes.json();
    const repoRes = await fetchImpl(`${API}/repos/${repo.owner}/${repo.repo}`, { headers });
    if (repoRes.status === 404) return { ok: false, error: "repo-not-found" };
    if (!repoRes.ok) return { ok: false, error: `http-${repoRes.status}` };
    const repoData = await repoRes.json();
    // fine-grained token 的 permissions 反映令牌在该仓库上的实际权限
    if (repoData.permissions && !repoData.permissions.push) {
      return { ok: false, error: "no-write-permission" };
    }
    return { ok: true, login: user.login, isPrivate: !!repoData.private };
  } catch (error) {
    return { ok: false, error: "network" };
  }
};

module.exports = { GitHubSyncUtil, verifyGitHubConfig, parseRepo, normalizeDir };
