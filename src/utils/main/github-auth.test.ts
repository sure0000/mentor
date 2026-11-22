import { afterEach, describe, expect, it, vi } from "vitest";
import githubAuth from "./github-auth";

const { requestDeviceCode, pollAccessToken, ensureSyncRepo, getClientId } =
  githubAuth;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyFetch = any;
const json = (status: number, data: unknown) =>
  ({ ok: status >= 200 && status < 300, status, json: async () => data }) as Response;

afterEach(() => {
  vi.useRealTimers();
  delete process.env.MENTOR_GITHUB_CLIENT_ID;
});

describe("getClientId", () => {
  it("reads the env override", () => {
    process.env.MENTOR_GITHUB_CLIENT_ID = " abc ";
    expect(getClientId()).toBe("abc");
  });
});

describe("requestDeviceCode", () => {
  it("maps the GitHub response", async () => {
    const fetchImpl = vi.fn(async () =>
      json(200, {
        device_code: "dc",
        user_code: "ABCD-1234",
        verification_uri: "https://github.com/login/device",
        interval: 5,
        expires_in: 900,
      })
    );
    const device = await requestDeviceCode("cid", fetchImpl);
    expect(device).toEqual({
      deviceCode: "dc",
      userCode: "ABCD-1234",
      verificationUri: "https://github.com/login/device",
      interval: 5,
      expiresIn: 900,
    });
    const body = String((fetchImpl.mock.calls[0] as unknown[])[1] && (fetchImpl.mock.calls[0] as any)[1].body);
    expect(body).toContain("client_id=cid");
    expect(body).toContain("scope=repo");
  });
});

describe("pollAccessToken", () => {
  const device = { deviceCode: "dc", userCode: "", verificationUri: "", interval: 1, expiresIn: 60 };

  it("keeps polling while pending and returns the token", async () => {
    vi.useFakeTimers();
    const responses = [
      { error: "authorization_pending" },
      { error: "slow_down", interval: 1 },
      { access_token: "tok" },
    ];
    const fetchImpl = vi.fn(async () => json(200, responses.shift()));
    const promise = pollAccessToken("cid", device, () => false, fetchImpl);
    await vi.runAllTimersAsync();
    expect(await promise).toEqual({ ok: true, token: "tok" });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("stops on access_denied", async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn(async () => json(200, { error: "access_denied" }));
    const promise = pollAccessToken("cid", device, () => false, fetchImpl);
    await vi.runAllTimersAsync();
    expect(await promise).toEqual({ ok: false, error: "access_denied" });
  });

  it("stops when cancelled", async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn();
    const promise = pollAccessToken("cid", device, () => true, fetchImpl);
    await vi.runAllTimersAsync();
    expect(await promise).toEqual({ ok: false, error: "cancelled" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("ensureSyncRepo", () => {
  const user = { login: "alice", name: "Alice", avatar_url: "a.png" };

  it("reuses an existing repository", async () => {
    const fetchImpl = vi.fn(async (url: string) =>
      url.endsWith("/user")
        ? json(200, user)
        : json(200, { full_name: "alice/mentor-sync", private: true })
    );
    const result = await ensureSyncRepo("tok", "mentor-sync", fetchImpl as AnyFetch);
    expect(result).toMatchObject({ ok: true, login: "alice", repo: "alice/mentor-sync", isPrivate: true });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("creates a private repository when missing", async () => {
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/user")) return json(200, user);
      if (init?.method === "POST") return json(201, { full_name: "alice/mentor-sync" });
      return json(404, {});
    });
    const result = await ensureSyncRepo("tok", "mentor-sync", fetchImpl as AnyFetch);
    expect(result).toMatchObject({ ok: true, repo: "alice/mentor-sync", isPrivate: true });
    const createCall = fetchImpl.mock.calls.find((c) => (c as any)[1]?.method === "POST") as any;
    expect(JSON.parse(createCall[1].body)).toMatchObject({ name: "mentor-sync", private: true, auto_init: true });
  });

  it("reports a bad token", async () => {
    const fetchImpl = vi.fn(async () => json(401, {}));
    expect(await ensureSyncRepo("bad", "mentor-sync", fetchImpl)).toEqual({ ok: false, error: "bad-token" });
  });
});
