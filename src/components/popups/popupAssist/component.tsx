import { useLatest } from "../../../utils/hooks/useLatest";
import { useTranslation } from "react-i18next";
import React, { useEffect, useRef, useState } from "react";
import "./popupAssist.css";
import {
  ConfigService,
  KookitConfig,
} from "../../../assets/lib/kookit-extra-browser.min";
import Parser from "html-react-parser";
import DOMPurify from "dompurify";
import { Trans } from "react-i18next";
import { handleContextMenu } from "../../../utils/common";
import toast from "react-hot-toast";
import { saveAs } from "file-saver";
import { chatStream } from "../../../utils/request/common";
import { marked } from "marked";
import { sampleQuestion } from "../../../constants/settingList";
import { useAppStore } from "../../../store/useAppStore";
import {
  CLAUDE_CODE_ERROR_KEYS,
  CLAUDE_CODE_PLUGIN_KEY,
  buildConversationPrompt,
  cancelClaudeCode,
  formatUsage,
  startClaudeCodeChat,
} from "../../../utils/aiReading/claudeCode";
import QaAnswer from "../../aiReading/qaAnswer";
import {
  SPOILER_SAFE_KEY,
  isSpoilerSafe,
  prepareQa,
} from "../../../utils/aiReading/bookQaService";
import { loadCachedIndex } from "../../../utils/aiReading/bookIndex";
import {
  QA_EXTRA_CLOSE,
  QA_EXTRA_OPEN,
  QaSource,
  parseSources,
  stripRefMarkers,
  stripSources,
  visibleWhileStreaming,
} from "../../../utils/aiReading/bookQa";
import { getCurrentDocIndex } from "../../../utils/aiReading/readerAdapter";
import { isElectron } from "react-device-detect";

export type AiChatMessage = {
  role: "user" | "assistant";
  content: string;
  /** AI 伴读：全书问答的出处（已核对） */
  sources?: QaSource[];
};

export interface PopupAssistProps {
  isDockedRight: boolean;
}

export interface PopupAssistState {
  aiService: string;
  isAddNew: boolean;
  isWaiting: boolean;
  question: string;
  askHistory: AiChatMessage[];
  answer: string;
  inputQuestion: string;
  usage: string;
  isSpoilerSafe: boolean;
}

const MAX_HISTORY_LENGTH = 50;
const AI_ASK_HISTORY_KEY = "aiAskHistory";

/** 去掉全书问答回答中的「AI 补充」标记，用于复制与流式显示 */
const plainAnswer = (text: string) =>
  text.split(QA_EXTRA_OPEN).join("").split(QA_EXTRA_CLOSE).join("");

const isBookQaService = (service: string) =>
  service === CLAUDE_CODE_PLUGIN_KEY || service === "custom-ai-assistant-plugin";

