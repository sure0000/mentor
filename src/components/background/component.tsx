import { useEffect, useState } from "react";
import "./background.css";
import { ConfigService } from "../../assets/lib/kookit-extra-browser.min";
import {
  getPageWidth,
  getRightPanelInset,
  throttle,
} from "../../utils/common";
import { useAppStore } from "../../store/useAppStore";
import { useLatest } from "../../utils/hooks/useLatest";

const Background = () => {
  const readerMode = useAppStore((s) => s.reader.readerMode);
  const isNavLocked = useAppStore((s) => s.reader.isNavLocked);
  const isSettingLocked = useAppStore((s) => s.reader.isSettingLocked);
  const isDockedRight = useAppStore((s) => s.reader.isDockedRight);
  const backgroundColor = useAppStore((s) => s.reader.backgroundColor);
  const isHideBackground = useAppStore((s) => s.reader.isHideBackground);
  const scale = useAppStore((s) => s.reader.scale);
  const isFitPage = useAppStore((s) => s.reader.isFitPage);
  const margin = useAppStore((s) => s.reader.margin);
  const [isSingle, setIsSingle] = useState(readerMode !== "double");
  const [pageSize, setPageSize] = useState<{
    pageOffset: string;
    pageWidth: string;
  }>({ pageOffset: "", pageWidth: "" });
  const currentProps = {
    readerMode,
    scale,
    margin,
    isNavLocked,
    isSettingLocked,
    isDockedRight,
    isFitPage,
  };
  const propsRef = useLatest(currentProps);

  useEffect(() => {
    const current = propsRef.current;
    setPageSize(
      getPageWidth(
        current.readerMode,
        current.scale,
        parseInt(current.margin),
        current.isNavLocked,
        getRightPanelInset(current.isSettingLocked, current.isDockedRight),
        current.isFitPage
      )
    );
    const resizeHandler = throttle(() => {
      const latest = propsRef.current;
      setPageSize(
        getPageWidth(
          latest.readerMode,
          latest.scale,
          parseInt(latest.margin),
          latest.isNavLocked,
          getRightPanelInset(latest.isSettingLocked, latest.isDockedRight),
          latest.isFitPage
        )
      );
    });
    window.addEventListener("resize", resizeHandler);
    return () => {
      window.removeEventListener("resize", resizeHandler);
    };
  }, []);

  useEffect(() => {
    setPageSize(
      getPageWidth(
        readerMode,
        scale,
        parseInt(margin),
        isNavLocked,
        getRightPanelInset(isSettingLocked, isDockedRight),
        isFitPage
      )
    );
  }, [
    margin,
    scale,
    readerMode,
    isNavLocked,
    isSettingLocked,
    isDockedRight,
    isFitPage,
  ]);

  useEffect(() => {
    setIsSingle(readerMode !== "double");
  }, [readerMode]);

  return (
    <>
      {!isHideBackground && (
        <>
          <div
            className="background-box2"
            style={
              isSingle
                ? {
                    left: pageSize.pageOffset,
                    marginLeft: -50,
                    width: `calc(${pageSize.pageWidth} + 98px)`,
                    boxShadow: "0 0 0px rgba(191, 191, 191, 1)",
                  }
                : {
                    left: isNavLocked ? 305 : 5,
                    right: getRightPanelInset(isSettingLocked, isDockedRight) + 5,
                  }
            }
          ></div>

          <div
            className="background-box3"
            style={
              isSingle
                ? {
                    marginLeft: -50,
                    left: pageSize.pageOffset,
                    width: `calc(${pageSize.pageWidth} + 100px)`,
                  }
                : {
                    left: isNavLocked ? 307 : 7,
                    right: getRightPanelInset(isSettingLocked, isDockedRight) + 7,
                  }
            }
          >
            {(() => {
              const isDarkMode =
                (!backgroundColor &&
                  (ConfigService.getReaderConfig("appSkin") === "night" ||
                    (ConfigService.getReaderConfig("appSkin") === "system" &&
                      ConfigService.getReaderConfig("isOSNight") === "yes"))) ||
                backgroundColor === "rgba(44,47,49,1)";

              const shadowOpacity = isDarkMode ? 0.5 : undefined;

              return (
                <>
                  <div
                    className="spine-shadow-left"
                    style={{
                      ...(isSingle && { display: "none" }),
                      ...(shadowOpacity && { opacity: shadowOpacity }),
                    }}
                  ></div>
                  <div
                    className="book-spine"
                    style={isSingle ? { display: "none" } : {}}
                  ></div>
                  <div
                    className="spine-shadow-right"
                    style={{
                      ...(isSingle && {
                        position: "relative",
                        right: 0,
                      }),
                      ...(shadowOpacity && { opacity: shadowOpacity }),
                    }}
                  ></div>
                </>
              );
            })()}
          </div>

          <div
            className="background-box1"
            style={
              isSingle
                ? {
                    marginLeft: -50,
                    left: pageSize.pageOffset,
                    width: `calc(${pageSize.pageWidth} + 102px)`,
                    boxShadow: "0 0 0px rgba(191, 191, 191, 1)",
                  }
                : {
                    left: isNavLocked ? 309 : 9,
                    right: getRightPanelInset(isSettingLocked, isDockedRight) + 9,
                  }
            }
          ></div>
        </>
      )}
    </>
  );
};

export default Background;
