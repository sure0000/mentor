// 书城缓存：书单与书籍详情都要解析公开网页，重复请求既慢又容易触发反爬。
// 存在 localStorage 里，重启应用后仍可复用；按 TTL 过期，避免内容长期陈旧。
const PREFIX = "mentor-store-cache:";
// 书单变动快，详情基本不变
export const LIST_TTL = 30 * 60 * 1000;
export const DETAIL_TTL = 7 * 24 * 60 * 60 * 1000;
// 书单页 + 详情加起来不会太多，超出后按写入时间淘汰最旧的
const MAX_ENTRIES = 80;

interface Entry<T> {
  time: number;
  data: T;
}

const entryTime = (key: string): number => {
  try {
    return JSON.parse(localStorage.getItem(key) || "0")?.time || 0;
  } catch {
    return 0;
  }
};

const prune = () => {
  const keys: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith(PREFIX)) keys.push(key);
  }
  if (keys.length < MAX_ENTRIES) return;
  keys
    .sort((a, b) => entryTime(a) - entryTime(b))
    .slice(0, keys.length - MAX_ENTRIES + 1)
    .forEach((key) => localStorage.removeItem(key));
};

/** 读取未过期的缓存；过期或损坏时返回 null */
export const readCache = <T>(key: string, ttl: number): T | null => {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (!raw) return null;
    const entry = JSON.parse(raw) as Entry<T>;
    if (!entry || typeof entry.time !== "number") return null;
    if (Date.now() - entry.time > ttl) {
      localStorage.removeItem(PREFIX + key);
      return null;
    }
    return entry.data;
  } catch {
    return null;
  }
};

/** 写入缓存；存储满或被禁用时静默放弃，不影响正常请求 */
export const writeCache = <T>(key: string, data: T) => {
  try {
    prune();
    localStorage.setItem(
      PREFIX + key,
      JSON.stringify({ time: Date.now(), data })
    );
  } catch {
    // 配额不足时仅本次不缓存
  }
};
