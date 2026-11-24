import { useTranslation } from "react-i18next";
import React, { useState } from "react";
import "./settingPanel.css";
import { isReadingRawPDF } from "../../../utils/common";
import ThemeList from "../../../components/readerSettings/themeList";
import SliderList from "../../../components/readerSettings/sliderList";
import DropdownList from "../../../components/readerSettings/dropdownList";
import ModeControl from "../../../components/readerSettings/modeControl";
import SettingSwitch from "../../../components/readerSettings/settingSwitch";
import { Trans } from "react-i18next";
import {
  ConfigService,
  KookitConfig,
} from "../../../assets/lib/kookit-extra-browser.min";
import { sliderConfigs } from "../../../constants/dropdownList";
import toast from "react-hot-toast";
import { useAppStore } from "../../../store/useAppStore";

const SETTING_PANEL_MORE_KEY = "isSettingPanelMoreOpen";

const PanelDropdownList = DropdownList as unknown as React.ComponentType<{
  group?: string;
}>;
const PanelSettingSwitch = SettingSwitch as unknown as React.ComponentType<{
  group?: string;
}>;

const SettingPanel = () => {
  const currentBook = useAppStore((s) => s.book.currentBook);
  const backgroundColor = useAppStore((s) => s.reader.backgroundColor);
  const isSettingLocked = useAppStore((s) => s.reader.isSettingLocked);
  const readerMode = useAppStore((s) => s.reader.readerMode);
  const renderBookFunc = useAppStore((s) => s.book.renderBookFunc);
  const handleSettingLock = useAppStore((s) => s.handleSettingLock);
  const handleBackgroundColor = useAppStore((s) => s.handleBackgroundColor);
  const { t } = useTranslation();
  const [isShowMenu, setIsShowMenu] = useState(false);
  const [isMoreOpen, setIsMoreOpen] = useState(
    () => ConfigService.getReaderConfig(SETTING_PANEL_MORE_KEY) === "yes"
  );

  const handleToggleMore = () => {
    const next = !isMoreOpen;
    setIsMoreOpen(next);
    ConfigService.setReaderConfig(SETTING_PANEL_MORE_KEY, next ? "yes" : "no");
  };

  const handleLock = () => {
    handleSettingLock(!isSettingLocked);
    ConfigService.setReaderConfig(
      "isSettingLocked",
      !isSettingLocked ? "yes" : "no"
    );
    // 固定 / 取消固定后的正文重排由 Viewer 监听 isNavLocked / isSettingLocked 统一触发
  };

  const handleClearAllStyle = () => {
    if (
      ConfigService.getAllListConfig("seperateStyleBooks").includes(
        currentBook.key
      )
    ) {
      ConfigService.deleteObjectConfig(
        currentBook.key,
        "seperateStyleConfig"
      );
    } else {
      const readerConfig = ConfigService.getAllObjectConfig("readerConfig");
      KookitConfig.StyleKeys.forEach((key) => delete readerConfig[key]);
      ConfigService.setAllObjectConfig(readerConfig, "readerConfig");
    }

    toast.success(t("Clear successful"));
    handleBackgroundColor("");
    renderBookFunc();
  };

  const isPDF = isReadingRawPDF(currentBook);
  const renderSliders = (modes: string[]) => {
    return sliderConfigs
      .filter(
        (item) =>
          modes.includes(item.mode) &&
          (!isPDF || item.isPDF) &&
          // 页间距只在双页模式下有意义
          (item.mode !== "pageGap" || readerMode === "double")
      )
      .map((item) => <SliderList key={item.mode} item={item} variant="panel" />);
  };

  const renderSection = (title: string, children: React.ReactNode) => (
    <div className="setting-panel-section">
      <div className="setting-panel-section-title">
        <Trans>{title}</Trans>
      </div>
      {children}
    </div>
  );

  return (
    <div
      className="setting-panel-parent"
      style={{
        backgroundColor: isSettingLocked ? backgroundColor : "",
        color: isSettingLocked
          ? ConfigService.getReaderConfig("textColor")
          : "",
      }}
    >
      <span
        className={
          isSettingLocked
            ? "icon-lock lock-icon"
            : "icon-unlock lock-icon"
        }
        onClick={() => {
          handleLock();
        }}
      ></span>

      <div className="setting-panel-title">
        <Trans>Reading option</Trans>
      </div>
      <div className="setting-panel">
        {renderSection(
          "Theme",
          <>
            <ThemeList />
            {renderSliders(["brightness"])}
          </>
        )}
        {!isPDF &&
          renderSection(
            "Font",
            <>
              {renderSliders(["fontSize", "letterSpacing"])}
              <PanelDropdownList group="font" />
            </>
          )}
        {renderSection(
          "View mode",
          <>
            <ModeControl />
            {renderSliders(["margin", "pageGap", "paraSpacing"])}
            <PanelDropdownList group="layout" />
          </>
        )}
        <div className="setting-panel-more-toggle" onClick={handleToggleMore}>
          <Trans>More settings</Trans>
          <span
            className="icon-dropdown setting-panel-more-icon"
            style={isMoreOpen ? { transform: "rotate(180deg)" } : {}}
          ></span>
        </div>
        {isMoreOpen && (
          <div className="setting-panel-more">
            <PanelSettingSwitch group="theme" />
            <PanelSettingSwitch group="layout" />
            {!isPDF && <PanelSettingSwitch group="font" />}
            <PanelDropdownList group="more" />
            <PanelSettingSwitch group="more" />
          </div>
        )}
        <div className="setting-panel-menu" style={{ marginTop: "5px" }}>
          <span
            className="icon-more menu-icon"
            onClick={() => {
              setIsShowMenu((prev) => !prev);
            }}
            style={{ fontSize: "15px" }}
          ></span>
        </div>
        <div
          className="action-dialog-container"
          style={{
            right: 5,
            top: 5,
            width: 150,
            display: isShowMenu ? "block" : "none",
          }}
          onMouseLeave={() => {
            setIsShowMenu(false);
          }}
        >
          <div className="action-dialog-actions-container" style={{}}>
            <div
              className="action-dialog-add"
              onClick={() => {
                handleClearAllStyle();
              }}
            >
              <p className="action-name">
                <Trans>Clear all style</Trans>
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SettingPanel;
