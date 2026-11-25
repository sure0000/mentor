import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SourceUnavailableError, fetchWithPolicy, resetHttpPolicy } from "./http";

const fetchMock = vi.fn();

const run = async <T>(promise: Promise<T>) => {
  const settled = promise.then(
    (value) => ({ value, error: null }),
    (error: unknown) => ({ value: null, error })
  );
  await vi.advanceTimersByTimeAsync(120000);
  return settled;
};

const status = (code: number) => async () => new Response("", { status: code });

describe("fetchWithPolicy", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
    resetHttpPolicy();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("503 重试后成功", async () => {
    fetchMock.mockImplementationOnce(status(503)).mockImplementation(status(200));
    const { value } = await run(fetchWithPolicy("https://a.com/"));
    expect(value?.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("一次请求连同重试失败不会熔断，连续三次才熔断，冷却后恢复", async () => {
    fetchMock.mockImplementation(status(503));
    await run(fetchWithPolicy("https://a.com/"));
    expect(fetchMock).toHaveBeenCalledTimes(3);
    await run(fetchWithPolicy("https://a.com/"));
    await run(fetchWithPolicy("https://a.com/"));
    expect(fetchMock).toHaveBeenCalledTimes(9);
    const blocked = await run(fetchWithPolicy("https://a.com/"));
    expect(blocked.error).toBeInstanceOf(SourceUnavailableError);
    expect(fetchMock).toHaveBeenCalledTimes(9);
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    fetchMock.mockImplementation(status(200));
    expect((await run(fetchWithPolicy("https://a.com/"))).value?.status).toBe(200);
  });

  it("403 和 418 不重试", async () => {
    fetchMock.mockImplementation(status(418));
    await run(fetchWithPolicy("https://a.com/"));
    fetchMock.mockImplementation(status(403));
    await run(fetchWithPolicy("https://a.com/"));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("超时不重试", async () => {
    fetchMock.mockImplementation(
      (_url, init) =>
        new Promise((_, reject) =>
          init.signal.addEventListener("abort", () => reject(new Error("aborted")))
        )
    );
    const { error } = await run(fetchWithPolicy("https://a.com/"));
    expect(String(error)).toContain("timeout");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("豆瓣请求按间隔发出，但未完成的请求不阻塞后续请求", async () => {
    fetchMock.mockImplementation(() => new Promise(() => {}));
    fetchWithPolicy("https://book.douban.com/1").catch(() => {});
    fetchWithPolicy("https://book.douban.com/2").catch(() => {});
    await vi.advanceTimersByTimeAsync(1000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(300);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
