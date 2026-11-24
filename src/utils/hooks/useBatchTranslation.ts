import { useCallback, useEffect, useRef, useState } from "react";
import { getFullTranslationTarget, isRateLimitedResult } from "../common";
import { isAiAvailable } from "../aiReading/aiGateway";
import { getBatchTrans } from "../request/reader";

// 目标语言 + 原文 → 译文；持久化到 localStorage，重启应用后已翻译过的内容不再请求
const CACHE_KEY = "mentor-translation-cache";
// 超出上限时丢弃最早的条目，避免缓存无限增长
const CACHE_LIMIT = 4000;
const BATCH_SIZE = 25;

const loadCache = (): Map<string, string> => {
  try {
    const entries = JSON.parse(localStorage.getItem(CACHE_KEY) || "[]");
    return new Map<string, string>(
      Array.isArray(entries) ? (entries as [string, string][]) : []
    );
  } catch {
    // 存储被禁用或内容损坏时从空缓存开始
    return new Map();
  }
};

const transCache = loadCache();
let saveTimer: ReturnType<typeof setTimeout> | undefined;

// 译文是逐条写入的，合并成一次落盘
const saveCache = () => {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      const entries = Array.from(transCache.entries());
      localStorage.setItem(CACHE_KEY, JSON.stringify(entries.slice(-CACHE_LIMIT)));
    } catch {
      // 存储已满或被禁用时只保留内存缓存
    }
  }, 500);
};

const setCached = (key: string, value: string) => {
  transCache.set(key, value);
  saveCache();
};

const deleteCached = (key: string) => {
  if (transCache.delete(key)) saveCache();
};

/**
 * 开启后把 texts 中还没有译文的文本按批交给 AI 翻译，返回查询译文的函数。
 * texts 变化时只翻新增的部分；未配置 AI 服务时什么都不做。
 * 翻译是锦上添花：失败静默，且本次开启期间不再重试，避免列表变化时反复请求。
 */
export const useBatchTranslation = (texts: string[], enabled: boolean) => {
  // 译文更新时递增，触发重新渲染（译文本身存在 transCache 里）
  const [version, setVersion] = useState(0);
  const translatingRef = useRef(new Set<string>());
  const failedRef = useRef(new Set<string>());
  // 最近一批请求失败，供界面提示（AI 服务不可达时不逐条弹错误）
  const [hasError, setHasError] = useState(false);
  // 还有文本在等译文，界面据此显示「翻译中」动效
  const [isPending, setIsPending] = useState(false);
  // 手动重译时递增，重新触发下面的请求
  const [retryToken, setRetryToken] = useState(0);

  // 重新开启时给之前失败的文本一次重试机会
  useEffect(() => {
    if (!enabled) return;
    failedRef.current.clear();
    setHasError(false);
  }, [enabled]);

  useEffect(() => {
    if (!enabled || !isAiAvailable("translate")) return;
    const lang = getFullTranslationTarget();
    const pending = Array.from(
      new Set(
        texts.filter(
          (text) =>
            text &&
            !transCache.has(lang + text) &&
            !translatingRef.current.has(lang + text) &&
            !failedRef.current.has(lang + text)
        )
      )
    );
    for (let i = 0; i < pending.length; i += BATCH_SIZE) {
      const batch = pending.slice(i, i + BATCH_SIZE);
      batch.forEach((text) => translatingRef.current.add(lang + text));
      getBatchTrans(batch, "Automatic", lang, undefined, true)
        .then((res) => {
          const results = res?.data?.texts;
          batch.forEach((text, j) => {
            const translated = (results?.[j] || "").trim();
            if (translated && !isRateLimitedResult(translated)) {
              setCached(lang + text, translated);
            } else {
              failedRef.current.add(lang + text);
            }
          });
          setHasError(!results);
          // 成功或失败都刷新一次，让待翻译计数重新计算
          setVersion((v) => v + 1);
        })
        .finally(() =>
          batch.forEach((text) => translatingRef.current.delete(lang + text))
        );
    }
  }, [enabled, texts, retryToken]);

  // 仍有文本既没有译文、也没有判定失败，说明翻译尚未结束
  useEffect(() => {
    const lang = getFullTranslationTarget();
    setIsPending(
      enabled &&
        isAiAvailable("translate") &&
        texts.some(
          (text) =>
            text &&
            !transCache.has(lang + text) &&
            !failedRef.current.has(lang + text)
        )
    );
  }, [enabled, texts, version]);

  const getTrans = useCallback(
    (text: string): string => {
      if (!enabled) return "";
      const translated = transCache.get(getFullTranslationTarget() + text) || "";
      // 已是目标语言时译文与原文相同，不必重复展示
      return translated === text ? "" : translated;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [enabled, version]
  );

  // 手动重译：清掉这些文本的缓存（含已落盘部分），再重新请求
  const retranslate = useCallback(() => {
    const lang = getFullTranslationTarget();
    texts.forEach((text) => {
      if (!text) return;
      deleteCached(lang + text);
      failedRef.current.delete(lang + text);
    });
    setHasError(false);
    // 清空后立即刷新，界面先隐去旧译文并显示「翻译中」
    setVersion((v) => v + 1);
    setRetryToken((v) => v + 1);
  }, [texts]);

  return {
    getTrans,
    retranslate,
    hasError: enabled && hasError,
    isPending: enabled && isPending,
  };
};
