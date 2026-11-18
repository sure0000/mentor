import { useTranslation } from "react-i18next";
import { useState } from "react";
import { Trans } from "react-i18next";
import { isElectron } from "react-device-detect";
import toast from "react-hot-toast";
import { ConfigService } from "../../../assets/lib/kookit-extra-browser.min";
import { readingSettingList } from "../../../constants/settingList";
import SwitchRow from "../../../components/readerSettings/switchRow";

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

  return <>{renderSwitchOption(readingSettingList)}</>;
};

export default ReadingSetting;
