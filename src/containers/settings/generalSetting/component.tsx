import { useTranslation } from "react-i18next";
import { useState } from "react";
import { Trans } from "react-i18next";
import { changeLanguage as changeI18nLanguage } from "../../../i18n";
import { isElectron } from "react-device-detect";
import { generalSettingList, langList } from "../../../constants/settingList";

import toast from "react-hot-toast";
import { ConfigService } from "../../../assets/lib/kookit-extra-browser.min";
import SwitchRow from "../../../components/readerSettings/switchRow";

export interface SettingInfoState {
  isPreventSleep: boolean;
  isAlwaysOnTop: boolean;
  isAutoMaximizeWin: boolean;
}

declare var window: any;
const GeneralSetting = () => {
  const { t } = useTranslation();
  const [state, setState] = useState<Record<string, any>>({
    isPreventSleep: ConfigService.getReaderConfig("isPreventSleep") === "yes",
    isAlwaysOnTop: ConfigService.getReaderConfig("isAlwaysOnTop") === "yes",
    isAutoMaximizeWin:
      ConfigService.getReaderConfig("isAutoMaximizeWin") === "yes",
  });

  const handleRest = (_bool: boolean) => {
    toast.success(t("Change successful"));
  };
  const changeLanguage = (lng: string) => {
    changeI18nLanguage(lng);
    ConfigService.setReaderConfig("lang", lng);
  };
  const handleSetting = (stateName: string) => {
    setState((prev) => ({ ...prev, [stateName]: !prev[stateName] }));
    ConfigService.setReaderConfig(
      stateName,
      state[stateName] ? "no" : "yes"
    );
    handleRest(state[stateName]);
  };

  const handleAlwaysOnTop = () => {
    const ipcRenderer = window.electronAPI;
    ipcRenderer.invoke("set-always-on-top", {
      isAlwaysOnTop: state.isAlwaysOnTop ? "no" : "yes",
    });
    handleSetting("isAlwaysOnTop");
  };
  const handleMaximizeWin = () => {
    const ipcRenderer = window.electronAPI;
    ipcRenderer.invoke("set-auto-maximize", {
      isAutoMaximizeWin: state.isAutoMaximizeWin ? "no" : "yes",
    });
    handleSetting("isAutoMaximizeWin");
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
            onClick={() => {
              switch (item.propName) {
                case "isAlwaysOnTop":
                  handleAlwaysOnTop();
                  break;
                case "isAutoMaximizeWin":
                  handleMaximizeWin();
                  break;
                default:
                  handleSetting(item.propName);
                  break;
              }
            }}
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
        {renderSwitchOption(generalSettingList)}

        <div className="setting-dialog-new-title">
          <Trans>Language</Trans>
          <select
            name=""
            className="lang-setting-dropdown"
            value={ConfigService.getReaderConfig("lang") || "en"}
            onChange={(event) => {
              changeLanguage(event.target.value);
            }}
          >
            {langList.map((item) => (
              <option
                value={item.value}
                key={item.value}
                className="lang-setting-option"
              >
                {item.label}
              </option>
            ))}
          </select>
        </div>
      </>
  );
};

export default GeneralSetting;
