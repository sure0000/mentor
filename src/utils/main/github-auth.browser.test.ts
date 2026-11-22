import { afterEach, describe, expect, it, vi } from "vitest";
import http from "http";
import githubAuth from "./github-auth";

const { startBrowserLogin, getLoginMode } = githubAuth;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyFetch = any;

const get = (url: string) =>
  new Promise<{ status: number; body: string }>((resolve, reject) => {
    http
      .get(url, (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => resolve({ status: res.statusCode || 0, body }));
      })
      .on("error", reject);
  });

afterEach(() => {
  delete process.env.MENTOR_GITHUB_CLIENT_ID;
  delete process.env.MENTOR_GITHUB_CLIENT_SECRET;
});

describe("getLoginMode", () => {
  it("prefers one-click browser login when a secret is configured", () => {
    expect(getLoginMode()).toBe("");
    process.env.MENTOR_GITHUB_CLIENT_ID = "cid";
    expect(getLoginMode()).toBe("device");
    process.env.MENTOR_GITHUB_CLIENT_SECRET = "sec";
    expect(getLoginMode()).toBe("browser");
  });
});

describe("startBrowserLogin", () => {
  it("exchanges the callback code for a token", async () => {
    process.env.MENTOR_GITHUB_CLIENT_ID = "cid";
    process.env.MENTOR_GITHUB_CLIENT_SECRET = "sec";
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ access_token: "tok" }),
    }));
    const login = await startBrowserLogin(fetchImpl as AnyFetch);
    const authorize = new URL(login.url);
    expect(authorize.origin + authorize.pathname).toBe(
      "https://github.com/login/oauth/authorize"
    );
    expect(authorize.searchParams.get("scope")).toBe("repo");
    expect(authorize.searchParams.get("code_challenge_method")).toBe("S256");
    const redirect = authorize.searchParams.get("redirect_uri")!;
    expect(redirect).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/callback$/);

    // 伪造 state 的请求会被拒绝，不影响后续真实回调
    const forged = await get(`${redirect}?code=x&state=wrong`);
    expect(forged.status).toBe(400);

    const state = authorize.searchParams.get("state");
    const page = await get(`${redirect}?code=abc&state=${state}`);
    expect(page.status).toBe(200);
    expect(await login.result).toEqual({ ok: true, token: "tok" });

    const body = new URLSearchParams((fetchImpl.mock.calls[0] as AnyFetch)[1].body);
    expect(body.get("code")).toBe("abc");
    expect(body.get("client_secret")).toBe("sec");
    expect(body.get("redirect_uri")).toBe(redirect);
    expect(body.get("code_verifier")).toBeTruthy();
  });

  it("reports access_denied when the user cancels on GitHub", async () => {
    process.env.MENTOR_GITHUB_CLIENT_ID = "cid";
    process.env.MENTOR_GITHUB_CLIENT_SECRET = "sec";
    const login = await startBrowserLogin(vi.fn() as AnyFetch);
    const authorize = new URL(login.url);
    const redirect = authorize.searchParams.get("redirect_uri")!;
    const state = authorize.searchParams.get("state");
    await get(`${redirect}?error=access_denied&state=${state}`);
    expect(await login.result).toEqual({ ok: false, error: "access_denied" });
  });

  it("can be cancelled from the app", async () => {
    process.env.MENTOR_GITHUB_CLIENT_ID = "cid";
    process.env.MENTOR_GITHUB_CLIENT_SECRET = "sec";
    const login = await startBrowserLogin(vi.fn() as AnyFetch);
    login.cancel();
    expect(await login.result).toEqual({ ok: false, error: "cancelled" });
  });
});
