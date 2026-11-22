import { useLatest } from "../../../utils/hooks/useLatest";
import { useTranslation } from "react-i18next";
import { useEffect, useRef, useState } from "react";
import { Trans } from "react-i18next";
import toast from "react-hot-toast";
import { ConfigService } from "../../../assets/lib/kookit-extra-browser.min";
import {
  dropdownList,
  fullTranslationLangList,
} from "../../../constants/dropdownList";
import { isAiAvailable } from "../../../utils/aiReading/aiGateway";
import "./studyLangDialog.css";
import { useAppStore } from "../../../store/useAppStore";
import {
  cancelTranslationJob,
  getTranslationJob,
  subscribeTranslationJob,
  translateCurrentChapter,
  translateWholeBook,
  TranslationJob,
} from "../../../utils/reader/fullTranslation";

export interface StudyLangDialogState {
  fullTranslationModeValue: string;
  fullTranslationTargetValue: string;
}

const StudyLangDialog = () => {
  const currentBook = useAppStore((s) => s.book.currentBook);
  const renderBookFunc = useAppStore((s) => s.book.renderBookFunc);
  const handleStudyLangDialog = useAppStore((s) => s.handleStudyLangDialog);
  const handleSetting = useAppStore((s) => s.handleSetting);
  const handleSettingMode = useAppStore((s) => s.handleSettingMode);
  const { t } = useTranslation();
  const [state, setState] = useState<StudyLangDialogState>({
    fullTranslationModeValue: ConfigService.getAllListConfig(
      "fullTranslationBooks"
    ).includes(currentBook?.key)
      ? ConfigService.getReaderConfig("fullTranslationMode") || ""
      : "",
    fullTranslationTargetValue:
      ConfigService.getReaderConfig("fullTranslationTarget") ||
      ConfigService.getReaderConfig("lang") ||
      "zhCN",
  });
  const stateRef = useLatest(state);
  const [job, setJob] = useState<TranslationJob | null>(getTranslationJob());
  useEffect(() => subscribeTranslationJob(setJob), []);
  const prevBookKeyRef = useRef(currentBook?.key);

  const mergeState = (patch: Partial<StudyLangDialogState>) => {
    stateRef.current = { ...stateRef.current, ...patch };
    setState(stateRef.current);
  };

  useEffect(() => {
    if (currentBook?.key !== prevBookKeyRef.current) {
      mergeState({
        fullTranslationModeValue: ConfigService.getAllListConfig(
          "fullTranslationBooks"
        ).includes(currentBook?.key)
          ? ConfigService.getReaderConfig("fullTranslationMode") || ""
          : "",
      });
    }
    prevBookKeyRef.current = currentBook?.key;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentBook?.key]);

  const handleFullTranslationChange = (value: string) => {
    mergeState({ fullTranslationModeValue: value });
    if (value === "no" || value === "") {
      cancelTranslationJob();
      ConfigService.deleteListConfig(
        currentBook.key,
        "fullTranslationBooks"
      );
      ConfigService.setReaderConfig("fullTranslationMode", "no");
    } else {
      if (!isAiAvailable("translate")) {
        mergeState({ fullTranslationModeValue: "no" });
        toast(
          t("No AI service configured. Please add one in Settings > AI service")
        );
        handleSetting(true);
        handleSettingMode("ai");
        ConfigService.setReaderConfig("fullTranslationMode", "no");
        return;
      }
      ConfigService.setListConfig(
        currentBook.key,
        "fullTranslationBooks"
      );
      ConfigService.setReaderConfig("fullTranslationMode", value);
    }
    toast.success(t("Setup successful"));
    renderBookFunc();
  };

  const bookJob = job && job.bookKey === currentBook?.key ? job : null;
  const isRunning = bookJob?.status === "running";

  const startJob = async (scope: "chapter" | "book") => {
    toast(t("Translating in the background"));
    const started =
      scope === "chapter"
        ? await translateCurrentChapter()
        : await translateWholeBook();
    if (!started) toast.error(t("Translation failed"));
  };

  const renderJobRow = () => (
    <div className="study-lang-job">
      <div className="study-lang-job-hint">
        <Trans>
          Pages are translated automatically as you read. You can also
          translate ahead:
        </Trans>
      </div>
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
            {bookJob!.scope === "book" ? t("Whole book") : t("Current chapter")}
            {bookJob!.total ? ` ${bookJob!.done}/${bookJob!.total}` : " …"}
          </span>
          <span
            className="study-lang-job-button"
            onClick={() => cancelTranslationJob()}
          >
            <Trans>Stop</Trans>
          </span>
        </div>
      ) : (
        <div className="study-lang-job-actions">
          <span
            className="study-lang-job-button"
            onClick={() => startJob("chapter")}
          >
            <Trans>Translate this chapter</Trans>
          </span>
          <span
            className="study-lang-job-button"
            onClick={() => startJob("book")}
          >
            <Trans>Translate whole book</Trans>
          </span>
        </div>
      )}
      {bookJob?.status === "done" && !isRunning && (
        <div className="study-lang-job-hint">
          <Trans>Translation completed</Trans>
        </div>
      )}
    </div>
  );

  const fullTranslationItem = dropdownList.find(
    (item) => item.value === "fullTranslationMode"
  );
  const fullTranslationOptions = fullTranslationItem?.option || [
    { label: "Disable", value: "no" },
    { label: "Bilingual translation", value: "both" },
    { label: "Only translation", value: "target" },
  ];
  return (
    <div
      className="sort-dialog-container scale-page-dialog-container study-lang-dialog-container"
      onMouseLeave={() => {
        handleStudyLangDialog(false);
      }}
      onMouseEnter={() => {
        handleStudyLangDialog(true);
      }}
      style={{
        top: "50px",
        width: "280px",
        overflowY: "auto",
        maxHeight: "calc(100vh - 80px)",
      }}
    >
      <ul className="sort-by-category">
        <div className="setting-dialog-new-title scale-page-preset-row">
          <span>
            <Trans>Full text translation</Trans>
          </span>
          <select
            className="lang-setting-dropdown"
            value={state.fullTranslationModeValue}
            onChange={(event) => {
              handleFullTranslationChange(event.target.value);
            }}
          >
            {fullTranslationOptions.map((option) => (
              <option
                key={option.value}
                value={option.value}
                className="lang-setting-option"
              >
                {t(option.label)}
              </option>
            ))}
          </select>
        </div>
        {(state.fullTranslationModeValue === "both" ||
          state.fullTranslationModeValue === "target") && (
          <div className="setting-dialog-new-title scale-page-preset-row">
            <span style={{ maxWidth: "120px" }}>
              <Trans>Target translation language</Trans>
            </span>
            <select
              className="lang-setting-dropdown"
              value={
                fullTranslationLangList.find(
                  (option) => option.code === state.fullTranslationTargetValue
                )?.code || state.fullTranslationTargetValue
              }
              onChange={(event) => {
                const value = event.target.value;
                mergeState({ fullTranslationTargetValue: value });
                ConfigService.setReaderConfig("fullTranslationTarget", value);
                toast(t("Change successful"));
                renderBookFunc();
              }}
            >
              {fullTranslationLangList.map((option) => (
                <option
                  key={option.code}
                  value={option.code}
                  className="lang-setting-option"
                >
                  {t(option.label)}
                </option>
              ))}
            </select>
          </div>
        )}
        {(state.fullTranslationModeValue === "both" ||
          state.fullTranslationModeValue === "target") &&
          renderJobRow()}
      </ul>
    </div>
  );
};

export default StudyLangDialog;
