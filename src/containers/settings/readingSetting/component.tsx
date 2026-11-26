import { useTranslation } from "react-i18next";
import { useState } from "react";
import { Trans } from "react-i18next";
import { isElectron } from "react-device-detect";
import toast from "react-hot-toast";
import { ConfigService } from "../../../assets/lib/kookit-extra-browser.min";
import { readingSettingList } from "../../../constants/settingList";
import SwitchRow from "../../../components/readerSettings/switchRow";
import { isPaginatedBook } from "../../../utils/common";
import { useAppStore } from "../../../store/useAppStore";
import "./readingSetting.css";

export interface SettingInfoState {
  isOpenBook: boolean;
  isDisablePopup: boolean;
  isDisableAutoScroll: boolean;
  isManualScroll: boolean;

  isOpenInMain: boolean;

  isOverwriteLink: boolean;
  isOverwriteText: boolean;
  isOverwriteBackground: boolean;
  isAutoFullscreen: boolean;
  isAutoMaximize: boolean;
}

declare var window: any;

// 微信读书式三种翻页方式；PDF 等固定版式书使用自己的 pdfReaderMode，不受这里影响
const readingModeOptions = [
  { mode: "scroll", title: "Scroll" },
  { mode: "single", title: "Single page" },
  { mode: "double", title: "Double page" },
];

const ReadingSetting = () => {
  const { t } = useTranslation();
  const [state, setState] = useState<Record<string, boolean>>({
    isAutoFullscreen:
      ConfigService.getReaderConfig("isAutoFullscreen") === "yes",
    isAutoMaximize: ConfigService.getReaderConfig("isAutoMaximize") === "yes",
    isOpenBook: ConfigService.getReaderConfig("isOpenBook") === "yes",
    isDisablePopup: ConfigService.getReaderConfig("isDisablePopup") === "yes",
    isManualScroll: ConfigService.getReaderConfig("isManualScroll") === "yes",
    isDisableAutoScroll:
      ConfigService.getReaderConfig("isDisableAutoScroll") === "yes",
    isOpenInMain: ConfigService.getReaderConfig("isOpenInMain") === "yes",
    isOverwriteText:
      ConfigService.getReaderConfig("isOverwriteText") === "yes",
    isOverwriteLink:
      ConfigService.getReaderConfig("isOverwriteLink") === "yes",
    isOverwriteBackground:
      ConfigService.getReaderConfig("isOverwriteBackground") === "yes",
  });

  const currentBook = useAppStore((s) => s.book.currentBook);
  const [readerMode, setReaderMode] = useState(
    ConfigService.getReaderConfig("readerMode") || "scroll"
  );

  const handleChangeReadingMode = (mode: string) => {
    if (mode === readerMode) return;
    ConfigService.setReaderConfig("readerMode", mode);
    setReaderMode(mode);
    // 阅读器里正打开着可重排书籍时立刻换版式，不必重开书
    if (currentBook?.key && !isPaginatedBook(currentBook)) {
      useAppStore.getState().handleReaderMode(mode);
      useAppStore.getState().book.renderBookFunc();
    }
    toast.success(t("Change successful"));
  };

  const handleRest = (_bool: boolean) => {
    toast.success(t("Change successful"));
  };

  const handleToggleSetting = (stateName: string) => {
    setState((prev) => ({ ...prev, [stateName]: !prev[stateName] }));
    ConfigService.setReaderConfig(stateName, state[stateName] ? "no" : "yes");
    handleRest(state[stateName]);
  };

  const renderSwitchOption = (optionList: any[]) => {
    return optionList.map((item) => {
      return (
        <div
          style={item.isElectron ? (isElectron ? {} : { display: "none" }) : {}}
          key={item.propName}
        >
          <SwitchRow
            variant="setting"
            title={<Trans>{item.title}</Trans>}
            isEnabled={state[item.propName]}
            onClick={() => handleToggleSetting(item.propName)}
          />
          <p className="setting-option-subtitle">
            <Trans>{item.desc}</Trans>
          </p>
        </div>
      );
    });
  };

  return (
    <>
      <div className="reading-mode-section">
        <div className="reading-mode-title">
          <Trans>Reading mode</Trans>
        </div>
        <div className="reading-mode-segmented">
          {readingModeOptions.map((item) => (
            <div
              key={item.mode}
              className={
                "reading-mode-item" +
                (readerMode === item.mode ? " active" : "")
              }
              onClick={() => handleChangeReadingMode(item.mode)}
            >
              <Trans>{item.title}</Trans>
            </div>
          ))}
        </div>
        <div className="reading-mode-desc">
          <Trans>
            Applies to all reflowable books; PDF keeps its own page mode
          </Trans>
        </div>
      </div>
      {renderSwitchOption(readingSettingList)}
    </>
  );
};

export default ReadingSetting;
