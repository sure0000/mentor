import { useTranslation } from "react-i18next";
import { useReducer, useState } from "react";
import {
  backgroundList,
  DAY_BG,
  DAY_TEXT,
  readerPresetThemes,
  textList,
} from "../../../constants/themeList";
import "./themeList.css";
import { Trans } from "react-i18next";
import {
  ConfigService,
  KookitConfig,
} from "../../../assets/lib/kookit-extra-browser.min";
import { HexColorPicker } from "react-colorful";
import toast from "react-hot-toast";
import { normalizePickerColor, parseColorInput } from "../../../utils/common";
import { useAppStore } from "../../../store/useAppStore";

export interface ThemeListState {
  currentBackgroundIndex: number;
  currentTextIndex: number;
  isShowTextPicker: boolean;
  isShowBgPicker: boolean;
  bgColorInput: string;
  textColorInput: string;
  pendingBgColor: string;
  pendingTextColor: string;
}

const ThemeList = () => {
  const renderBookFunc = useAppStore((s) => s.book.renderBookFunc);
  const handleBackgroundColor = useAppStore((s) => s.handleBackgroundColor);
  const { t } = useTranslation();
  const [state, setState] = useState<ThemeListState>(() => ({
    currentBackgroundIndex: backgroundList
      .concat(ConfigService.getAllListConfig("themeColors"))
      .findIndex((item) => {
        return (
          item ===
          (ConfigService.getReaderConfig("backgroundColor") ||
            DAY_BG)
        );
      }),
    currentTextIndex: textList
      .concat(ConfigService.getAllListConfig("themeColors"))
      .findIndex((item) => {
        return (
          item ===
          (ConfigService.getReaderConfig("textColor") || DAY_TEXT)
        );
      }),
    isShowTextPicker: false,
    isShowBgPicker: false,
    bgColorInput: normalizePickerColor(
      ConfigService.getReaderConfig("backgroundColor"),
      "#ffffff"
    ),
    textColorInput: normalizePickerColor(
      ConfigService.getReaderConfig("textColor"),
      "#000000"
    ),
    pendingBgColor: normalizePickerColor(
      ConfigService.getReaderConfig("backgroundColor"),
      "#ffffff"
    ),
    pendingTextColor: normalizePickerColor(
      ConfigService.getReaderConfig("textColor"),
      "#000000"
    ),
  }));
  const [, forceUpdate] = useReducer((x) => x + 1, 0);
  const [isShowCustom, setIsShowCustom] = useState(false);

  const updateState = (patch: Partial<ThemeListState>) => {
    setState((prev) => ({ ...prev, ...patch }));
  };

  const getPresetIndex = (backgroundColor: string, textColor: string) => {
    return [...readerPresetThemes, ...KookitConfig.PresetThemeList.slice(4)].findIndex((item) => {
      return (
        item.backgroundColor === backgroundColor && item.textColor === textColor
      );
    });
  };

  const handleChangeBgColor = (color: string, index: number = -1) => {
    ConfigService.setReaderConfig("backgroundColor", color);
    handleBackgroundColor(color);
    updateState({
      currentBackgroundIndex: index,
    });
    // 选内置背景时同步配套文字色，避免夜间背景配深色字
    if (index >= 0 && index < textList.length) {
      ConfigService.setReaderConfig("textColor", textList[index]);
    }
    renderBookFunc();
  };

  const handlePreviewBgColor = (color: string) => {
    updateState({ bgColorInput: color, pendingBgColor: color });
  };
  const handlePreviewTextColor = (color: string) => {
    updateState({ textColorInput: color, pendingTextColor: color });
  };
  const handleColorTextPicker = (isShowTextPicker: boolean) => {
    if (!isShowTextPicker) {
      const pendingHex = state.pendingTextColor;
      const exists = textList
        .concat(ConfigService.getAllListConfig("themeColors"))
        .some((item) => normalizePickerColor(item, "#000000") === pendingHex);
      if (!exists) {
        ConfigService.setListConfig(pendingHex, "themeColors");
      }
      const appliedColor =
        ConfigService.getReaderConfig("textColor") || DAY_TEXT;
      updateState({
        currentTextIndex: textList
          .concat(ConfigService.getAllListConfig("themeColors"))
          .indexOf(appliedColor),
      });
    } else {
      const current = normalizePickerColor(
        ConfigService.getReaderConfig("textColor"),
        "#000000"
      );
      updateState({
        pendingTextColor: current,
        textColorInput: current,
      });
    }
    updateState({ isShowTextPicker });
  };
  const handleColorBgPicker = (isShowBgPicker: boolean) => {
    if (!isShowBgPicker) {
      const pendingHex = state.pendingBgColor;
      const exists = backgroundList
        .concat(ConfigService.getAllListConfig("themeColors"))
        .some((item) => normalizePickerColor(item, "#ffffff") === pendingHex);
      if (!exists) {
        ConfigService.setListConfig(pendingHex, "themeColors");
      }
      const appliedColor =
        ConfigService.getReaderConfig("backgroundColor") ||
        DAY_BG;
      updateState({
        currentBackgroundIndex: backgroundList
          .concat(ConfigService.getAllListConfig("themeColors"))
          .indexOf(appliedColor),
      });
    } else {
      const current = normalizePickerColor(
        ConfigService.getReaderConfig("backgroundColor"),
        "#ffffff"
      );
      updateState({
        pendingBgColor: current,
        bgColorInput: current,
      });
    }
    updateState({ isShowBgPicker });
  };
  const handleChooseTextColor = (color: string) => {
    updateState({
      currentTextIndex: textList
        .concat(ConfigService.getAllListConfig("themeColors"))
        .indexOf(color),
      textColorInput: normalizePickerColor(color, "#000000"),
      pendingTextColor: normalizePickerColor(color, "#000000"),
    });
    ConfigService.setReaderConfig("textColor", color);
    renderBookFunc();
  };

  const handleChoosePreset = (preset: {
    textColor: string;
    backgroundColor: string;
  }) => {
    ConfigService.setReaderConfig("backgroundColor", preset.backgroundColor);
    ConfigService.setReaderConfig("textColor", preset.textColor);
    handleBackgroundColor(preset.backgroundColor);
    const bgIndex = backgroundList
      .concat(ConfigService.getAllListConfig("themeColors"))
      .indexOf(preset.backgroundColor);
    const textIndex = textList
      .concat(ConfigService.getAllListConfig("themeColors"))
      .indexOf(preset.textColor);
    updateState({
      currentBackgroundIndex: bgIndex,
      currentTextIndex: textIndex,
      bgColorInput: normalizePickerColor(preset.backgroundColor, "#ffffff"),
      textColorInput: normalizePickerColor(preset.textColor, "#000000"),
    });
    renderBookFunc();
  };

  const renderBackgroundColorList = () => {
    return backgroundList
      .concat(ConfigService.getAllListConfig("themeColors"))
      .map((item, index) => {
        return (
          <li
            key={item + index}
            className={
              index === state.currentBackgroundIndex
                ? "active-color background-color-circle"
                : "background-color-circle"
            }
            onClick={() => {
              handleChangeBgColor(item, index);
            }}
            style={{ backgroundColor: item }}
          >
            {index > 3 && (
              <span
                className="icon-close theme-color-delete theme-color-delete-hover theme-color-delete-button"
                onClick={(e) => {
                  e.stopPropagation();
                  ConfigService.deleteListConfig(item, "themeColors");
                  if (index === state.currentBackgroundIndex) {
                    handleChangeBgColor(backgroundList[0], 0);
                  } else {
                    forceUpdate();
                  }
                }}
              ></span>
            )}
          </li>
        );
      });
  };
  const renderTextColorList = () => {
    return textList
      .concat(ConfigService.getAllListConfig("themeColors"))
      .map((item, index) => {
        return (
          <li
            key={item + index}
            className={
              index === state.currentTextIndex
                ? "active-color background-color-circle"
                : "background-color-circle"
            }
            onClick={() => {
              handleChooseTextColor(item);
            }}
            style={{ backgroundColor: item }}
          >
            {index > 3 && (
              <span
                className="icon-close theme-color-delete theme-color-delete-hover"
                onClick={(e) => {
                  e.stopPropagation();
                  ConfigService.deleteListConfig(item, "themeColors");
                  if (index === state.currentTextIndex) {
                    handleChooseTextColor(textList[0]);
                  } else {
                    forceUpdate();
                  }
                }}
              ></span>
            )}
          </li>
        );
      });
  };

  const renderColorPicker = (type: "bg" | "text") => {
    const isBg = type === "bg";
    const inputValue = isBg ? state.bgColorInput : state.textColorInput;
    const pendingValue = isBg ? state.pendingBgColor : state.pendingTextColor;
    const handlePreview = isBg ? handlePreviewBgColor : handlePreviewTextColor;
    return (
      <div className="theme-color-picker">
        <HexColorPicker
          color={pendingValue}
          onChange={handlePreview}
          style={{
            marginBottom: 10,
            animation: "fade-in 0.2s ease-in-out 0s 1",
          }}
        />
        <input
          className="color-input-box"
          value={inputValue}
          placeholder="#rrggbb / rgba(r,g,b,a)"
          onChange={(e) =>
            updateState(
              isBg
                ? { bgColorInput: e.target.value }
                : { textColorInput: e.target.value }
            )
          }
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              const hex = parseColorInput(inputValue);
              if (hex) handlePreview(hex);
            }
          }}
          onBlur={() => {
            const hex = parseColorInput(inputValue);
            if (hex) handlePreview(hex);
            else
              updateState(
                isBg
                  ? { bgColorInput: pendingValue }
                  : { textColorInput: pendingValue }
              );
          }}
        />
      </div>
    );
  };

  const currentBg =
    ConfigService.getReaderConfig("backgroundColor") || DAY_BG;
  const currentText =
    ConfigService.getReaderConfig("textColor") || DAY_TEXT;
  const activePresetIndex = getPresetIndex(currentBg, currentText);
  const isZh = (ConfigService.getReaderConfig("lang") || "").startsWith("zh");
  // 微信读书式：常用主题平铺展示，其余主题与自定义颜色收进「自定义」
  const mainPresets = readerPresetThemes;
  const extraPresets = KookitConfig.PresetThemeList.slice(4);

  const renderPreset = (
    item: { key: string; title: string; backgroundColor: string; textColor: string },
    index: number,
    size: "large" | "small"
  ) => (
    <div
      key={item.key}
      className={
        "preset-theme-item preset-theme-item-" +
        size +
        (index === activePresetIndex ? " active" : "")
      }
      style={{
        backgroundColor: item.backgroundColor,
        color: item.textColor,
      }}
      title={t(item.title)}
      onClick={() => {
        handleChoosePreset(item);
      }}
    >
      <span className="preset-theme-text">
        {size === "large" ? "Aa" : isZh ? t(item.title) : "A"}
      </span>
    </div>
  );

  return (
    <div className="background-color-setting">
      <div className="preset-theme-main">
        {mainPresets.map((item, index) => renderPreset(item, index, "large"))}
      </div>
      <div
        className="theme-custom-toggle"
        onClick={() => {
          setIsShowCustom((prev) => !prev);
        }}
      >
        <Trans>Customize</Trans>
        <span
          className="icon-dropdown theme-custom-toggle-icon"
          style={isShowCustom ? { transform: "rotate(180deg)" } : {}}
        ></span>
      </div>
      {isShowCustom && (
        <div className="theme-custom-section">
          <div className="preset-theme-list">
            {extraPresets.map((item, index) =>
              renderPreset(item, index + mainPresets.length, "small")
            )}
          </div>
          <div className="background-color-text">
            <Trans>Background color</Trans>
            <span
              className="theme-color-clear-button"
              onClick={() => {
                ConfigService.setReaderConfig("backgroundColor", "");
                handleBackgroundColor("");
                toast.success(t("Removal successful"));
                renderBookFunc();
              }}
            >
              <Trans>Clear</Trans>
            </span>
          </div>
          <ul className="background-color-list">
            <li
              className="background-color-circle theme-color-add"
              onClick={() => {
                handleColorBgPicker(!state.isShowBgPicker);
              }}
            >
              <span
                className={state.isShowBgPicker ? "icon-check" : "icon-add"}
              ></span>
            </li>
            {renderBackgroundColorList()}
          </ul>
          {state.isShowBgPicker && renderColorPicker("bg")}
          <div className="background-color-text">
            <Trans>Text color</Trans>
            <span
              className="theme-color-clear-button"
              onClick={() => {
                ConfigService.setReaderConfig("textColor", "");
                toast.success(t("Removal successful"));
                renderBookFunc();
              }}
            >
              <Trans>Clear</Trans>
            </span>
          </div>
          <ul className="background-color-list">
            <li
              className="background-color-circle theme-color-add"
              onClick={() => {
                handleColorTextPicker(!state.isShowTextPicker);
              }}
            >
              <span
                className={state.isShowTextPicker ? "icon-check" : "icon-add"}
              ></span>
            </li>
            {renderTextColorList()}
          </ul>
          {state.isShowTextPicker && renderColorPicker("text")}
        </div>
      )}
    </div>
  );
};

export default ThemeList;
