// GitHub 登录（仅 Electron 主进程使用）。
// 一键登录：系统浏览器打开 GitHub 授权页，用户点「Authorize」后回跳到本机回环地址
// http://127.0.0.1:<随机端口>/callback，应用拿到 code 换取 access token（OAuth Web Flow + PKCE）。
// 已授权过的账号 GitHub 会直接跳回，无需任何点击。
// 未配置 Client Secret 时退回 Device Flow（需要用户输入一次性代码）。
// 登录后自动创建（或复用）私有仓库作为同步后端，交给 github-sync.js 使用。

const http = require("http");
const crypto = require("crypto");

const API = "https://api.github.com";
const DEVICE_CODE_URL = "https://github.com/login/device/code";
const TOKEN_URL = "https://github.com/login/oauth/access_token";
const AUTHORIZE_URL = "https://github.com/login/oauth/authorize";
// 等待用户在浏览器中授权的最长时间
const BROWSER_LOGIN_TIMEOUT = 5 * 60 * 1000;
// repo 权限才能创建、读写私有仓库
const SCOPE = "repo";
const DEFAULT_REPO = "mentor-sync";
// GitHub OAuth App 的 Client ID（公开信息，不是密钥）。
// 在 https://github.com/settings/developers 新建 OAuth App 并勾选 "Enable Device Flow" 后填入；
// 也可通过环境变量 MENTOR_GITHUB_CLIENT_ID 覆盖。为空时设置页回退到「个人访问令牌」方式。
const GITHUB_CLIENT_ID = "";
// 一键登录需要 Client Secret 换取令牌。桌面应用无法真正保密该值，
// 它只能配合本应用的 Client ID 和用户授权使用；也可通过环境变量 MENTOR_GITHUB_CLIENT_SECRET 提供。
const GITHUB_CLIENT_SECRET = "";
const getClientId = () =>
  (process.env.MENTOR_GITHUB_CLIENT_ID || GITHUB_CLIENT_ID || "").trim();
const getClientSecret = () =>
  (process.env.MENTOR_GITHUB_CLIENT_SECRET || GITHUB_CLIENT_SECRET || "").trim();

/** 当前可用的登录方式："browser" 一键 / "device" 设备码 / "" 仅令牌 */
const getLoginMode = () => {
  if (!getClientId()) return "";
  return getClientSecret() ? "browser" : "device";
};

const apiHeaders = (token) => ({
  Accept: "application/vnd.github+json",
  Authorization: `Bearer ${token}`,
  "X-GitHub-Api-Version": "2022-11-28",
  "User-Agent": "Mentor",
});

const postForm = async (url, body, fetchImpl) => {
  const res = await fetchImpl(url, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "Mentor",
    },
    body: new URLSearchParams(body).toString(),
  });
  if (!res.ok) throw new Error(`http-${res.status}`);
  return res.json();
};

