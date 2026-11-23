import { useLatest } from "../../../utils/hooks/useLatest";
import { useTranslation } from "react-i18next";
import React, { useEffect, useRef, useState } from "react";
import "./popupAssist.css";
import { ConfigService } from "../../../assets/lib/kookit-extra-browser.min";
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
import { aiStreamText, getPrompt } from "../../../utils/aiReading/aiGateway";
import { fillPrompt } from "../../../utils/aiReading/prompts";
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
  service === "custom-ai-assistant-plugin";

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
  const cancelAnswer = useRef<(() => void) | null>(null);
  const isMounted = useRef(true);
  const chatBoxRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  /** 本次提问携带的引用（发送时从 quote 取出并清空输入区的引用） */
  const pendingQuote = useRef("");
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
  // 划线引用保存在 store（reader.quoteText）里，不放组件 state：
  // 侧边栏停靠后会触发整本书重新渲染，期间 PopupBox / PopupAssist 会卸载再挂载，组件 state 会丢
  const quote = quoteText.trim();
  useEffect(() => {
    if (quote) runAfterUpdate(() => textareaRef.current?.focus());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quote]);

  // componentDidMount: 加载历史、初始化 AI 服务
  useEffect(() => {
    loadChatHistory();
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
      // 关闭面板时结束正在进行的请求（FR-AI-05）
      cancelAnswer.current?.();
      cancelAnswer.current = null;
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
    const maxLines = 10;
    const maxHeight = lineHeight * maxLines + paddingTop + paddingBottom;
    // 先重置为最小高度，让 scrollHeight 反映真实内容高度
    el.style.height = "0px";
    const contentHeight = el.scrollHeight;
    const minHeight = lineHeight * 3 + paddingTop + paddingBottom;
    if (contentHeight < minHeight) {
      el.style.height = minHeight + "px";
      el.style.overflowY = "hidden";
    } else if (contentHeight >= maxHeight) {
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
    // 有引用时以引用原文为上下文（全书问答里作为「选中文字」）
    let answerText = (pendingQuote.current || originalText)
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
      if (isElectron && isBookQaService(service)) {
        await handleBookQaAnswer(text);
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
        const systemPrompt = fillPrompt(getPrompt("aiAssistance"), { text });
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
          systemPrompt + "\n\n读者的问题：" + currentQuestion,
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
    const started = Date.now();
    const handle = aiStreamText({
      system: qa.system,
      prompt: qa.prompt,
      onText,
    });
    cancelAnswer.current = handle.cancel;
    try {
      await handle.done;
    } catch (e) {
      ok = false;
      errorText = t("Error happened");
    }
    cancelAnswer.current = null;
    let usage = `${((Date.now() - started) / 1000).toFixed(1)}s`;
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
    cancelAnswer.current?.();
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
  const handleRenderHistoryMessage = (message: AiChatMessage[]) => {
    return message.map((item, index) =>
      item.role === "user" ? (
        <div key={index} className="ai-chat-row ai-chat-row-user">
          <div className="ai-chat-bubble">
            {Parser(DOMPurify.sanitize(marked.parse(item.content) as string) || " ")}
          </div>
        </div>
      ) : (
        <div key={index} className="ai-chat-row ai-chat-row-ai">
          <div className="ai-chat-answer">
            {item.sources ? (
              <QaAnswer content={item.content} sources={item.sources} />
            ) : (
              Parser(DOMPurify.sanitize(marked.parse(item.content) as string) || " ")
            )}
          </div>
          <div className="ai-chat-actions">
            <span
              className="ai-chat-action"
              onClick={() => handleCopyAnswer(plainAnswer(item.content))}
            >
              <span className="icon-copy-line"></span>
              {t("Copy")}
            </span>
          </div>
          {index === message.length - 1 && (
            <div className="ai-chat-disclaimer">
              {t(
                "AI-generated content is for reference only. Please verify carefully as it does not constitute professional advice."
              )}
            </div>
          )}
        </div>
      )
    );
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
    const question = inputQuestion.trim() || (quote ? t("Explain this passage") : "");
    if (!question) return;
    handleNewQuestion(question);
    mergeState({ inputQuestion: "" });
    runAfterUpdate(autoResizeTextarea);
  };
  const handleNewQuestion = (question: string) => {
    pendingQuote.current = quote;
    // 引用以 Markdown 引用块显示在提问气泡里，并随提问进入对话历史
    const content = quote
      ? quote
          .split(/\n+/)
          .map((line) => "> " + line)
          .join("\n") +
        "\n\n" +
        t(question)
      : t(question);
    if (quote) handleQuoteText("");
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
  const assistantPlugins = plugins.filter((item) => item.type === "assistant");
  const isQa = isElectron && isBookQaService(state.aiService);
  const isAnswering = state.isWaiting || !!state.answer;
  const hasMessages = state.askHistory.length > 0 || isAnswering;

  return (
    <div className={"ai-chat" + (props.isDockedRight ? " ai-chat-docked" : "")}>
      <div className="ai-chat-header">
        <div className="ai-chat-title">
          <span className="ai-chat-title-text">{t("Reading Assistant")}</span>
          {currentBook?.name && (
            <span className="ai-chat-subtitle">《{currentBook.name}》</span>
          )}
        </div>
        <div className="ai-chat-tools">
          <span
            className="ai-chat-tool"
            data-tooltip-id="my-tooltip"
            data-tooltip-content={t("Export chat history")}
            onClick={handleExportChatHistory}
          >
            <span className="icon-share"></span>
          </span>
          <span
            className="ai-chat-tool"
            data-tooltip-id="my-tooltip"
            data-tooltip-content={t("Clear chat history")}
            onClick={handleDeleteChatHistory}
          >
            <span className="icon-trash-line"></span>
          </span>
        </div>
      </div>

      <div className="ai-chat-meta">
        <select
          className="ai-chat-service"
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
          <option value={""}>{t("Please select")}</option>
          {assistantPlugins.map((item) => (
            <option value={item.key} key={item.key}>
              {t(item.displayName)}
            </option>
          ))}
          <option value={"add-new"}>{t("Add new plugin")}</option>
        </select>
        {isQa && (
          <label
            className="ai-chat-spoiler"
            title={t("Spoiler-safe (only use text before my position)")}
          >
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
            />
            {t("Spoiler-safe")}
          </label>
        )}
      </div>

      {state.isAddNew ? (
        <div className="ai-chat-empty">
          <div className="ai-chat-empty-text">
            {t("No AI service configured. Please add one in Settings > AI service")}
          </div>
          <span
            className="ai-chat-primary"
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
      ) : (
        <>
          <div className="ai-chat-messages" ref={chatBoxRef}>
            {!hasMessages && (
              <div className="ai-chat-welcome">
                <div className="ai-chat-welcome-title">
                  {t("Hi there! What questions do you have about this chapter?")}
                </div>
                {isQa && (
                  <div className="ai-chat-welcome-hint">
                    {hasBookIndex
                      ? t("Answers draw on the whole book")
                      : t("Open Reading Companion once to enable whole-book answers")}
                  </div>
                )}
                <div className="ai-chat-suggestions">
                  {sampleQuestion
                    .filter((item) => item.mode === "ask")
                    .map((item) => (
                      <div
                        key={item.question}
                        className="ai-chat-suggestion"
                        onClick={() => handleNewQuestion(item.question)}
                      >
                        <span>{t(item.question)}</span>
                        <span className="ai-chat-suggestion-arrow">›</span>
                      </div>
                    ))}
                </div>
              </div>
            )}
            {handleRenderHistoryMessage(state.askHistory)}
            {state.isWaiting ? (
              <div className="ai-chat-row ai-chat-row-ai">
                <div className="ai-chat-thinking">
                  <span className="ai-chat-dot"></span>
                  <span className="ai-chat-dot"></span>
                  <span className="ai-chat-dot"></span>
                  <span>{t("Thinking, please wait...")}</span>
                </div>
              </div>
            ) : state.answer ? (
              <div className="ai-chat-row ai-chat-row-ai">
                <div className="ai-chat-answer">
                  {Parser(
                    DOMPurify.sanitize(
                      marked.parse(
                        plainAnswer(stripRefMarkers(visibleWhileStreaming(state.answer)))
                      ) as string
                    ) || " "
                  )}
                </div>
              </div>
            ) : null}
          </div>

          <div className="ai-chat-footer">
            {hasMessages && !isAnswering && (
              <div className="ai-chat-quick">
                {sampleQuestion
                  .filter((item) => item.mode === "ask")
                  .map((item) => (
                    <span
                      key={item.question}
                      className="ai-chat-chip"
                      onClick={() => handleNewQuestion(item.question)}
                    >
                      {t(item.question)}
                    </span>
                  ))}
              </div>
            )}
            <div className="popup-assist-composer">
              {quote && (
                <div className="popup-assist-quote">
                  <span className="popup-assist-quote-text">{quote}</span>
                  <span
                    className="icon-close popup-assist-quote-remove"
                    title={t("Remove quote")}
                    onClick={() => handleQuoteText("")}
                  ></span>
                </div>
              )}
              <textarea
                ref={textareaRef}
                name="url"
                placeholder={
                  quote
                    ? t("Ask about the quoted passage")
                    : t("Ask anything about this chapter")
                }
                id="trans-add-content-box"
                className="popup-assist-input"
                rows={3}
                onKeyDown={(event: React.KeyboardEvent<HTMLTextAreaElement>) => {
                  // Enter 发送，Shift+Enter 换行；输入法组字时不发送
                  if (
                    event.key === "Enter" &&
                    !event.shiftKey &&
                    !(event.nativeEvent as KeyboardEvent).isComposing
                  ) {
                    event.preventDefault();
                    handleSendQuestion();
                  }
                }}
                onContextMenu={() => {
                  handleContextMenu("trans-add-content-box");
                }}
                value={state.inputQuestion}
                onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) => {
                  mergeState({ inputQuestion: event.target.value });
                  runAfterUpdate(autoResizeTextarea);
                }}
              />
              <div className="popup-assist-composer-bar">
                <span className="popup-assist-composer-hint">
                  {isQa && state.usage
                    ? state.usage
                    : t("Enter to send, Shift+Enter for a new line")}
                </span>
                {isQa && isAnswering ? (
                  <div
                    className="popup-assistant-send-button popup-assistant-stop"
                    onClick={handleStopAnswer}
                  >
                    {t("Stop")}
                  </div>
                ) : (
                  <div
                    className={
                      "popup-assistant-send-button" +
                      (state.inputQuestion.trim() || quote
                        ? ""
                        : " popup-assistant-send-disabled")
                    }
                    onClick={handleSendQuestion}
                  >
                    {t("Send")}
                  </div>
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
};
export default PopupAssist;