const PopupAssist = (props: PopupAssistProps) => {
  const currentBook = useAppStore((s) => s.book.currentBook);
  const originalText = useAppStore((s) => s.reader.originalText);
  const quoteText = useAppStore((s) => s.reader.quoteText);
  const htmlBook = useAppStore((s) => s.reader.htmlBook);
  const plugins = useAppStore((s) => s.manager.plugins);
  const handleOpenMenu = useAppStore((s) => s.handleOpenMenu);
  const handleMenuMode = useAppStore((s) => s.handleMenuMode);
  const handleSetting = useAppStore((s) => s.handleSetting);
  const handleSettingMode = useAppStore((s) => s.handleSettingMode);
  const handleQuoteText = useAppStore((s) => s.handleQuoteText);
  const { t } = useTranslation();
  const [state, setState] = useState<PopupAssistState>({
    answer: "",
    aiService: ConfigService.getReaderConfig("aiService") || "",
    isAddNew: false,
    isWaiting: false,
    question: "",
    askHistory: [],
    inputQuestion: "",
    usage: "",
    isSpoilerSafe: isSpoilerSafe(),
  });

  const stateRef = useLatest(state);
  // 是否已有全书索引（切到问书页签或换书时重新检查）
  const [hasBookIndex, setHasBookIndex] = useState(false);
  useEffect(() => {
    if (!isElectron || !currentBook?.key) return;
    setHasBookIndex(!!loadCachedIndex(currentBook));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentBook?.key]);
  const claudeRequestId = useRef("");
  const isMounted = useRef(true);
  const chatBoxRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const answerTextAccumulator = useRef("");
  const updateInterval = useRef<ReturnType<typeof setInterval> | null>(null);
  const isHydrating = useRef(false);
  const pendingTimeouts = useRef<Set<ReturnType<typeof setTimeout>>>(
    new Set()
  );

  const mergeState = (patch: Partial<PopupAssistState>) => {
    setState((prev) => ({ ...prev, ...patch }));
  };

  const runAfterUpdate = (callback: () => void) => {
    const id = setTimeout(() => {
      pendingTimeouts.current.delete(id);
      callback();
    }, 0);
    pendingTimeouts.current.add(id);
  };

  const loadHistory = (bookKey: string): AiChatMessage[] => {
    if (!bookKey) {
      return [];
    }
    return ConfigService.getObjectConfig(bookKey, AI_ASK_HISTORY_KEY, []);
  };

  const clearHistory = (bookKey: string): void => {
    if (!bookKey) {
      return;
    }
    ConfigService.setObjectConfig(bookKey, [], AI_ASK_HISTORY_KEY);
  };

  const saveHistory = (bookKey: string, messages: AiChatMessage[]): void => {
    if (!bookKey) {
      return;
    }
    const key = AI_ASK_HISTORY_KEY;
    const trimmed =
      messages.length <= MAX_HISTORY_LENGTH
        ? messages
        : messages.slice(messages.length - MAX_HISTORY_LENGTH);
    ConfigService.setObjectConfig(bookKey, trimmed, key);
  };

  const startUpdateInterval = () => {
    if (updateInterval.current) {
      clearInterval(updateInterval.current);
    }
    updateInterval.current = setInterval(() => {
      const text = answerTextAccumulator.current;
      if (text) {
        setState((prev) => ({ ...prev, answer: text }));
        runAfterUpdate(scrollToBottomIfNeeded);
      }
    }, 150);
  };

  const stopUpdateInterval = (
    finalAnswer?: string,
    callback?: () => void
  ) => {
    if (updateInterval.current) {
      clearInterval(updateInterval.current);
      updateInterval.current = null;
    }
    if (finalAnswer !== undefined) {
      setState((prev) => ({ ...prev, answer: finalAnswer }));
      if (callback) runAfterUpdate(callback);
    } else {
      callback?.();
    }
  };
  const loadChatHistory = () => {
    const bookKey = currentBook?.key;
    if (!bookKey) {
      return;
    }
    isHydrating.current = true;
    setState((prev) => ({
      ...prev,
      askHistory: loadHistory(bookKey),
    }));
    runAfterUpdate(() => {
      isHydrating.current = false;
      if (ConfigService.getReaderConfig("isManualScroll") !== "yes") {
        scrollToBottom();
      }
    });
  };
  const saveChatHistory = () => {
    const bookKey = currentBook?.key;
    if (!bookKey || isHydrating.current) {
      return;
    }
    saveHistory(bookKey, stateRef.current.askHistory);
  };
  // componentDidMount: 加载历史、处理引用文本、初始化 AI 服务
  useEffect(() => {
    loadChatHistory();
    if (quoteText) {
      setState((prev) => ({ ...prev, inputQuestion: quoteText + "\n" }));
      runAfterUpdate(() => {
        autoResizeTextarea();
        const el = textareaRef.current;
        if (el) {
          el.focus();
          const len = el.value.length;
          el.setSelectionRange(len, len);
        }
      });
      handleQuoteText("");
    }
    if (!state.aiService) {
      let pluginList = plugins.filter(
        (item) =>
          item.type === "assistant" && !item.key.startsWith("official-ai-")
      );
      if (pluginList.length > 0) {
        mergeState({
          aiService: pluginList[0].key,
        });
        ConfigService.setReaderConfig("aiService", pluginList[0].key);
      } else {
        mergeState({
          isAddNew: true,
        });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // componentDidUpdate: 书籍变化时重新加载历史
  const prevBookKeyRef = useRef(currentBook?.key);
  useEffect(() => {
    if (prevBookKeyRef.current !== currentBook?.key) {
      prevBookKeyRef.current = currentBook?.key;
      loadChatHistory();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentBook?.key]);

  // componentDidUpdate: 历史变化时持久化
  useEffect(() => {
    if (isHydrating.current) {
      return;
    }
    const bookKey = currentBook?.key;
    if (!bookKey) {
      return;
    }
    saveHistory(bookKey, state.askHistory);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.askHistory]);

  // componentWillUnmount: 保存历史并清理定时器
  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
      // 关闭面板时结束正在运行的 Claude Code 进程（FR-AI-05）
      if (claudeRequestId.current) {
        cancelClaudeCode(claudeRequestId.current);
        claudeRequestId.current = "";
      }
      saveChatHistory();
      if (updateInterval.current) {
        clearInterval(updateInterval.current);
        updateInterval.current = null;
      }
      pendingTimeouts.current.forEach((id) => clearTimeout(id));
      pendingTimeouts.current.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const autoResizeTextarea = () => {
    const el = textareaRef.current;
    if (!el) return;
    const style = getComputedStyle(el);
    const lineHeight = parseFloat(style.lineHeight) || 20;
    const paddingTop = parseFloat(style.paddingTop) || 0;
    const paddingBottom = parseFloat(style.paddingBottom) || 0;
    const maxLines = 5;
    const maxHeight = lineHeight * maxLines + paddingTop + paddingBottom;
    // 先重置为最小高度，让 scrollHeight 反映真实内容高度
    el.style.height = "0px";
    const contentHeight = el.scrollHeight;
    if (contentHeight >= maxHeight) {
      el.style.height = maxHeight + "px";
      el.style.overflowY = "auto";
    } else {
      el.style.height = contentHeight + "px";
      el.style.overflowY = "hidden";
    }
  };
  const scrollToBottom = () => {
    if (chatBoxRef.current) {
      const scrollHeight = chatBoxRef.current.scrollHeight;
      const height = chatBoxRef.current.clientHeight;
      const maxScrollTop = scrollHeight - height;
      chatBoxRef.current.scrollTop = maxScrollTop > 0 ? maxScrollTop : 0;
    }
  };
  const scrollToBottomIfNeeded = () => {
    if (ConfigService.getReaderConfig("isManualScroll") !== "yes") {
      scrollToBottom();
    }
  };
  const handleAnswer = async () => {
    let answerText = originalText
      .replace(/(\r\n|\n|\r)/gm, "")
      // Remove common garbage characters
      .replace(
        /[^\x20-\x7E\u00A0-\u00FF\u0100-\u017F\u4E00-\u9FFF\u3000-\u303F]/g,
        ""
      )
      // Remove consecutive spaces
      .replace(/\s{2,}/g, " ")
      .trim();
    if (
      (!ConfigService.getReaderConfig("aiService") ||
        plugins.findIndex(
          (item) => item.key === ConfigService.getReaderConfig("aiService")
        ) === -1)
    ) {
      mergeState({ isAddNew: true });
    }
    if (!answerText) {
      answerText = await htmlBook.rendition.chapterText();
    }
    handleDoAnswer(answerText);
  };
  const handleDoAnswer = async (text: string) => {
    try {
      const service = ConfigService.getReaderConfig("aiService");
      if (
        isElectron &&
        (service === CLAUDE_CODE_PLUGIN_KEY ||
          service === "custom-ai-assistant-plugin")
      ) {
        await handleBookQaAnswer(text);
        return;
      }
      if (service === CLAUDE_CODE_PLUGIN_KEY) {
        await handleClaudeCodeAnswer(text);
        return;
      }
      if (
        ConfigService.getReaderConfig("aiService") &&
        ConfigService.getReaderConfig("aiService") ===
          "custom-ai-assistant-plugin"
      ) {
        let plugin = plugins.find(
          (item) => item.key === "custom-ai-assistant-plugin"
        );
        if (!plugin) {
          return;
        }
        let systemPrompt =
          ConfigService.getReaderConfig("aiAssistancePrompt") ||
          KookitConfig.DefaultPrompts.aiAssistance;
        systemPrompt = systemPrompt.replace("{text}", text);
        let config: any = plugin.config || {};
        let chatHistory = stateRef.current.askHistory;
        // Build messages: system prompt as first user message, then history, then current question
        const historyMessages = chatHistory.slice(0, -1); // exclude the latest user message we just added
        const currentQuestion =
          chatHistory[chatHistory.length - 1]?.content ||
          stateRef.current.question;
        if (!currentQuestion) {
          return;
        }
        answerTextAccumulator.current = "";
        startUpdateInterval();
        await chatStream(
          config.endpoint,
          config.providerId,
          config.apiKey,
          config.modelId,
          systemPrompt + "\n\nUser question: " + currentQuestion,
          historyMessages,
          (result) => {
            if (result && result.done) {
              return;
            }
            if (result && result.text) {
              if (!answerTextAccumulator.current) {
                mergeState({ isWaiting: false });
              }
              answerTextAccumulator.current += result.text;
            }
          }
        );
        stopUpdateInterval(answerTextAccumulator.current);
        const finalAnswer = answerTextAccumulator.current;
        answerTextAccumulator.current = "";
        setState((prev) => ({
          ...prev,
          askHistory: [
            ...prev.askHistory,
            { role: "assistant", content: finalAnswer },
          ],
          answer: "",
          question: "",
          isWaiting: false,
        }));
        runAfterUpdate(scrollToBottomIfNeeded);
      }
    } catch (error) {
      toast.error(
        t("Error happened") +
          ": " +
          (error instanceof Error ? error.message : String(error))
      );
      console.error(error);
      mergeState({
        answer: t("Error happened"),
      });
    }
  };
  const appendAssistantMessage = (finalAnswer: string) => {
    setState((prev) => ({
      ...prev,
      askHistory: [
        ...prev.askHistory,
        { role: "assistant", content: finalAnswer },
      ],
      answer: "",
      question: "",
      isWaiting: false,
    }));
    runAfterUpdate(scrollToBottomIfNeeded);
  };
  const handleClaudeCodeAnswer = async (text: string) => {
    const history = stateRef.current.askHistory;
    const currentQuestion =
      history[history.length - 1]?.content || stateRef.current.question;
    if (!currentQuestion) {
      return;
    }
    const template =
      ConfigService.getReaderConfig("aiAssistancePrompt") ||
      KookitConfig.DefaultPrompts.aiAssistance;
    const system = template.replace("{text}", text);
    answerTextAccumulator.current = "";
    mergeState({ usage: "" });
    startUpdateInterval();
    const { requestId, promise } = startClaudeCodeChat({
      system,
      prompt: buildConversationPrompt(history.slice(0, -1), currentQuestion),
      onText: (delta) => {
        if (!answerTextAccumulator.current) {
          mergeState({ isWaiting: false });
        }
        answerTextAccumulator.current += delta;
      },
    });
    claudeRequestId.current = requestId;
    const result = await promise;
    claudeRequestId.current = "";
    stopUpdateInterval();
    const streamed = answerTextAccumulator.current;
    answerTextAccumulator.current = "";
    if (!isMounted.current) {
      return;
    }
    const usage = formatUsage(result.costUsd, result.durationMs);
    if (result.ok) {
      appendAssistantMessage(streamed || result.text);
      mergeState({ usage });
      return;
    }
    const errorText = t(CLAUDE_CODE_ERROR_KEYS[result.code]);
    if (result.code !== "cancelled") {
      toast.error(errorText, { duration: 6000 });
      if (result.message) console.error("Claude Code:", result.message);
    }
    // 已流出的部分保留，并标注中断原因
    appendAssistantMessage(
      (streamed ? streamed + "\n\n" : "") + "> " + errorText
    );
    mergeState({ usage });
  };
  /**
   * AI 伴读：全书问答（FR-QA）。上下文 = 选中文字 + 当前章节 + 全书检索片段；
   * 回答流式显示，结束后解析并核对出处。
   */
  const handleBookQaAnswer = async (chapterOrSelection: string) => {
    const history = stateRef.current.askHistory;
    const currentQuestion =
      history[history.length - 1]?.content || stateRef.current.question;
    if (!currentQuestion || !currentBook?.key) return;
    // originalText 来自工具栏时是整章文本，来自划词时是选中文字
    const chapterText = htmlBook?.rendition
      ? await htmlBook.rendition.chapterText()
      : "";
    const selection =
      chapterOrSelection && chapterOrSelection !== chapterText &&
      chapterOrSelection.length < 3000
        ? chapterOrSelection
        : "";
    const qa = prepareQa({
      book: currentBook,
      question: currentQuestion,
      selection,
      history: history.slice(0, -1),
      currentDocIndex: htmlBook?.rendition
        ? getCurrentDocIndex(htmlBook.rendition)
        : -1,
      fallbackChapterText: chapterText,
    });
    answerTextAccumulator.current = "";
    mergeState({ usage: "" });
    startUpdateInterval();
    const onText = (delta: string) => {
      if (!answerTextAccumulator.current) mergeState({ isWaiting: false });
      answerTextAccumulator.current += delta;
    };
    let ok = true;
    let errorText = "";
    let usage = "";
    if (ConfigService.getReaderConfig("aiService") === CLAUDE_CODE_PLUGIN_KEY) {
      const { requestId, promise } = startClaudeCodeChat({
        system: qa.system,
        prompt: qa.prompt,
        onText,
      });
      claudeRequestId.current = requestId;
      const result = await promise;
      claudeRequestId.current = "";
      usage = formatUsage(result.costUsd, result.durationMs);
      if (!result.ok) {
        ok = false;
        errorText = t(CLAUDE_CODE_ERROR_KEYS[result.code]);
        if (result.code !== "cancelled") {
          toast.error(errorText, { duration: 6000 });
          if (result.message) console.error("Claude Code:", result.message);
        }
      } else if (!answerTextAccumulator.current) {
        answerTextAccumulator.current = result.text;
      }
    } else {
      const plugin = plugins.find(
        (item) => item.key === "custom-ai-assistant-plugin"
      );
      const config = (plugin?.config || {}) as Record<string, string>;
      const started = Date.now();
      try {
        await chatStream(
          config.endpoint,
          config.providerId,
          config.apiKey,
          config.modelId,
          qa.system + "\n\n" + qa.prompt,
          [],
          (r: { text?: string; done?: boolean }) => {
            if (r && r.text) onText(r.text);
          }
        );
      } catch (e) {
        ok = false;
        errorText = t("Error happened");
      }
      usage = `${((Date.now() - started) / 1000).toFixed(1)}s`;
    }
    stopUpdateInterval();
    const raw = answerTextAccumulator.current;
    answerTextAccumulator.current = "";
    if (!isMounted.current) return;
    const sources = parseSources(raw, qa.context);
    let body = stripRefMarkers(stripSources(raw));
    if (!ok) body = (body ? body + "\n\n" : "") + "> " + errorText;
    if (!qa.usedIndex) {
      usage += " · " + t("Full-book index not built; used this chapter only");
    } else if (qa.spoilerSafe) {
      usage += " · " + t("Spoiler-safe");
    }
    setState((prev) => ({
      ...prev,
      askHistory: [
        ...prev.askHistory,
        { role: "assistant", content: body, sources },
      ],
      answer: "",
      question: "",
      isWaiting: false,
      usage,
    }));
    runAfterUpdate(scrollToBottomIfNeeded);
  };
  const handleStopAnswer = () => {
    if (claudeRequestId.current) {
      cancelClaudeCode(claudeRequestId.current);
    }
  };
  const handleChangeAiService = (aiService: string) => {
    let plugin = plugins.find((item) => item.key === aiService);
    if (!plugin) {
      return;
    }
    mergeState({
      aiService: aiService,
      isAddNew: false,
    });
    runAfterUpdate(() => {
      ConfigService.setReaderConfig("aiService", aiService);
      if (!plugin) return;
      handleAnswer();
    });
  };
  const handleCopyAnswer = (content: string) => {
    navigator.clipboard.writeText(content || "").then(() => {
      toast.success(t("Copied"));
    });
  };
  const handleRenderHistoryMessage = (message: any[]) => {
    return message.map((item, index) => {
      return (
        <div
          key={index}
          className={
            item.role === "assistant"
              ? "popup-message-assistant"
              : "popup-message-user"
          }
        >
          {item.role === "assistant" && item.sources ? (
            <QaAnswer content={item.content} sources={item.sources} />
          ) : (
            Parser(
              DOMPurify.sanitize(
                marked.parse(item.content) + "<address></address>"
              ) || " ",
              {
                replace: (_domNode) => {},
              }
            )
          )}
          {item.role === "assistant" && (
            <div
              className="popup-assist-copy-button"
              onClick={() => handleCopyAnswer(plainAnswer(item.content))}
            >
              <span className="icon-copy-line"></span>
            </div>
          )}
          {item.role === "assistant" && index === message.length - 1 && (
            <div className="popup-assist-disclaimer">
              {t(
                "AI-generated content is for reference only. Please verify carefully as it does not constitute professional advice."
              )}
            </div>
          )}
        </div>
      );
    });
  };
  const handleExportChatHistory = () => {
    const messages = stateRef.current.askHistory;
    if (messages.length === 0) {
      toast(t("Nothing to export"));
      return;
    }
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    const day = now.getDate();
    const dateStr = `${year}-${month <= 9 ? "0" + month : month}-${
      day <= 9 ? "0" + day : day
    }`;
    const bookName = currentBook?.name || "Unknown";
    const exportData = {
      bookName,
      mode: "ask",
      exportedAt: now.toISOString(),
      messages,
    };
    saveAs(
      new Blob([JSON.stringify(exportData, null, 2)], {
        type: "application/json;charset=UTF-8",
      }),
      `Mentor-Reading-Assistant-${bookName}-${dateStr}.json`
    );
    toast.success(t("Export successful"), { id: "exporting" });
  };
  const handleDeleteChatHistory = () => {
    clearHistory(currentBook?.key || "");
    toast.success(t("Deletion successful"));
    setState((prev) => ({ ...prev, askHistory: [] }));
  };
  const handleSendQuestion = () => {
    const { answer, isWaiting, inputQuestion } = stateRef.current;
    if (answer || isWaiting) {
      return;
    }
    handleNewQuestion(inputQuestion);
    mergeState({ inputQuestion: "" });
    runAfterUpdate(() => {
      const el = textareaRef.current;
      if (el) {
        el.style.height = "40px";
        el.style.overflowY = "hidden";
      }
    });
  };
  const handleNewQuestion = (question: string) => {
    const content = t(question);
    setState((prev) => ({
      ...prev,
      askHistory: [
        ...prev.askHistory,
        {
          role: "user",
          content,
        },
      ],
      question: content,
      answer: "",
      isWaiting: true,
    }));
    runAfterUpdate(handleAnswer);
    setTimeout(() => {
      if (ConfigService.getReaderConfig("isManualScroll") !== "yes") {
        scrollToBottom();
      }
    }, 100);
  };
  return (
      <div className="dict-container">
        <div
          className="dict-service-container"
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            width: "calc(100% - 50px)",
            top: "20px",
            flexWrap: props.isDockedRight ? "wrap" : "nowrap",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: props.isDockedRight
                ? "space-between"
                : "flex-start",
              flexShrink: 0,
              width: props.isDockedRight ? "100%" : undefined,
              marginTop: props.isDockedRight ? "10px" : "0px",
            }}
          >
            <div
              className="trans-service-selector"
              style={{ flex: props.isDockedRight ? 1 : undefined }}
            >
              <span className={`icon-bookmark trans-icon`}></span>
              {t("Reading Assistant")}
            </div>
          </div>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              width: props.isDockedRight ? "100%" : undefined,
              justifyContent: props.isDockedRight
                ? "space-between"
                : undefined,
              marginTop: props.isDockedRight ? "10px" : "0px",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <div
                className="popup-assist-export-button"
                style={{ fontSize: 18 }}
                onClick={handleDeleteChatHistory}
              >
                <span
                  data-tooltip-id="my-tooltip"
                  data-tooltip-content={t("Clear chat history")}
                >
                  <span className="icon-trash-line"></span>
                </span>
              </div>
              <div
                className="popup-assist-export-button"
                onClick={handleExportChatHistory}
              >
                <span
                  data-tooltip-id="my-tooltip"
                  data-tooltip-content={t("Export chat history")}
                >
                  <span className="icon-share"></span>
                </span>
              </div>
            </div>

            <select
              className="dict-service-selector"
              style={{
                margin: 0,
                color: "var(--brand)",
                width: "150px",
              }}
              value={state.aiService}
              onChange={(event: React.ChangeEvent<HTMLSelectElement>) => {
                if (event.target.value === "add-new") {
                  handleOpenMenu(false);
                  handleMenuMode("");
                  handleSetting(true);
                  handleSettingMode("ai");
                  return;
                }
                handleChangeAiService(event.target.value);
              }}
            >
              <option
                value={""}
                key={"select"}
                className="add-dialog-shelf-list-option"
              >
                {t("Please select")}
              </option>
              {plugins
                .filter((item) => item.type === "assistant")
                .map((item) => {
                  return (
                    <option
                      value={item.key}
                      key={item.key}
                      className="add-dialog-shelf-list-option"
                    >
                      {t(item.displayName)}
                    </option>
                  );
                })}
              <option
                value={"add-new"}
                key={"add-new"}
                className="add-dialog-shelf-list-option"
              >
                {t("Add new plugin")}
              </option>
            </select>
          </div>
        </div>

        {state.isAddNew && (
          <div
            style={{
              marginTop: "150px",
              textAlign: "center",
              fontSize: "17px",
              color: "var(--brand)",
            }}
          >
            <span
              style={{
                textDecoration: "underline",
                cursor: "pointer",
                textAlign: "center",
              }}
              onClick={() => {
                handleOpenMenu(false);
                handleMenuMode("");
                handleSetting(true);
                handleSettingMode("ai");
              }}
            >
              <Trans>Add new plugin</Trans>
            </span>
          </div>
        )}
        {!state.isAddNew && (
          <>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                height: "100%",
                paddingTop: props.isDockedRight ? "100px" : "60px",
                paddingBottom: "20px",
                boxSizing: "border-box",
              }}
            >
              <div
                className="dict-text-box"
                style={{
                  flex: 1,
                  marginTop: "0px",
                  width: "calc(100% + 20px)",
                  height: undefined,
                  paddingBottom: "0px",
                  paddingLeft: "0px",
                  paddingRight: "20px",
                }}
                ref={chatBoxRef}
              >
                {handleRenderHistoryMessage(state.askHistory)}
                {state.isWaiting ? (
                  <div
                    className="popup-message-assistant"
                    style={{ float: "left" }}
                  >
                    <span
                      className="icon-loading popup-assistant-loading"
                      style={{
                        marginRight: "10px",
                        marginTop: "5px",
                      }}
                    ></span>
                    <span>{t("Thinking, please wait...")}</span>
                  </div>
                ) : state.askHistory.length > 0 ? (
                  <div className="popup-message-assistant">
                    {Parser(
                      DOMPurify.sanitize(
                        marked.parse(
                          state.answer
                            ? plainAnswer(
                                stripRefMarkers(
                                  visibleWhileStreaming(state.answer)
                                )
                              )
                            : ""
                        ) + "<address></address>"
                      ) || " ",
                      {
                        replace: (_domNode) => {},
                      }
                    )}
                  </div>
                ) : (
                  <div className="popup-message-assistant">
                    {t(
                      "Hi there! What questions do you have about this chapter?"
                    )}
                  </div>
                )}
              </div>
              <div
                style={{
                  marginLeft: "-25px",
                  marginRight: "-25px",
                  marginBottom: "0px",
                  padding: "0px 25px",
                }}
              >
                {isElectron &&
                  isBookQaService(state.aiService) && (
                    <div className="popup-assist-qa-options">
                      <span>
                        {hasBookIndex
                          ? t("Answers draw on the whole book")
                          : t("Open Reading Companion once to enable whole-book answers")}
                      </span>
                      <label>
                        <input
                          type="checkbox"
                          checked={state.isSpoilerSafe}
                          onChange={(e) => {
                            ConfigService.setReaderConfig(
                              SPOILER_SAFE_KEY,
                              e.target.checked ? "yes" : "no"
                            );
                            mergeState({ isSpoilerSafe: e.target.checked });
                          }}
                        />{" "}
                        {t("Spoiler-safe (only use text before my position)")}
                      </label>
                    </div>
                  )}
                <div className="popup-assist-shortcut-container">
                  {sampleQuestion
                    .filter((item) => item.mode === "ask")
                    .map((item) => {
                      return (
                        <div
                          className="popup-assist-shortcut"
                          onClick={() => {
                            handleNewQuestion(item.question);
                          }}
                        >
                          {item.emoji + " " + t(item.question)}
                        </div>
                      );
                    })}
                </div>

                <div
                  style={{
                    display: "flex",
                    alignItems: "flex-end",
                    justifyContent: "space-between",
                  }}
                >
                  <textarea
                    ref={textareaRef}
                    name="url"
                    placeholder={t("Ask anything about this chapter")}
                    id="trans-add-content-box"
                    className="trans-add-content-box"
                    style={{
                      height: "40px",
                      resize: "none",
                      overflowY: "hidden",
                      marginRight: "10px",
                      marginBottom: "0px",
                    }}
                    onKeyDown={(
                      event: React.KeyboardEvent<HTMLTextAreaElement>
                    ) => {
                      if (
                        event.key === "Enter" &&
                        (event.ctrlKey || event.metaKey) &&
                        !(event.nativeEvent as any).isComposing
                      ) {
                        event.preventDefault();
                        handleSendQuestion();
                      }
                    }}
                    onContextMenu={() => {
                      handleContextMenu("trans-add-content-box");
                    }}
                    value={state.inputQuestion}
                    onChange={(
                      event: React.ChangeEvent<HTMLTextAreaElement>
                    ) => {
                      mergeState({ inputQuestion: event.target.value });
                      runAfterUpdate(autoResizeTextarea);
                    }}
                  />
                  {state.aiService === CLAUDE_CODE_PLUGIN_KEY &&
                  (state.isWaiting || state.answer) ? (
                    <div
                      className="popup-assistant-send-button"
                      onClick={handleStopAnswer}
                    >
                      {t("Stop")}
                    </div>
                  ) : (
                    <div
                      className="popup-assistant-send-button"
                      onClick={handleSendQuestion}
                    >
                      {t("Send")}
                    </div>
                  )}
                </div>
                {state.aiService === CLAUDE_CODE_PLUGIN_KEY && state.usage && (
                  <div className="popup-assist-usage">{state.usage}</div>
                )}
              </div>
            </div>
          </>
        )}
      </div>
  );
};
export default PopupAssist;
