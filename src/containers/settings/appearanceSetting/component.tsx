import { useTranslation } from "react-i18next";
import { useEffect, useReducer, useState } from "react";
import { Trans } from "react-i18next";
import { isElectron } from "react-device-detect";
import toast from "react-hot-toast";
import { ConfigService } from "../../../assets/lib/kookit-extra-browser.min";
import {
  appearanceSettingList,
  skinList,
} from "../../../constants/settingList";
import { themeList } from "../../../constants/themeList";
import { HexColorPicker } from "react-colorful";
import { reloadManager, parseColorInput } from "../../../utils/common";
import SwitchRow from "../../../components/readerSettings/switchRow";
import FontUtil from "../../../utils/file/fontUtil";
import {
  applyCustomSystemFont,
  syncNativeThemeSource,
} from "../../../utils/reader/launchUtil";

export interface SettingInfoState {
  currentThemeIndex: number;
  isShowCustomColorPicker: boolean;
  customColor: string;
  pendingCustomColor: string;
  fontListVersion: number;
  fontOptions: { label: string; value: string }[];
  isDisablePDFCover: boolean;
  isDisableCrop: boolean;
}

const AppearanceSetting = () => {
  const { t } = useTranslation();
  const [state, setState] = useState<SettingInfoState>(() => {
    return {
      currentThemeIndex: themeList.findIndex(
        (item) =>
          item.color ===
          (ConfigService.getReaderConfig("themeColor") || "default")
      ),
      isShowCustomColorPicker: false,
      customColor: ConfigService.getReaderConfig("themeColor") || "#0179CA",
      pendingCustomColor:
        ConfigService.getReaderConfig("themeColor") || "#0179CA",
      fontListVersion: 0,
      fontOptions: [] as { label: string; value: string }[],
      isDisablePDFCover:
        ConfigService.getReaderConfig("isDisablePDFCover") === "yes",
      isDisableCrop: ConfigService.getReaderConfig("isDisableCrop") === "yes",
    };
  });

  const [, forceUpdate] = useReducer((x: number) => x + 1, 0);

  const loadFont = async () => {
    const options = await FontUtil.getMergedFontOptions();
    setState((prevState) => ({
      ...prevState,
      fontOptions: options,
      fontListVersion: prevState.fontListVersion + 1,
    }));
  };

  useEffect(() => {
    loadFont();
    window.addEventListener("font-list-changed", loadFont);
    return () => {
      window.removeEventListener("font-list-changed", loadFont);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleRest = (_bool: boolean) => {
    toast.success(t("Change successful"));
  };

  const handleSetting = (stateName: string) => {
    const nextValue = !(state as any)[stateName];
    setState((prevState) => ({ ...prevState, [stateName]: nextValue } as any));
    ConfigService.setReaderConfig(stateName, nextValue ? "yes" : "no");
    handleRest(nextValue);
  };

  const changeSkin = (skin: string) => {
    ConfigService.setReaderConfig("appSkin", skin);
    syncNativeThemeSource(skin);

    if (
      skin === "night" ||
      (ConfigService.getReaderConfig("appSkin") === "system" &&
        ConfigService.getReaderConfig("isOSNight") === "yes")
    ) {
      ConfigService.setReaderConfig("backgroundColor", "rgba(44,47,49,1)");
      ConfigService.setReaderConfig("textColor", "rgba(255,255,255,1)");
    } else if (
      skin === "light" ||
      (ConfigService.getReaderConfig("appSkin") === "system" &&
        ConfigService.getReaderConfig("isOSNight") !== "yes")
    ) {
      ConfigService.setReaderConfig("backgroundColor", "rgba(255,255,255,1)");
      ConfigService.setReaderConfig("textColor", "rgba(0,0,0,1)");
    }

    reloadManager();
  };

  const changeFont = async (font: string) => {
    ConfigService.setReaderConfig(
      "systemFont",
      font === "Built-in font" ? "" : font
    );
    await applyCustomSystemFont();
    forceUpdate();
  };

  const handleTheme = (color: string, index: number) => {
    setState((prevState) => ({
      ...prevState,
      currentThemeIndex: index,
      isShowCustomColorPicker: false,
    }));
    ConfigService.setReaderConfig("themeColor", color);
    reloadManager();
  };

  const handleCustomColor = (color: string) => {
    setState((prevState) => ({
      ...prevState,
      pendingCustomColor: color,
    }));
  };

  const handleConfirmCustomColor = () => {
    const color = state.pendingCustomColor;
    setState((prevState) => ({
      ...prevState,
      customColor: color,
      currentThemeIndex: -1,
      isShowCustomColorPicker: false,
    }));
    ConfigService.setReaderConfig("themeColor", color);
    reloadManager();
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
            isEnabled={(state as any)[item.propName]}
            onClick={() => {
              handleSetting(item.propName);
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
      {renderSwitchOption(appearanceSettingList)}
      <div className="setting-dialog-new-title">
        <Trans>System font</Trans>
        <select
          name=""
          className="lang-setting-dropdown"
          value={ConfigService.getReaderConfig("systemFont") || "Built-in font"}
          onChange={(event) => {
            changeFont(event.target.value);
          }}
        >
          {state.fontOptions.map((item) => (
            <option
              value={item.value}
              key={item.value}
              className="lang-setting-option"
            >
              {item.value === "Built-in font"
                ? t(item.label)
                : item.label}
            </option>
          ))}
        </select>
      </div>
      <div className="setting-dialog-new-title">
        <Trans>Theme color</Trans>
      </div>
      <ul className="theme-setting-container">
        {themeList.map((item, index) => (
          <li
            className={
              index === state.currentThemeIndex
                ? "theme-setting-item active-theme-item"
                : "theme-setting-item"
            }
            key={item.color}
            onClick={() => {
              handleTheme(item.color, index);
            }}
            style={{
              color:
                item.color === "default" ? "rgba(75, 75, 75, 1)" : item.color,
            }}
          >
            <span
              className="theme-setting-dot"
              style={{
                backgroundColor:
                  item.color === "default"
                    ? "rgba(75, 75, 75, 1)"
                    : item.color,
              }}
            ></span>
            <span className="theme-setting-title">
              <Trans>{item.title}</Trans>
            </span>
          </li>
        ))}
        <li
          className={
            state.currentThemeIndex === -1
              ? "theme-setting-item active-theme-item"
              : "theme-setting-item"
          }
          onClick={() => {
            setState((prevState) => ({
              ...prevState,
              isShowCustomColorPicker: !state.isShowCustomColorPicker,
              pendingCustomColor: state.customColor,
            }));
          }}
          style={{ color: state.customColor }}
        >
          <span
            className="theme-setting-dot"
            style={{
              backgroundColor:
                state.currentThemeIndex === -1 ? state.customColor : undefined,
            }}
          >
            <span
              className={
                state.isShowCustomColorPicker ? "icon-check" : "icon-more"
              }
              style={{
                fontSize: "12px",
                position: "relative",
                top: "2px",
                left: "2px",
              }}
            ></span>
          </span>
          <span className="theme-setting-title">
            <Trans>Custom</Trans>
          </span>
        </li>
      </ul>
      {state.isShowCustomColorPicker && (
        <div className="custom-color-picker-container">
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
            }}
          >
            <HexColorPicker
              color={state.pendingCustomColor}
              onChange={handleCustomColor}
              style={{
                margin: "10px 0",
                animation: "fade-in 0.2s ease-in-out 0s 1",
              }}
            />
            <input
              className="color-input-box"
              style={{ marginBottom: 8 }}
              value={state.pendingCustomColor}
              placeholder="#rrggbb / rgba(r,g,b,a)"
              onChange={(e) =>
                setState((prevState) => ({
                  ...prevState,
                  pendingCustomColor: e.target.value,
                }))
              }
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  const hex = parseColorInput(state.pendingCustomColor);
                  if (hex)
                    setState((prevState) => ({
                      ...prevState,
                      pendingCustomColor: hex,
                    }));
                }
              }}
              onBlur={() => {
                const hex = parseColorInput(state.pendingCustomColor);
                if (hex)
                  setState((prevState) => ({
                    ...prevState,
                    pendingCustomColor: hex,
                  }));
              }}
            />
            <span
              className="change-location-button"
              onClick={handleConfirmCustomColor}
              style={{ marginBottom: "10px" }}
            >
              <Trans>Confirm</Trans>
            </span>
          </div>
        </div>
      )}
      <div className="setting-dialog-new-title">
        <Trans>Appearance</Trans>
      </div>
      <ul className="skin-setting-container">
        {skinList.map((item) => (
          <li
            key={item.value}
            className={
              item.value ===
              (ConfigService.getReaderConfig("appSkin") || "system")
                ? "skin-setting-item active-skin-item"
                : "skin-setting-item"
            }
            onClick={() => {
              changeSkin(item.value);
            }}
          >
            <span
              className="skin-setting-icon"
              dangerouslySetInnerHTML={{ __html: item.icon }}
            />
            <Trans>{item.label}</Trans>
          </li>
        ))}
      </ul>
    </>
  );
};

export default AppearanceSetting;
