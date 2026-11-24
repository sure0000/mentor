import { useTranslation } from "react-i18next";
import { useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import { ConfigService } from "../../../assets/lib/kookit-extra-browser.min";
import { fullTranslationLangList } from "../../../constants/dropdownList";
import { isAiAvailable } from "../../../utils/aiReading/aiGateway";
import { isReadingRawPDF } from "../../../utils/common";
import SwitchRow from "../../readerSettings/switchRow";
import "../../readerSettings/modeControl/modeControl.css";
import "./studyLangDialog.css";
import { useAppStore } from "../../../store/useAppStore";
import {
  cancelTranslationJob,
  getTranslationJob,
  getTranslationUnit,
  subscribeTranslationJob,
  translateCurrentChapter,
  translateWholeBook,
  TranslationJob,
} from "../../../utils/reader/fullTranslation";
import {
  getPdfTranslationView,
  isPdfTranslationEnabled,
  notifyTranslationTargetChange,
  PdfTranslationView,
  setPdfTranslation,
} from "../../../utils/reader/pdfOverlayTranslation";

interface SegmentOption {
  value: string;
  label: string;
  hint: string;
}

/** 分段选择器：选项少且互斥时比下拉框直观，每个选项下方给一句说明 */
const Segmented = ({
  options,
  value,
  onChange,
}: {
  options: SegmentOption[];
  value: string;
  onChange: (value: string) => void;
}) => {
  const { t } = useTranslation();
  const current = options.find((o) => o.value === value) || options[0];
  return (
    <>
      <div className="panel-segmented study-lang-segmented">
        {options.map((o) => (
          <div
            key={o.value}
            className={"panel-segmented-item" + (o.value === current.value ? " active" : "")}
            onClick={() => o.value !== current.value && onChange(o.value)}
          >
            {t(o.label)}
          </div>
        ))}
      </div>
      <div className="study-lang-hint">{t(current.hint)}</div>
    </>
  );
};

const isTextBookEnabled = (bookKey?: string) =>
  !!bookKey &&
  ConfigService.getAllListConfig("fullTranslationBooks").includes(bookKey) &&
  ["both", "target"].includes(ConfigService.getReaderConfig("fullTranslationMode"));

const getTextBookMode = () =>
  ConfigService.getReaderConfig("fullTranslationMode") === "target" ? "target" : "both";

/**
 * 翻译设置：EPUB 等可重排书与 PDF 共用一套布局
 * 1. 开关：本书是否翻译
 * 2. 显示方式：可重排书为「双语对照 / 仅译文」，PDF 为「覆盖原文 / 侧边对照」
 * 3. 翻译单位（仅可重排书）、目标语言
 * 4. 提前翻译（仅可重排书）
 */
const StudyLangDialog = () => {
  const currentBook = useAppStore((s) => s.book.currentBook);
  const renderBookFunc = useAppStore((s) => s.book.renderBookFunc);
  const handleStudyLangDialog = useAppStore((s) => s.handleStudyLangDialog);
  const handleSetting = useAppStore((s) => s.handleSetting);
  const handleSettingMode = useAppStore((s) => s.handleSettingMode);
  const { t } = useTranslation();
  const isPDF = !!currentBook && isReadingRawPDF(currentBook);

  const readEnabled = () =>
    isPDF ? isPdfTranslationEnabled(currentBook?.key) : isTextBookEnabled(currentBook?.key);
  const readView = () => (isPDF ? getPdfTranslationView() : getTextBookMode());

  const [enabled, setEnabled] = useState(readEnabled);
  const [view, setView] = useState<string>(readView);
  const [unit, setUnit] = useState<string>(getTranslationUnit());
  const [target, setTarget] = useState(
    ConfigService.getReaderConfig("fullTranslationTarget") ||
      ConfigService.getReaderConfig("lang") ||
      "zhCN"
  );
  const [job, setJob] = useState<TranslationJob | null>(getTranslationJob());
  useEffect(() => subscribeTranslationJob(setJob), []);

  // 切换书籍后（同一窗口多标签）重新读取本书设置
  const prevBookKeyRef = useRef(currentBook?.key);
  useEffect(() => {
    if (currentBook?.key !== prevBookKeyRef.current) {
      setEnabled(readEnabled());
      setView(readView());
    }
    prevBookKeyRef.current = currentBook?.key;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentBook?.key]);

  const ensureAi = () => {
    if (isAiAvailable("translate")) return true;
    toast(t("No AI service configured. Please add one in Settings > AI service"));
    handleSetting(true);
    handleSettingMode("ai");
    return false;
  };

  /** 可重排书：开关与显示方式都落到原有的 fullTranslationBooks / fullTranslationMode 配置 */
  const applyTextBook = (nextEnabled: boolean, nextMode: string) => {
    if (nextEnabled) {
      ConfigService.setListConfig(currentBook.key, "fullTranslationBooks");
      ConfigService.setReaderConfig("fullTranslationMode", nextMode);
    } else {
      cancelTranslationJob();
      ConfigService.deleteListConfig(currentBook.key, "fullTranslationBooks");
      ConfigService.setReaderConfig("fullTranslationMode", "no");
    }
    renderBookFunc();
  };

  const handleToggle = () => {
    const next = !enabled;
    if (next && !ensureAi()) return;
    setEnabled(next);
    if (isPDF) setPdfTranslation(currentBook, { enabled: next });
    else applyTextBook(next, view);
  };

  const handleViewChange = (value: string) => {
    setView(value);
    if (isPDF) setPdfTranslation(currentBook, { view: value as PdfTranslationView });
    else applyTextBook(true, value);
  };

  const handleUnitChange = (value: string) => {
    setUnit(value);
    cancelTranslationJob();
    ConfigService.setReaderConfig("fullTranslationUnit", value);
    renderBookFunc();
  };

  const handleTargetChange = (value: string) => {
    setTarget(value);
    ConfigService.setReaderConfig("fullTranslationTarget", value);
    if (isPDF) notifyTranslationTargetChange();
    else renderBookFunc();
  };

  const bookJob = job && job.bookKey === currentBook?.key ? job : null;
  const isRunning = bookJob?.status === "running";

  const startJob = async (scope: "chapter" | "book") => {
    const started =
      scope === "chapter" ? await translateCurrentChapter() : await translateWholeBook();
    if (!started) toast.error(t("Translation failed"));
  };

  const renderJobRow = () => (
    <div className="study-lang-section">
      <div className="study-lang-label">{t("Translate ahead")}</div>
      {isRunning ? (
        <div className="study-lang-job-progress">
          <div className="study-lang-job-bar">
            <div
              className="study-lang-job-bar-inner"
              style={{
                width: bookJob!.total
                  ? `${Math.round((bookJob!.done / bookJob!.total) * 100)}%`
                  : "0%",
              }}
            />
          </div>
          <span className="study-lang-job-text">
            {bookJob!.total ? `${bookJob!.done}/${bookJob!.total}` : "…"}
          </span>
          <span className="study-lang-job-button" onClick={() => cancelTranslationJob()}>
            {t("Stop")}
          </span>
        </div>
      ) : (
        <div className="study-lang-job-actions">
          <span className="study-lang-job-button" onClick={() => startJob("chapter")}>
            {t("Translate this chapter")}
          </span>
          <span className="study-lang-job-button" onClick={() => startJob("book")}>
            {t("Translate whole book")}
          </span>
        </div>
      )}
      <div className="study-lang-hint">
        {bookJob?.status === "done" && !isRunning
          ? t("Translation completed")
          : t("Pages are translated as you read. Translate ahead to avoid waiting.")}
      </div>
    </div>
  );

  const viewOptions: SegmentOption[] = isPDF
    ? [
        { value: "overlay", label: "Overlay original", hint: "Translation replaces the original text on the page" },
        { value: "side", label: "Side by side", hint: "Original and translation shown paragraph by paragraph in a side panel" },
      ]
    : [
        { value: "both", label: "Bilingual", hint: "Translation shown below each original paragraph" },
        { value: "target", label: "Translation only", hint: "Only the translation is shown" },
      ];
  const unitOptions: SegmentOption[] = [
    { value: "paragraph", label: "Paragraph", hint: "One translation per paragraph, more fluent" },
    { value: "sentence", label: "Sentence", hint: "Long paragraphs split into sentences, easier to compare" },
  ];

  return (
    <div
      className="sort-dialog-container scale-page-dialog-container study-lang-dialog-container"
      onMouseLeave={() => handleStudyLangDialog(false)}
      onMouseEnter={() => handleStudyLangDialog(true)}
      style={{ top: "50px", width: "300px", overflowY: "auto", maxHeight: "calc(100vh - 80px)" }}
    >
      <SwitchRow
        title={t("Translate this book")}
        isEnabled={enabled}
        onClick={handleToggle}
        style={{ marginTop: 0, paddingTop: 0 }}
      />
      {enabled ? (
        <>
          <div className="study-lang-section">
            <div className="study-lang-label">{t("Display")}</div>
            <Segmented options={viewOptions} value={view} onChange={handleViewChange} />
          </div>
          {!isPDF && (
            <div className="study-lang-section">
              <div className="study-lang-label">{t("Translate by")}</div>
              <Segmented options={unitOptions} value={unit} onChange={handleUnitChange} />
            </div>
          )}
          <div className="study-lang-section study-lang-row">
            <span className="study-lang-label">{t("Target translation language")}</span>
            <select
              className="lang-setting-dropdown"
              value={target}
              onChange={(event) => handleTargetChange(event.target.value)}
            >
              {fullTranslationLangList.map((option) => (
                <option key={option.code} value={option.code} className="lang-setting-option">
                  {t(option.label)}
                </option>
              ))}
            </select>
          </div>
          {!isPDF && renderJobRow()}
        </>
      ) : (
        <div className="study-lang-hint study-lang-off-hint">
          {isPDF
            ? t("Translate the visible pages with AI, shown on the page or in a side panel")
            : t("Translate the book with AI as you read, shown below each paragraph")}
        </div>
      )}
    </div>
  );
};

export default StudyLangDialog;
