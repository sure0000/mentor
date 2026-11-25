// 书源抓取统一策略：超时、退避重试、按站点限速、失败熔断。
// 豆瓣、Goodreads 与各 OPDS 书源都解析公开网页/feed，既怕慢也怕频繁请求被拦。

export interface HttpOptions {
  // 单次请求超时，默认 20 秒（部分 OPDS 目录响应很慢）
  timeout?: number;
  // 失败后的重试次数，默认 2 次；超时不重试
  retries?: number;
  signal?: AbortSignal;
}

// 站点被判定为不可用后暂停的时长
const COOLDOWN = 5 * 60 * 1000;
// 连续多少次请求（重试算同一次）失败后熔断
const FAILURE_THRESHOLD = 3;
// 同一站点的两次请求最小间隔；反爬较严的站点单独放宽
const DEFAULT_MIN_INTERVAL = 150;
const HOST_MIN_INTERVAL: Record<string, number> = {
  "book.douban.com": 1200,
  "search.douban.com": 1200,
  "www.goodreads.com": 1200,
  "www.gutenberg.org": 600,
};

export class SourceUnavailableError extends Error {
  constructor(public host: string) {
    super(`Source unavailable: ${host}`);
    this.name = "SourceUnavailableError";
  }
}

interface HostState {
  nextAvailable: number;
  failures: number;
  openUntil: number;
}

const hostStates = new Map<string, HostState>();
const getState = (host: string): HostState => {
  let state = hostStates.get(host);
  if (!state) {
    state = { nextAvailable: 0, failures: 0, openUntil: 0 };
    hostStates.set(host, state);
  }
  return state;
};

const getHost = (url: string): string => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

// 同步预约发送时刻，只限制发起频率；不占用到响应结束，下载大文件时不会堵住同站搜索
const waitForSlot = async (host: string) => {
  const state = getState(host);
  const startAt = Math.max(Date.now(), state.nextAvailable);
  state.nextAvailable =
    startAt + (HOST_MIN_INTERVAL[host] ?? DEFAULT_MIN_INTERVAL);
  const wait = startAt - Date.now();
  if (wait > 0) await sleep(wait);
};

const isRetryable = (status: number) => status === 429 || status >= 500;
// 403 / 418（豆瓣）多为人机验证或封禁，重试没有意义，但要计入熔断
const isFailure = (status: number) =>
  isRetryable(status) || status === 403 || status === 418;

const parseRetryAfter = (value: string | null): number => {
  if (!value) return 0;
  const seconds = Number(value);
  if (!isNaN(seconds)) return Math.min(seconds * 1000, 30000);
  const date = Date.parse(value);
  return isNaN(date) ? 0 : Math.min(Math.max(date - Date.now(), 0), 30000);
};

const backoff = (attempt: number) =>
  Math.min(500 * 2 ** attempt, 8000) + Math.round(Math.random() * 300);

const recordFailure = (host: string) => {
  const state = getState(host);
  state.failures += 1;
  if (state.failures >= FAILURE_THRESHOLD) {
    state.openUntil = Date.now() + COOLDOWN;
  }
};

const recordSuccess = (host: string) => {
  const state = getState(host);
  state.failures = 0;
  state.openUntil = 0;
};

const throwIfAborted = (signal?: AbortSignal) => {
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
};

/**
 * 带策略的 fetch。HTTP 错误状态在重试耗尽后照常返回，由调用方处理；
 * 网络错误、超时和熔断则抛出异常。
 */
export const fetchWithPolicy = async (
  url: string,
  init: RequestInit = {},
  options: HttpOptions = {}
): Promise<Response> => {
  const host = getHost(url);
  const { timeout = 20000, retries = 2, signal } = options;

  for (let attempt = 0; ; attempt++) {
    await waitForSlot(host);
    throwIfAborted(signal);
    // 排队期间可能已被其它请求熔断
    if (getState(host).openUntil > Date.now()) {
      throw new SourceUnavailableError(host);
    }
    const controller = new AbortController();
    let isTimeout = false;
    const timer = setTimeout(() => {
      isTimeout = true;
      controller.abort();
    }, timeout);
    const onAbort = () => controller.abort();
    signal?.addEventListener("abort", onAbort, { once: true });
    let delay = backoff(attempt);
    try {
      const response = await fetch(url, { ...init, signal: controller.signal });
      if (!isFailure(response.status)) {
        recordSuccess(host);
        return response;
      }
      if (!isRetryable(response.status) || attempt >= retries) {
        recordFailure(host);
        return response;
      }
      delay = parseRetryAfter(response.headers.get("retry-after")) || delay;
    } catch (err) {
      // 调用方主动取消不算书源故障
      if (signal?.aborted) throw err;
      if (isTimeout || attempt >= retries) {
        recordFailure(host);
        throw isTimeout ? new Error(`Request timeout: ${host}`) : err;
      }
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    }
    await sleep(delay);
  }
};

// 测试与手动重试用
export const resetHttpPolicy = () => {
  hostStates.clear();
};