/** 第一步：申请设备码，返回 { deviceCode, userCode, verificationUri, interval, expiresIn } */
const requestDeviceCode = async (clientId, fetchImpl = fetch) => {
  const data = await postForm(
    DEVICE_CODE_URL,
    { client_id: clientId, scope: SCOPE },
    fetchImpl
  );
  if (data.error) throw new Error(data.error);
  return {
    deviceCode: data.device_code,
    userCode: data.user_code,
    verificationUri: data.verification_uri,
    interval: data.interval || 5,
    expiresIn: data.expires_in || 900,
  };
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 第二步：轮询直到用户授权。返回 { ok, token } 或 { ok:false, error }。
 * isCancelled 用于用户关闭登录框时提前结束。
 */
const pollAccessToken = async (
  clientId,
  device,
  isCancelled = () => false,
  fetchImpl = fetch
) => {
  let interval = device.interval;
  const deadline = Date.now() + device.expiresIn * 1000;
  while (Date.now() < deadline) {
    await sleep(interval * 1000);
    if (isCancelled()) return { ok: false, error: "cancelled" };
    let data;
    try {
      data = await postForm(
        TOKEN_URL,
        {
          client_id: clientId,
          device_code: device.deviceCode,
          grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        },
        fetchImpl
      );
    } catch (e) {
      // 网络抖动时继续等待
      continue;
    }
    if (data.access_token) return { ok: true, token: data.access_token };
    if (data.error === "authorization_pending") continue;
    if (data.error === "slow_down") {
      interval = (data.interval || interval) + 5;
      continue;
    }
    // expired_token / access_denied / unsupported_grant_type 等
    return { ok: false, error: data.error || "unknown" };
  }
  return { ok: false, error: "expired_token" };
};

const base64url = (buf) =>
  buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

const CALLBACK_PAGE = (ok) => `<!doctype html><html><head><meta charset="utf-8">
<title>Mentor</title><style>body{font-family:-apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif;
display:flex;align-items:center;justify-content:center;height:100vh;margin:0;color:#212832;background:#f6f7f9}
.box{text-align:center}.t{font-size:20px;font-weight:600;margin-bottom:8px}.s{font-size:14px;color:#858c96}</style></head>
<body><div class="box"><div class="t">${ok ? "登录成功 · Signed in" : "登录未完成 · Sign in was not completed"}</div>
<div class="s">${ok ? "可以关闭此页面，返回 Mentor · You can close this tab and return to Mentor" : "请返回 Mentor 重试 · Please return to Mentor and try again"}</div></div></body></html>`;

/**
 * 一键登录：启动本机回环服务并返回授权地址；用户授权后 resolve 出 { ok, token } 。
 * 返回 { url, result: Promise, cancel() }。
 */
const startBrowserLogin = async (fetchImpl = fetch) => {
  const clientId = getClientId();
  const clientSecret = getClientSecret();
  const state = base64url(crypto.randomBytes(24));
  const verifier = base64url(crypto.randomBytes(32));
  const challenge = base64url(crypto.createHash("sha256").update(verifier).digest());

  let finish;
  const result = new Promise((resolve) => {
    finish = resolve;
  });
  let settled = false;
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || "/", "http://127.0.0.1");
    if (url.pathname !== "/callback") {
      res.writeHead(404);
      res.end();
      return;
    }
    const code = url.searchParams.get("code");
    const error = url.searchParams.get("error");
    // state 不匹配的请求一律拒绝，防止其他本机页面伪造回调
    if (url.searchParams.get("state") !== state || settled) {
      res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
      res.end(CALLBACK_PAGE(false));
      return;
    }
    settled = true;
    if (!code) {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(CALLBACK_PAGE(false));
      done({ ok: false, error: error === "access_denied" ? "access_denied" : "unknown" });
      return;
    }
    try {
      const data = await postForm(
        TOKEN_URL,
        {
          client_id: clientId,
          client_secret: clientSecret,
          code,
          redirect_uri: redirectUri,
          code_verifier: verifier,
        },
        fetchImpl
      );
      const ok = !!data.access_token;
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(CALLBACK_PAGE(ok));
      done(ok ? { ok: true, token: data.access_token } : { ok: false, error: data.error || "unknown" });
    } catch (e) {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(CALLBACK_PAGE(false));
      done({ ok: false, error: "network" });
    }
  });
  const timer = setTimeout(() => done({ ok: false, error: "expired_token" }), BROWSER_LOGIN_TIMEOUT);
  function done(value) {
    clearTimeout(timer);
    settled = true;
    // 稍后关闭，确保回调页面已经发送给浏览器
    setTimeout(() => server.close(), 1000);
    finish(value);
  }
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const { port } = server.address();
  const redirectUri = `http://127.0.0.1:${port}/callback`;
  const authorizeUrl =
    AUTHORIZE_URL +
    "?" +
    new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      scope: SCOPE,
      state,
      code_challenge: challenge,
      code_challenge_method: "S256",
      allow_signup: "true",
    }).toString();
  return {
    url: authorizeUrl,
    result,
    cancel: () => {
      if (!settled) done({ ok: false, error: "cancelled" });
    },
  };
};

/** 第三步：读取用户信息，确保同步仓库存在（不存在则创建私有仓库） */
const ensureSyncRepo = async (token, repoName = DEFAULT_REPO, fetchImpl = fetch) => {
  const headers = apiHeaders(token);
  const userRes = await fetchImpl(`${API}/user`, { headers });
  if (!userRes.ok) return { ok: false, error: "bad-token" };
  const user = await userRes.json();
  const repoRes = await fetchImpl(`${API}/repos/${user.login}/${repoName}`, {
    headers,
  });
  if (repoRes.ok) {
    const repo = await repoRes.json();
    return {
      ok: true,
      login: user.login,
      avatar: user.avatar_url || "",
      name: user.name || user.login,
      repo: repo.full_name,
      isPrivate: !!repo.private,
    };
  }
  if (repoRes.status !== 404) return { ok: false, error: `http-${repoRes.status}` };
  const createRes = await fetchImpl(`${API}/user/repos`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({
      name: repoName,
      private: true,
      description: "Mentor reading data sync",
      // 创建空提交，保证默认分支存在，后续 Contents API 才能直接写文件
      auto_init: true,
    }),
  });
  if (!createRes.ok) return { ok: false, error: "create-repo-failed" };
  const repo = await createRes.json();
  return {
    ok: true,
    login: user.login,
    avatar: user.avatar_url || "",
    name: user.name || user.login,
    repo: repo.full_name,
    isPrivate: true,
  };
};

module.exports = {
  getClientId,
  getLoginMode,
  startBrowserLogin,
  requestDeviceCode,
  pollAccessToken,
  ensureSyncRepo,
  DEFAULT_REPO,
};
